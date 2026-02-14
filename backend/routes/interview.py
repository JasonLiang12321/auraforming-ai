import json
import logging
import base64
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request
import requests

from routes.gemini import GeminiAuthError, GeminiRateLimitError, GeminiRequestError, run_gemini_json
from storage import get_agent

interview_bp = Blueprint("interview", __name__)
logger = logging.getLogger(__name__)


@dataclass
class InterviewSession:
    session_id: str
    agent_id: str
    missing_fields: list[str]
    answers: dict[str, str] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    @property
    def current_field(self) -> str | None:
        return self.missing_fields[0] if self.missing_fields else None

    @property
    def completed(self) -> bool:
        return not self.missing_fields


SESSIONS: dict[str, InterviewSession] = {}
ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1"


def _build_system_prompt(missing_fields: list[str]) -> str:
    ordered_fields = json.dumps(missing_fields)
    return (
        "You are a voice assistant helping the user fill a form.\n"
        f"Required fields in strict order: {ordered_fields}\n"
        "Rules:\n"
        "1) Ask for exactly one missing field at a time, in order.\n"
        "2) If answer is adequate, acknowledge and move to the next field.\n"
        "3) If answer is unclear/incomplete, ask a concise clarification for that same field.\n"
        "4) If user interrupts, briefly acknowledge and steer back to current field.\n"
        "5) Never request fields outside the required list."
    )


def _build_first_prompt(first_field: str) -> str:
    return (
        "Hi there. I will help you complete this form one step at a time. "
        f"Let's start with {first_field}. What should I enter?"
    )


def _evaluate_turn_with_gemini(
    *,
    current_field: str,
    user_input: str,
    missing_fields: list[str],
    answers: dict[str, str],
    was_interruption: bool,
) -> dict:
    prompt = f"""
You are validating one turn in a voice form interview.

Current field (evaluate only this field): "{current_field}"
Remaining fields in order: {json.dumps(missing_fields)}
Already collected answers: {json.dumps(answers)}
User transcript: "{user_input}"
Interruption while assistant was speaking: {str(was_interruption).lower()}

Return STRICT JSON:
{{
  "intent": "data|clarification|acknowledgment|barge_in",
  "is_answer_adequate": true/false,
  "normalized_value": "string (empty if inadequate)",
  "assistant_response": "short spoken response"
}}

Rules:
- Mark as adequate ONLY when user clearly provided the value for the current field.
- If unclear, off-topic, partial, or ambiguous, mark inadequate and ask clarification.
- If interruption/side question, use intent "barge_in", acknowledge briefly, then return to current field.
- Never ask for multiple fields at once.
- Never invent field names.
""".strip()

    response = run_gemini_json(
        prompt=prompt,
        response_schema={
            "type": "object",
            "properties": {
                "intent": {"type": "string", "enum": ["data", "clarification", "acknowledgment", "barge_in"]},
                "is_answer_adequate": {"type": "boolean"},
                "normalized_value": {"type": "string"},
                "assistant_response": {"type": "string"},
            },
            "required": ["intent", "is_answer_adequate", "normalized_value", "assistant_response"],
        },
    )
    return response


def _require_session(agent_id: str, session_id: str) -> InterviewSession | tuple:
    session = SESSIONS.get(session_id)
    if not session:
        return jsonify({"error": "Interview session not found."}), 404
    if session.agent_id != agent_id:
        return jsonify({"error": "Session does not match agent_id."}), 400
    return session


def _evaluate_and_update_session(
    *,
    agent_id: str,
    session: InterviewSession,
    user_input: str,
    was_interruption: bool,
) -> dict:
    if session.completed:
        return {
            "session_id": session.session_id,
            "completed": True,
            "current_field": None,
            "missing_fields": [],
            "answers": session.answers,
            "intent": "acknowledgment",
            "is_answer_adequate": True,
            "assistant_response": "Thanks. I have all required information.",
        }

    current_field = session.current_field
    if not current_field:
        raise RuntimeError("No active field in session.")

    logger.info(
        "Interview turn received agent_id=%s session_id=%s current_field=%s interruption=%s user_input=%s",
        agent_id,
        session.session_id,
        current_field,
        was_interruption,
        user_input[:240],
    )

    evaluation = _evaluate_turn_with_gemini(
        current_field=current_field,
        user_input=user_input,
        missing_fields=session.missing_fields,
        answers=session.answers,
        was_interruption=was_interruption,
    )

    intent = str(evaluation.get("intent", "clarification"))
    is_answer_adequate = bool(evaluation.get("is_answer_adequate", False))
    normalized_value = str(evaluation.get("normalized_value", "")).strip()
    assistant_response = str(evaluation.get("assistant_response", "")).strip()

    if is_answer_adequate and normalized_value:
        session.answers[current_field] = normalized_value
        session.missing_fields = session.missing_fields[1:]
        session.updated_at = datetime.now(timezone.utc).isoformat()

        if session.completed:
            assistant_response = assistant_response or "Thanks. We have all missing fields now."
        else:
            next_field = session.current_field or "the next field"
            assistant_response = assistant_response or f"Great, now let's do {next_field}."
    else:
        session.updated_at = datetime.now(timezone.utc).isoformat()
        if not assistant_response:
            if intent == "barge_in":
                assistant_response = f"Got it. Let's continue with {current_field}."
            else:
                assistant_response = f"I still need {current_field}. Could you clarify that?"

    logger.info(
        "Interview turn evaluated agent_id=%s session_id=%s intent=%s adequate=%s completed=%s next_field=%s",
        agent_id,
        session.session_id,
        intent,
        is_answer_adequate,
        session.completed,
        session.current_field,
    )

    return {
        "session_id": session.session_id,
        "completed": session.completed,
        "current_field": session.current_field,
        "missing_fields": session.missing_fields,
        "answers": session.answers,
        "intent": intent,
        "is_answer_adequate": is_answer_adequate,
        "assistant_response": assistant_response,
    }


def _synthesize_with_elevenlabs(text: str) -> tuple[bytes, str]:
    api_key = os.getenv("ELEVENLABS_API_KEY", "").strip()
    voice_id = os.getenv("ELEVENLABS_VOICE_ID", "").strip()
    tts_model = os.getenv("ELEVENLABS_TTS_MODEL", "eleven_flash_v2_5").strip()

    if not api_key:
        raise RuntimeError("Missing ELEVENLABS_API_KEY.")
    if not voice_id:
        raise RuntimeError("Missing ELEVENLABS_VOICE_ID.")

    response = requests.post(
        f"{ELEVENLABS_API_BASE}/text-to-speech/{voice_id}",
        headers={
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
        json={
            "text": text,
            "model_id": tts_model,
        },
        timeout=25,
    )

    if not response.ok:
        logger.error("ElevenLabs TTS failed status=%s body=%s", response.status_code, response.text[:400])
        raise RuntimeError("ElevenLabs TTS request failed.")

    return response.content, "audio/mpeg"


def _transcribe_with_elevenlabs(*, audio_bytes: bytes, filename: str, content_type: str) -> str:
    api_key = os.getenv("ELEVENLABS_API_KEY", "").strip()
    stt_model = os.getenv("ELEVENLABS_STT_MODEL", "scribe_v1").strip()
    language_code = os.getenv("ELEVENLABS_STT_LANGUAGE", "").strip()

    if not api_key:
        raise RuntimeError("Missing ELEVENLABS_API_KEY.")

    data: dict[str, str] = {"model_id": stt_model}
    if language_code:
        data["language_code"] = language_code

    response = requests.post(
        f"{ELEVENLABS_API_BASE}/speech-to-text",
        headers={"xi-api-key": api_key},
        files={"file": (filename, audio_bytes, content_type)},
        data=data,
        timeout=40,
    )

    if not response.ok:
        logger.error("ElevenLabs STT failed status=%s body=%s", response.status_code, response.text[:400])
        raise RuntimeError("ElevenLabs STT request failed.")

    payload = response.json()
    transcript = str(payload.get("text") or payload.get("transcript") or "").strip()
    return transcript


@interview_bp.post("/agent/<agent_id>/interview/start")
def start_interview(agent_id: str) -> tuple:
    agent = get_agent(agent_id)
    if not agent:
        return jsonify({"error": "Agent not found."}), 404

    fields = agent.get("schema", {}).get("widget_names", [])
    if not isinstance(fields, list) or not fields:
        return jsonify({"error": "Agent has no fields to interview."}), 400

    normalized_fields = [str(item).strip() for item in fields if str(item).strip()]
    if not normalized_fields:
        return jsonify({"error": "Agent has no valid fields to interview."}), 400

    session_id = uuid.uuid4().hex[:12]
    session = InterviewSession(session_id=session_id, agent_id=agent_id, missing_fields=normalized_fields)
    SESSIONS[session_id] = session

    first_field = session.current_field or "the first field"
    return (
        jsonify(
            {
                "session_id": session.session_id,
                "agent_id": agent_id,
                "current_field": session.current_field,
                "missing_fields": session.missing_fields,
                "answers": session.answers,
                "completed": session.completed,
                "system_prompt": _build_system_prompt(session.missing_fields),
                "first_prompt": _build_first_prompt(first_field),
            }
        ),
        200,
    )


@interview_bp.post("/agent/<agent_id>/interview/turn")
def process_interview_turn(agent_id: str) -> tuple:
    try:
        data = request.get_json(silent=True)
        if data is None or not isinstance(data, dict):
            return jsonify({"error": "Invalid or missing JSON body"}), 400

        session_id = str(data.get("session_id", "")).strip()
        user_input = str(data.get("user_input", "")).strip()
        was_interruption = bool(data.get("was_interruption", False))

        if not session_id or not user_input:
            return jsonify({"error": "Missing session_id or user_input"}), 400

        session_or_error = _require_session(agent_id, session_id)
        if isinstance(session_or_error, tuple):
            return session_or_error
        session = session_or_error

        result = _evaluate_and_update_session(
            agent_id=agent_id,
            session=session,
            user_input=user_input,
            was_interruption=was_interruption,
        )
        return (
            jsonify(result),
            200,
        )
    except GeminiAuthError as exc:
        logger.warning("Interview turn blocked by Gemini auth issue: %s", exc)
        return jsonify({"error": str(exc), "code": "GEMINI_AUTH"}), 502
    except GeminiRateLimitError as exc:
        logger.warning("Interview turn blocked by Gemini rate limit: %s", exc)
        return jsonify({"error": str(exc), "code": "GEMINI_RATE_LIMIT"}), 429
    except GeminiRequestError as exc:
        logger.warning("Interview turn failed due to Gemini request issue: %s", exc)
        return jsonify({"error": str(exc), "code": "GEMINI_REQUEST"}), 502
    except Exception as exc:
        logger.exception("Interview turn processing failed: %s", exc)
        return jsonify({"error": "Failed to process interview turn."}), 500


@interview_bp.post("/agent/<agent_id>/interview/speak")
def speak_text(agent_id: str) -> tuple:
    try:
        data = request.get_json(silent=True)
        if data is None or not isinstance(data, dict):
            return jsonify({"error": "Invalid or missing JSON body"}), 400

        text = str(data.get("text", "")).strip()
        if not text:
            return jsonify({"error": "Missing text"}), 400

        if not get_agent(agent_id):
            return jsonify({"error": "Agent not found."}), 404

        audio_bytes, audio_mime = _synthesize_with_elevenlabs(text)
        return (
            jsonify(
                {
                    "audio_mime_type": audio_mime,
                    "audio_base64": base64.b64encode(audio_bytes).decode("ascii"),
                }
            ),
            200,
        )
    except Exception as exc:
        logger.exception("Interview speak failed: %s", exc)
        return jsonify({"error": "Failed to synthesize assistant speech.", "code": "ELEVENLABS_TTS"}), 502


@interview_bp.post("/agent/<agent_id>/interview/turn-audio")
def process_interview_turn_audio(agent_id: str) -> tuple:
    try:
        session_id = str(request.form.get("session_id", "")).strip()
        was_interruption = str(request.form.get("was_interruption", "false")).strip().lower() == "true"
        audio_file = request.files.get("audio")

        if not session_id:
            return jsonify({"error": "Missing session_id"}), 400
        if not audio_file:
            return jsonify({"error": "Missing audio file"}), 400

        session_or_error = _require_session(agent_id, session_id)
        if isinstance(session_or_error, tuple):
            return session_or_error
        session = session_or_error

        audio_bytes = audio_file.read()
        if not audio_bytes:
            return jsonify({"error": "Uploaded audio is empty"}), 400

        transcript = _transcribe_with_elevenlabs(
            audio_bytes=audio_bytes,
            filename=audio_file.filename or "turn_audio.webm",
            content_type=audio_file.mimetype or "audio/webm",
        )
        if not transcript:
            return jsonify({"error": "No speech detected in audio. Please try again."}), 400

        result = _evaluate_and_update_session(
            agent_id=agent_id,
            session=session,
            user_input=transcript,
            was_interruption=was_interruption,
        )

        assistant_response = str(result.get("assistant_response", "")).strip()
        audio_mime_type = ""
        audio_base64 = ""
        if assistant_response:
            tts_audio, audio_mime_type = _synthesize_with_elevenlabs(assistant_response)
            audio_base64 = base64.b64encode(tts_audio).decode("ascii")

        result["user_transcript"] = transcript
        result["audio_mime_type"] = audio_mime_type
        result["audio_base64"] = audio_base64
        return jsonify(result), 200
    except GeminiAuthError as exc:
        logger.warning("Interview audio turn blocked by Gemini auth issue: %s", exc)
        return jsonify({"error": str(exc), "code": "GEMINI_AUTH"}), 502
    except GeminiRateLimitError as exc:
        logger.warning("Interview audio turn blocked by Gemini rate limit: %s", exc)
        return jsonify({"error": str(exc), "code": "GEMINI_RATE_LIMIT"}), 429
    except GeminiRequestError as exc:
        logger.warning("Interview audio turn failed due to Gemini request issue: %s", exc)
        return jsonify({"error": str(exc), "code": "GEMINI_REQUEST"}), 502
    except Exception as exc:
        logger.exception("Interview audio turn processing failed: %s", exc)
        return jsonify({"error": "Failed to process interview audio turn.", "code": "ELEVENLABS_OR_PIPELINE"}), 502
