import logging
import uuid
import fitz
import re
from urllib.parse import unquote
from flask import Blueprint, jsonify, request
from werkzeug.utils import secure_filename
from storage import UPLOAD_DIR, save_agent

upload_bp = Blueprint("upload", __name__)
logger = logging.getLogger(__name__)


def _decode_pdf_token(value: str) -> str:
    if not value:
        return ""
    text = unquote(str(value))
    # Some PDFs encode spaces as '#20' in widget values.
    text = re.sub(r"#([0-9A-Fa-f]{2})", lambda m: bytes.fromhex(m.group(1)).decode("latin1"), text)
    return " ".join(text.split()).strip()


def _humanize_label(text: str) -> str:
    value = str(text or "")
    value = value.replace("_", " ").replace("\t", " ")
    value = re.sub(r"\s+", " ", value).strip()
    # Only split camelCase/digits for key-like labels with no natural separators.
    looks_key_like = bool(value) and all(sep not in value for sep in [" ", "/", "(", ")", ",", "-", ":"])
    if looks_key_like:
        value = re.sub(r"([a-z])([A-Z])", r"\1 \2", value)
        value = re.sub(r"([A-Za-z])(\d)", r"\1 \2", value)
        value = re.sub(r"\s+", " ", value).strip()
    return value


def _clean_label(label: str, fallback: str) -> str:
    text = _decode_pdf_token(label or "")
    if not text:
        text = _decode_pdf_token(fallback)
    # Remove verbose Acrobat date helper suffix for cleaner spoken prompts.
    marker = "Type in the date or use the arrow keys to select a date."
    if marker in text:
        text = text.split(marker, 1)[0].strip()
    text = text.rstrip(":;,. ").strip()
    if text.lower() in {"i, full name", "i full name"}:
        text = "Full name"
    return _humanize_label(text or _decode_pdf_token(fallback))


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


@upload_bp.post("/admin/upload")
def upload_pdf() -> tuple:
    if "file" not in request.files:
        return jsonify({"error": "Missing file field. Use form-data key 'file'."}), 400

    pdf_file = request.files["file"]
    if not pdf_file.filename:
        return jsonify({"error": "No file selected."}), 400

    if not pdf_file.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Only PDF files are supported."}), 400
    agent_name = str(request.form.get("agent_name", "")).strip()

    try:
        file_bytes = pdf_file.read()
        widget_names: list[str] = []
        seen = set()
        interview_fields: list[dict] = []
        fields_by_key: dict[str, dict] = {}
        with fitz.open(stream=file_bytes, filetype="pdf") as document:
            for page_index, page in enumerate(document):
                widgets = page.widgets() or []
                for widget in widgets:
                    name = (widget.field_name or "").strip()
                    if name and name not in seen:
                        seen.add(name)
                        widget_names.append(name)

                    if not name:
                        continue

                    field_key = name.strip()
                    field_type = (getattr(widget, "field_type_string", None) or "Text").strip() or "Text"
                    field_label = _clean_label(getattr(widget, "field_label", None) or "", field_key)
                    field_options = _extract_widget_options(widget)

                    item = fields_by_key.get(field_key)
                    if not item:
                        item = {
                            "key": field_key,
                            "label": field_label,
                            "type": field_type,
                            "options": [],
                            "page": page_index + 1,
                        }
                        fields_by_key[field_key] = item
                        interview_fields.append(item)
                    elif not item.get("label") and field_label:
                        item["label"] = field_label

                    existing_options = set(item.get("options", []))
                    for option in field_options:
                        if option not in existing_options:
                            item["options"].append(option)
                            existing_options.add(option)

        # Add explicit boolean choices for standalone checkboxes.
        for item in interview_fields:
            if item.get("type") == "CheckBox" and not item.get("options"):
                item["options"] = ["Yes", "No"]
    except Exception as exc:
        logger.exception("Failed to parse uploaded PDF '%s': %s", pdf_file.filename, exc)
        return jsonify({"error": "Could not parse PDF. Please upload a valid fillable PDF."}), 400

    if not widget_names:
        return jsonify({"error": "No fillable fields detected."}), 400

    agent_id = uuid.uuid4().hex[:8]
    safe_name = secure_filename(pdf_file.filename) or "upload.pdf"
    pdf_path = UPLOAD_DIR / f"{agent_id}_{safe_name}"
    pdf_path.write_bytes(file_bytes)

    schema = {
        "widget_names": widget_names,
        "interview_fields": interview_fields,
        "blank_values": {name: None for name in widget_names},
    }
    if not agent_name:
        fallback_name = pdf_file.filename.rsplit(".", 1)[0].strip()
        agent_name = fallback_name or f"Agent {agent_id}"

    save_agent(agent_id=agent_id, pdf_path=str(pdf_path), schema=schema, agent_name=agent_name)

    return (
        jsonify(
            {
                "filename": pdf_file.filename,
                "agent_name": agent_name,
                "fieldCount": len(widget_names),
                "widgetNames": widget_names,
                "agent_id": agent_id,
                "share_url": f"/agent/{agent_id}",
            }
        ),
        200,
    )
