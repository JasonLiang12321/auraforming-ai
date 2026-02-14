import json
import logging
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from flask import Blueprint, jsonify, request, send_file

from storage import get_agent

voice_bp = Blueprint("voice", __name__)
logger = logging.getLogger(__name__)


@voice_bp.get("/agent/<agent_id>/signed-url")
def get_signed_url(agent_id: str) -> tuple:
    debug_enabled = os.getenv("VOICE_DEBUG", "0") == "1" or request.args.get("debug") == "1"

    def build_error(message: str, status_code: int, details: dict | None = None) -> tuple:
        payload = {"error": message}
        if debug_enabled and details:
            payload["details"] = details
        return jsonify(payload), status_code

    logger.info("Signed URL request received for agent_id=%s", agent_id)

    agent = get_agent(agent_id)
    if not agent:
        return build_error("Agent not found.", 404)

    api_key = os.getenv("ELEVENLABS_API_KEY")
    elevenlabs_agent_id = os.getenv("ELEVENLABS_AGENT_ID")
    if not api_key or not elevenlabs_agent_id:
        return build_error(
            "Missing ElevenLabs config. Set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID.",
            500,
            {"has_api_key": bool(api_key), "has_agent_id": bool(elevenlabs_agent_id)},
        )

    request_url = (
        "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?"
        + urlencode({"agent_id": elevenlabs_agent_id})
    )
    req = Request(
        request_url,
        method="GET",
        headers={"xi-api-key": api_key, "Accept": "application/json"},
    )

    try:
        with urlopen(req, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8")
        except Exception:
            body = "<unable-to-read-response-body>"
        logger.exception("ElevenLabs signed URL request failed with HTTP %s", exc.code)
        return build_error(
            "Failed to fetch signed URL from ElevenLabs.",
            502,
            {"http_status": exc.code, "upstream_body": body[:500], "elevenlabs_agent_id": elevenlabs_agent_id},
        )
    except URLError as exc:
        logger.exception("Could not connect to ElevenLabs signed URL endpoint.")
        return build_error("Could not reach ElevenLabs service.", 502, {"reason": str(exc.reason)})
    except json.JSONDecodeError:
        logger.exception("ElevenLabs signed URL response was not valid JSON.")
        return build_error("Invalid response from ElevenLabs service.", 502)

    signed_url = payload.get("signed_url")
    if not signed_url:
        logger.error("ElevenLabs response missing signed_url key.")
        return build_error(
            "Signed URL was missing from ElevenLabs response.",
            502,
            {"response_keys": sorted(payload.keys())},
        )

    logger.info("Signed URL generated successfully for agent_id=%s", agent_id)
    return jsonify({"signed_url": signed_url}), 200

