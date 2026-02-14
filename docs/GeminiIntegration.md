# Gemini Integration (Interview Reasoning Layer)

This document describes how Gemini is used in the current app for guided voice form filling.

## Purpose

Gemini is the reasoning engine behind the guided interview flow:

- Decides whether a user answer is adequate for the current field.
- Returns a short assistant response for the next turn.
- Handles clarification and interruption (`barge_in`) intents.

ElevenLabs is used as transport only (STT + TTS). Gemini handles all turn validation/state decisions.

## Model

- Environment variable: `GEMINI_MODEL`
- Default: ``
- API key variable: `GEMINI_API_KEY`

Configured in: `backend/routes/gemini.py`

## Backend Endpoints

### 1) Start Interview Session

- `POST /api/agent/{agent_id}/interview/start`
- File: `backend/routes/interview.py`

What it does:

- Loads agent schema (`widget_names`) for `agent_id`
- Creates in-memory interview session
- Returns:
  - `session_id`
  - `missing_fields` (ordered list)
  - `current_field`
  - `system_prompt` (sequential collection rules)
  - `first_prompt`

### 2) Process Interview Turn

- `POST /api/agent/{agent_id}/interview/turn`
- File: `backend/routes/interview.py`

Request body:

```json
{
  "session_id": "abc123def456",
  "user_input": "user transcript text",
  "was_interruption": false
}
```

What it does:

- Validates current field only (no jumping fields).
- Calls Gemini with strict JSON schema.
- If adequate:
  - stores normalized answer
  - advances to next field
- If inadequate:
  - keeps current field
  - asks clarification

Response includes:

- `completed`
- `current_field`
- `missing_fields`
- `answers`
- `intent`
- `is_answer_adequate`
- `assistant_response`

### 3) Process Interview Audio Turn (Primary)

- `POST /api/agent/{agent_id}/interview/turn-audio`
- File: `backend/routes/interview.py`

Request body (multipart form-data):

- `session_id` (string)
- `was_interruption` (boolean-like string)
- `audio` (recorded audio file from browser)

What it does:

- Sends uploaded audio to ElevenLabs STT.
- Uses transcript as `user_input` for Gemini turn evaluation.
- Uses Gemini `assistant_response` text for ElevenLabs TTS synthesis.
- Returns both structured interview result and playable audio payload.

Additional response fields:

- `user_transcript`
- `audio_mime_type`
- `audio_base64`

### 4) Synthesize Interview Text

- `POST /api/agent/{agent_id}/interview/speak`
- File: `backend/routes/interview.py`

Used by frontend to play the opening first prompt before user records first turn.

### 5) Generic Gemini Utility Endpoints

In `backend/routes/gemini.py`:

- `POST /api/gemini`
- `POST /api/gemini/questions`

These are utility endpoints and are separate from the live interview turn pipeline.

## Prompting + JSON Contract

Gemini calls use:

- `response_mime_type: "application/json"`
- strict `response_schema`

Interview turn required fields:

- `intent`: `data | clarification | acknowledgment | barge_in`
- `is_answer_adequate`: boolean
- `normalized_value`: string
- `assistant_response`: string

Helper used:

- `run_gemini_json(...)` in `backend/routes/gemini.py`

## Frontend Wiring

Main file: `frontend/src/pages/AgentPage.jsx`

Flow:

1. Start interview session (`/interview/start`).
2. Play first prompt with `/interview/speak`.
3. User records audio (push-to-talk) in browser.
4. Send audio to `/interview/turn-audio`.
5. Backend returns transcript + Gemini decision + ElevenLabs TTS audio.
6. Frontend plays returned assistant audio.
7. Repeat until `completed`.

API helpers:

- `startGuidedInterview(...)`
- `submitInterviewAudioTurn(...)`
- `speakInterviewText(...)`

in `frontend/src/services/api.js`.

## Interruption Handling (Barge-in)

- Frontend flags interruption when user speaks while assistant mode is `speaking`:
  - `was_interruption = true`
- Backend prompt allows `barge_in` intent and instructs Gemini to acknowledge and pivot back to current field.

## Notes / Limits

- Interview sessions are currently in-memory (`SESSIONS` dict in `backend/routes/interview.py`).
- Restarting backend clears active interview sessions.
- Final PDF completion persistence is not part of this interview logic doc.

## Required Env Vars

Backend:

- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- optional: `ELEVENLABS_TTS_MODEL` (defaults to `eleven_flash_v2_5`)
- optional: `ELEVENLABS_STT_MODEL` (defaults to `scribe_v1`)
- optional: `ELEVENLABS_STT_LANGUAGE`
- `GEMINI_API_KEY`
- optional: `GEMINI_MODEL` (defaults to `gemini-2.0-flash`)
