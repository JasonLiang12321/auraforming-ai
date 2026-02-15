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
                agent_name TEXT NOT NULL DEFAULT '',
                pdf_path TEXT NOT NULL,
                schema_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        columns = {
            row[1]
            for row in conn.execute("PRAGMA table_info(agents)").fetchall()
        }
        if "agent_name" not in columns:
            conn.execute("ALTER TABLE agents ADD COLUMN agent_name TEXT NOT NULL DEFAULT ''")
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


def save_agent(agent_id: str, pdf_path: str, schema: dict, agent_name: str = "") -> None:
    created_at = datetime.now(timezone.utc).isoformat()
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT INTO agents (agent_id, agent_name, pdf_path, schema_json, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (agent_id, agent_name, pdf_path, json.dumps(schema), created_at),
        )


def get_agent(agent_id: str) -> dict | None:
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute(
            """
            SELECT agent_id, agent_name, pdf_path, schema_json, created_at
            FROM agents
            WHERE LOWER(agent_id) = LOWER(?)
            """,
            (agent_id,),
        ).fetchone()

    if not row:
        return None

    return {
        "agent_id": row[0],
        "agent_name": row[1] or "",
        "pdf_path": row[2],
        "schema": json.loads(row[3]),
        "created_at": row[4],
    }


def list_agents(limit: int = 200) -> list[dict]:
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            """
            SELECT
                a.agent_id,
                a.agent_name,
                a.pdf_path,
                a.schema_json,
                a.created_at,
                COUNT(cs.session_id) AS intake_count
            FROM agents AS a
            LEFT JOIN completed_sessions AS cs
                ON LOWER(cs.agent_id) = LOWER(a.agent_id)
            GROUP BY a.agent_id, a.agent_name, a.pdf_path, a.schema_json, a.created_at
            ORDER BY a.created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    agents: list[dict] = []
    for row in rows:
        schema = json.loads(row[3])
        widget_names = schema.get("widget_names", [])
        agents.append(
            {
                "agent_id": row[0],
                "agent_name": row[1] or "",
                "pdf_path": row[2],
                "schema": schema,
                "field_count": len(widget_names) if isinstance(widget_names, list) else 0,
                "intake_count": int(row[5] or 0),
                "created_at": row[4],
                "share_url": f"/agent/{row[0]}",
            }
        )
    return agents


def list_completed_sessions_by_agent(agent_id: str, limit: int = 200) -> list[dict]:
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            """
            SELECT session_id, agent_id, answers_json, filled_pdf_path, created_at
            FROM completed_sessions
            WHERE LOWER(agent_id) = LOWER(?)
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (agent_id, limit),
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


def _safe_data_file(path_value: str) -> Path | None:
    path = Path(path_value).resolve()
    data_root = DATA_DIR.resolve()
    if not str(path).startswith(str(data_root)):
        return None
    return path


def delete_agent(agent_id: str) -> dict | None:
    with sqlite3.connect(DB_PATH) as conn:
        agent_row = conn.execute(
            """
            SELECT agent_id, pdf_path
            FROM agents
            WHERE LOWER(agent_id) = LOWER(?)
            """,
            (agent_id,),
        ).fetchone()
        if not agent_row:
            return None

        session_rows = conn.execute(
            """
            SELECT filled_pdf_path
            FROM completed_sessions
            WHERE LOWER(agent_id) = LOWER(?)
            """,
            (agent_id,),
        ).fetchall()

        conn.execute(
            """
            DELETE FROM completed_sessions
            WHERE LOWER(agent_id) = LOWER(?)
            """,
            (agent_id,),
        )
        conn.execute(
            """
            DELETE FROM agents
            WHERE LOWER(agent_id) = LOWER(?)
            """,
            (agent_id,),
        )

    deleted_files = 0
    candidate_paths = [agent_row[1], *[row[0] for row in session_rows]]
    for raw_path in candidate_paths:
        safe_path = _safe_data_file(raw_path)
        if safe_path and safe_path.exists() and safe_path.is_file():
            try:
                safe_path.unlink()
                deleted_files += 1
            except OSError:
                continue

    return {
        "agent_id": agent_row[0],
        "deleted_sessions": len(session_rows),
        "deleted_files": deleted_files,
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
