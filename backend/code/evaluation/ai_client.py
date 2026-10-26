"""
evaluation/ai_client.py - the ONLY module that talks to an LLM provider.

Provider chain: Gemini (google-genai SDK, function calling forced with
mode=ANY) -> OpenRouter (openai SDK against OpenRouter's base URL),
optionally with fallback models as extra hops. First success wins.

Env vars:
  GEMINI_API_KEY, GEMINI_MODEL (from .env),
  GEMINI_MODEL_FALLBACK (from .env, optional),
  GEMINI_BASE_URL (optional),
  OPENROUTER_API_KEY, OPENROUTER_MODEL (from .env),
  OPENROUTER_MODEL_FALLBACK (from .env, optional),
  OPENROUTER_BASE_URL (from .env),
  OPENROUTER_APP_TITLE (optional, for OpenRouter attribution headers),
  LLM_REQUEST_TIMEOUT_S (120), LLM_MAX_ATTEMPTS_PER_PROVIDER (3),
  LLM_BACKOFF_BASE_S (1), LLM_BACKOFF_CAP_S (20), LLM_BACKOFF_JITTER_S (0.75),
  LLM_CIRCUIT_FAILURE_THRESHOLD (3), LLM_CIRCUIT_COOLDOWN_S (60)
"""

from google import genai
import asyncio
import json
import logging
import os
import random
import re
import time
from collections import OrderedDict
from contextvars import ContextVar
from datetime import datetime
from functools import partial
from typing import Any, Awaitable, Callable, List, Optional, Tuple

logger = logging.getLogger("evaluation.ai_client")

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "").strip()
GEMINI_MODEL_FALLBACK = os.getenv("GEMINI_MODEL_FALLBACK", "").strip()
GEMINI_BASE_URL = os.getenv("GEMINI_BASE_URL", "").strip()

OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "").strip()
OPENROUTER_MODEL_FALLBACK = os.getenv("OPENROUTER_MODEL_FALLBACK", "").strip()
OPENROUTER_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")

REQUEST_TIMEOUT_S = float(os.getenv("LLM_REQUEST_TIMEOUT_S", "120"))
MAX_ATTEMPTS_PER_PROVIDER = max(1, int(os.getenv("LLM_MAX_ATTEMPTS_PER_PROVIDER", "3")))
BACKOFF_BASE_S = float(os.getenv("LLM_BACKOFF_BASE_S", "1.0"))
BACKOFF_CAP_S = float(os.getenv("LLM_BACKOFF_CAP_S", "20.0"))
BACKOFF_JITTER_S = float(os.getenv("LLM_BACKOFF_JITTER_S", "0.75"))
RETRYABLE_STATUS_CODES = frozenset({429, 503})

_CIRCUIT_FAILURE_THRESHOLD = max(1, int(os.getenv("LLM_CIRCUIT_FAILURE_THRESHOLD", "3")))
_CIRCUIT_COOLDOWN_S = float(os.getenv("LLM_CIRCUIT_COOLDOWN_S", "60"))


class LLMError(Exception):
    """Base class for transport-layer errors."""


class LLMProviderError(LLMError):
    """Whole chain exhausted (or circuit open). Orchestration turns this
    into a flagged needs_human_review fallback - never a silent zero."""


class LLMInvalidResponseError(LLMError):
    """Provider responded but the payload was unusable. Transient ->
    retried, then failover."""


class _ProviderUnavailable(LLMError):
    """Internal: provider not configured (missing key / missing SDK). Skip."""


# ---------------------------------------------------------------------------
# Circuit breaker
# ---------------------------------------------------------------------------

_chain_failures = 0
_circuit_opened_at: Optional[float] = None


def _circuit_is_open() -> bool:
    return (_circuit_opened_at is not None
            and (time.monotonic() - _circuit_opened_at) < _CIRCUIT_COOLDOWN_S)


def _note_chain_success() -> None:
    global _chain_failures, _circuit_opened_at
    _chain_failures = 0
    _circuit_opened_at = None


def _note_chain_failure() -> None:
    global _chain_failures, _circuit_opened_at
    _chain_failures += 1
    if _chain_failures >= _CIRCUIT_FAILURE_THRESHOLD:
        _circuit_opened_at = time.monotonic()
        logger.error("LLM circuit OPEN after %d consecutive chain failures "
                     "(cooldown %.0fs)", _chain_failures, _CIRCUIT_COOLDOWN_S)


# ---------------------------------------------------------------------------
# Retry classification
# ---------------------------------------------------------------------------

def _status_code(exc: BaseException) -> Optional[int]:
    """Extract an HTTP status code from an exception."""
    for attr in ("status_code", "code"):
        v = getattr(exc, attr, None)
        if isinstance(v, int) and 100 <= v <= 599:
            return v
    resp = getattr(exc, "response", None)
    v = getattr(resp, "status_code", None)
    if isinstance(v, int):
        return v
    m = re.search(r"\b([45]\d\d)\b", str(exc))
    return int(m.group(1)) if m else None


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError, LLMInvalidResponseError)):
        return True
    return _status_code(exc) in RETRYABLE_STATUS_CODES


async def _jittered_backoff(attempt: int) -> None:
    delay = min(BACKOFF_BASE_S * (2 ** attempt), BACKOFF_CAP_S)
    delay += random.uniform(0.0, BACKOFF_JITTER_S)
    await asyncio.sleep(delay)


# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------

_gemini_client: Any = None
_openrouter_client: Any = None


def _get_gemini_client() -> Any:
    global _gemini_client
    if _gemini_client is None:
        api_key = (os.getenv("GEMINI_API_KEY") or "").strip()
        
        if not api_key:
            print("\n❌ [GEMINI ERROR] GEMINI_API_KEY is not set in environment or .env!")
            raise _ProviderUnavailable("GEMINI_API_KEY not set")
            
        # Ab hum AIzaSy aur AQ dono ko valid standard keys maanenge
        if not api_key.startswith("AIzaSy") and not api_key.startswith("AQ.") and not GEMINI_BASE_URL:
            print("\n" + "⚠️ " * 20)
            print(f"⚠️ [GEMINI KEY WARNING] GEMINI_API_KEY starts with '{api_key[:8]}...' (Length: {len(api_key)})")
            print("   Official Google Gemini API keys usually start with 'AIzaSy...' or 'AQ...'.")
            print("   If this is an OpenRouter or invalid key, Google Gemini API will return error.")
            print("⚠️ " * 20 + "\n")
            
        try:
            from google import genai
        except ImportError as e:
            raise _ProviderUnavailable(f"google-genai SDK not installed: {e}")
            
        project_id = os.getenv("GOOGLE_CLOUD_PROJECT_ID", "").strip()
        location = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1").strip()
        
        # FIX: Sirf project_id hone par hi Vertex AI mode me jao!
        if project_id:
            _gemini_client = genai.Client(
                vertexai=True,
                project=project_id,
                location=location,
                api_key=api_key
            )
        else:
            # Yeh normal AI Studio (chahe AIzaSy ho ya AQ) ke liye properly chalega
            kwargs: dict = {
                "api_key": "dummy",  # SDK ko dummy key do taaki Bearer na bheje
                "http_options": {
                    "headers": {"x-goog-api-key": api_key}
                }
            }
            if GEMINI_BASE_URL:
                kwargs["http_options"]["base_url"] = GEMINI_BASE_URL
            _gemini_client = genai.Client(**kwargs)
            
    return _gemini_client


def _get_openrouter_client() -> Any:
    global _openrouter_client
    if _openrouter_client is None:
        api_key = os.getenv("OPENROUTER_API_KEY", "")
        if not api_key:
            raise _ProviderUnavailable("OPENROUTER_API_KEY not set")
        if not _openrouter_models():
            raise _ProviderUnavailable("OPENROUTER_MODEL not set in .env")
        try:
            from openai import AsyncOpenAI
        except ImportError as e:
            raise _ProviderUnavailable(f"openai SDK not installed: {e}")
        headers = {"X-Title": os.getenv("OPENROUTER_APP_TITLE", "interview-evaluation")}
        if os.getenv("OPENROUTER_APP_URL"):
            headers["HTTP-Referer"] = os.getenv("OPENROUTER_APP_URL")
        _openrouter_client = AsyncOpenAI(
            api_key=api_key,
            base_url=OPENROUTER_BASE_URL,
            timeout=REQUEST_TIMEOUT_S,
            max_retries=0,
            default_headers=headers,
        )
    return _openrouter_client


def _gemini_models() -> List[str]:
    """Primary Gemini model from .env, plus optional fallback model."""
    return [m for m in [GEMINI_MODEL, GEMINI_MODEL_FALLBACK] if m]


def _openrouter_models() -> List[str]:
    """Primary OpenRouter model, plus optional fallback model as an extra hop."""
    return [m for m in [OPENROUTER_MODEL, OPENROUTER_MODEL_FALLBACK] if m]


# ---------------------------------------------------------------------------
# Gemini: JSON-schema -> google.genai Schema converter + response plumbing
# ---------------------------------------------------------------------------

_GEMINI_TYPE_MAP = {
    "string": "STRING", "integer": "INTEGER", "number": "NUMBER",
    "boolean": "BOOLEAN", "array": "ARRAY", "object": "OBJECT",
}


def _to_gemini_schema(schema: dict) -> Any:
    from google.genai import types as genai_types
    stype = _GEMINI_TYPE_MAP.get(str(schema.get("type", "string")).lower(), "STRING")
    kwargs: dict = {"type": stype}
    if schema.get("description"):
        kwargs["description"] = str(schema["description"])
    if schema.get("enum"):
        kwargs["enum"] = list(schema["enum"])
    if schema.get("items"):
        kwargs["items"] = _to_gemini_schema(schema["items"])
    properties = schema.get("properties")
    if properties:
        kwargs["properties"] = {k: _to_gemini_schema(v) for k, v in properties.items()}
    if schema.get("required"):
        kwargs["required"] = list(schema["required"])
    return genai_types.Schema(**kwargs)


def _extract_gemini_function_args(resp: Any, tool_name: str) -> Optional[dict]:
    calls = getattr(resp, "function_calls", None)
    if calls:
        for fc in calls:
            if getattr(fc, "name", None) == tool_name:
                args = getattr(fc, "args", None)
                if isinstance(args, dict) and args:
                    return args
    try:
        for cand in (resp.candidates or []):
            content = getattr(cand, "content", None)
            for part in (getattr(content, "parts", None) or []):
                fc = getattr(part, "function_call", None)
                if fc is not None and getattr(fc, "name", None) == tool_name:
                    args = getattr(fc, "args", None)
                    if isinstance(args, dict) and args:
                        return args
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Per-interview LLM usage tracking + prompt/response logging
#
# Every provider response is recorded against the interview (session_id) that
# is active in the current async context (see set_usage_session). Each call
# prints what was sent, what came back, its tokens and cost, plus the
# interview's running totals; log_interview_usage() prints the final total.
# Counters live in this process only (multiple workers = separate counters).
# ---------------------------------------------------------------------------

LOG_AI_IO = os.getenv("EVAL_LOG_AI_IO", "true").strip().lower() in ("1", "true", "yes")
USD_TO_INR = float(os.getenv("EVAL_USD_TO_INR", "86.5"))
# USD per 1M tokens (input, output). ESTIMATES. Override per model with
# EVAL_MODEL_PRICING_JSON, e.g. {"gemini-2.5-flash": [0.30, 2.50]} - the key is
# matched as a substring of "provider:model".
_FLASH_RATES = (0.075, 0.30)
_PRO_RATES = (1.25, 5.00)
_PRO_MODEL_RE = re.compile(r"(^|[-:/._])pro($|[-:/._])")
_MAX_TRACKED_SESSIONS = 200


def _load_pricing_overrides() -> dict:
    raw = os.getenv("EVAL_MODEL_PRICING_JSON", "").strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return {str(k).lower(): (float(v[0]), float(v[1])) for k, v in data.items()}
    except Exception:  # noqa: BLE001
        logger.warning("EVAL_MODEL_PRICING_JSON is invalid - using default rates")
        return {}


_PRICING_OVERRIDES = _load_pricing_overrides()

_usage_session: ContextVar = ContextVar("llm_usage_session", default=None)
_usage_user: ContextVar = ContextVar("llm_usage_user", default=None)
_call_label: ContextVar = ContextVar("llm_call_label", default=None)
_SESSION_USAGE: "OrderedDict[str, dict]" = OrderedDict()


def set_usage_session(session_id, username=None) -> None:
    """Attribute every LLM call made from this async context to one interview."""
    _usage_session.set(str(session_id) if session_id else None)
    _usage_user.set(str(username) if username else None)


def _new_usage() -> dict:
    return {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0,
            "cost_usd": 0.0, "by_label": {}, "username": None}


def _rates_for(provider: str) -> Tuple[float, float]:
    p = provider.lower()
    for key, rates in _PRICING_OVERRIDES.items():
        if key in p:
            return rates
    return _PRO_RATES if _PRO_MODEL_RE.search(p) else _FLASH_RATES


def _extract_usage(resp: Any) -> Tuple[int, int, int]:
    """(prompt, completion, total). Gemini 'thinking' tokens are billed as
    output, so they are added to completion."""
    try:
        um = getattr(resp, "usage_metadata", None) or getattr(resp, "usage", None)
        if not um:
            return 0, 0, 0
        prompt = getattr(um, "prompt_token_count", None) or getattr(um, "prompt_tokens", 0) or 0
        cand = getattr(um, "candidates_token_count", None) or getattr(um, "completion_tokens", 0) or 0
        thoughts = getattr(um, "thoughts_token_count", None) or 0
        total = getattr(um, "total_token_count", None) or getattr(um, "total_tokens", 0) or 0
        completion = int(cand) + int(thoughts)
        total = int(total) or (int(prompt) + completion)
        return int(prompt), completion, total
    except Exception:  # noqa: BLE001
        return 0, 0, 0


def _record_usage(provider: str, resp: Any) -> dict:
    prompt, completion, total = _extract_usage(resp)
    in_rate, out_rate = _rates_for(provider)
    cost = prompt / 1_000_000 * in_rate + completion / 1_000_000 * out_rate
    sid = _usage_session.get() or "unassigned"
    label = _call_label.get() or "llm_call"

    stats = _SESSION_USAGE.get(sid)
    if stats is None:
        stats = _new_usage()
        _SESSION_USAGE[sid] = stats
        while len(_SESSION_USAGE) > _MAX_TRACKED_SESSIONS:
            _SESSION_USAGE.popitem(last=False)
    else:
        _SESSION_USAGE.move_to_end(sid)
    stats["username"] = _usage_user.get() or stats.get("username")
    stats["calls"] += 1
    stats["prompt_tokens"] += prompt
    stats["completion_tokens"] += completion
    stats["total_tokens"] += total
    stats["cost_usd"] += cost
    b = stats["by_label"].setdefault(label, {"calls": 0, "tokens": 0, "cost_usd": 0.0})
    b["calls"] += 1
    b["tokens"] += total
    b["cost_usd"] += cost
    return {"session": sid, "label": label, "provider": provider, "call_no": stats["calls"],
            "prompt_tokens": prompt, "completion_tokens": completion,
            "total_tokens": total, "cost_usd": cost}


def _log_usage(provider: str, resp: Any) -> dict:
    """Record tokens/cost for this response (even if it later turns out unusable,
    because the provider still billed it) and return the per-call stats."""
    usage = _record_usage(provider, resp)
    logger.info("[%s] tokens in=%s out=%s total=%s cost=$%.5f", provider,
                usage["prompt_tokens"], usage["completion_tokens"],
                usage["total_tokens"], usage["cost_usd"])
    return usage


def _safe_resp_text(resp: Any, cap: int = 1500) -> str:
    try:
        return str(getattr(resp, "text", "") or "")[:cap]
    except Exception:  # noqa: BLE001
        return ""


def _print_evaluation_debug(provider: str, system: str, user_prompt: str, output: Any,
                            resp: Any, usage: Optional[dict] = None, status: str = "OK") -> None:
    if usage is None:
        usage = _record_usage(provider, resp)
    if not LOG_AI_IO:
        return
    stats = _SESSION_USAGE.get(usage["session"]) or _new_usage()
    if isinstance(output, (dict, list)):
        try:
            output_formatted = json.dumps(output, indent=2, ensure_ascii=False)
        except Exception:  # noqa: BLE001
            output_formatted = str(output)
    else:
        output_formatted = str(output)
    inr = USD_TO_INR

    print("\n" + "=" * 85)
    print(f"🤖 [LLM CALL #{usage['call_no']} of interview {usage['session']}] {usage['label']} ➔ {provider}  [{status}]")
    print(f"⏰ Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("-" * 85)
    print("📝 [SYSTEM INSTRUCTION]:")
    print(system[:500] + ("..." if len(system) > 500 else ""))
    print("-" * 85)
    print(f"📥 [SENT TO AI] (Length: {len(user_prompt)} characters):")
    print(user_prompt)
    print("-" * 85)
    print("📤 [RETURNED BY AI]:")
    print(output_formatted)
    print("-" * 85)
    print("📊 [THIS CALL]:")
    print(f"   • Input Tokens:   {usage['prompt_tokens']:,}")
    print(f"   • Output Tokens:  {usage['completion_tokens']:,}")
    print(f"   • Total Tokens:   {usage['total_tokens']:,}")
    print(f"   • Est. Cost:      ${usage['cost_usd']:.5f} (~₹{usage['cost_usd'] * inr:.3f})")
    print("📈 [THIS INTERVIEW SO FAR]:")
    print(f"   • LLM Calls:      {stats['calls']}")
    print(f"   • Tokens:         {stats['total_tokens']:,} (In: {stats['prompt_tokens']:,} | Out: {stats['completion_tokens']:,})")
    print(f"   • Est. Cost:      ${stats['cost_usd']:.4f} (~₹{stats['cost_usd'] * inr:.2f})")
    print("=" * 85 + "\n")


def get_usage_snapshot(session_id) -> Optional[dict]:
    stats = _SESSION_USAGE.get(str(session_id)) if session_id else None
    return json.loads(json.dumps(stats)) if stats else None


def log_interview_usage(session_id=None, note: str = "") -> Optional[dict]:
    """Print the interview's TOTAL calls / tokens / cost (call once evaluation ends)."""
    sid = str(session_id) if session_id else (_usage_session.get() or "unassigned")
    stats = _SESSION_USAGE.get(sid)
    print("\n" + "#" * 85)
    print(f"🧾 [INTERVIEW TOTAL] session={sid}" + (f" user={stats['username']}" if stats and stats.get("username") else "")
          + (f"  ({note})" if note else ""))
    if not stats or not stats["calls"]:
        print("   No LLM calls were recorded for this interview.")
        print("#" * 85 + "\n")
        return None
    print(f"   • LLM Calls:      {stats['calls']}")
    print(f"   • Total Tokens:   {stats['total_tokens']:,} (In: {stats['prompt_tokens']:,} | Out: {stats['completion_tokens']:,})")
    print(f"   • Total Est. Cost: ${stats['cost_usd']:.4f} (~₹{stats['cost_usd'] * USD_TO_INR:.2f})")
    for label, b in stats["by_label"].items():
        print(f"     - {label}: {b['calls']} call(s), {b['tokens']:,} tokens, ${b['cost_usd']:.4f}")
    print("#" * 85 + "\n")
    return get_usage_snapshot(sid)


# ---------------------------------------------------------------------------
# Provider call implementations
# ---------------------------------------------------------------------------

async def _gemini_call_with_tool(
    model: str, system: str, user_prompt: str, tool: dict, max_tokens: int,
    image_b64_list: Optional[List[str]] = None,     # ✅ NEW
) -> dict:
    client = _get_gemini_client()
    from google.genai import types as genai_types
    import base64                                    # ✅ NEW
    declaration = genai_types.FunctionDeclaration(
        name=tool["name"],
        description=tool["description"],
        parameters=_to_gemini_schema(tool["input_schema"]),
    )
    config = genai_types.GenerateContentConfig(
        system_instruction=system,
        temperature=0,
        max_output_tokens=max_tokens,
        tools=[genai_types.Tool(function_declarations=[declaration])],
        tool_config=genai_types.ToolConfig(
            function_calling_config=genai_types.FunctionCallingConfig(
                mode="ANY",
                allowed_function_names=[tool["name"]],
            )
        ),
    )

    # ✅ NEW: Build multimodal contents — text + optional images
    contents: list = [user_prompt]
    if image_b64_list:
        for img_b64 in image_b64_list:
            if not img_b64:
                continue
            try:
                # image_b64 may come as data URL ("data:image/png;base64,...") or raw base64
                raw_b64 = img_b64.split(",", 1)[1] if "," in img_b64[:120] else img_b64
                # Detect MIME type
                mime = "image/jpeg"
                head = img_b64[:80]
                if "data:image/png" in head:
                    mime = "image/png"
                elif "data:image/jpg" in head or "data:image/jpeg" in head:
                    mime = "image/jpeg"
                contents.append(
                    genai_types.Part.from_bytes(
                        data=base64.b64decode(raw_b64),
                        mime_type=mime,
                    )
                )
            except Exception as e:
                logger.warning("[gemini] Failed to attach image, sending text-only: %s", e)

    resp = await asyncio.wait_for(
        client.aio.models.generate_content(model=model, contents=contents, config=config),
        timeout=REQUEST_TIMEOUT_S,
    )
    usage = _log_usage(f"gemini:{model}", resp)
    args = _extract_gemini_function_args(resp, tool["name"])
    if args is None:
        _print_evaluation_debug(f"gemini:{model}", system, user_prompt,
                                "<<no usable function call>> " + _safe_resp_text(resp), resp,
                                usage=usage, status="FAILED - no usable function call (possible truncation)")
        raise LLMInvalidResponseError(
            f"Gemini returned no usable '{tool['name']}' function call (possible output truncation)")
    _print_evaluation_debug(f"gemini:{model}", system, user_prompt, args, resp, usage=usage)
    return args


async def _openrouter_call_with_tool(model: str, system: str, user_prompt: str,
                                     tool: dict, max_tokens: int) -> dict:
    client = _get_openrouter_client()
    openai_tool = {
        "type": "function",
        "function": {
            "name": tool["name"],
            "description": tool["description"],
            "parameters": tool["input_schema"],
        },
    }
    resp = await asyncio.wait_for(
        client.chat.completions.create(
            model=model,
            temperature=0,
            max_tokens=max_tokens,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_prompt},
            ],
            tools=[openai_tool],
            tool_choice={"type": "function", "function": {"name": tool["name"]}},
        ),
        timeout=REQUEST_TIMEOUT_S + 5.0,
    )
    usage = _log_usage(f"openrouter:{model}", resp)
    err = getattr(resp, "error", None)
    if err:
        raise LLMInvalidResponseError(f"OpenRouter error payload: {str(err)[:200]}")
    choices = getattr(resp, "choices", None) or []
    if not choices:
        raise LLMInvalidResponseError("OpenRouter returned no choices")
    message = choices[0].message
    for tc in (getattr(message, "tool_calls", None) or []):
        fn = getattr(tc, "function", None)
        if fn is not None and getattr(fn, "name", None) == tool["name"]:
            try:
                args = json.loads(getattr(fn, "arguments", None) or "")
            except json.JSONDecodeError as e:
                raise LLMInvalidResponseError(f"OpenRouter tool arguments not valid JSON: {e}")
            if isinstance(args, dict) and args:
                _print_evaluation_debug(f"openrouter:{model}", system, user_prompt, args, resp, usage=usage)
                return args
    _print_evaluation_debug(f"openrouter:{model}", system, user_prompt,
                            "<<no usable tool call>> " + str(getattr(message, "content", "") or "")[:1500], resp,
                            usage=usage, status="FAILED - no usable tool call")
    raise LLMInvalidResponseError(f"OpenRouter returned no '{tool['name']}' tool call")


async def _gemini_call_plain(model: str, system: str, user_prompt: str, max_tokens: int) -> str:
    client = _get_gemini_client()
    from google.genai import types as genai_types
    config = genai_types.GenerateContentConfig(
        system_instruction=system, temperature=0, max_output_tokens=max_tokens,
    )
    resp = await asyncio.wait_for(
        client.aio.models.generate_content(model=model, contents=user_prompt, config=config),
        timeout=REQUEST_TIMEOUT_S,
    )
    usage = _log_usage(f"gemini:{model}", resp)
    text = (getattr(resp, "text", None) or "").strip()
    if not text:
        raise LLMInvalidResponseError("Gemini returned empty text")
    _print_evaluation_debug(f"gemini:{model}", system, user_prompt, text, resp, usage=usage)
    return text


async def _openrouter_call_plain(model: str, system: str, user_prompt: str, max_tokens: int) -> str:
    client = _get_openrouter_client()
    resp = await asyncio.wait_for(
        client.chat.completions.create(
            model=model,
            temperature=0,
            max_tokens=max_tokens,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_prompt},
            ],
        ),
        timeout=REQUEST_TIMEOUT_S + 5.0,
    )
    usage = _log_usage(f"openrouter:{model}", resp)
    err = getattr(resp, "error", None)
    if err:
        raise LLMInvalidResponseError(f"OpenRouter error payload: {str(err)[:200]}")
    choices = getattr(resp, "choices", None) or []
    content = (getattr(choices[0].message, "content", "") or "").strip() if choices else ""
    if not content:
        raise LLMInvalidResponseError("OpenRouter returned empty content")
    _print_evaluation_debug(f"openrouter:{model}", system, user_prompt, content, resp, usage=usage)
    return content


# ---------------------------------------------------------------------------
# The unified provider chain
# ---------------------------------------------------------------------------

async def _run_provider_chain(entries: List[Tuple[str, Callable[[], Awaitable[Any]]]]) -> Any:
    errors: List[str] = []
    if _circuit_is_open():
        raise LLMProviderError(
            f"LLM circuit breaker open (cooling down after {_chain_failures} consecutive "
            f"chain failures); retrying shortly")
    for idx, (name, fn) in enumerate(entries):
        for attempt in range(MAX_ATTEMPTS_PER_PROVIDER):
            try:
                result = await fn()
                _note_chain_success()
                return result
            except _ProviderUnavailable as e:
                err_str = f"Provider unavailable: {e}"
                errors.append(f"{name}: {err_str}")
                print("\n" + "!" * 85)
                print(f"⚠️ [AI PROVIDER UNAVAILABLE] '{name}': {e}")
                if idx < len(entries) - 1:
                    next_name = entries[idx + 1][0]
                    print(f"   ➔ Failover: Switching to next provider in chain: '{next_name}'...")
                print("!" * 85 + "\n")
                break
            except Exception as e:
                err_msg = f"{type(e).__name__}: {str(e)}"
                errors.append(f"{name} attempt {attempt + 1}: {err_msg[:200]}")
                print("\n" + "!" * 85)
                print(f"❌ [AI CALL FAILED] Provider '{name}' (Attempt {attempt + 1}/{MAX_ATTEMPTS_PER_PROVIDER}) encountered error:")
                print(f"   • Error: {err_msg}")
                if "gemini" in name.lower():
                    g_key = (os.getenv("GEMINI_API_KEY") or "").strip()
                    if not g_key:
                        print("   • Key Info: GEMINI_API_KEY is not set in environment or .env!")
                    elif not g_key.startswith("AIzaSy") and not os.getenv("GEMINI_BASE_URL"):
                        print(f"   • Key Diagnostic: GEMINI_API_KEY starts with '{g_key[:8]}...' (Length: {len(g_key)}).")
                        print("     Official Google Gemini API keys start with 'AIzaSy...'. An invalid key will be rejected with 400 Bad Request.")
                if _is_retryable(e) and attempt < MAX_ATTEMPTS_PER_PROVIDER - 1:
                    print(f"   🔄 Retrying '{name}' with backoff...")
                    await _jittered_backoff(attempt)
                    continue
                else:
                    if idx < len(entries) - 1:
                        next_name = entries[idx + 1][0]
                        print(f"   ➔ Failover: Switching to fallback provider: '{next_name}'...")
                    else:
                        print("   ❌ No more providers remaining in chain!")
                print("!" * 85 + "\n")
                break
    _note_chain_failure()
    raise LLMProviderError("All LLM providers failed: " + " | ".join(errors))


async def call_with_tool(
    system: str, 
    user_prompt: str, 
    tool: dict, 
    max_tokens: int = 4000,
    image_b64_list: Optional[List[str]] = None,     # ✅ NEW
) -> dict:
    _call_label.set(tool.get("name") or "tool_call")
    entries: List[Tuple[str, Callable[[], Awaitable[Any]]]] = []
    for model in _gemini_models():
        entries.append((f"gemini:{model}",
                        partial(_gemini_call_with_tool, model=model, system=system,
                                user_prompt=user_prompt, tool=tool, max_tokens=max_tokens,
                                image_b64_list=image_b64_list)))     # ✅ Gemini me images
    for model in _openrouter_models():
        entries.append((f"openrouter:{model}",
                        partial(_openrouter_call_with_tool, model=model, system=system,
                                user_prompt=user_prompt, tool=tool, max_tokens=max_tokens)))     # ✅ OpenRouter me images NAHI (Q3: B)
    return await _run_provider_chain(entries)


async def call_plain_text(system: str, user_prompt: str, max_tokens: int = 1000) -> str:
    _call_label.set("plain_text (intro)")
    entries: List[Tuple[str, Callable[[], Awaitable[Any]]]] = []
    for model in _gemini_models():
        entries.append((f"gemini:{model}",
                        partial(_gemini_call_plain, model=model, system=system,
                                user_prompt=user_prompt, max_tokens=max_tokens)))
    for model in _openrouter_models():
        entries.append((f"openrouter:{model}",
                        partial(_openrouter_call_plain, model=model, system=system,
                                user_prompt=user_prompt, max_tokens=max_tokens)))
    return await _run_provider_chain(entries)


def extract_json(text: str) -> Optional[dict]:
    if not text:
        return None
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    candidate = fenced.group(1) if fenced else text
    match = re.search(r"\{.*\}", candidate, re.DOTALL)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None