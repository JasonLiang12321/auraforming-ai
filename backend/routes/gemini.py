import os
import json
from flask import Blueprint, request, jsonify
from dotenv import load_dotenv
import google.generativeai as genai
from storage import get_agent

load_dotenv()

gemini_bp = Blueprint("gemini", __name__)

# Configure Gemini API
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
genai.configure(api_key=GEMINI_API_KEY)

model = genai.GenerativeModel(model_name="gemini-2.0-pro-exp")

@gemini_bp.post("/gemini")
def gemini_endpoint():
    try:
        data = request.get_json()
        agent_id = data.get("agent_id", "")
        user_input = data.get("user_input", "")
        form_field = data.get("form_field", "")
        field_context = data.get("field_context", "")
        
        if not agent_id or not user_input or not form_field:
            return jsonify({"error": "Missing agent_id, user_input, or form_field"}), 400

        # AC2: Dynamically fetch required keys from agent schema
        agent = get_agent(agent_id)
        if not agent:
            return jsonify({"error": "Agent not found"}), 404
        
        required_keys = agent["schema"].get("widget_names", [])
        if not required_keys:
            return jsonify({"error": "Agent has no form fields"}), 400

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

        # AC2: Use responseMimeType and responseSchema parameters
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
                    "required": ["collected_value", "intent", "response"]
                }
            }
        )

        result = json.loads(response.text)

        return jsonify({
            "data_collected": result["intent"] == "data",
            "collected_value": result["collected_value"],
            "response": result["response"]
        }), 200

    except json.JSONDecodeError:
        return jsonify({"error": "Invalid JSON from Gemini API"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500    
    
@gemini_bp.post("/gemini/questions")
def generate_all_questions():
    """Generate questions for all form fields at once"""
    try:
        data = request.get_json()
        agent_id = data.get("agent_id", "")
        
        if not agent_id:
            return jsonify({"error": "Missing agent_id"}), 400

        # Fetch agent
        agent = get_agent(agent_id)
        if not agent:
            return jsonify({"error": "Agent not found"}), 404
        
        form_fields = agent["schema"].get("widget_names", [])
        if not form_fields:
            return jsonify({"error": "Agent has no form fields"}), 400

        # Generate questions for all fields at once
        fields_str = "\n".join([f"{i+1}. {field}" for i, field in enumerate(form_fields)])
        
        prompt = f"""Generate natural, conversational questions for these form fields. Return ONLY the questions in plain text, one per line, in the same order.

Form fields:
{fields_str}

Requirements:
- One question per line
- 1-2 sentences max per question
- NO numbering, NO explanations, just questions
- Plain text only"""

        response = model.generate_content(prompt)
        questions = response.text.strip().split("\n")
        
        # Match questions to fields
        questions_map = {
            field: question.strip() for field, question in zip(form_fields, questions)
        }

        return jsonify({
            "questions": questions_map,
            "form_fields": form_fields
        }), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500
