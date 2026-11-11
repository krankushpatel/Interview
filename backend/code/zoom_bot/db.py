"""SQLite persistence for Zoom Bot interviews and answers."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS interviews (
    id TEXT PRIMARY KEY,
    candidate_name TEXT,
    meeting_url TEXT,
    bot_id TEXT,
    status TEXT,
    questions TEXT,
    current_index INTEGER DEFAULT -1,
    student_id TEXT,
    student_name TEXT,
    created_at REAL,
    started_at REAL,
    finished_at REAL
);
CREATE TABLE IF NOT EXISTS answers (
    interview_id TEXT,
    q_index INTEGER,
    question TEXT,
    answer TEXT,
    status TEXT,
    started_at REAL,
    ended_at REAL,
    duration_sec REAL,
    word_count INTEGER,
    PRIMARY KEY (interview_id, q_index)
);
"""


def init(path: str) -> None:
    global _conn
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with _lock:
        _conn = sqlite3.connect(path, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.executescript(SCHEMA)


def _c() -> sqlite3.Connection:
    if _conn is None:
        raise RuntimeError("db.init(path) must be called first")
    return _conn


def save_interview(data: dict[str, Any]) -> None:
    with _lock, _c() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO interviews
               (id, candidate_name, meeting_url, bot_id, status, questions,
                current_index, student_id, student_name, created_at, started_at, finished_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                data["id"],
                data.get("candidate_name", ""),
                data.get("meeting_url", ""),
                data.get("bot_id", ""),
                data.get("status", "waiting"),
                json.dumps(data.get("questions", [])),
                data.get("current_index", -1),
                data.get("student_id"),
                data.get("student_name"),
                data.get("created_at", time.time()),
                data.get("started_at"),
                data.get("finished_at"),
            ),
        )


def update_interview(iid: str, **fields: Any) -> None:
    if not fields:
        return
    cols = []
    vals = []
    for k, v in fields.items():
        cols.append(f"{k} = ?")
        vals.append(json.dumps(v) if isinstance(v, (list, dict)) else v)
    vals.append(iid)
    with _lock, _c() as conn:
        conn.execute(f"UPDATE interviews SET {', '.join(cols)} WHERE id = ?", vals)


def get_interview(iid: str) -> dict[str, Any] | None:
    with _lock:
        row = _c().execute("SELECT * FROM interviews WHERE id = ?", (iid,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d["questions"] = json.loads(d["questions"]) if d.get("questions") else []
    return d


def list_interviews() -> list[dict[str, Any]]:
    with _lock:
        rows = _c().execute("SELECT * FROM interviews ORDER BY created_at DESC").fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["questions"] = json.loads(d["questions"]) if d.get("questions") else []
        out.append(d)
    return out


def save_answer(iid: str, q_index: int, question: str, answer: str,
                status: str, started_at: float, ended_at: float) -> None:
    dur = max(0.0, ended_at - started_at) if (started_at and ended_at) else 0.0
    words = len(answer.split()) if answer else 0
    with _lock, _c() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO answers
               (interview_id, q_index, question, answer, status, started_at, ended_at, duration_sec, word_count)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (iid, q_index, question, answer, status, started_at, ended_at, dur, words),
        )


def get_answers(iid: str) -> list[dict[str, Any]]:
    with _lock:
        rows = _c().execute(
            "SELECT * FROM answers WHERE interview_id = ? ORDER BY q_index ASC", (iid,)
        ).fetchall()
    return [dict(r) for r in rows]

