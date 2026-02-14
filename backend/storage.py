import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
COMPLETED_DIR = DATA_DIR / "completed"
DB_PATH = DATA_DIR / "agents.sqlite3"


def init_storage() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    COMPLETED_DIR.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS agents (
                agent_id TEXT PRIMARY KEY,
                pdf_path TEXT NOT NULL,
                schema_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS completed_sessions (
                session_id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                answers_json TEXT NOT NULL,
                filled_pdf_path TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(agent_id) REFERENCES agents(agent_id)
            )
            """
        )


def save_agent(agent_id: str, pdf_path: str, schema: dict) -> None:
    created_at = datetime.now(timezone.utc).isoformat()
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT INTO agents (agent_id, pdf_path, schema_json, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (agent_id, pdf_path, json.dumps(schema), created_at),
        )


def get_agent(agent_id: str) -> dict | None:
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute(
            """
            SELECT agent_id, pdf_path, schema_json, created_at
            FROM agents
            WHERE LOWER(agent_id) = LOWER(?)
            """,
            (agent_id,),
        ).fetchone()

    if not row:
        return None

    return {
        "agent_id": row[0],
        "pdf_path": row[1],
        "schema": json.loads(row[2]),
        "created_at": row[3],
    }


def save_completed_session(
    *,
    session_id: str,
    agent_id: str,
    answers: dict[str, str],
    filled_pdf_path: str,
) -> None:
    created_at = datetime.now(timezone.utc).isoformat()
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO completed_sessions
                (session_id, agent_id, answers_json, filled_pdf_path, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (session_id, agent_id, json.dumps(answers), filled_pdf_path, created_at),
        )


def list_completed_sessions(limit: int = 100) -> list[dict]:
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            """
            SELECT session_id, agent_id, answers_json, filled_pdf_path, created_at
            FROM completed_sessions
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    items: list[dict] = []
    for row in rows:
        answers = json.loads(row[2])
        items.append(
            {
                "session_id": row[0],
                "agent_id": row[1],
                "answers": answers,
                "field_count": len(answers),
                "filled_pdf_path": row[3],
                "created_at": row[4],
            }
        )
    return items


def get_completed_session(session_id: str) -> dict | None:
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute(
            """
            SELECT session_id, agent_id, answers_json, filled_pdf_path, created_at
            FROM completed_sessions
            WHERE session_id = ?
            """,
            (session_id,),
        ).fetchone()

    if not row:
        return None

    answers = json.loads(row[2])
    return {
        "session_id": row[0],
        "agent_id": row[1],
        "answers": answers,
        "field_count": len(answers),
        "filled_pdf_path": row[3],
        "created_at": row[4],
    }
