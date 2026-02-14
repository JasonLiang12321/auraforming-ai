from flask import Flask, jsonify
from flask_cors import CORS

from routes.health import health_bp
from routes.upload import upload_bp
from routes.voice import voice_bp
from routes.dashboard import dashboard_bp
from storage import get_agent, init_storage

from routes.gemini import gemini_bp

def create_app() -> Flask:
    app = Flask(__name__)
    CORS(app)
    init_storage()

    app.register_blueprint(health_bp, url_prefix="/api")
    app.register_blueprint(gemini_bp)
    app.register_blueprint(upload_bp, url_prefix="/api")
    app.register_blueprint(voice_bp, url_prefix="/api")
    app.register_blueprint(dashboard_bp, url_prefix="/api")
    return app


app = create_app()


@app.get("/api/agent/<agent_id>")
def agent_details(agent_id: str) -> tuple:
    agent = get_agent(agent_id)
    if not agent:
        return jsonify({"error": "Agent not found."}), 404
    return jsonify(agent), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5050, debug=True)
