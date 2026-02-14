import logging
import uuid
import fitz
from flask import Blueprint, jsonify, request
from werkzeug.utils import secure_filename
from storage import UPLOAD_DIR, save_agent

upload_bp = Blueprint("upload", __name__)
logger = logging.getLogger(__name__)


@upload_bp.post("/admin/upload")
def upload_pdf() -> tuple:
    if "file" not in request.files:
        return jsonify({"error": "Missing file field. Use form-data key 'file'."}), 400

    pdf_file = request.files["file"]
    if not pdf_file.filename:
        return jsonify({"error": "No file selected."}), 400

    if not pdf_file.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Only PDF files are supported."}), 400

    try:
        file_bytes = pdf_file.read()
        widget_names: list[str] = []
        seen = set()
        with fitz.open(stream=file_bytes, filetype="pdf") as document:
            for page in document:
                widgets = page.widgets() or []
                for widget in widgets:
                    name = (widget.field_name or "").strip()
                    if name and name not in seen:
                        seen.add(name)
                        widget_names.append(name)
    except Exception as exc:
        logger.exception("Failed to parse uploaded PDF '%s': %s", pdf_file.filename, exc)
        return jsonify({"error": "Could not parse PDF. Please upload a valid fillable PDF."}), 400

    if not widget_names:
        return jsonify({"error": "No fillable fields detected."}), 400

    agent_id = uuid.uuid4().hex[:8]
    safe_name = secure_filename(pdf_file.filename) or "upload.pdf"
    pdf_path = UPLOAD_DIR / f"{agent_id}_{safe_name}"
    pdf_path.write_bytes(file_bytes)

    schema = {"widget_names": widget_names, "blank_values": {name: None for name in widget_names}}
    save_agent(agent_id=agent_id, pdf_path=str(pdf_path), schema=schema)

    return (
        jsonify(
            {
                "filename": pdf_file.filename,
                "fieldCount": len(widget_names),
                "widgetNames": widget_names,
                "agent_id": agent_id,
                "share_url": f"/agent/{agent_id}",
            }
        ),
        200,
    )
