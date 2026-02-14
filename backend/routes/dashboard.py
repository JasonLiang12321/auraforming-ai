import logging
from pathlib import Path

from flask import Blueprint, jsonify, send_file

from storage import DATA_DIR, get_completed_session, list_completed_sessions

dashboard_bp = Blueprint("dashboard", __name__)
logger = logging.getLogger(__name__)


def _with_urls(item: dict) -> dict:
    session_id = item["session_id"]
    return {
        **item,
        "pdf_preview_url": f"/api/admin/dashboard/sessions/{session_id}/pdf",
        "download_url": f"/api/admin/dashboard/sessions/{session_id}/download",
    }


@dashboard_bp.get("/admin/dashboard/sessions")
def get_sessions() -> tuple:
    sessions = [_with_urls(item) for item in list_completed_sessions(limit=200)]
    return jsonify({"sessions": sessions}), 200


@dashboard_bp.get("/admin/dashboard/sessions/<session_id>")
def get_session_detail(session_id: str) -> tuple:
    session = get_completed_session(session_id)
    if not session:
        return jsonify({"error": "Session not found."}), 404
    return jsonify(_with_urls(session)), 200


def _safe_pdf_path(path_value: str) -> Path | None:
    path = Path(path_value).resolve()
    data_root = DATA_DIR.resolve()
    if not path.exists() or not path.is_file():
        return None
    if not str(path).startswith(str(data_root)):
        return None
    return path


@dashboard_bp.get("/admin/dashboard/sessions/<session_id>/pdf")
def preview_pdf(session_id: str):
    session = get_completed_session(session_id)
    if not session:
        return jsonify({"error": "Session not found."}), 404

    pdf_path = _safe_pdf_path(session["filled_pdf_path"])
    if not pdf_path:
        logger.warning("Missing or invalid PDF path for session_id=%s", session_id)
        return jsonify({"error": "Filled PDF not found."}), 404

    return send_file(pdf_path, mimetype="application/pdf", as_attachment=False)


@dashboard_bp.get("/admin/dashboard/sessions/<session_id>/download")
def download_pdf(session_id: str):
    session = get_completed_session(session_id)
    if not session:
        return jsonify({"error": "Session not found."}), 404

    pdf_path = _safe_pdf_path(session["filled_pdf_path"])
    if not pdf_path:
        logger.warning("Missing or invalid download PDF path for session_id=%s", session_id)
        return jsonify({"error": "Filled PDF not found."}), 404

    return send_file(
        pdf_path,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=f"completed-{session_id}.pdf",
    )
