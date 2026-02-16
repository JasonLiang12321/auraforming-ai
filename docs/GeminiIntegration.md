# Gemini Integration (Current)

This doc reflects the **current live implementation** in `backend/routes/interview.py` and `backend/routes/gemini.py`.

## Role of Gemini

Gemini is the reasoning layer for interview turns. It:

- validates the current answer
- decides if the answer is adequate
- returns normalized values for PDF filling
- generates the assistant’s next spoken response
- handles interruptions (`barge_in`)

ElevenLabs is used for STT/TTS transport; Gemini decides interview logic.

## Model and Config

- Env var: `GEMINI_API_KEY` (required)
- Env var: `GEMINI_MODEL` (optional)
- Default model: `gemini-2.0-flash`

Configured in: `backend/routes/gemini.py`

## Endpoints that use Gemini

- `POST /api/agent/<agent_id>/interview/turn`
  - text turn validation
- `POST /api/agent/<agent_id>/interview/turn-audio`
  - STT transcript -> Gemini validation -> TTS response
- `POST /api/gemini/questions`
  - helper for generating grouped field questions
- `POST /api/gemini/ui-translations`
  - helper for UI translation payloads

## Active Prompt Sources (Source of Truth)

- `backend/routes/interview.py::_build_system_prompt(...)`
- `backend/routes/interview.py::_build_first_prompt(...)`
- `backend/routes/interview.py::_evaluate_turn_with_gemini(...)`

### 1) System Prompt (`_build_system_prompt`)

The prompt enforces:

1. one field at a time, strict order  
2. use user-facing labels only (never technical keys)  
3. proper handling for `ComboBox/RadioButton` options  
4. `CheckBox` as yes/no  
5. clarify if inadequate  
6. interruption recovery  
7. no out-of-scope fields  
8. assistant responses in selected interview language  
9. `normalized_value` in English for PDF filling

### 2) First Prompt (`_build_first_prompt`)

Built from language copy templates and field metadata.  
It introduces the form and asks the first field in the selected language.

### 3) Turn-Evaluation Prompt (`_evaluate_turn_with_gemini`)

Prompt includes:

- form title
- required assistant language
- current field label/type/options
- next field label/type/options
- remaining fields
- collected answers
- user transcript
- interruption flag

Strict JSON contract requested:

```json
{
  "intent": "data|clarification|acknowledgment|barge_in",
  "is_answer_adequate": true,
  "normalized_value": "string",
  "collected_values": ["..."],
  "assistant_response": "string"
}
```

`collected_values` is used for grouped/multi-select fields.

## Output Handling Rules

Backend coercion logic applies after Gemini output:

- checkboxes mapped to `Yes/No` semantics
- radio/dropdown values mapped to allowed options
- grouped fields can write multiple related keys in one turn

If Gemini returns an adequate answer, backend advances field state and may append/ensure next question quality.

## Error Mapping

`run_gemini_json(...)` maps failures to typed errors:

- `GEMINI_AUTH` (invalid/expired key)
- `GEMINI_RATE_LIMIT` (429/resource exhausted)
- `GEMINI_REQUEST` (other request failures)

These are surfaced in interview endpoints as structured error codes.

## Notes

- Interview sessions are in-memory (`SESSIONS` dict in `interview.py`).
- Restarting backend clears active sessions.
- Final PDF persistence is handled after completion by backend session finalization.
