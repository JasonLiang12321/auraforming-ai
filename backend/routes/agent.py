from flask import Blueprint, jsonify

from storage import delete_agent, get_agent, list_agents, list_completed_sessions_by_agent

agent_bp = Blueprint("agent", __name__)


@agent_bp.get("/agent/<agent_id>")
def agent_details(agent_id: str) -> tuple:
    agent = get_agent(agent_id)
    if not agent:
        return jsonify({"error": "Agent not found."}), 404
    return jsonify(agent), 200


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
