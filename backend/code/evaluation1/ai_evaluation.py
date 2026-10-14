import asyncio
import json
import logging
import os
from typing import Dict, List, Optional, Tuple
import datetime

from code.evaluation import ai_client
from code.evaluation.ai_client import LLMProviderError
from code.evaluation.gibberish_detector import is_gibberish, get_gibberish_reason
from code.evaluation.scoring_engine import (
    SCORING_ENGINE_VERSION,
    BATCH_TOOL_WITH_SUMMARY,
    SUMMARY_TOOL,
    TECHNICAL_BATCH_TOOL,
    TECHNICAL_SINGLE_TOOL,
    check_evaluation_consistency,
    clamp_score,
    compute_average_score,
    derive_reference_answer,
    derive_technical_performance_grade,
    render_overall_summary,
    rubric_drift_warning,
    validate_math,
)
from code.evaluation.prompts import (
    _build_intro_prompt,
    _build_summary_prompt,
    _build_technical_batch_prompt,
    _build_technical_single_prompt,
)

logger = logging.getLogger("evaluation.ai_evaluation")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

CHUNK_SIZE = 9
MAX_CONCURRENT_LLM_CALLS = max(1, int(os.getenv("EVAL_MAX_CONCURRENT_LLM_CALLS", "3")))
CHUNK_MAX_TOKENS = int(os.getenv("EVAL_CHUNK_MAX_TOKENS", "6000"))
SINGLE_MAX_TOKENS = int(os.getenv("EVAL_SINGLE_MAX_TOKENS", "2000"))
SUMMARY_MAX_TOKENS = int(os.getenv("EVAL_SUMMARY_MAX_TOKENS", "800"))
FEEDBACK_MAX_CHARS = 600

_LLM_SEMAPHORE = asyncio.Semaphore(MAX_CONCURRENT_LLM_CALLS)

_INTRO_SYSTEM = "You are an expert interview coach evaluating a candidate's self-introduction."
_TECH_SYSTEM = ("You are an expert technical interviewer grading a candidate's answers "
                "objectively and consistently against a fixed rubric.")
_SUMMARY_SYSTEM = ("You are an expert technical interviewer writing a holistic summary of a "
                   "candidate's TECHNICAL performance only.")

_SUMMARY_UNAVAILABLE = "Technical summary unavailable for this session."
_SUMMARY_INCOMPLETE = ("Technical summary unavailable: too many answers failed automatic "
                       "evaluation this session. Manual review required.")


class _ChunkEvaluationError(Exception):
    """A chunk call failed entirely - triggers per-question fanout."""


# ---------------------------------------------------------------------------
# Debug I/O logging
# ---------------------------------------------------------------------------

DEBUG_LOG_AI_IO = os.getenv("EVAL_DEBUG_LOG_AI_IO", "false").strip().lower() in ("1", "true", "yes")


def _debug_log_prompt(label: str, prompt: str) -> None:
    if not DEBUG_LOG_AI_IO:
        return
    print(f"\n{'=' * 80}\n📝 [PROMPT SENT] {label}  ({len(prompt)} chars)\n{'=' * 80}")
    print(prompt)
    print(f"{'=' * 80}\n")


def _debug_log_response(label: str, raw) -> None:
    if not DEBUG_LOG_AI_IO:
        return
    print(f"\n{'=' * 80}\n📤 [AI RAW OUTPUT] {label}\n{'=' * 80}")
    try:
        print(json.dumps(raw, indent=2, ensure_ascii=False, default=str))
    except (TypeError, ValueError):
        print(repr(raw))
    print(f"{'=' * 80}\n")


# ---------------------------------------------------------------------------
# Intro-question detection
# ---------------------------------------------------------------------------

INTRO_CATEGORY_MARKERS = {"introduction", "intro", "self-introduction", "self introduction"}
INTRO_TEXT_MARKERS = (
    "introduce yourself",
    "tell me about yourself",
    "describe yourself",
    "walk me through your background",
)


def _is_intro_question(question_text: str, category: str = "") -> bool:
    if category and category.strip().lower() in INTRO_CATEGORY_MARKERS:
        return True
    text = (question_text or "").strip().lower()
    return any(marker in text for marker in INTRO_TEXT_MARKERS)


# ---------------------------------------------------------------------------
# Fallbacks + deterministic finalize
# ---------------------------------------------------------------------------

def _safe_fallback(question_text: str, answer: str, category: str,
                   error_msg: str, extra_reasons: Optional[List[str]] = None) -> dict:
    reasons = list(extra_reasons or [])
    reasons.append(f"Automatic evaluation failed: {str(error_msg)[:120]}")
    return {
        "score": 0.0, "correctness": 0, "completeness": 0, "clarity": 0,
        "feedback": "Automatic evaluation failed for this answer. Please have it reviewed manually.",
        "topic": None,
        "evidence": {"expected_key_points": [], "key_point_coverage": [], "contradictions": []},
        "expected_key_points": [],
        "ai_used": False,
        "needs_human_review": True,
        "review_reasons": reasons,
        "clarity_explanation": "Evaluation failed",
        "scoring_engine_version": SCORING_ENGINE_VERSION,
    }


def _gibberish_kill_switch(answer: str) -> Optional[dict]:
    if not is_gibberish(answer):
        return None
    _, reason = get_gibberish_reason(answer)
    return {
        "score": 0.0, "correctness": 0, "completeness": 0, "clarity": 0,
        "feedback": f"This answer does not appear to be a valid response ({reason}). No marks awarded.",
        "topic": None,
        "evidence": {"expected_key_points": [], "key_point_coverage": [], "contradictions": []},
        "expected_key_points": [],
        "ai_used": True,
        "needs_human_review": False,
        "review_reasons": [],
        "scoring_engine_version": SCORING_ENGINE_VERSION,
    }


def _split_gibberish(items: List[dict]) -> Tuple[List[dict], Dict[str, dict]]:
    clean, gibberish = [], {}
    for item in items:
        kill = _gibberish_kill_switch(item["answer"])
        if kill:
            gibberish[str(item["id"])] = kill
        else:
            clean.append(item)
    return clean, gibberish


def _missing_points_from_coverage(raw: dict) -> List[str]:
    pts = []
    for c in (raw.get("key_point_coverage") or []):
        if isinstance(c, dict) and c.get("status") in ("missing", "partial"):
            p = str(c.get("point") or "").strip()
            if p:
                pts.append(p)
    return pts


def _ensure_missing_points_in_feedback(feedback: str, raw: dict) -> str:
    fb = feedback.lower()
    if any(k in fb for k in ("missing", "not mention", "did not cover", "left out",
                             "could add", "should add", "could include")):
        return feedback
    missing = _missing_points_from_coverage(raw)[:2]
    if not missing:
        return feedback
    return f"{feedback} Missing points: {', '.join(missing)}."


def _finalize_evaluation(raw: dict, existing_key_points: Optional[List[str]]) -> dict:
    missing_fields = [k for k in ("correctness", "completeness", "clarity") if raw.get(k) is None]
    correctness = clamp_score(raw.get("correctness"))
    completeness = clamp_score(raw.get("completeness"))
    clarity = clamp_score(raw.get("clarity"))
    
    # --- EVIDENCE VERIFICATION ---
    coverage = raw.get("key_point_coverage") or []
    verified_points = sum(1 for c in coverage if c.get("status") == "covered" and len(str(c.get("evidence_quote", "")).strip()) > 5)
    
    if len([c for c in coverage if c.get("status") == "covered"]) > verified_points:
        completeness = max(0, completeness - 1)

    feedback = str(raw.get("feedback") or "").strip()[:FEEDBACK_MAX_CHARS] or "Evaluation completed."
    feedback = _ensure_missing_points_in_feedback(feedback, raw)

    review_reasons: List[str] = []
    if missing_fields:
        review_reasons.append(
            f"Model response missing score fields {missing_fields}; scores defaulted to 0 "
            f"(parse-level failure).")
    math_reason = validate_math(raw)
    if math_reason:
        review_reasons.append(math_reason)
    review_reasons.extend(check_evaluation_consistency(raw))
    drift = rubric_drift_warning(raw.get("expected_key_points"), existing_key_points)
    if drift:
        review_reasons.append(drift)

    expected_key_points = [str(p) for p in
                           (raw.get("expected_key_points") or existing_key_points or [])
                           if str(p).strip()]

    return {
        "score": compute_average_score(correctness, completeness, clarity),
        "correctness": correctness,
        "completeness": completeness,
        "clarity": clarity,
        "feedback": feedback,
        "topic": (str(raw.get("topic")).strip() if raw.get("topic") else None),
        "evidence": {
            "expected_key_points": raw.get("expected_key_points") or [],
            "key_point_coverage": coverage,
            "contradictions": raw.get("contradictions") or [],
        },
        "expected_key_points": raw.get("expected_key_points") or [],
        "ai_used": True,
        "needs_human_review": bool(review_reasons),
        "review_reasons": review_reasons,
        "scoring_engine_version": SCORING_ENGINE_VERSION,
    }


# ---------------------------------------------------------------------------
# Single-question evaluation
# ---------------------------------------------------------------------------

async def _call_single_ai(
    question_text: str,
    answer: str,
    category: str = "General",
    reference_answer: Optional[str] = None,
    question_data: Optional[dict] = None,
    existing_key_points: Optional[List[str]] = None,
) -> dict:
    kill = _gibberish_kill_switch(answer)
    if kill:
        return kill
    if _is_intro_question(question_text, category):
        return await _evaluate_intro(question_text, answer, category)
    return await _evaluate_technical_single(
        question_text, answer, category, reference_answer, question_data, existing_key_points)


async def _evaluate_intro(question_text: str, answer: str, category: str) -> dict:
    prompt = _build_intro_prompt(question_text, answer)
    _debug_log_prompt("Intro question", prompt)
    try:
        raw_text = await ai_client.call_plain_text(
            system=_INTRO_SYSTEM, user_prompt=prompt, max_tokens=2000)
    except LLMProviderError as e:
        logger.error("[intro] all providers failed: %s", e)
        return _safe_fallback(question_text, answer, category, "all LLM providers failed")
    _debug_log_response("Intro question (raw text)", raw_text)

    parsed = ai_client.extract_json(raw_text)
    if not parsed or not all(parsed.get(k) is not None for k in ("correctness", "completeness", "clarity")):
        logger.warning("[intro] JSON parse/shape failure - raw response (first 800 chars): %s",
                       (raw_text or "")[:800])
        return _safe_fallback(question_text, answer, category, "intro response missing required score fields")

    correctness = clamp_score(parsed.get("correctness"))
    completeness = clamp_score(parsed.get("completeness"))
    clarity = clamp_score(parsed.get("clarity"))
    return {
        "score": compute_average_score(correctness, completeness, clarity),
        "correctness": correctness,
        "completeness": completeness,
        "clarity": clarity,
        "feedback": str(parsed.get("feedback") or "").strip()[:FEEDBACK_MAX_CHARS] or "Introduction evaluated.",
        "topic": "Self-Introduction",
        "evidence": {"expected_key_points": [], "key_point_coverage": [], "contradictions": []},
        "expected_key_points": [],
        "ai_used": True,
        "needs_human_review": False,
        "review_reasons": [],
        "scoring_engine_version": SCORING_ENGINE_VERSION,
    }


async def _evaluate_technical_single(
    question_text: str,
    answer: str,
    category: str,
    reference_answer: Optional[str],
    question_data: Optional[dict],
    existing_key_points: Optional[List[str]],
) -> dict:
    resolved_reference = derive_reference_answer(reference_answer, question_data)
    prompt = _build_technical_single_prompt(
        question_text, answer, category, resolved_reference, existing_key_points)
    _debug_log_prompt(f"Single question (id-less, q={question_text[:60]!r})", prompt)
    try:
        raw = await ai_client.call_with_tool(
            system=_TECH_SYSTEM, user_prompt=prompt,
            tool=TECHNICAL_SINGLE_TOOL, max_tokens=SINGLE_MAX_TOKENS)
        _debug_log_response("Single question", raw)
        return _finalize_evaluation(raw, existing_key_points)
    except LLMProviderError as e:
        logger.error("[single] all providers failed: %s", e)
        return _safe_fallback(question_text, answer, category, "all LLM providers failed")


# ---------------------------------------------------------------------------
# Summary rendering
# ---------------------------------------------------------------------------

def _item_score(q: dict) -> Optional[float]:
    v = q.get("score", q.get("average_score"))
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _render_session_summary(fields, items: List[dict]) -> Optional[str]:
    if not isinstance(fields, dict):
        return None
    scored_items = [q for q in items if q.get("ai_used")]
    scores = [s for s in (_item_score(q) for q in scored_items) if s is not None]
    if not scores:
        return None
    avg = sum(scores) / len(scores)
    llm_grade = str(fields.get("final_technical_performance") or "").strip()
    band_grade = derive_technical_performance_grade(avg)
    if llm_grade and llm_grade != band_grade:
        logger.warning("[summary] LLM grade %r != score band %r (avg %.2f) - using score band",
                       llm_grade, band_grade, avg)
    return render_overall_summary(fields, avg)


def _to_summary_items(entries: List[dict]) -> List[dict]:
    items = []
    for q in entries:
        scores = q.get("scores") if isinstance(q.get("scores"), dict) else q
        items.append({
            "id": q.get("id"),
            "topic": q.get("topic") or q.get("category") or "General",
            "correctness": scores.get("correctness"),
            "completeness": scores.get("completeness"),
            "clarity": scores.get("clarity"),
            "feedback": q.get("feedback") or "",
            "ai_used": bool(q.get("ai_used")),
            "skipped": bool(q.get("skipped", False)),
        })
    return items


async def _generate_ai_summary(entries: List[dict]) -> str:
    items = _to_summary_items(entries)
    scored = [it for it in items if it["ai_used"]]
    failed = [it for it in items if not it["ai_used"] and not it["skipped"]]
    if not scored or len(failed) > len(scored):
        logger.warning("[summary] %d scored / %d failed - skipping LLM summary",
                       len(scored), len(failed))
        return _SUMMARY_INCOMPLETE

    prompt = _build_summary_prompt(scored)
    try:
        fields = await ai_client.call_with_tool(
            system=_SUMMARY_SYSTEM, user_prompt=prompt,
            tool=SUMMARY_TOOL, max_tokens=SUMMARY_MAX_TOKENS)
    except LLMProviderError as e:
        logger.error("[summary] all providers failed: %s", e)
        return _SUMMARY_UNAVAILABLE
    summary = _render_session_summary(fields, items)
    return summary or _SUMMARY_UNAVAILABLE


# ---------------------------------------------------------------------------
# Chunked batch evaluation
# ---------------------------------------------------------------------------

async def _evaluate_chunk(chunk: List[dict]) -> Tuple[Dict[str, dict], List[dict]]:
    prompt = _build_technical_batch_prompt(chunk, include_summary=False)
    _debug_log_prompt(f"Batch of {len(chunk)} (no summary)", prompt)
    result = await ai_client.call_with_tool(
        system=_TECH_SYSTEM, user_prompt=prompt,
        tool=TECHNICAL_BATCH_TOOL, max_tokens=CHUNK_MAX_TOKENS)
    _debug_log_response(f"Batch of {len(chunk)} (no summary)", result)

    evaluations = result.get("evaluations")
    if not isinstance(evaluations, list) or not evaluations:
        raise _ChunkEvaluationError("batch response missing non-empty 'evaluations' array")

    item_by_id = {str(item["id"]): item for item in chunk}
    scored: Dict[str, dict] = {}
    for ev in evaluations:
        if not isinstance(ev, dict):
            continue
        qid = str(ev.get("id"))
        if qid not in item_by_id:
            logger.warning("[chunk] model returned unknown id %r; ignoring", qid)
            continue
        if qid in scored:
            continue
        item = item_by_id[qid]
        scored[qid] = _finalize_evaluation(ev, item.get("existing_key_points"))

    missing = [item for item in chunk if str(item["id"]) not in scored]
    if missing:
        logger.warning("[chunk] response covered %d/%d questions; %d will be re-evaluated "
                       "individually", len(scored), len(chunk), len(missing))
    return scored, missing


async def _evaluate_chunk_with_summary(chunk: List[dict]) -> Tuple[Dict[str, dict], List[dict], Optional[dict]]:
    prompt = _build_technical_batch_prompt(chunk, include_summary=True)
    _debug_log_prompt(f"Batch of {len(chunk)} (with summary)", prompt)
    result = await ai_client.call_with_tool(
        system=_TECH_SYSTEM, user_prompt=prompt,
        tool=BATCH_TOOL_WITH_SUMMARY, max_tokens=CHUNK_MAX_TOKENS)
    _debug_log_response(f"Batch of {len(chunk)} (with summary)", result)

    evaluations = result.get("evaluations")
    if not isinstance(evaluations, list) or not evaluations:
        raise _ChunkEvaluationError("batch+summary response missing non-empty 'evaluations' array")

    item_by_id = {str(item["id"]): item for item in chunk}
    scored: Dict[str, dict] = {}
    for ev in evaluations:
        if not isinstance(ev, dict):
            continue
        qid = str(ev.get("id"))
        if qid not in item_by_id or qid in scored:
            continue
        item = item_by_id[qid]
        scored[qid] = _finalize_evaluation(ev, item.get("existing_key_points"))

    missing = [item for item in chunk if str(item["id"]) not in scored]
    summary_fields = result.get("overall_summary")
    if missing:
        logger.warning("[chunk+summary] response covered %d/%d questions; %d will be "
                       "re-evaluated individually (summary kept)", len(scored), len(chunk), len(missing))
    return scored, missing, (summary_fields if isinstance(summary_fields, dict) else None)


async def _fanout_single(item: dict) -> dict:
    async with _LLM_SEMAPHORE:
        return await _call_single_ai(
            item["question_text"], item["answer"], item.get("category", "General"),
            reference_answer=item.get("reference_answer"),
            question_data=item.get("question_data"),
            existing_key_points=item.get("existing_key_points"),
        )


async def _fanout_to_singles(items: List[dict]) -> Dict[str, dict]:
    results = await asyncio.gather(*[_fanout_single(i) for i in items],
                                   return_exceptions=True)
    out: Dict[str, dict] = {}
    for item, res in zip(items, results):
        qid = str(item["id"])
        if isinstance(res, BaseException):
            logger.error("[fanout] single eval crashed for qid=%s: %s", qid, res)
            out[qid] = _safe_fallback(item["question_text"], item["answer"],
                                      item.get("category", "General"),
                                      f"single evaluation crashed: {res}")
        else:
            out[qid] = res
    return out


async def _run_chunk(chunk: List[dict]) -> Dict[str, dict]:
    async with _LLM_SEMAPHORE:
        try:
            scored, missing = await _evaluate_chunk(chunk)
        except Exception as e:
            logger.warning("[chunk] call failed (%s: %s) - fanning out to singles",
                           type(e).__name__, str(e)[:150])
            scored, missing = {}, list(chunk)
    if missing:
        scored.update(await _fanout_to_singles(missing))
    return scored


def _enrich(batch: List[dict]) -> List[dict]:
    enriched = []
    for item in batch:
        ref = derive_reference_answer(item.get("reference_answer"), item.get("question_data"))
        enriched.append({**item, "reference_answer": ref})
    return enriched


def _backfill_missing(enriched: List[dict], results: Dict[str, dict]) -> Dict[str, dict]:
    for item in enriched:
        qid = str(item["id"])
        if qid not in results:
            results[qid] = _safe_fallback(item["question_text"], item["answer"],
                                          item.get("category", "General"),
                                          "question lost during chunked evaluation")
    return results


async def _call_batch_ai(batch: List[dict]) -> Dict[str, dict]:
    if not batch:
        return {}
    enriched = _enrich(batch)
    clean, results = _split_gibberish(enriched)
    if clean:
        chunks = [clean[i: i + CHUNK_SIZE] for i in range(0, len(clean), CHUNK_SIZE)]
        logger.info("[batch] %d questions (%d gibberish filtered) -> %d chunk(s) of <=%d "
                    "(concurrency %d)", len(enriched), len(enriched) - len(clean),
                    len(chunks), CHUNK_SIZE, MAX_CONCURRENT_LLM_CALLS)
        chunk_results = await asyncio.gather(*[_run_chunk(c) for c in chunks],
                                             return_exceptions=True)
        for cr in chunk_results:
            if isinstance(cr, BaseException):
                logger.error("[batch] chunk crashed unexpectedly: %s", cr)
                continue
            results.update(cr)
    return _backfill_missing(enriched, results)


async def _call_batch_ai_with_summary(batch: List[dict]) -> dict:
    if not batch:
        return {"results": {}, "summary": None}

    enriched = _enrich(batch)
    clean, results = _split_gibberish(enriched)
    summary_fields: Optional[dict] = None

    if not clean:
        pass
    elif len(clean) <= CHUNK_SIZE:
        async with _LLM_SEMAPHORE:
            try:
                scored, missing, summary_fields = await _evaluate_chunk_with_summary(clean)
            except Exception as e:
                logger.warning("[batch+summary] call failed (%s: %s) - fanning out to singles",
                               type(e).__name__, str(e)[:150])
                scored, missing = {}, list(clean)
        if missing:
            scored.update(await _fanout_to_singles(missing))
        results.update(scored)
    else:
        chunks = [clean[i: i + CHUNK_SIZE] for i in range(0, len(clean), CHUNK_SIZE)]
        logger.info("[batch+summary] %d questions (%d gibberish filtered) -> %d no-summary "
                    "chunk(s) + 1 standalone summary call", len(enriched),
                    len(enriched) - len(clean), len(chunks))
        chunk_results = await asyncio.gather(*[_run_chunk(c) for c in chunks],
                                             return_exceptions=True)
        for cr in chunk_results:
            if isinstance(cr, BaseException):
                logger.error("[batch+summary] chunk crashed unexpectedly: %s", cr)
                continue
            results.update(cr)

    results = _backfill_missing(enriched, results)

    summary = _render_session_summary(summary_fields, list(results.values()))
    if summary is None:
        summary = await _generate_ai_summary(
            [{**r, "id": qid} for qid, r in results.items()])
    return {"results": results, "summary": summary}


# ---------------------------------------------------------------------------
# Behavioral / proctoring penalty
# ---------------------------------------------------------------------------

PENALTY_WEIGHTS = {
    "tab_switch": 5,
    "paste_detected": 3,
    "fullscreen_exit": 8,
    "no_face_detected": 2,
    "multiple_speakers_detected": 6,
    "face_mismatch": 5,
    "eye_contact_violation": 2,
    "voice_overlap": 6,
}
PER_TYPE_PENALTY_CAPS = {
    "tab_switch": 15, "paste": 9, "fullscreen_exit": 8, "devtools_open": 10,
    "window_blur": 12, "face_missing": 12, "multiple_voices": 18, "voice_overlap": 18,
}
MAX_PENALTY_PERCENTAGE = 40
DEBOUNCE_SECONDS = 3.0


def _event_timestamp(event: dict) -> Optional[float]:
    for key in ("timestamp", "ts", "t", "time"):
        v = event.get(key)
        if isinstance(v, (int, float)):
            return v / 1000.0 if v > 1e12 else float(v)
        if isinstance(v, str):
            try:
                f = float(v)
                return f / 1000.0 if f > 1e12 else f
            except ValueError:
                continue
    return None


def _compute_behavior(events: Optional[list]) -> dict:
    clean = [e for e in (events or [])
             if isinstance(e, dict) and isinstance(e.get("type"), str) and e["type"]]
    clean.sort(key=lambda e: (_event_timestamp(e) is None, _event_timestamp(e) or 0.0))

    counts: Dict[str, int] = {}
    debounced: Dict[str, int] = {}
    last_counted_at: Dict[str, float] = {}
    for e in clean:
        etype = e["type"]
        if etype == "fullscreen_exit_attempt":
            etype = "fullscreen_exit"
        counts[etype] = counts.get(etype, 0) + 1
        ts = _event_timestamp(e)
        if ts is None:
            debounced[etype] = debounced.get(etype, 0) + 1
            continue
        last = last_counted_at.get(etype)
        if last is None or (ts - last) >= DEBOUNCE_SECONDS:
            debounced[etype] = debounced.get(etype, 0) + 1
            last_counted_at[etype] = ts

    penalty = 0
    per_type_penalty: Dict[str, int] = {}
    for etype, n in debounced.items():
        p = min(PENALTY_WEIGHTS.get(etype, 0) * n,
                PER_TYPE_PENALTY_CAPS.get(etype, MAX_PENALTY_PERCENTAGE))
        per_type_penalty[etype] = p
        penalty += p

    total_v = sum(debounced.values())
    penalty = total_v / 10.0
    return {
        "classification": "Malpractices" if total_v >= 2 else "fair",
        "events_count": total_v,
        "violations": debounced,
        "penalty_percentage": penalty,
        "reasoning": f"Detected {total_v} critical violation(s)."
    }
