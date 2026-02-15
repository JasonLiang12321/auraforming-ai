import json
import logging
import base64
import os
import uuid
import re
from urllib.parse import unquote
from dataclasses import dataclass, field
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request
import requests
import fitz

from routes.gemini import GeminiAuthError, GeminiRateLimitError, GeminiRequestError, run_gemini_json
from storage import COMPLETED_DIR, get_agent, save_completed_session

interview_bp = Blueprint("interview", __name__)
logger = logging.getLogger(__name__)


@dataclass
class InterviewSession:
    session_id: str
    agent_id: str
    missing_fields: list[str]
    form_name: str = ""
    field_meta: dict[str, dict] = field(default_factory=dict)
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


def _normalize_for_match(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _fallback_label_from_key(field_key: str) -> str:
    text = str(field_key).replace("_", " ").replace("\t", " ")
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", text)
    text = re.sub(r"([A-Za-z])(\d)", r"\1 \2", text)
    text = re.sub(r"\s+", " ", text).strip()
    if text.lower() in {"i full name", "i, full name"}:
        return "Full name"
    return text or str(field_key)


def _decode_pdf_token(value: str) -> str:
    if not value:
        return ""
    text = unquote(str(value))
    text = re.sub(r"#([0-9A-Fa-f]{2})", lambda m: bytes.fromhex(m.group(1)).decode("latin1"), text)
    return " ".join(text.split()).strip()


def _clean_pdf_label(label: str, fallback: str) -> str:
    text = _decode_pdf_token(label or "")
    if not text:
        text = _decode_pdf_token(fallback)
    marker = "Type in the date or use the arrow keys to select a date."
    if marker in text:
        text = text.split(marker, 1)[0].strip()
    text = text.rstrip(":;,. ").strip()
    if text.lower() in {"i, full name", "i full name"}:
        text = "Full name"
    if text:
        looks_key_like = bool(text) and all(sep not in text for sep in [" ", "/", "(", ")", ",", "-", ":"])
        return _fallback_label_from_key(text) if looks_key_like else text
    return _fallback_label_from_key(fallback)


def _extract_widget_options(widget) -> list[str]:
    options: list[str] = []
    seen = set()

    raw_choices = getattr(widget, "choice_values", None)
    if callable(raw_choices):
        raw_choices = raw_choices()
    raw_choices = raw_choices or []
    for choice in raw_choices:
        item = _decode_pdf_token(str(choice))
        if item and item.lower() != "off" and item not in seen:
            seen.add(item)
            options.append(item)

    button_states = getattr(widget, "button_states", None)
    if callable(button_states):
        button_states = button_states()
    button_states = button_states or {}
    if not isinstance(button_states, dict):
        button_states = {}
    for state_values in button_states.values():
        for value in state_values or []:
            item = _decode_pdf_token(str(value))
            if item and item.lower() != "off" and item not in seen:
                seen.add(item)
                options.append(item)

    on_state = getattr(widget, "on_state", "")
    if callable(on_state):
        on_state = on_state()
    on_state = _decode_pdf_token(str(on_state or ""))
    if on_state and on_state.lower() != "off" and on_state not in seen:
        options.append(on_state)

    return options


def _normalize_field_meta_item(item: dict) -> dict:
    field_key = str(item.get("key", "")).strip()
    label = str(item.get("label", "")).strip() or _fallback_label_from_key(field_key)
    field_type = str(item.get("type", "Text")).strip() or "Text"
    options = []
    for option in item.get("options", []) if isinstance(item.get("options"), list) else []:
        clean = str(option).strip()
        if clean and clean not in options:
            options.append(clean)

    if field_type == "CheckBox" and not options:
        options = ["Yes", "No"]

    return {
        "key": field_key,
        "label": label,
        "type": field_type,
        "options": options,
    }


def _build_field_meta(schema: dict) -> dict[str, dict]:
    fields_meta: dict[str, dict] = {}
    interview_fields = schema.get("interview_fields", [])
    if isinstance(interview_fields, list):
        for item in interview_fields:
            if not isinstance(item, dict):
                continue
            normalized = _normalize_field_meta_item(item)
            key = normalized.get("key", "")
            if key and key not in fields_meta:
                fields_meta[key] = normalized

    if fields_meta:
        return fields_meta

    # Backward-compatible fallback for agents saved before interview_fields metadata existed.
    for raw in schema.get("widget_names", []) if isinstance(schema.get("widget_names"), list) else []:
        key = str(raw).strip()
        if key and key not in fields_meta:
            fields_meta[key] = {
                "key": key,
                "label": _fallback_label_from_key(key),
                "type": "Text",
                "options": [],
            }
    return fields_meta


def _build_field_meta_from_pdf(pdf_path: str) -> dict[str, dict]:
    fields_meta: dict[str, dict] = {}
    if not pdf_path or not os.path.exists(pdf_path):
        return fields_meta

    try:
        with fitz.open(pdf_path) as document:
            for page in document:
                for widget in page.widgets() or []:
                    key = str(getattr(widget, "field_name", "") or "").strip()
                    if not key:
                        continue

                    field_type = str(getattr(widget, "field_type_string", "Text") or "Text").strip() or "Text"
                    label = _clean_pdf_label(str(getattr(widget, "field_label", "") or ""), key)
                    options = _extract_widget_options(widget)

                    item = fields_meta.get(key)
                    if not item:
                        item = {
                            "key": key,
                            "label": label,
                            "type": field_type,
                            "options": [],
                        }
                        fields_meta[key] = item
                    elif not item.get("label") and label:
                        item["label"] = label

                    existing_options = set(item.get("options", []))
                    for option in options:
                        if option not in existing_options:
                            item["options"].append(option)
                            existing_options.add(option)

        for item in fields_meta.values():
            if item.get("type") == "CheckBox" and not item.get("options"):
                item["options"] = ["Yes", "No"]
    except Exception as exc:
        logger.warning("Could not rebuild interview field metadata from PDF: %s", exc)
        return {}

    return fields_meta


def _field_meta_for(session: InterviewSession, field_key: str) -> dict:
    fallback = {
        "key": field_key,
        "label": _fallback_label_from_key(field_key),
        "type": "Text",
        "options": [],
    }
    item = session.field_meta.get(field_key)
    if not isinstance(item, dict):
        return fallback
    merged = {**fallback, **item}
    if merged.get("type") == "CheckBox" and not merged.get("options"):
        merged["options"] = ["Yes", "No"]
    return merged


def _build_field_question(field_meta: dict) -> str:
    label = str(field_meta.get("label", "")).strip() or _fallback_label_from_key(str(field_meta.get("key", "")))
    field_type = str(field_meta.get("type", "Text")).strip()
    options = field_meta.get("options", []) if isinstance(field_meta.get("options"), list) else []

    if field_type in {"ComboBox", "RadioButton"} and options:
        options_text = ", ".join(options)
        return f"For {label}, choose one option: {options_text}. What should I select?"
    if field_type == "CheckBox":
        return f"For {label}, should I mark yes or no?"
    return f"What should I enter for {label}?"


def _build_system_prompt(form_name: str, missing_fields: list[str], field_meta: dict[str, dict]) -> str:
    ordered_fields = json.dumps(
        [
            {
                "key": key,
                "label": (field_meta.get(key) or {}).get("label", _fallback_label_from_key(key)),
                "type": (field_meta.get(key) or {}).get("type", "Text"),
                "options": (field_meta.get(key) or {}).get("options", []),
            }
            for key in missing_fields
        ]
    )
    return (
        "You are a voice assistant helping the user fill a form.\n"
        f'Form title: "{form_name or "Untitled form"}"\n'
        f"Required fields in strict order: {ordered_fields}\n"
        "Rules:\n"
        "1) Ask for exactly one missing field at a time, in order.\n"
        "2) Use only user-facing labels, never technical keys.\n"
        "3) For ComboBox/RadioButton fields, ask user to choose one valid option.\n"
        "4) For CheckBox fields, ask yes/no.\n"
        "5) If answer is adequate, acknowledge and move to the next field.\n"
        "6) If answer is unclear/incomplete, ask a concise clarification for that same field.\n"
        "7) If user interrupts, briefly acknowledge and steer back to current field.\n"
        "8) Never request fields outside the required list."
    )


def _build_first_prompt(form_name: str, first_field_meta: dict) -> str:
    return (
        f'Hi there. We are now completing "{form_name or "this form"}". '
        "I will help you step by step. "
        + _build_field_question(first_field_meta)
    )


def _build_next_field_prompt(next_field_meta: dict) -> str:
    return "Next, " + _build_field_question(next_field_meta)


def _mentions_field_label(text: str, field_label: str) -> bool:
    normalized_text = _normalize_for_match(text)
    normalized_field = _normalize_for_match(field_label)
    if not normalized_text or not normalized_field:
        return False
    if normalized_field in normalized_text:
        return True
    field_tokens = [token for token in normalized_field.split() if len(token) > 2]
    if not field_tokens:
        return False
    overlap = sum(1 for token in field_tokens if token in normalized_text)
    return overlap >= max(2, min(3, len(field_tokens)))


def _ensure_next_question(*, assistant_response: str, next_field_meta: dict) -> str:
    response = assistant_response.strip()
    next_prompt = _build_next_field_prompt(next_field_meta)
    next_label = str(next_field_meta.get("label", "")).strip()
    if not response:
        return next_prompt
    if "?" in response or _mentions_field_label(response, next_label):
        return response
    clean = response.rstrip()
    if clean and clean[-1] not in ".!?":
        clean = f"{clean}."
    return f"{clean} {next_prompt}".strip()


def _coerce_checkbox_value(value: str) -> str:
    normalized = _normalize_for_match(value)
    yes_tokens = {"yes", "y", "true", "checked", "check", "mark yes", "affirmative", "consent"}
    no_tokens = {"no", "n", "false", "unchecked", "uncheck", "mark no", "decline", "do not consent"}
    if normalized in yes_tokens:
        return "Yes"
    if normalized in no_tokens:
        return "No"
    if " not " in f" {normalized} " and "consent" in normalized:
        return "No"
    if "consent" in normalized:
        return "Yes"
    return ""


def _map_value_to_allowed_option(value: str, options: list[str]) -> str:
    if not options:
        return value.strip()
    raw = value.strip()
    if not raw:
        return ""
    if raw in options:
        return raw

    normalized_raw = _normalize_for_match(raw)
    normalized_options = {option: _normalize_for_match(option) for option in options}

    for option, normalized_option in normalized_options.items():
        if normalized_raw == normalized_option:
            return option

    for option, normalized_option in normalized_options.items():
        if normalized_raw and normalized_raw in normalized_option:
            return option
        if normalized_option and normalized_option in normalized_raw:
            return option

    return ""


def _coerce_value_for_field(field_meta: dict, value: str) -> str:
    field_type = str(field_meta.get("type", "Text"))
    options = field_meta.get("options", []) if isinstance(field_meta.get("options"), list) else []
    if field_type == "CheckBox":
        checkbox_value = _coerce_checkbox_value(value)
        if checkbox_value:
            if checkbox_value in options:
                return checkbox_value
            # Keep semantic yes/no even when PDF uses widget values like "On".
            return checkbox_value
        if not options:
            return ""
        mapped = _map_value_to_allowed_option(value, options)
        return mapped
    if field_type in {"ComboBox", "RadioButton"}:
        return _map_value_to_allowed_option(value, options)
    return value.strip()


def _checkbox_is_yes(value: str) -> bool:
    return _coerce_checkbox_value(value) == "Yes"


def _widget_on_state(widget) -> str:
    on_state = getattr(widget, "on_state", "")
    if callable(on_state):
        on_state = on_state()
    return str(on_state or "").strip()


def _assign_widget_value(widget, value: str) -> None:
    field_type = str(getattr(widget, "field_type_string", "") or "")
    text_value = str(value or "").strip()

    if field_type == "CheckBox":
        widget.field_value = _widget_on_state(widget) if _checkbox_is_yes(text_value) else "Off"
    elif field_type == "RadioButton":
        options = _extract_widget_options(widget)
        mapped = _map_value_to_allowed_option(text_value, options)
        widget.field_value = mapped or text_value
    else:
        widget.field_value = text_value

    widget.update()


def _fill_pdf_with_answers(pdf_path: str, answers: dict[str, str]) -> bytes:
    with fitz.open(pdf_path) as doc:
        processed_radio_fields: set[str] = set()
        for page in doc:
            for widget in page.widgets() or []:
                field_key = str(getattr(widget, "field_name", "") or "").strip()
                if field_key and field_key in answers:
                    field_type = str(getattr(widget, "field_type_string", "") or "")
                    if field_type == "RadioButton":
                        if field_key in processed_radio_fields:
                            continue
                        processed_radio_fields.add(field_key)
                    _assign_widget_value(widget, str(answers[field_key]))
        # Ask viewers to respect updated appearance streams.
        try:
            doc.need_appearances(True)
        except Exception:
            pass
        return doc.write()


def _finalize_completed_interview(*, session: InterviewSession, agent: dict) -> dict:
    pdf_path = str(agent.get("pdf_path", "") or "").strip()
    if not pdf_path or not os.path.exists(pdf_path):
        raise RuntimeError("Original PDF file is missing for this agent.")

    filled_pdf_bytes = _fill_pdf_with_answers(pdf_path, session.answers)
    filled_pdf_path = COMPLETED_DIR / f"{session.session_id}_completed.pdf"
    filled_pdf_path.write_bytes(filled_pdf_bytes)

    save_completed_session(
        session_id=session.session_id,
        agent_id=session.agent_id,
        answers=session.answers,
        filled_pdf_path=str(filled_pdf_path),
    )

    session_id = session.session_id
    return {
        "download_url": f"/api/admin/dashboard/sessions/{session_id}/download",
        "pdf_preview_url": f"/api/admin/dashboard/sessions/{session_id}/pdf",
    }


def _evaluate_turn_with_gemini(
    *,
    form_name: str,
    current_field: str,
    current_field_meta: dict,
    next_field_meta: dict | None,
    user_input: str,
    missing_fields: list[dict],
    answers: dict[str, str],
    was_interruption: bool,
) -> dict:
    current_label = str(current_field_meta.get("label", "")).strip() or _fallback_label_from_key(current_field)
    current_type = str(current_field_meta.get("type", "Text")).strip() or "Text"
    current_options = current_field_meta.get("options", []) if isinstance(current_field_meta.get("options"), list) else []
    next_label = ""
    next_type = ""
    next_options: list[str] = []
    if isinstance(next_field_meta, dict):
        next_label = str(next_field_meta.get("label", "")).strip()
        next_type = str(next_field_meta.get("type", "")).strip()
        next_options = next_field_meta.get("options", []) if isinstance(next_field_meta.get("options"), list) else []

    prompt = f"""
You are validating one turn in a voice form interview.
Form title: "{form_name or "Untitled form"}"

Current field technical key (internal only): "{current_field}"
Current field label (speak this): "{current_label}"
Current field type: "{current_type}"
Current field allowed options (if any): {json.dumps(current_options)}
Next field label (if current is accepted): "{next_label}"
Next field type (if current is accepted): "{next_type}"
Next field allowed options (if any): {json.dumps(next_options)}
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
- Mark as adequate ONLY when user clearly provided the value for the current field label.
- Never speak or repeat the technical key; always use the label.
- For ComboBox/RadioButton fields with options, normalized_value must be one of the allowed options exactly.
- For CheckBox fields, normalized_value must be "Yes" or "No" unless a different allowed option is listed.
- If unclear, off-topic, partial, or ambiguous, mark inadequate and ask clarification.
- If interruption/side question, use intent "barge_in", acknowledge briefly, then return to current field.
- If answer is adequate:
  - assistant_response must confirm the captured value for the CURRENT field label.
  - if Next field label is non-empty, assistant_response must also ask that next field in the same response.
  - if next field type is ComboBox/RadioButton and options exist, assistant_response must list those options in the question.
  - do not output very short fragments; never output just the field name or "X?".
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
            "assistant_response": (
                "Thank you. We have everything we need. "
                "Your completed form is ready and can be downloaded now."
            ),
        }

    current_field = session.current_field
    if not current_field:
        raise RuntimeError("No active field in session.")
    current_field_meta = _field_meta_for(session, current_field)
    current_label = str(current_field_meta.get("label", "")).strip() or _fallback_label_from_key(current_field)
    next_field_meta = None
    if len(session.missing_fields) > 1:
        next_field_key = session.missing_fields[1]
        next_field_meta = _field_meta_for(session, next_field_key)

    logger.info(
        "Interview turn received agent_id=%s session_id=%s current_field=%s interruption=%s user_input=%s",
        agent_id,
        session.session_id,
        current_field,
        was_interruption,
        user_input[:240],
    )

    evaluation = _evaluate_turn_with_gemini(
        form_name=session.form_name,
        current_field=current_field,
        current_field_meta=current_field_meta,
        next_field_meta=next_field_meta,
        user_input=user_input,
        missing_fields=[
            {
                "key": key,
                "label": _field_meta_for(session, key).get("label", _fallback_label_from_key(key)),
                "type": _field_meta_for(session, key).get("type", "Text"),
                "options": _field_meta_for(session, key).get("options", []),
            }
            for key in session.missing_fields
        ],
        answers=session.answers,
        was_interruption=was_interruption,
    )

    intent = str(evaluation.get("intent", "clarification"))
    is_answer_adequate = bool(evaluation.get("is_answer_adequate", False))
    raw_normalized_value = str(evaluation.get("normalized_value", "")).strip()
    normalized_value = _coerce_value_for_field(current_field_meta, raw_normalized_value)
    assistant_response = str(evaluation.get("assistant_response", "")).strip()

    if is_answer_adequate and not normalized_value:
        is_answer_adequate = False

    if is_answer_adequate and normalized_value:
        session.answers[current_field] = normalized_value
        session.missing_fields = session.missing_fields[1:]
        session.updated_at = datetime.now(timezone.utc).isoformat()

        if session.completed:
            assistant_response = assistant_response or (
                "Thank you. We have everything we need. "
                "Your completed form is now being generated and will be ready to download shortly."
            )
        else:
            next_field = session.current_field or "the next field"
            next_field_meta = _field_meta_for(session, next_field)
            assistant_response = assistant_response or _build_next_field_prompt(next_field_meta)
    else:
        session.updated_at = datetime.now(timezone.utc).isoformat()
        if not assistant_response:
            if intent == "barge_in":
                assistant_response = f"Got it. Let's continue. {_build_field_question(current_field_meta)}"
            else:
                assistant_response = f"I still need {current_label}. {_build_field_question(current_field_meta)}"

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


def _attach_completion_artifacts(*, session: InterviewSession, result: dict) -> dict:
    if not result.get("completed"):
        return result

    agent = get_agent(session.agent_id)
    if not agent:
        logger.warning("Could not finalize completed session %s because agent was not found.", session.session_id)
        return result

    try:
        artifacts = _finalize_completed_interview(session=session, agent=agent)
        result.update(artifacts)
    except Exception as exc:
        logger.exception("Failed to finalize completed interview session %s: %s", session.session_id, exc)
    return result


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

    schema = agent.get("schema", {}) if isinstance(agent.get("schema"), dict) else {}
    has_interview_fields = isinstance(schema.get("interview_fields"), list) and bool(schema.get("interview_fields"))
    field_meta = _build_field_meta(schema)
    if not has_interview_fields:
        rebuilt_meta = _build_field_meta_from_pdf(str(agent.get("pdf_path", "") or ""))
        if rebuilt_meta:
            field_meta = rebuilt_meta
    if not field_meta:
        return jsonify({"error": "Agent has no fields to interview."}), 400

    normalized_fields = [key for key in field_meta.keys() if str(key).strip()]
    form_name = str(agent.get("agent_name", "")).strip() or "this form"

    session_id = uuid.uuid4().hex[:12]
    session = InterviewSession(
        session_id=session_id,
        agent_id=agent_id,
        missing_fields=normalized_fields,
        form_name=form_name,
        field_meta=field_meta,
    )
    SESSIONS[session_id] = session

    first_field = session.current_field or "the first field"
    first_field_meta = _field_meta_for(session, first_field)
    return (
        jsonify(
            {
                "session_id": session.session_id,
                "agent_id": agent_id,
                "current_field": session.current_field,
                "missing_fields": session.missing_fields,
                "answers": session.answers,
                "completed": session.completed,
                "system_prompt": _build_system_prompt(session.form_name, session.missing_fields, session.field_meta),
                "first_prompt": _build_first_prompt(session.form_name, first_field_meta),
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
        result = _attach_completion_artifacts(session=session, result=result)
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
        result = _attach_completion_artifacts(session=session, result=result)

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
