# ElevenLabs Integration (Current, No Agent Mode)

## Important Update

This project **does not currently use ElevenLabs Conversational Agent prompt overrides** for the active interview flow.

- No dynamic variables like `FIRST_MISSING_FIELD_NAME` are required in production flow.
- The old conversational-agent prompt template is deprecated in this repo.

Current architecture:

- ElevenLabs handles:
  - Speech-to-Text (STT)
  - Text-to-Speech (TTS)
- Gemini handles:
  - turn reasoning
  - field validation
  - next-question generation

## Runtime Path

Frontend (`AgentPage`) calls backend interview endpoints:

1. `POST /api/agent/<agent_id>/interview/start`
2. `POST /api/agent/<agent_id>/interview/turn-audio`
3. `POST /api/agent/<agent_id>/interview/speak` (for spoken prompts)

Backend (`backend/routes/interview.py`) calls ElevenLabs HTTP APIs directly:

- `POST /v1/speech-to-text`
- `POST /v1/text-to-speech/<voice_id>`

## Required Environment Variables

- `ELEVENLABS_API_KEY` (required)
- `ELEVENLABS_VOICE_ID` (required for TTS)

Optional:

- `ELEVENLABS_TTS_MODEL` (default: `eleven_flash_v2_5`)
- `ELEVENLABS_STT_MODEL` (default: `scribe_v1`)
- `ELEVENLABS_STT_LANGUAGE` (fallback language code for STT)

## Legacy Signed URL Endpoint

`GET /api/agent/<agent_id>/signed-url` still exists in `backend/routes/voice.py` for legacy ConvAI signed URL workflows, but it is **not used by the current primary frontend interview flow**.

## Why this design

- Keeps conversation logic centralized in backend (Gemini + session state)
- Avoids ConvAI override restrictions (`prompt`, `first_message`, dynamic variable mismatches)
- Makes behavior auditable and deterministic from one code path
