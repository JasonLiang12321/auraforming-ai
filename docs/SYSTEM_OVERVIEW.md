# System Overview

## Product Summary

`auraforming.ai` is a B2B intake platform for form-heavy workflows. A business uploads a blank fillable PDF once, receives a unique agent link, and sends that link to clients. Clients complete the form through a guided voice interview; the system validates answers, fills the PDF, and stores completed intake records for review.

## B2B Structure

- Business-side portal:
  - Create and manage form agents
  - Review completed intakes and generated PDFs
  - Track per-agent performance
- Client-side interview:
  - Join by link/ID
  - Push-to-talk voice session
  - Guided field-by-field completion

## Architecture

- Frontend: React + Vite (`frontend/`)
- Backend: Flask modular blueprints (`backend/`)
- Storage: SQLite + filesystem (`backend/data/`)
- PDF engine: PyMuPDF (`fitz`)
- AI reasoning: Gemini API
- Voice I/O: ElevenLabs STT + TTS

## Core Backend Modules

- `backend/routes/upload.py`
  - Accepts blank PDF upload
  - Extracts widget names + interview field metadata
  - Creates `agent_id`
- `backend/routes/agent.py`
  - Agent details, blank PDF, live preview, list/delete agents
- `backend/routes/interview.py`
  - Interview session lifecycle (`start`, `turn`, `turn-audio`, `speak`)
  - STT -> Gemini reasoning -> TTS response pipeline
- `backend/routes/submission.py`
  - Final PDF generation + persistence of completed session
- `backend/routes/dashboard.py`
  - Completed intakes listing, detail, preview, and download
- `backend/routes/analytics.py`
  - Agent analytics endpoint
- `backend/routes/gemini.py`
  - Gemini helpers (reasoning + translation endpoints)
- `backend/storage.py`
  - SQLite schema and persistence utilities

## API Map (High-Level)

All routes are mounted under `/api` unless path already includes `/api` in the route file.

- Health
  - `GET /api/health`
- Admin / agent creation
  - `POST /api/admin/upload`
  - `GET /api/admin/agents`
  - `DELETE /api/admin/agents/<agent_id>`
  - `GET /api/admin/agents/<agent_id>/sessions`
  - `GET /api/admin/agents/<agent_id>/analytics`
- Agent runtime
  - `GET /api/agent/<agent_id>`
  - `GET /api/agent/<agent_id>/pdf`
  - `POST /api/agent/<agent_id>/preview`
  - `GET /api/agent/<agent_id>/signed-url`
- Interview
  - `POST /api/agent/<agent_id>/interview/start`
  - `POST /api/agent/<agent_id>/interview/turn`
  - `POST /api/agent/<agent_id>/interview/turn-audio`
  - `POST /api/agent/<agent_id>/interview/speak`
- Completion and dashboards
  - `POST /api/submission/complete`
  - `GET /api/admin/dashboard/sessions`
  - `GET /api/admin/dashboard/sessions/<session_id>`
  - `GET /api/admin/dashboard/sessions/<session_id>/pdf`
  - `GET /api/admin/dashboard/sessions/<session_id>/download`

## Interview Data Flow

1. Client starts interview (`/interview/start`) and receives first prompt.
2. Client records audio and submits `/interview/turn-audio`.
3. Backend transcribes with ElevenLabs STT.
4. Backend evaluates the turn using Gemini with strict JSON schema.
5. Session state updates:
   - adequate answer -> store + advance field
   - inadequate answer -> clarification prompt
6. Backend synthesizes assistant response via ElevenLabs TTS.
7. On completion, generated PDF and intake metadata are persisted.

## Storage Model

SQLite tables:

- `agents`
  - `agent_id`, `agent_name`, `pdf_path`, `schema_json`, `created_at`
- `completed_sessions`
  - `session_id`, `agent_id`, `answers_json`, `filled_pdf_path`, `created_at`

Filesystem:

- `backend/data/uploads/` blank PDFs
- `backend/data/completed/` completed PDFs + session metadata JSON files

## Operational Notes

- Interview sessions in `interview.py` are in-memory; backend restart resets active sessions.
- PDF field names vary across documents; normalization/mapping logic is critical for reliable checkbox and dropdown behavior.
- Gemini reliability is prompt-dependent; strict response schema is used to reduce drift.
