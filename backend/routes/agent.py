import io
import os
import re
from urllib.parse import unquote

import fitz
from flask import Blueprint, jsonify, request, send_file

from storage import DATA_DIR, delete_agent, get_agent, list_agents, list_completed_sessions_by_agent

agent_bp = Blueprint("agent", __name__)


def _decode_pdf_token(value: str) -> str:
    if not value:
        return ""
    text = unquote(str(value))
    text = re.sub(r"#([0-9A-Fa-f]{2})", lambda m: bytes.fromhex(m.group(1)).decode("latin1"), text)
    return " ".join(text.split()).strip()


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


def _safe_pdf_path(path_value: str):
    path = os.path.realpath(path_value)
    data_root = os.path.realpath(str(DATA_DIR))
    if not path.startswith(data_root):
        return None
    if not os.path.isfile(path):
        return None
    return path


def _is_checkbox_yes(value: str) -> bool:
    normalized = re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()
    yes_tokens = {"yes", "y", "true", "checked", "check", "mark yes", "affirmative", "consent", "on"}
    if normalized in yes_tokens:
        return True
    if " not " in f" {normalized} " and "consent" in normalized:
        return False
    return False


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
    normalized_raw = re.sub(r"[^a-z0-9]+", " ", raw.lower()).strip()
    for option in options:
        normalized_option = re.sub(r"[^a-z0-9]+", " ", option.lower()).strip()
        if normalized_raw == normalized_option:
            return option
    for option in options:
        normalized_option = re.sub(r"[^a-z0-9]+", " ", option.lower()).strip()
        if normalized_raw and normalized_raw in normalized_option:
            return option
        if normalized_option and normalized_option in normalized_raw:
            return option
    return ""


def _assign_widget_value(widget, value: str, options_by_field: dict[str, list[str]]) -> None:
    field_type = str(getattr(widget, "field_type_string", "") or "")
    field_name = str(getattr(widget, "field_name", "") or "").strip()
    text_value = str(value or "").strip()
    field_options = options_by_field.get(field_name, [])

    if field_type == "CheckBox":
        if _is_checkbox_yes(text_value):
            widget.field_value = _widget_on_state(widget) or "Yes"
        else:
            widget.field_value = "Off"
    elif field_type == "RadioButton":
        options = field_options or _extract_widget_options(widget)
        mapped = _map_value_to_allowed_option(text_value, options)
        widget.field_value = mapped or text_value
    elif field_type == "ComboBox":
        mapped = _map_value_to_allowed_option(text_value, field_options)
        widget.field_value = mapped or text_value
    else:
        widget.field_value = text_value

    widget.update()


def _flatten_preview_pdf(doc: fitz.Document) -> bytes:
    # Render each page into an image-backed PDF so preview remains read-only.
    flattened = fitz.open()
    matrix = fitz.Matrix(1.35, 1.35)
    for source_page in doc:
        target_page = flattened.new_page(width=source_page.rect.width, height=source_page.rect.height)
        pix = source_page.get_pixmap(matrix=matrix, alpha=False)
        target_page.insert_image(target_page.rect, stream=pix.tobytes("png"))
    output = flattened.write()
    flattened.close()
    return output


def _field_map_from_schema(schema: dict) -> list[dict]:
    items = schema.get("interview_fields", []) if isinstance(schema.get("interview_fields"), list) else []
    output: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key", "")).strip()
        if not key:
            continue
        output.append(
            {
                "key": key,
                "label": str(item.get("label", "")).strip() or key,
                "type": str(item.get("type", "Text")).strip() or "Text",
                "options": [str(x).strip() for x in item.get("options", []) if str(x).strip()],
                "page": int(item.get("page", 1) or 1),
                "rect": item.get("rect"),
                "page_size": item.get("page_size"),
            }
        )
    return output


def _field_map_from_pdf(pdf_path: str) -> list[dict]:
    output: list[dict] = []
    seen = set()
    with fitz.open(pdf_path) as document:
        for page_index, page in enumerate(document):
            page_size = {"width": float(page.rect.width), "height": float(page.rect.height)}
            for widget in page.widgets() or []:
                key = str(getattr(widget, "field_name", "") or "").strip()
                if not key or key in seen:
                    continue
                seen.add(key)
                rect = getattr(widget, "rect", None)
                rect_payload = None
                if rect is not None:
                    rect_payload = {
                        "x0": float(rect.x0),
                        "y0": float(rect.y0),
                        "x1": float(rect.x1),
                        "y1": float(rect.y1),
                    }
                output.append(
                    {
                        "key": key,
                        "label": str(getattr(widget, "field_label", "") or "").strip() or key,
                        "type": str(getattr(widget, "field_type_string", "Text") or "Text"),
                        "options": _extract_widget_options(widget),
                        "page": page_index + 1,
                        "rect": rect_payload,
                        "page_size": page_size,
                    }
                )
    return output


@agent_bp.get("/agent/<agent_id>")
def agent_details(agent_id: str) -> tuple:
    agent = get_agent(agent_id)
    if not agent:
        return jsonify({"error": "Agent not found."}), 404
    schema = agent.get("schema", {}) if isinstance(agent.get("schema"), dict) else {}
    field_map = _field_map_from_schema(schema)
    if not field_map:
        pdf_path = _safe_pdf_path(str(agent.get("pdf_path", "") or ""))
        if pdf_path:
            try:
                field_map = _field_map_from_pdf(pdf_path)
            except Exception:
                field_map = []

    payload = {
        **agent,
        "preview_pdf_url": f"/api/agent/{agent_id}/pdf",
        "live_preview_url": f"/api/agent/{agent_id}/preview",
        "field_map": field_map,
    }
    return jsonify(payload), 200


@agent_bp.get("/agent/<agent_id>/pdf")
def agent_blank_pdf(agent_id: str):
    agent = get_agent(agent_id)
    if not agent:
        return jsonify({"error": "Agent not found."}), 404
    pdf_path = _safe_pdf_path(str(agent.get("pdf_path", "") or ""))
    if not pdf_path:
        return jsonify({"error": "Blank PDF not found."}), 404
    return send_file(pdf_path, mimetype="application/pdf", as_attachment=False)


@agent_bp.post("/agent/<agent_id>/preview")
def agent_live_preview(agent_id: str):
    agent = get_agent(agent_id)
    if not agent:
        return jsonify({"error": "Agent not found."}), 404

    payload = request.get_json(silent=True)
    if payload is None or not isinstance(payload, dict):
        return jsonify({"error": "Invalid or missing JSON body"}), 400

    answers_raw = payload.get("answers", {})
    if not isinstance(answers_raw, dict):
        return jsonify({"error": "answers must be an object"}), 400

    answers = {str(k): str(v) for k, v in answers_raw.items() if str(k).strip()}
    pdf_path = _safe_pdf_path(str(agent.get("pdf_path", "") or ""))
    if not pdf_path:
        return jsonify({"error": "Blank PDF not found."}), 404

    schema = agent.get("schema", {}) if isinstance(agent.get("schema"), dict) else {}
    field_map = _field_map_from_schema(schema)
    options_by_field: dict[str, list[str]] = {}
    for item in field_map:
        key = str(item.get("key", "")).strip()
        if not key:
            continue
        options = item.get("options", [])
        if isinstance(options, list):
            options_by_field[key] = [str(x) for x in options]

    try:
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
                        _assign_widget_value(widget, answers[field_key], options_by_field)
            try:
                doc.need_appearances(True)
            except Exception:
                pass
            pdf_bytes = _flatten_preview_pdf(doc)
    except Exception:
        return jsonify({"error": "Could not generate live PDF preview."}), 500

    return send_file(
        io.BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=False,
        download_name=f"{agent_id}-live-preview.pdf",
    )


@agent_bp.get("/admin/agents")
def agent_list() -> tuple:
    return jsonify({"agents": list_agents(limit=300)}), 200


def _with_urls(item: dict) -> dict:
    session_id = item["session_id"]
    return {
        **item,
        "pdf_preview_url": f"/api/admin/dashboard/sessions/{session_id}/pdf",
        "download_url": f"/api/admin/dashboard/sessions/{session_id}/download",
    }


@agent_bp.get("/admin/agents/<agent_id>/sessions")
def agent_sessions(agent_id: str) -> tuple:
    agent = get_agent(agent_id)
    if not agent:
        return jsonify({"error": "Agent not found."}), 404
    sessions = [_with_urls(item) for item in list_completed_sessions_by_agent(agent_id, limit=300)]
    return jsonify({"agent_id": agent_id, "sessions": sessions}), 200


@agent_bp.delete("/admin/agents/<agent_id>")
def agent_delete(agent_id: str) -> tuple:
    result = delete_agent(agent_id)
    if not result:
        return jsonify({"error": "Agent not found."}), 404
    return jsonify(result), 200
