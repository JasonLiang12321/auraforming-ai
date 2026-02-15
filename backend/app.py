import logging

from flask import Flask
from flask_cors import CORS

from routes.agent import agent_bp
from routes.health import health_bp
from routes.upload import upload_bp
from routes.voice import voice_bp
from routes.interview import interview_bp
from routes.dashboard import dashboard_bp
from routes.submission import submission_bp
from storage import get_agent, init_storage
from routes.analytics import analytics_bp
from routes.gemini import gemini_bp

def create_app() -> Flask:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger().setLevel(logging.INFO)

    app = Flask(__name__)
    app.logger.setLevel(logging.INFO)
    CORS(app)
    init_storage()

    app.register_blueprint(health_bp, url_prefix="/api")
    app.register_blueprint(gemini_bp, url_prefix="/api")
    app.register_blueprint(upload_bp, url_prefix="/api")
    app.register_blueprint(voice_bp, url_prefix="/api")
    app.register_blueprint(interview_bp, url_prefix="/api")
    app.register_blueprint(dashboard_bp, url_prefix="/api")
    app.register_blueprint(agent_bp, url_prefix="/api")
    app.register_blueprint(submission_bp, url_prefix="/api")
    app.register_blueprint(analytics_bp)
    
    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5050, debug=True)
