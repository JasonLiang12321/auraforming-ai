import json
import logging
import uuid
from pathlib import Path
import fitz
from flask import Blueprint, jsonify, request
from storage import get_agent, save_completed_session, COMPLETED_DIR
import re

submission_bp = Blueprint("submission", __name__)
logger = logging.getLogger(__name__)


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
        print(f"DEBUG: Answers received: {json.dumps(answers, indent=2)}")
        
        # Open the PDF
        doc = fitz.open(pdf_path)
        filled_count = 0
        
        # Iterate through all pages and widgets
        for page in doc:
            widgets = page.widgets() or []
            for widget in widgets:
                field_name = widget.field_name
                if field_name in answers:
                    value = answers[field_name]
                    widget.field_value = value
                    widget.update()
                    filled_count += 1
        
        print(f"DEBUG: Filled {filled_count} fields")
        
        # Flatten the PDF (remove editability)
        for page in doc:
            page.clean_contents()
        
        # Write to bytes and close
        pdf_bytes = doc.write()
        doc.close()
        print("\nDEBUG: Verifying filled PDF...")
        temp_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        for page in temp_doc:
            widgets = page.widgets() or []
            for widget in widgets:
                print(f"  {widget.field_name} = {widget.field_value}")
        temp_doc.close()
        
        return pdf_bytes
        
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