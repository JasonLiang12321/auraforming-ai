# Hackathon Starter: React + Flask

Lean full-stack starter with:
- Frontend: React + Vite
- Backend: Flask + Flask-CORS
- Health check endpoint: `GET /api/health`
- Business upload endpoint: `POST /api/admin/upload`
- Share endpoint: `GET /agent/{agent_id}`

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
  "agent_id": "a1b2c3d4",
  "share_url": "/agent/a1b2c3d4",
  "fieldCount": 2,
  "widgetNames": ["Text_Field_01", "Checkbox_02"]
}
```

## Optional: Change Backend URL in Frontend

Set an env var if needed:

```bash
cd frontend
echo "VITE_API_BASE_URL=http://127.0.0.1:5050" > .env.local
```
