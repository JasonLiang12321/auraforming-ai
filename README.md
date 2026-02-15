# Hackathon Starter: React + Flask

Lean full-stack starter with:
- Frontend: React + Vite
- Backend: Flask + Flask-CORS
- Health check endpoint: `GET /api/health`
- Business upload endpoint: `POST /api/admin/upload`
- Share page route: `/agent/{agent_id}` (frontend)
- Agent details endpoint: `GET /api/agent/{agent_id}`
- Guided interview start endpoint: `POST /api/agent/{agent_id}/interview/start`
- Guided interview turn endpoint: `POST /api/agent/{agent_id}/interview/turn`
- Guided interview audio turn endpoint: `POST /api/agent/{agent_id}/interview/turn-audio`
- Interview speech synthesis endpoint: `POST /api/agent/{agent_id}/interview/speak`
- Completed sessions endpoint: `GET /api/admin/dashboard/sessions`
- Completed session detail endpoint: `GET /api/admin/dashboard/sessions/{session_id}`
- ElevenLabs prompt config doc: `docs/ElevenlabsAgentConfig.md` (legacy conversational mode)

## Prerequisites

- Python 3.10+
- Node.js 18+ and npm

## Project Structure

```text
.
├── backend/
│   ├── app.py
│   ├── storage.py
│   ├── requirements.txt
│   └── routes/
│       ├── voice.py
│       ├── upload.py
│       └── health.py
└── frontend/
    ├── package.json
    └── src/
        ├── components/
        ├── pages/
        └── services/
```

## 1) Install Dependencies

From the project root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

Then install frontend deps:

```bash
cd frontend
npm install
cd ..
```

## 2) Run the Backend (Terminal 1)

From project root:

```bash
source .venv/bin/activate
python backend/app.py
```

Backend runs on: `http://127.0.0.1:5050`

## 3) Run the Frontend (Terminal 2)

From project root:

```bash
cd frontend
npm run dev
```

Frontend runs on: `http://127.0.0.1:5173`

Pages:
- Admin: `http://127.0.0.1:5173/admin`
- Admin dashboard: `http://127.0.0.1:5173/admin/dashboard`
- End-user: `http://127.0.0.1:5173/agent/<agent_id>`

## 3.1) ElevenLabs Keys Required

Set these before running backend:

```bash
export ELEVENLABS_API_KEY="your_api_key"
export ELEVENLABS_VOICE_ID="your_tts_voice_id"
export ELEVENLABS_TTS_MODEL="eleven_flash_v2_5"
export ELEVENLABS_STT_MODEL="scribe_v1"
export GEMINI_API_KEY="your_google_ai_key"
export GEMINI_MODEL="gemini-2.0-flash"
```

Notes:
- Interview flow is now deterministic:
  - browser records user audio
  - backend sends audio to ElevenLabs STT
  - backend sends transcript to Gemini
  - backend sends Gemini response text to ElevenLabs TTS
- Guided interview validation is handled by Gemini.

## 4) Verify API Connection

In a third terminal:

```bash
curl http://127.0.0.1:5050/api/health
```

Expected response:

```json
{"service":"flask-backend","status":"ok"}
```

## 5) Create Agent From Blank PDF

```bash
curl -X POST http://127.0.0.1:5050/api/admin/upload \
  -F "file=@/absolute/path/to/blank-form.pdf"
```

Expected response shape:

```json
{
  "filename": "blank-form.pdf",
  "agent_id": "a1b2c3d4",
  "share_url": "/agent/a1b2c3d4",
  "fieldCount": 2,
  "widgetNames": ["Text_Field_01", "Checkbox_02"]
}
```

Open this share URL in frontend:

```text
http://127.0.0.1:5173/agent/a1b2c3d4
```

## Optional: Change Backend URL in Frontend

Set an env var if needed:

```bash
cd frontend
echo "VITE_API_BASE_URL=http://127.0.0.1:5050" > .env.local
```
