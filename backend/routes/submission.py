import json
import logging
import uuid
from pathlib import Path
import fitz
from flask import Blueprint, jsonify, request
from storage import get_agent, save_completed_session, COMPLETED_DIR
import re
from urllib.parse import unquote

submission_bp = Blueprint("submission", __name__)
logger = logging.getLogger(__name__)


def _decode_pdf_token(value: str) -> str:
    if not value:
        return ""
    text = unquote(str(value))
    text = re.sub(r"#([0-9A-Fa-f]{2})", lambda m: bytes.fromhex(m.group(1)).decode("latin1"), text)
    return " ".join(text.split()).strip()


def _normalize_for_match(text: str) -> str:
    return re.sub(r"[^\w]+", " ", str(text or "").lower(), flags=re.UNICODE).strip()


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


def _widget_on_state(widget) -> str:
    on_state = getattr(widget, "on_state", "")
    if callable(on_state):
        on_state = on_state()
    return str(on_state or "").strip()


def _map_value_to_allowed_option(value: str, options: list[str]) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if raw in options:
        return raw
    normalized_raw = _normalize_for_match(raw)
    for option in options:
        normalized_option = _normalize_for_match(option)
        if normalized_raw == normalized_option:
            return option
    for option in options:
        normalized_option = _normalize_for_match(option)
        if normalized_raw and normalized_raw in normalized_option:
            return option
        if normalized_option and normalized_option in normalized_raw:
            return option
    return ""


def _is_checkbox_yes(value: str) -> bool:
    normalized = _normalize_for_match(value)
    yes_tokens = {
        "yes",
        "y",
        "true",
        "checked",
        "check",
        "on",
        "1",
        "selected",
        "x",
        "mark yes",
        "affirmative",
        "consent",
        "si",
        "sí",
        "oui",
        "ja",
        "sim",
        "hai",
        "はい",
        "예",
        "да",
        "shi",
        "是",
        "haan",
        "हाँ",
    }
    return normalized in yes_tokens


def _assign_widget_value(widget, value: str) -> None:
    field_type = str(getattr(widget, "field_type_string", "") or "")
    text_value = str(value or "").strip()

    if field_type == "CheckBox":
        on_state = _widget_on_state(widget) or "Yes"
        normalized_text = _normalize_for_match(text_value)
        normalized_on_state = _normalize_for_match(on_state)
        mapped_option = _map_value_to_allowed_option(text_value, _extract_widget_options(widget))
        if (
            _is_checkbox_yes(text_value)
            or (normalized_on_state and normalized_text == normalized_on_state)
            or (_normalize_for_match(mapped_option) not in {"", "off"})
        ):
            widget.field_value = on_state
        else:
            widget.field_value = "Off"
    elif field_type == "RadioButton":
        mapped = _map_value_to_allowed_option(text_value, _extract_widget_options(widget))
        widget.field_value = mapped or text_value
    elif field_type == "ComboBox":
        mapped = _map_value_to_allowed_option(text_value, _extract_widget_options(widget))
        widget.field_value = mapped or text_value
    else:
        widget.field_value = text_value

    widget.update()


def convert_to_readable(pdf_field: str, doc=None) -> str:
    """Convert PDF field names to readable labels by extracting field display text"""
    if not doc:
        # Fallback: extract from field name
        match = re.search(r'\.([a-zA-Z0-9_]+)\[\d+\]$', pdf_field)
        if match:
            field_id = match.group(1)
            return field_id.replace("_", " ").title()
        return pdf_field
    
    try:
        # Search all pages for this field and extract nearby label text
        for page in doc:
            widgets = page.widgets() or []
            for widget in widgets:
                if widget.field_name == pdf_field:
                    rect = widget.rect
                    # Get text from the page and look for text near the field
                    text = page.get_text("text")
                    
                    # Try to find label to the left of field
                    clip_rect = fitz.Rect(rect.x0 - 200, rect.y0 - 20, rect.x0, rect.y0 + 20)
                    label_text = page.get_text("text", clip=clip_rect).strip()
                    
                    if label_text:
                        return label_text.split('\n')[-1]  # Get last line (closest to field)
                    
                    # Fallback: extract from field name
                    match = re.search(r'\.([a-zA-Z0-9_]+)\[\d+\]$', pdf_field)
                    if match:
                        field_id = match.group(1)
                        return field_id.replace("_", " ").title()
        
        return pdf_field
    except:
        # Fallback to field name extraction
        match = re.search(r'\.([a-zA-Z0-9_]+)\[\d+\]$', pdf_field)
        if match:
            field_id = match.group(1)
            return field_id.replace("_", " ").title()
        return pdf_field


def fill_pdf_with_json(pdf_path: str, answers: dict[str, str]) -> bytes:
    """
    AC1: Accept the agent_id's original blank PDF and the user's populated JSON object.
    AC2: Iterate through keys and map values into PDF's AcroForm fields.
    AC3: Flatten the final PDF and return bytes.
    """
    try:
        with fitz.open(pdf_path) as doc:
            processed_radio_fields: set[str] = set()
            for page in doc:
                widgets = page.widgets() or []
                for widget in widgets:
                    field_name = str(getattr(widget, "field_name", "") or "").strip()
                    if not field_name or field_name not in answers:
                        continue

                    field_type = str(getattr(widget, "field_type_string", "") or "")
                    if field_type == "RadioButton":
                        if field_name in processed_radio_fields:
                            continue
                        processed_radio_fields.add(field_name)

                    _assign_widget_value(widget, str(answers[field_name]))

            try:
                doc.need_appearances(True)
            except Exception:
                pass
            return doc.write()
    except Exception as e:
        logger.exception("Failed to fill PDF: %s", e)
        raise

@submission_bp.post("/submission/complete")
def complete_submission() -> tuple:
    try:
        data = request.get_json()
        agent_id = data.get("agent_id", "")
        answers = data.get("answers", {})
        
        if not agent_id or not answers:
            return jsonify({"error": "Missing agent_id or answers"}), 400

        # Fetch agent
        agent = get_agent(agent_id)
        if not agent:
            return jsonify({"error": "Agent not found"}), 404
        
        original_pdf_path = agent["pdf_path"]
        if not Path(original_pdf_path).exists():
            return jsonify({"error": "Original PDF not found"}), 404

        # Generate unique submission ID
        submission_id = str(uuid.uuid4())
        
        # Get form fields and create readable question mapping
        form_fields = agent["schema"].get("widget_names", [])
        
        # Open PDF to extract labels
        with fitz.open(original_pdf_path) as doc:
            questions_map = {field: convert_to_readable(field, doc) for field in form_fields}
        
        # Fill PDF with answers
        filled_pdf_bytes = fill_pdf_with_json(original_pdf_path, answers)
        
        # Save filled PDF to completed directory
        filled_pdf_filename = f"{submission_id}_completed.pdf"
        filled_pdf_path = COMPLETED_DIR / filled_pdf_filename
        filled_pdf_path.write_bytes(filled_pdf_bytes)
        
    
        print(f"DEBUG: Questions mapping: {json.dumps(questions_map, indent=2)}")
        
        # Save to database
        save_completed_session(
            session_id=submission_id,
            agent_id=agent_id,
            answers=answers,
            filled_pdf_path=str(filled_pdf_path)
        )
        
        return jsonify({
            "submission_id": submission_id,
            "agent_id": agent_id,
            "message": "Submission completed successfully",
            "filled_pdf_path": str(filled_pdf_path),
            "questions": questions_map
        }), 200

    except Exception as e:
        logger.exception("Submission completion failed: %s", e)
        return jsonify({"error": str(e)}), 500
