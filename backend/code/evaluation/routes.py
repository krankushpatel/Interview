# evaluation/routes.py - V3.1 snippet: final-evaluation trust & persistence.
#
# /evaluate-chunk and /status/{username} carry over from V3 UNCHANGED:
#   - /evaluate-chunk persists every score into the server-side session
#     document (question_results.{qid}) and returns a DISPLAY-ONLY payload;
#     nothing the browser posts back is ever trusted as input.
#   - /status keeps the stale-"processing" watchdog.
#
# V3.1 changes in the flow below:
#   - The 4-line technical summary comes from the batch call
#     (_call_batch_ai_with_summary) and NEVER references penalty/decision.
#   - Penalty/decision are still computed on the backend for the REPORT
#     (current frontend contract displays raw vs adjusted + decision). If
#     the roadmap removes them from the product, delete the marked block -
#     nothing else depends on it.

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP

import pymongo
from fastapi import APIRouter, BackgroundTasks, Form, HTTPException

from code.core.helpers import is_empty_answer, is_skipped_answer
from code.evaluation.ai_evaluation import (
    _call_batch_ai,
    _call_batch_ai_with_summary,
    _call_single_ai,
    _compute_behavior,
    _generate_ai_summary,
    _is_intro_question,
)
from code.evaluation.scoring_engine import (
    SCORING_ENGINE_VERSION,
    clamp_answer_words,
    align_summary_with_final_result,
)

logger = logging.getLogger("evaluation.routes")

MONGO_URL = os.getenv("MONGO_URL") or os.getenv("MONGO_URI", "")
EVAL_TOTAL_TIMEOUT_S = int(os.getenv("EVAL_TOTAL_TIMEOUT_S", "420"))
DECISION_THRESHOLD = 65

router = APIRouter()
_mongo_client: pymongo.MongoClient = None


def _get_db():
    global _mongo_client
    if _mongo_client is None:
        if not MONGO_URL:
            raise RuntimeError("MONGO_URL or MONGO_URI environment variable is required")
        _mongo_client = pymongo.MongoClient(MONGO_URL)  # created ONCE, reused, thread-safe
    db_name = os.getenv("MONGO_DB_NAME", "interview_platform")
    return _mongo_client[db_name]


async def _db(fn, *args, **kwargs):
    """pymongo is synchronous - run every Mongo op off the event loop."""
    return await asyncio.to_thread(fn, *args, **kwargs)


def _round_half_up(x: float) -> int:
    """Half-up, not banker's rounding (V1 bug: raw 86, penalty 25% -> 64.5
    rounded to 64 -> wrong Rejection)."""
    return int(Decimal(str(x)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _coerce_qid(value, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _deduplicate_answers(answers: list) -> list:
    """Deduplicate incoming answers by question_id preserving first occurrence."""
    if not isinstance(answers, list):
        return []
    seen_qids = set()
    deduped = []
    for i, ans in enumerate(answers):
        if not isinstance(ans, dict):
            continue
        qid = str(_coerce_qid(ans.get("question_id", i + 1), i + 1))
        if qid not in seen_qids:
            seen_qids.add(qid)
            deduped.append(ans)
    return deduped


def _age_seconds(iso_ts) -> float:
    try:
        dt = datetime.fromisoformat(str(iso_ts))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - dt).total_seconds()
    except (ValueError, TypeError):
        return float("inf")


# ---------------------------------------------------------------------------
# Report-entry builders
# ---------------------------------------------------------------------------

def _skipped_result(qid, q_text, answer, category) -> dict:
    return {"id": qid, "question": q_text, "answer": answer, "category": category,
            "scores": {"correctness": 0, "completeness": 0, "clarity": 0},
            "average_score": 0.0, "feedback": "Question was skipped or left empty.",
            "topic": None, "evidence": None, "expected_key_points": [],
            "ai_used": False, "skipped": True,
            "needs_human_review": False, "review_reasons": [],
            "scoring_engine_version": SCORING_ENGINE_VERSION}


def _missing_result(qid, q_text, answer, category) -> dict:
    return {**_skipped_result(qid, q_text, answer, category), "skipped": False,
            "needs_human_review": True,
            "feedback": "Evaluation missing for this question.",
            "review_reasons": ["No evaluation result was produced for this question."]}


def _to_report_entry(item: dict, res: dict) -> dict:
    return {"id": item["id"], "question": item["question_text"], "answer": item["answer"],
            "category": item["category"],
            "scores": {"correctness": res.get("correctness", 0),
                       "completeness": res.get("completeness", 0),
                       "clarity": res.get("clarity", 0)},
            "average_score": res.get("score", 0.0),
            "feedback": res.get("feedback", ""),
            "topic": res.get("topic"),
            "evidence": res.get("evidence"),
            "expected_key_points": res.get("expected_key_points", []),
            "ai_used": bool(res.get("ai_used")),
            "skipped": False,
            "needs_human_review": bool(res.get("needs_human_review")),
            "review_reasons": res.get("review_reasons", []),
            "scoring_engine_version": res.get("scoring_engine_version", SCORING_ENGINE_VERSION)}


# ---------------------------------------------------------------------------
# POST /evaluate - final evaluation. NOTE: no cached_scores_json parameter.
# The ONLY trusted score cache is the server-side session document.
# ---------------------------------------------------------------------------

@router.post("/evaluate")
async def evaluate_all(
    background_tasks: BackgroundTasks,
    username: str = Form(...),
    answers_json: str = Form(...),
    events_json: str = Form(...),
    session_id: str = Form(...),
):
    try:
        answers = json.loads(answers_json)
        events = json.loads(events_json)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Malformed JSON payload: {e}")
    if not isinstance(answers, list) or not answers:
        raise HTTPException(status_code=400, detail="answers_json must be a non-empty list")
    if not isinstance(events, list):
        events = []

    # Immediately deduplicate incoming answers by question_id before processing
    answers = _deduplicate_answers(answers)

    db = _get_db()
    existing = await _db(db.evaluations.find_one, {"username": username, "session_id": session_id})

    # Idempotency guard: no duplicate full evaluations on double-submit.
    if existing and existing.get("status") == "done":
        return {"success": True, "message": "Evaluation already complete", "session_id": session_id}
    if (existing and existing.get("status") in ["processing", "scoring_questions"]
            and _age_seconds(existing.get("started_at")) < EVAL_TOTAL_TIMEOUT_S):
        return {"success": True, "message": "Evaluation already in progress", "session_id": session_id}

    background_tasks.add_task(_run_final_evaluation, username, answers, events, session_id)
    return {"success": True, "message": "Evaluation started"}


async def _run_final_evaluation(username: str, answers: list, events: list, session_id: str):
    """Terminal-state guarantee: ALWAYS writes "done" or "failed". The
    V1/V2 silent death (KeyError -> stuck "processing" forever) is gone."""
    db = _get_db()
    query = {"username": username, "session_id": session_id}
    
    # Status Update: Started with granular status
    await _db(db.evaluations.update_one, query,
              {"$set": {"status": "scoring_questions", "done": False,
                        "started_at": datetime.now(timezone.utc).isoformat()}},
              upsert=True)
    try:
        final = await asyncio.wait_for(
            _evaluate_session(db, username, answers, events, session_id),
            timeout=EVAL_TOTAL_TIMEOUT_S)
        
        # Final success update
        await _db(db.evaluations.update_one, query,
                  {"$set": {**final, "status": "done", "done": True}})
        
        logger.info("[evaluate] done user=%s session=%s adj=%s decision=%s review=%s",
                    username, session_id, final["final_result"]["adjusted_score"],
                    final["final_result"]["decision"], final["needs_human_review"])
    except asyncio.TimeoutError:
        logger.error(f"Evaluation timed out for user={username} session={session_id}")
        await _db(db.evaluations.update_one, query,
                  {"$set": {"status": "failed", "done": False, "error": "Evaluation timed out. Please try again."}})
    except Exception as e:  # noqa: BLE001
        logger.exception("[evaluate] failed user=%s session=%s", username, session_id)
        # SAFETY: Ensure status is NEVER stuck in 'processing' or 'scoring_questions'
        await _db(db.evaluations.update_one, query,
                  {"$set": {"status": "failed", "done": False, "error": str(e)[:300]}})


def _normalize_event_type(e: dict) -> dict:
    """Raw session_proctoring_logs documents use 'event' as the field
    name (see admin/monitoring.py's identical UI-compatibility fix) -
    _compute_behavior expects 'type'. Normalized once, here."""
    if isinstance(e, dict) and "type" not in e and "event" in e:
        return {**e, "type": e["event"]}
    return e


async def _fetch_proctoring_events(db, username: str, session_id: str) -> list:
    def _query():
        return list(db.session_proctoring_logs.find({"username": username, "session_id": session_id}))
    docs = await _db(_query)
    return [_normalize_event_type(e) for e in docs]


async def _evaluate_session(db, username: str, answers: list, events: list, session_id: str) -> dict:
    doc = await _db(db.evaluations.find_one,
                    {"username": username, "session_id": session_id}) or {}
    stored: dict = doc.get("question_results") or {}

    # Answers are already deduplicated by evaluate_all entrypoint before background dispatch
    results_map: dict = {}
    intro_items, technical_batch, intro_ids = [], [], set()

    for i, ans in enumerate(answers):
        ans = ans if isinstance(ans, dict) else {}
        qid = _coerce_qid(ans.get("question_id", i + 1), i + 1)
        q_text = str(ans.get("question") or ans.get("question_text") or ans.get("text") or "")
        raw_answer = str(ans.get("answer") or "")
        answer = clamp_answer_words(raw_answer)
        category = str(ans.get("category") or "General")

        if is_empty_answer(answer) or is_skipped_answer(answer):
            results_map[qid] = _skipped_result(qid, q_text, answer, category)
            continue

        prior = stored.get(str(qid))
        if (prior and prior.get("ai_used")
                and prior.get("scoring_engine_version") == SCORING_ENGINE_VERSION):
            results_map[qid] = {**prior, "id": qid, "question": q_text,
                                "answer": answer, "category": category}
            continue

        item = {"id": qid, "question_text": q_text, "answer": answer, "category": category,
                "reference_answer": ans.get("reference_answer"),
                "question_data": ans.get("question_data"),
                "existing_key_points": (prior or {}).get("expected_key_points")}
        if _is_intro_question(q_text, category):
            intro_items.append(item)
            intro_ids.add(qid)
        else:
            technical_batch.append(item)

    for item in intro_items:
        res = await _call_single_ai(item["question_text"], item["answer"], item["category"],
                                    reference_answer=item["reference_answer"],
                                    question_data=item["question_data"])
        results_map[item["id"]] = _to_report_entry(item, res)

    ai_summary = None
    if technical_batch:
        combined = await _call_batch_ai_with_summary(technical_batch)
        for item in technical_batch:
            res = combined["results"].get(str(item["id"]))
            if res is None:
                res = {"score": 0.0, "correctness": 0, "completeness": 0, "clarity": 0,
                       "feedback": "Evaluation missing.", "topic": None, "ai_used": False,
                       "needs_human_review": True,
                       "review_reasons": ["result missing after batch evaluation"],
                       "scoring_engine_version": SCORING_ENGINE_VERSION}
            results_map[item["id"]] = _to_report_entry(item, res)
        ai_summary = combined["summary"]

    question_results = []
    seen_res_qids = set()
    for i, ans in enumerate(answers):
        ans = ans if isinstance(ans, dict) else {}
        qid = _coerce_qid(ans.get("question_id", i + 1), i + 1)
        qid_key = str(qid)
        if qid_key in seen_res_qids:
            continue
        seen_res_qids.add(qid_key)
        q_text_final = str(ans.get("question") or ans.get("question_text") or ans.get("text") or "")
        question_results.append(results_map.get(qid) or _missing_result(
            qid, q_text_final, str(ans.get("answer") or ""),
            str(ans.get("category") or "General")))

    behavior_events = await _fetch_proctoring_events(db, username, session_id)
    if not behavior_events and events:
        behavior_events = [_normalize_event_type(e) for e in events if isinstance(e, dict)]
    behavior = _compute_behavior(behavior_events)
    scored = [q for q in question_results if q.get("ai_used") or q.get("skipped")]
    failed = [q for q in question_results if not q.get("ai_used") and not q.get("skipped")]
    total = sum(q.get("average_score", 0.0) for q in scored)
    raw_score = _round_half_up((total / len(scored)) * 10) if scored else 0
    penalty = behavior["penalty_percentage"]
    adjusted_score = max(0, _round_half_up(raw_score - penalty))

    if adjusted_score <= 39:
        grade = "Poor"
        decision = "Rejected"
    elif 40 <= adjusted_score <= 60:
        grade = "Fair"
        decision = "Recommend preparation"
    elif 61 <= adjusted_score <= 80:
        grade = "Good"
        decision = "Recommend preparation"
    elif 81 <= adjusted_score <= 90:
        grade = "Very Good"
        decision = "Shortlisted"
    else:
        grade = "Excellent"
        decision = "Selected"

    if ai_summary is None:
        technical_entries = [q for q in question_results
                             if q["id"] not in intro_ids and not q.get("skipped")]
        ai_summary = await _generate_ai_summary(technical_entries)

    if ai_summary:
        ai_summary = align_summary_with_final_result(ai_summary, adjusted_score, grade, decision)

    review_reasons = [r for q in question_results for r in (q.get("review_reasons") or [])][:20]
    if failed:
        review_reasons.insert(0, f"{len(failed)} answer(s) failed automatic evaluation and were "
                                 f"excluded from scoring - manual review required.")
    needs_human_review = bool(review_reasons)

    user_record = await _db(db.users.find_one, {"username": username})
    student_name = (user_record or {}).get("name", username)

    final = {
        "username": username,
        "student_name": student_name,
        "session_id": session_id,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "ai_powered": True,
        "questions": question_results,
        "behavior_analysis": behavior,
        "final_result": {
            "raw_score": raw_score,
            "adjusted_score": adjusted_score,
            "decision": decision,
            "grade": grade,
            "summary": ai_summary,
        },
        "needs_human_review": needs_human_review,
        "review_reasons": review_reasons,
        "failed_question_ids": [q["id"] for q in failed],
        "scoring_engine_version": SCORING_ENGINE_VERSION,
    }

    return final


# ---------------------------------------------------------------------------
# GET /status/{username}
# ---------------------------------------------------------------------------

@router.get("/status/{username}")
async def evaluation_status(username: str, session_id: str = None):
    db = _get_db()
    query = {"username": username}
    if session_id:
        query["session_id"] = session_id
    result = await _db(db.evaluations.find_one, query, sort=[("started_at", pymongo.DESCENDING)])
    if not result:
        return {"status": "not_started", "done": False}
    return {
        "status": result.get("status", "not_started"),
        "done": bool(result.get("done", False)),
        "error": result.get("error"),
    }


# ---------------------------------------------------------------------------
# GET /result/{username}
# ---------------------------------------------------------------------------

@router.get("/result/{username}")
async def get_student_result(username: str, session_id: str = None):
    db = _get_db()
    query = {"username": username, "status": "done"}
    if session_id:
        query["session_id"] = session_id
    result = await _db(db.evaluations.find_one, query, sort=[("evaluated_at", pymongo.DESCENDING)])
    if not result:
        raise HTTPException(status_code=404, detail="Result not found or evaluation is still processing.")
    result["_id"] = str(result["_id"])
    fr = result.get("final_result")
    if isinstance(fr, dict) and fr.get("summary"):
        adj_score = fr.get("adjusted_score") if fr.get("adjusted_score") is not None else (fr.get("raw_score") or 0)
        grade = fr.get("grade") or ""
        decision = fr.get("decision") or ""
        fr["summary"] = align_summary_with_final_result(fr["summary"], adj_score, grade, decision)
    return result


# ---------------------------------------------------------------------------
# POST /evaluate-single
# ---------------------------------------------------------------------------

@router.post("/evaluate-single")
async def evaluate_single(
    username: str = Form(...),
    session_id: str = Form(...),
    question_id: int = Form(...),
    question_text: str = Form(default=""),
    question: str = Form(default=""),
    answer: str = Form(...),
    category: str = Form(default="General"),
    reference_answer: str = Form(default=None),
    question_data_json: str = Form(default=None),
):
    resolved_q = (question or question_text or "").strip()
    question_data = None
    if question_data_json:
        try:
            question_data = json.loads(question_data_json)
        except json.JSONDecodeError:
            pass

    safe_answer = clamp_answer_words(answer)
    item = {"id": question_id, "question_text": resolved_q, "question": resolved_q, "answer": safe_answer, "category": category}

    if is_empty_answer(safe_answer) or is_skipped_answer(safe_answer):
        entry = _skipped_result(question_id, resolved_q, safe_answer, category)
    else:
        res = await _call_single_ai(resolved_q, safe_answer, category,
                                    reference_answer=reference_answer,
                                    question_data=question_data)
        entry = _to_report_entry(item, res)

    return entry


# ---------------------------------------------------------------------------
# POST /evaluate-chunk
# ---------------------------------------------------------------------------

@router.post("/evaluate-chunk")
async def evaluate_chunk(
    username: str = Form(...),
    session_id: str = Form(...),
    answers_json: str = Form(...),
):
    try:
        chunk = json.loads(answers_json)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Malformed JSON payload: {e}")
    if not isinstance(chunk, list) or not chunk:
        return {"success": False, "message": "Empty chunk"}

    items = [{"id": _coerce_qid(it.get("question_id", i + 1), i + 1),
              "question_text": str(it.get("question_text") or ""),
              "answer": clamp_answer_words(str(it.get("answer") or "")),
              "category": str(it.get("category") or "General"),
              "reference_answer": it.get("reference_answer"),
              "question_data": it.get("question_data")}
             for i, it in enumerate(chunk)]

    results = await _call_batch_ai(items)

    formatted = []
    for item in items:
        res = results.get(str(item["id"])) or {
            "score": 0.0, "correctness": 0, "completeness": 0, "clarity": 0,
            "feedback": "Evaluation missing.", "ai_used": False,
            "needs_human_review": True, "review_reasons": ["result missing after chunk evaluation"],
            "scoring_engine_version": SCORING_ENGINE_VERSION,
        }
        entry = _to_report_entry(item, res)
        formatted.append({"question_id": item["id"], "score": entry["average_score"],
                          "correctness": entry["scores"]["correctness"],
                          "completeness": entry["scores"]["completeness"],
                          "clarity": entry["scores"]["clarity"],
                          "feedback": entry["feedback"]})

    return {"success": True, "results": formatted}
