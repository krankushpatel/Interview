"""Tiny SQLite persistence: interviews + answers."""
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
        _conn.commit()


def _db() -> sqlite3.Connection:
    assert _conn is not None, "db.init() was not called"
    return _conn


def save_interview(row: dict[str, Any]) -> None:
    with _lock:
        _db().execute(
            """INSERT OR REPLACE INTO interviews
               (id, candidate_name, meeting_url, bot_id, status, questions, current_index,
                student_id, student_name, created_at, started_at, finished_at)
               VALUES (:id, :candidate_name, :meeting_url, :bot_id, :status, :questions,
                       :current_index, :student_id, :student_name, :created_at,
                       :started_at, :finished_at)""",
            {
                "student_id": None,
                "student_name": None,
                "started_at": None,
                "finished_at": None,
                "current_index": -1,
                **row,
                "questions": json.dumps(row["questions"]),
            },
        )
        _db().commit()


def update_interview(iid: str, **fields: Any) -> None:
    if not fields:
        return
    cols = ", ".join(f"{k} = :{k}" for k in fields)
    with _lock:
        _db().execute(f"UPDATE interviews SET {cols} WHERE id = :_id", {**fields, "_id": iid})
        _db().commit()


def save_answer(iid: str, q_index: int, question: str, answer: str, status: str,
                started_at: float, ended_at: float) -> None:
    with _lock:
        _db().execute(
            """INSERT OR REPLACE INTO answers
               (interview_id, q_index, question, answer, status, started_at, ended_at,
                duration_sec, word_count)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (iid, q_index, question, answer, status, started_at, ended_at,
             round(ended_at - started_at, 1), len(answer.split())),
        )
        _db().commit()


def get_answers(iid: str) -> list[dict[str, Any]]:
    with _lock:
        rows = _db().execute(
            "SELECT * FROM answers WHERE interview_id = ? ORDER BY q_index", (iid,)
        ).fetchall()
    return [dict(r) for r in rows]


def _row_to_dict(r: sqlite3.Row) -> dict[str, Any]:
    d = dict(r)
    d["questions"] = json.loads(d["questions"] or "[]")
    return d


def get_interview(iid: str) -> dict[str, Any] | None:
    with _lock:
        r = _db().execute("SELECT * FROM interviews WHERE id = ?", (iid,)).fetchone()
    return _row_to_dict(r) if r else None


def list_interviews(limit: int = 100) -> list[dict[str, Any]]:
    with _lock:
        rows = _db().execute(
            "SELECT * FROM interviews ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def now() -> float:
    return time.time()
