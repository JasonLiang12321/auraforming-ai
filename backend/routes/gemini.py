import json
import logging
import os
import uuid
import hashlib
import re

import google.generativeai as genai
from dotenv import load_dotenv
from flask import Blueprint, jsonify, request

from storage import get_agent

load_dotenv()

gemini_bp = Blueprint("gemini", __name__)
logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
UI_TRANSLATION_CACHE: dict[str, dict[str, str]] = {}

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)


class GeminiAuthError(RuntimeError):
    pass


class GeminiRequestError(RuntimeError):
    pass


class GeminiRateLimitError(RuntimeError):
    pass


def _language_family(language_code: str) -> str:
    return str(language_code or "").strip().split("-", 1)[0].lower()


def _needs_translation_retry(*, source_text: str, translated_text: str) -> bool:
    source = str(source_text or "").strip()
    translated = str(translated_text or "").strip()
    if not source:
        return False
    if not translated:
        return True
    if source != translated:
        return False
    # Exact English echo for long phrases usually means untranslated output.
    if len(source) > 12 and (" " in source or re.search(r"[A-Za-z]{6,}", source)):
        return True
    return False


def run_gemini_json(*, prompt: str, response_schema: dict, model_name: str | None = None) -> dict:
    if not GEMINI_API_KEY:
        raise GeminiAuthError("Missing GEMINI_API_KEY.")

    call_id = uuid.uuid4().hex[:8]
    active_model = model_name or GEMINI_MODEL
    schema_fields = list((response_schema or {}).get("properties", {}).keys())
    logger.warning("[Gemini %s] request model=%s schema_fields=%s", call_id, active_model, schema_fields)
    logger.warning("[Gemini %s] prompt=%s", call_id, prompt[:4000])

    model = genai.GenerativeModel(model_name=active_model)
    try:
        response = model.generate_content(
            prompt,
            generation_config={
                "response_mime_type": "application/json",
                "response_schema": response_schema,
            },
        )
        raw_text = response.text or ""
        logger.warning("[Gemini %s] raw_response=%s", call_id, raw_text)
        try:
            parsed = json.loads(raw_text)
        except json.JSONDecodeError as exc:
            logger.error("[Gemini %s] invalid_json_response=%s", call_id, raw_text)
            raise GeminiRequestError("Gemini returned invalid JSON response.") from exc
        logger.warning("[Gemini %s] parsed_response=%s", call_id, json.dumps(parsed, ensure_ascii=False))
        return parsed
    except Exception as exc:
        message = str(exc)
        auth_markers = (
            "API_KEY_INVALID",
            "API key expired",
            "API key not valid",
            "invalid api key",
        )
        rate_limit_markers = (
            "Resource exhausted",
            "ResourceExhausted",
            "429",
            "quota",
            "rate limit",
        )
        if any(marker.lower() in message.lower() for marker in auth_markers):
            raise GeminiAuthError("Gemini API key is invalid or expired. Update GEMINI_API_KEY and restart backend.") from exc
        if any(marker.lower() in message.lower() for marker in rate_limit_markers):
            raise GeminiRateLimitError("Gemini rate limit reached. Please wait a few seconds and try again.") from exc
        logger.exception("[Gemini %s] request_failed: %s", call_id, message)
        raise GeminiRequestError(f"Gemini request failed: {message}") from exc


@gemini_bp.post("/gemini")
def gemini_endpoint():
    try:
        data = request.get_json(silent=True) or {}
        agent_id = str(data.get("agent_id", "")).strip()
        user_input = str(data.get("user_input", "")).strip()
        form_field = str(data.get("form_field", "")).strip()
        field_context = str(data.get("field_context", "")).strip()

        if not agent_id or not user_input or not form_field:
            return jsonify({"error": "Missing agent_id, user_input, or form_field"}), 400

        agent = get_agent(agent_id)
        if not agent:
            return jsonify({"error": "Agent not found"}), 404

        required_keys = agent["schema"].get("widget_names", [])
        if not required_keys:
            return jsonify({"error": "Agent has no form fields"}), 400

        prompt = f"""You are an AI assistant helping users fill out a form. Analyze the user's input and determine the next action.

Form field: "{form_field}"
Field context: "{field_context}"
User input: "{user_input}"

Respond with JSON:
{{
"collected_value": "the extracted value if data is collected, empty string otherwise",
"intent": "clarification|acknowledgment|data",
"response": "your conversational response to the user"
}}

STRICT Rules:
- ONLY set intent to "data" if the user clearly provided THEIR OWN information for THIS specific field
- If the information is ambiguous, unclear, or about someone else, set intent to "clarification"
- If user asked a question, set intent to "clarification" and explain
- If user acknowledged understanding, set intent to "acknowledgment" and re-ask the question
- For "{form_field}" ({field_context}): user must explicitly state THEIR personal data
- Do NOT assume or infer information
- When in doubt, ask for clarification"""

        result = run_gemini_json(
            prompt=prompt,
            response_schema={
                "type": "object",
                "properties": {
                    "collected_value": {"type": "string"},
                    "intent": {"type": "string", "enum": ["clarification", "acknowledgment", "data"]},
                    "response": {"type": "string"},
                },
                "required": ["collected_value", "intent", "response"],
            },
        )

        return (
            jsonify(
                {
                    "data_collected": result.get("intent") == "data",
                    "collected_value": result.get("collected_value", ""),
                    "response": result.get("response", ""),
                }
            ),
            200,
        )
    except json.JSONDecodeError:
        logger.exception("Gemini JSON parsing failed.")
        return jsonify({"error": "Invalid JSON from Gemini API"}), 500
    except Exception as exc:
        logger.exception("Gemini endpoint failure: %s", exc)
        return jsonify({"error": str(exc)}), 500


@gemini_bp.post("/gemini/questions")
def generate_all_questions():
    try:
        data = request.get_json(silent=True) or {}
        agent_id = str(data.get("agent_id", "")).strip()

        if not agent_id:
            return jsonify({"error": "Missing agent_id"}), 400

        agent = get_agent(agent_id)
        if not agent:
            return jsonify({"error": "Agent not found"}), 404

        form_fields = agent["schema"].get("widget_names", [])
        if not form_fields:
            return jsonify({"error": "Agent has no form fields"}), 400

        if not GEMINI_API_KEY:
            return jsonify({"error": "Missing GEMINI_API_KEY"}), 500

        fields_str = "\n".join([f"{index + 1}. {field}" for index, field in enumerate(form_fields)])
        prompt = f"""Generate natural, conversational questions for these form fields. Return ONLY the questions in plain text, one per line, in the same order.

Form fields:
{fields_str}

Requirements:
- One question per line
- 1-2 sentences max per question
- NO numbering, NO explanations, just questions
- Plain text only"""

        model = genai.GenerativeModel(model_name=GEMINI_MODEL)
        response = model.generate_content(prompt)
        questions = [line.strip() for line in response.text.strip().split("\n") if line.strip()]

        questions_map = {field: question for field, question in zip(form_fields, questions)}
        return jsonify({"questions": questions_map, "form_fields": form_fields}), 200
    except Exception as exc:
        logger.exception("Gemini questions endpoint failure: %s", exc)
        return jsonify({"error": str(exc)}), 500


@gemini_bp.post("/gemini/ui-translations")
def translate_ui_messages():
    try:
        data = request.get_json(silent=True) or {}
        language_code = str(data.get("language_code", "")).strip()
        source_messages = data.get("source_messages", {})
        if not language_code:
            return jsonify({"error": "Missing language_code"}), 400
        if not isinstance(source_messages, dict) or not source_messages:
            return jsonify({"error": "Missing source_messages"}), 400

        family = _language_family(language_code)
        if family in {"en", "ru", "zh"}:
            return jsonify({"messages": source_messages, "cached": True}), 200

        normalized_messages = {str(key): str(value) for key, value in source_messages.items() if str(key).strip()}
        if not normalized_messages:
            return jsonify({"error": "No valid source messages"}), 400

        payload_hash = hashlib.sha1(
            json.dumps(normalized_messages, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest()
        cache_key = f"{family}:{payload_hash}"
        if cache_key in UI_TRANSLATION_CACHE:
            return jsonify({"messages": UI_TRANSLATION_CACHE[cache_key], "cached": True}), 200

        translated: dict[str, str] = {}

        def merge_translations(result_payload: dict, source_map: dict[str, str]) -> None:
            for item in result_payload.get("translations", []) if isinstance(result_payload.get("translations"), list) else []:
                if not isinstance(item, dict):
                    continue
                key = str(item.get("key", "")).strip()
                text = str(item.get("text", "")).strip()
                if key in source_map and text:
                    translated[key] = text

        def run_translation_pass(source_map: dict[str, str]) -> None:
            prompt = f"""
You are translating website UI copy.
Target language family code: "{family}".

Translate every value in this JSON object:
{json.dumps(source_map, ensure_ascii=False)}

Return STRICT JSON:
{{
  "translations": [
    {{"key": "string", "text": "string"}}
  ]
}}

Rules:
- Keep placeholders exactly unchanged, e.g. {{count}}, {{id}}, {{name}}, {{value}}.
- Keep technical terms and product names unchanged when appropriate (PDF, JSON, API, Gemini, auraforming).
- Preserve meaning and tone for interface labels/buttons.
- Never return empty text.
""".strip()

            result_payload = run_gemini_json(
                prompt=prompt,
                response_schema={
                    "type": "object",
                    "properties": {
                        "translations": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "key": {"type": "string"},
                                    "text": {"type": "string"},
                                },
                                "required": ["key", "text"],
                            },
                        }
                    },
                    "required": ["translations"],
                },
            )
            merge_translations(result_payload, source_map)

        # Pass 1 for all keys, then retry unresolved keys up to 2 more times.
        run_translation_pass(normalized_messages)
        for _ in range(2):
            unresolved = {
                key: source_value
                for key, source_value in normalized_messages.items()
                if _needs_translation_retry(
                    source_text=source_value,
                    translated_text=translated.get(key, ""),
                )
            }
            if not unresolved:
                break
            run_translation_pass(unresolved)

        # Guarantee every requested key has a value.
        for key, value in normalized_messages.items():
            translated.setdefault(key, value)

        translated_quality = sum(
            1
            for key, source_value in normalized_messages.items()
            if not _needs_translation_retry(source_text=source_value, translated_text=translated.get(key, ""))
        ) / max(1, len(normalized_messages))

        # Avoid persisting weak/partial results so client can retry later.
        if translated_quality >= 0.85:
            UI_TRANSLATION_CACHE[cache_key] = translated

        return jsonify({"messages": translated, "cached": False}), 200
    except GeminiAuthError as exc:
        logger.warning("UI translation blocked by Gemini auth issue: %s", exc)
        return jsonify({"error": str(exc), "code": "GEMINI_AUTH"}), 502
    except GeminiRateLimitError as exc:
        logger.warning("UI translation blocked by Gemini rate limit: %s", exc)
        return jsonify({"error": str(exc), "code": "GEMINI_RATE_LIMIT"}), 429
    except GeminiRequestError as exc:
        logger.warning("UI translation failed due to Gemini request issue: %s", exc)
        return jsonify({"error": str(exc), "code": "GEMINI_REQUEST"}), 502
    except Exception as exc:
        logger.exception("UI translation endpoint failure: %s", exc)
        return jsonify({"error": str(exc)}), 500
