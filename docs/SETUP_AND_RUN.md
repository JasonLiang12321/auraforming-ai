# Setup and Run

## Prerequisites

- Python `3.10+`
- Node.js `18+` and npm
- macOS/Linux shell (commands below assume `bash`/`zsh`)

## 1) Install Dependencies

From the repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
npm --prefix frontend install
```

## 2) Configure Environment Variables

Set these before starting the backend:

```bash
export GEMINI_API_KEY="your_google_ai_key"
export GEMINI_MODEL="gemini-2.0-flash"

export ELEVENLABS_API_KEY="your_elevenlabs_key"
export ELEVENLABS_VOICE_ID="your_voice_id"
export ELEVENLABS_TTS_MODEL="eleven_flash_v2_5"
export ELEVENLABS_STT_MODEL="scribe_v1"
```

Optional:

```bash
export ELEVENLABS_STT_LANGUAGE="en"
export ELEVENLABS_AGENT_ID="your_agent_id_for_signed_url_endpoint"
export ENABLE_INTERVIEW_LABEL_LOCALIZATION="1"
export VOICE_DEBUG="0"
```

Frontend API URL override (optional):

```bash
echo 'VITE_API_BASE_URL=http://127.0.0.1:5050' > frontend/.env.local
```

## 3) Start Backend

```bash
source .venv/bin/activate
python backend/app.py
```

Backend runs at `http://127.0.0.1:5050`.

## 4) Start Frontend

In another terminal:

```bash
npm --prefix frontend run dev
```

Frontend runs at `http://127.0.0.1:5173`.

## 5) Smoke Test

Health check:

```bash
curl http://127.0.0.1:5050/api/health
```

Expected:

```json
{"status":"ok","service":"flask-backend"}
```

Upload a blank fillable PDF:

```bash
curl -X POST http://127.0.0.1:5050/api/admin/upload \
  -F "agent_name=Demo Intake Form" \
  -F "file=@/absolute/path/to/blank-form.pdf"
```

## 6) Main Local Routes

- Landing: `http://127.0.0.1:5173/`
- Admin create agent: `http://127.0.0.1:5173/admin`
- Admin agents list: `http://127.0.0.1:5173/admin/agents`
- End-user interview: `http://127.0.0.1:5173/agent/<agent_id>`

## Notes

- SQLite and PDF files are stored under `backend/data/`.
- Active interview sessions are in-memory; restarting backend clears active sessions.
