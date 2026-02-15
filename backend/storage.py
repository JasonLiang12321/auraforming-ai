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

def save_session_start(session_id: str, agent_id: str, started_at: str) -> None:
    """Save session start time to metadata file"""
    metadata_path = COMPLETED_DIR / f"{session_id}.json"
    
    metadata = {
        'session_id': session_id,
        'agent_id': agent_id,
        'created_at': started_at,
        'started_at': started_at,
        'answers': {},
    }
    
    metadata_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False))
    print(f"🚀 Session {session_id} started at {started_at}")

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
    language_code: str = "en-US",
    language_label: str = "English (US)",
) -> None:
    """Save a completed session"""
    from datetime import datetime, timezone
    
    completed_at = datetime.now(timezone.utc).isoformat()
    
    # Load existing metadata to get started_at
    metadata_path = COMPLETED_DIR / f"{session_id}.json"
    started_at = None
    
    print(f"🔍 Looking for metadata at: {metadata_path}")
    print(f"   File exists: {metadata_path.exists()}")
    
    if metadata_path.exists():
        try:
            existing = json.loads(metadata_path.read_text())
            print(f"📖 Existing metadata: {existing}")
            started_at = existing.get('started_at') or existing.get('created_at')
            if started_at:
                print(f"✅ Found existing start time: {started_at}")
        except Exception as e:
            print(f"⚠️  Could not read existing metadata: {e}")
    
    # If no start time found, use completed_at (fallback)
    if not started_at:
        print(f"⚠️  No start time found, using completed_at as fallback")
        started_at = completed_at
    
    # Calculate duration
    duration_seconds = 0
    try:
        start = datetime.fromisoformat(started_at.replace('Z', '+00:00'))
        end = datetime.fromisoformat(completed_at.replace('Z', '+00:00'))
        duration_seconds = (end - start).total_seconds()
        print(f"⏱️  Calculated duration: {duration_seconds}s")
    except Exception as e:
        print(f"⚠️  Could not calculate duration: {e}")
    
    # Save complete metadata
    metadata = {
        'session_id': session_id,
        'agent_id': agent_id,
        'answers': answers,
        'started_at': started_at,
        'created_at': started_at,
        'completed_at': completed_at,
        'duration_seconds': duration_seconds,
        'language_code': language_code,
        'language_label': language_label,
    }
    
    metadata_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False))
    print(f"💾 Saved metadata to: {metadata_path}")
    
    # Save to database
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO completed_sessions
                (session_id, agent_id, answers_json, filled_pdf_path, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (session_id, agent_id, json.dumps(answers), filled_pdf_path, started_at),
        )
    
    print(f"✅ Session {session_id} complete:")
    print(f"   Started:   {started_at}")
    print(f"   Completed: {completed_at}")
    print(f"   Duration:  {duration_seconds:.1f}s ({int(duration_seconds // 60)}m {int(duration_seconds % 60)}s)")

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

def get_completed_sessions(limit: int = 500) -> list[dict]:
    """Get all completed sessions with enriched metadata from JSON files"""
    sessions = list_completed_sessions(limit)
    
    # Enrich with metadata from JSON files
    for session in sessions:
        metadata_path = COMPLETED_DIR / f"{session['session_id']}.json"
        if metadata_path.exists():
            try:
                metadata = json.loads(metadata_path.read_text())
                session['language_code'] = metadata.get('language_code', 'en-US')
                session['language_label'] = metadata.get('language_label', 'English (US)')
                session['completed_at'] = metadata.get('completed_at', session['created_at'])
            except Exception:
                # Fallback to defaults
                session['language_code'] = 'en-US'
                session['language_label'] = 'English (US)'
                session['completed_at'] = session['created_at']
        else:
            session['language_code'] = 'en-US'
            session['language_label'] = 'English (US)'
            session['completed_at'] = session['created_at']
        
        session['completed'] = True
    
    return sessions

# Add this function at the end of the file (after get_completed_sessions):

def get_all_sessions_for_agent(agent_id: str) -> list[dict]:
    """Get all sessions for an agent with timing info from JSON metadata files"""
    sessions = []
    
    # Get completed sessions from database
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            """
            SELECT session_id, agent_id, answers_json, filled_pdf_path, created_at
            FROM completed_sessions
            WHERE LOWER(agent_id) = LOWER(?)
            ORDER BY created_at DESC
            """,
            (agent_id,),
        ).fetchall()
    
    # Enrich with metadata from JSON files
    for row in rows:
        session_id = row[0]
        metadata_path = COMPLETED_DIR / f"{session_id}.json"
        
        answers = json.loads(row[2])
        session = {
            'session_id': session_id,
            'agent_id': row[1],
            'answers': answers,
            'filled_pdf_path': row[3],
            'created_at': row[4],
            'is_completed': True,
            'language_code': 'en-US',
            'language_label': 'English (US)',
        }
        
        # Try to get start/end times from metadata JSON
        if metadata_path.exists():
            try:
                metadata = json.loads(metadata_path.read_text())
                session['started_at'] = metadata.get('created_at', row[4])
                session['completed_at'] = metadata.get('completed_at', row[4])
                session['language_code'] = metadata.get('language_code', 'en-US')
                session['language_label'] = metadata.get('language_label', 'English (US)')
            except Exception:
                # Fallback - use created_at for both
                session['started_at'] = row[4]
                session['completed_at'] = row[4]
        else:
            # Fallback - use created_at for both
            session['started_at'] = row[4]
            session['completed_at'] = row[4]
        
        sessions.append(session)
    
    return sessions

# Add this function after save_completed_session (around line 290):

def list_completed_sessions(limit: int = 500) -> list[dict]:
    """Get all completed sessions with metadata from JSON files"""
    sessions = []
    
    # Get all session JSON files from completed directory
    if not COMPLETED_DIR.exists():
        return sessions
    
    for json_file in sorted(COMPLETED_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        if len(sessions) >= limit:
            break
        
        try:
            metadata = json.loads(json_file.read_text())
            session_id = metadata.get('session_id')
            
            if not session_id:
                continue
            
            # Enrich with basic info
            sessions.append({
                'session_id': session_id,
                'agent_id': metadata.get('agent_id', ''),
                'answers': metadata.get('answers', {}),
                'field_count': len(metadata.get('answers', {})),
                'created_at': metadata.get('created_at') or metadata.get('started_at', ''),
                'started_at': metadata.get('started_at', ''),
                'completed_at': metadata.get('completed_at', ''),
                'duration_seconds': metadata.get('duration_seconds', 0),
                'language_code': metadata.get('language_code', 'en-US'),
                'language_label': metadata.get('language_label', 'English (US)'),
            })
        except Exception as e:
            continue
    
    return sessions