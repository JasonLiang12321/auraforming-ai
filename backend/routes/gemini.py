import os
import json
from flask import Blueprint, request, jsonify
from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv()

gemini_bp = Blueprint("gemini", __name__)

# Configure Gemini API
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
genai.configure(api_key=GEMINI_API_KEY)

@gemini_bp.post("/gemini")
def gemini_endpoint():
    try:
        # Parse JSON data from the request
        data = request.get_json()
        conversation = data.get("conversation", [])
        required_keys = data.get("required_keys", [])

        if not conversation or not required_keys:
            return jsonify({"error": "Missing conversation or required_keys"}), 400

        # Build the prompt for Gemini
        conversation_text = "\n".join(
            [f"{msg['role'].capitalize()}: {msg['message']}" for msg in conversation]
        )
        
        prompt = f"""Based on the following conversation, extract the information and return ONLY a JSON object with these keys: {', '.join(required_keys)}.

Conversation:
{conversation_text}

Return ONLY valid JSON with these exact keys: {json.dumps(required_keys)}
Do not add any additional keys or fields."""

        # Call Gemini API with JSON response schema
        model = genai.GenerativeModel(
            model_name="gemini-2.0-flash",
            generation_config={
                "response_mime_type": "application/json",
                "response_schema": {
                    "type": "object",
                    "properties": {key: {"type": "string"} for key in required_keys},
                    "required": required_keys,
                }
            }
        )

        response = model.generate_content(prompt)
        
        # Parse the response
        extracted_data = json.loads(response.text)

        return jsonify({
            "message": "Data extracted successfully",
            "data": extracted_data
        }), 200

    except json.JSONDecodeError:
        return jsonify({"error": "Invalid JSON from Gemini API"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500