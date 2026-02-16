
  <img src="docs/images/wordmark.svg" alt="auraforming.ai" width="520" />

<hr/>
<img src="docs/images/agent-interview.gif" alt="Agent interview" width="380" />

## Overview

Voice-first form intake for businesses.  
Upload a blank fillable PDF, generate a shareable interview link, and let clients complete forms through a guided AI conversation.

## Project Description

`auraforming.ai` turns complex paperwork into a structured, multilingual voice workflow.  
The business uploads a PDF once; the platform extracts fields, creates an `agent_id`, and serves a client-facing interview page. During the interview, ElevenLabs handles speech I/O while Gemini evaluates each answer field-by-field and drives the next prompt. At completion, the backend writes answers into the PDF and stores the intake for admin review.

## Demo

- Video demo: `[TO BE ADDED]()`

## Tech Stack

- Frontend: React, Vite, React Router
- Backend: Flask, Flask-CORS
- Data: SQLite + filesystem storage
- PDF: PyMuPDF (`fitz`)
- AI reasoning: Gemini API (`gemini-2.0-flash` by default)
- Voice: ElevenLabs STT + TTS

## Quick Start

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
npm --prefix frontend install
```

Set required env vars:

```bash
export GEMINI_API_KEY="your_google_ai_key"
export ELEVENLABS_API_KEY="your_elevenlabs_key"
export ELEVENLABS_VOICE_ID="your_voice_id"
```

Run:

```bash
python backend/app.py
npm --prefix frontend run dev
```

- Backend: `http://127.0.0.1:5050`
- Frontend: `http://127.0.0.1:5173`

## Documentation

- Setup and startup: `docs/SETUP_AND_RUN.md`
- System architecture and API map: `docs/SYSTEM_OVERVIEW.md`
- Docs index: `docs/README.md`
- Gemini details: `docs/GeminiIntegration.md`
- ElevenLabs integration notes (no Agent mode): `docs/ElevenlabsAgentConfig.md`
