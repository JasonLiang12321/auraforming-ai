from flask import Flask
from flask_cors import CORS

from routes.health import health_bp
from routes.upload import upload_bp


def create_app() -> Flask:
    app = Flask(__name__)
    CORS(app)

    app.register_blueprint(health_bp, url_prefix="/api")
    app.register_blueprint(upload_bp)
    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5050, debug=True)
