from io import BytesIO

from flask import Blueprint, jsonify, request
from pypdf import PdfReader

upload_bp = Blueprint("upload", __name__)


@upload_bp.post("/upload")
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
        reader = PdfReader(BytesIO(file_bytes))
        fields = reader.get_fields() or {}
        field_names = sorted(fields.keys())
    except Exception:
        return jsonify({"error": "Could not parse PDF. Please upload a valid fillable PDF."}), 400

    return (
        jsonify(
            {
                "filename": pdf_file.filename,
                "fieldCount": len(field_names),
                "fieldNames": field_names,
            }
        ),
        200,
    )
