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

model = genai.GenerativeModel(model_name="gemini-2.0-pro-exp")

@gemini_bp.post("/gemini")
def gemini_endpoint():
    try:
        data = request.get_json(silent=True)
        if data is None or not isinstance(data, dict):
            return jsonify({"error": "Invalid or missing JSON body"}), 400
        user_input = data.get("user_input", "")
        form_field = data.get("form_field", "")
        field_context = data.get("field_context", "")
        
        if not user_input or not form_field:
            return jsonify({"error": "Missing user_input or form_field"}), 400

        # Single call to Gemini: analyze and generate response
        prompt = f"""You are an AI assistant helping users fill out a form. Analyze the user's input and determine the next action.

Form field: "{form_field}"
Field context: "{field_context}"
User input: "{user_input}"

Respond with JSON:
{{
"collected_value": "the extracted value if data is collected, empty string otherwise",
"intent": "clarification|acknowledgment|data",
"response": "your conversational response to the user"
}}

STRICT Rules:
- ONLY set intent to "data" if the user clearly provided THEIR OWN information for THIS specific field
- If the information is ambiguous, unclear, or about someone else, set intent to "clarification"
- If user asked a question, set intent to "clarification" and explain
- If user acknowledged understanding, set intent to "acknowledgment" and re-ask the question
- For "{form_field}" ({field_context}): user must explicitly state THEIR personal data
- Do NOT assume or infer information
- When in doubt, ask for clarification"""

        response = model.generate_content(
            prompt,
            generation_config={
                "response_mime_type": "application/json",
                "response_schema": {
                    "type": "object",
                    "properties": {
                        "collected_value": {"type": "string"},
                        "intent": {"type": "string", "enum": ["clarification", "acknowledgment", "data"]},
                        "response": {"type": "string"},
                    },
                    "required": [ "collected_value", "intent", "response"]
                }
            }
        )

        result = json.loads(response.text)

        return jsonify({
            "collected_value": result["collected_value"],
            "intent": result["intent"],
            "response": result["response"]
        }), 200

    except json.JSONDecodeError:
        return jsonify({"error": "Invalid JSON from Gemini API"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500
