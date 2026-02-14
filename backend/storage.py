import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "agents.sqlite3"


def init_storage() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

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
            WHERE agent_id = ?
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
