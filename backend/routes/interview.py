import json
import logging
import base64
import os
import uuid
import re
from urllib.parse import unquote
from dataclasses import dataclass, field
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request
import requests
import fitz

from routes.gemini import GeminiAuthError, GeminiRateLimitError, GeminiRequestError, run_gemini_json
from storage import COMPLETED_DIR, get_agent, save_completed_session, save_session_start

interview_bp = Blueprint("interview", __name__)
logger = logging.getLogger(__name__)


@dataclass
class InterviewSession:
    session_id: str
    agent_id: str
    missing_fields: list[str]
    form_name: str = ""
    field_meta: dict[str, dict] = field(default_factory=dict)
    language_code: str = "en-US"
    language_label: str = "English (US)"
    answers: dict[str, str] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    @property
    def current_field(self) -> str | None:
        return self.missing_fields[0] if self.missing_fields else None

    @property
    def completed(self) -> bool:
        return not self.missing_fields


SESSIONS: dict[str, InterviewSession] = {}
ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1"
ENABLE_LABEL_LOCALIZATION = os.getenv("ENABLE_INTERVIEW_LABEL_LOCALIZATION", "1").strip().lower() in {"1", "true", "yes"}
SUPPORTED_INTERVIEW_LANGUAGES: dict[str, str] = {
    "en-US": "English (US)",
    "en-GB": "English (UK)",
    "es-ES": "Spanish (Spain)",
    "es-MX": "Spanish (Mexico)",
    "fr-FR": "French",
    "de-DE": "German",
    "it-IT": "Italian",
    "pt-BR": "Portuguese (Brazil)",
    "ja-JP": "Japanese",
    "ko-KR": "Korean",
    "ru-RU": "Russian",
    "zh-CN": "Chinese (Simplified)",
    "hi-IN": "Hindi",
}
STT_LANGUAGE_CODE_MAP: dict[str, str] = {
    "en-US": "en",
    "en-GB": "en",
    "es-ES": "es",
    "es-MX": "es",
    "fr-FR": "fr",
    "de-DE": "de",
    "it-IT": "it",
    "pt-BR": "pt",
    "ja-JP": "ja",
    "ko-KR": "ko",
    "ru-RU": "ru",
    "zh-CN": "zh",
    "hi-IN": "hi",
}
LANGUAGE_COPY: dict[str, dict[str, str]] = {
    "en": {
        "this_form": "this form",
        "combo_question": 'For "{label}", choose one option: {options}. What should I select?',
        "checkbox_question": 'For "{label}", should I mark yes or no?',
        "text_question": 'What should I enter for "{label}"?',
        "intro": 'Hi there. We are now completing "{form_name}". I will help you step by step. {question}',
        "next_prefix": "Next, ",
        "completed_ready": "Thank you. We have everything we need. Your completed form is ready and can be downloaded now.",
        "completed_generating": "Thank you. We have everything we need. Your completed form is now being generated and will be ready to download shortly.",
        "barge_in_prefix": "Got it. Let's continue. ",
        "still_need": "I still need {label}. {question}",
    },
    "es": {
        "this_form": "este formulario",
        "combo_question": 'Para "{label}", elige una opción: {options}. ¿Cuál debo seleccionar?',
        "checkbox_question": 'Para "{label}", ¿debo marcar sí o no?',
        "text_question": '¿Qué debo ingresar para "{label}"?',
        "intro": 'Hola. Ahora completaremos "{form_name}". Te ayudaré paso a paso. {question}',
        "next_prefix": "Siguiente: ",
        "completed_ready": "Gracias. Ya tenemos toda la información necesaria. Tu formulario completo está listo para descargar.",
        "completed_generating": "Gracias. Ya tenemos toda la información necesaria. Tu formulario se está generando y estará listo para descargar en breve.",
        "barge_in_prefix": "Entendido. Continuemos. ",
        "still_need": "Todavía necesito {label}. {question}",
    },
    "fr": {
        "this_form": "ce formulaire",
        "combo_question": 'Pour "{label}", choisissez une option : {options}. Laquelle dois-je sélectionner ?',
        "checkbox_question": 'Pour "{label}", dois-je cocher oui ou non ?',
        "text_question": 'Que dois-je saisir pour "{label}" ?',
        "intro": 'Bonjour. Nous allons maintenant remplir "{form_name}". Je vais vous aider étape par étape. {question}',
        "next_prefix": "Ensuite, ",
        "completed_ready": "Merci. Nous avons toutes les informations nécessaires. Votre formulaire rempli est prêt à être téléchargé.",
        "completed_generating": "Merci. Nous avons toutes les informations nécessaires. Votre formulaire est en cours de génération et sera bientôt prêt au téléchargement.",
        "barge_in_prefix": "D'accord. Continuons. ",
        "still_need": "J'ai encore besoin de {label}. {question}",
    },
    "de": {
        "this_form": "dieses Formular",
        "combo_question": 'Für "{label}" wählen Sie bitte eine Option: {options}. Welche soll ich auswählen?',
        "checkbox_question": 'Soll ich bei "{label}" Ja oder Nein markieren?',
        "text_question": 'Was soll ich bei "{label}" eintragen?',
        "intro": 'Hallo. Wir füllen jetzt "{form_name}" aus. Ich helfe Ihnen Schritt für Schritt. {question}',
        "next_prefix": "Als Nächstes: ",
        "completed_ready": "Danke. Wir haben alle erforderlichen Angaben. Ihr ausgefülltes Formular kann jetzt heruntergeladen werden.",
        "completed_generating": "Danke. Wir haben alle erforderlichen Angaben. Ihr Formular wird gerade erstellt und ist in Kürze zum Download bereit.",
        "barge_in_prefix": "Verstanden. Machen wir weiter. ",
        "still_need": "Ich brauche noch {label}. {question}",
    },
    "it": {
        "this_form": "questo modulo",
        "combo_question": 'Per "{label}", scegli un\'opzione: {options}. Quale devo selezionare?',
        "checkbox_question": 'Per "{label}", devo segnare sì o no?',
        "text_question": 'Cosa devo inserire per "{label}"?',
        "intro": 'Ciao. Ora compileremo "{form_name}". Ti aiuterò passo dopo passo. {question}',
        "next_prefix": "Successivo: ",
        "completed_ready": "Grazie. Abbiamo tutte le informazioni necessarie. Il modulo compilato è pronto per il download.",
        "completed_generating": "Grazie. Abbiamo tutte le informazioni necessarie. Il modulo è in fase di generazione e sarà pronto per il download a breve.",
        "barge_in_prefix": "Capito. Continuiamo. ",
        "still_need": "Mi serve ancora {label}. {question}",
    },
    "pt": {
        "this_form": "este formulário",
        "combo_question": 'Para "{label}", escolha uma opção: {options}. Qual devo selecionar?',
        "checkbox_question": 'Para "{label}", devo marcar sim ou não?',
        "text_question": 'O que devo preencher em "{label}"?',
        "intro": 'Olá. Agora vamos preencher "{form_name}". Vou ajudar você passo a passo. {question}',
        "next_prefix": "Em seguida, ",
        "completed_ready": "Obrigado. Já temos todas as informações necessárias. Seu formulário preenchido está pronto para download.",
        "completed_generating": "Obrigado. Já temos todas as informações necessárias. Seu formulário está sendo gerado e ficará pronto para download em instantes.",
        "barge_in_prefix": "Perfeito. Vamos continuar. ",
        "still_need": "Ainda preciso de {label}. {question}",
    },
    "ja": {
        "this_form": "このフォーム",
        "combo_question": '「{label}」は次の中から1つ選んでください: {options}。どれを選びますか？',
        "checkbox_question": '「{label}」は「はい」か「いいえ」のどちらにしますか？',
        "text_question": '「{label}」には何を入力しますか？',
        "intro": 'こんにちは。これから「{form_name}」を入力します。順番にサポートします。{question}',
        "next_prefix": "次に、",
        "completed_ready": "ありがとうございます。必要な情報はすべてそろいました。入力済みフォームを今すぐダウンロードできます。",
        "completed_generating": "ありがとうございます。必要な情報はすべてそろいました。フォームを生成中です。まもなくダウンロードできます。",
        "barge_in_prefix": "わかりました。続けましょう。",
        "still_need": "{label} の入力がまだ必要です。{question}",
    },
    "ko": {
        "this_form": "이 양식",
        "combo_question": '"{label}" 항목은 다음 중 하나를 선택해 주세요: {options}. 어떤 것으로 선택할까요?',
        "checkbox_question": '"{label}" 항목은 예/아니오 중 무엇으로 표시할까요?',
        "text_question": '"{label}" 항목에 무엇을 입력할까요?',
        "intro": '안녕하세요. 이제 "{form_name}" 작성을 시작하겠습니다. 단계별로 도와드릴게요. {question}',
        "next_prefix": "다음으로, ",
        "completed_ready": "감사합니다. 필요한 정보를 모두 받았습니다. 작성된 양식을 지금 다운로드할 수 있습니다.",
        "completed_generating": "감사합니다. 필요한 정보를 모두 받았습니다. 양식을 생성 중이며 곧 다운로드할 수 있습니다.",
        "barge_in_prefix": "알겠습니다. 계속하겠습니다. ",
        "still_need": "{label} 항목 정보가 아직 필요합니다. {question}",
    },
    "ru": {
        "this_form": "эту форму",
        "combo_question": 'Для поля "{label}" выберите один вариант: {options}. Какой вариант выбрать?',
        "checkbox_question": 'Для поля "{label}" отметить "да" или "нет"?',
        "text_question": 'Что мне указать для поля "{label}"?',
        "intro": 'Здравствуйте. Сейчас мы заполняем "{form_name}". Я помогу шаг за шагом. {question}',
        "next_prefix": "Далее, ",
        "completed_ready": "Спасибо. Все обязательные поля заполнены. Готовую форму можно скачать.",
        "completed_generating": "Спасибо. Мы собрали все данные. Готовая форма сейчас формируется и скоро будет доступна для скачивания.",
        "barge_in_prefix": "Понял. Продолжим. ",
        "still_need": 'Мне все еще нужно значение для поля "{label}". {question}',
    },
    "zh": {
        "this_form": "这份表单",
        "combo_question": '关于“{label}”，请从以下选项中选择一项：{options}。我应该选择哪一项？',
        "checkbox_question": '关于“{label}”，应标记“是”还是“否”？',
        "text_question": '“{label}”这个字段我该填写什么？',
        "intro": '你好，我们现在开始填写“{form_name}”。我会一步一步帮助你。{question}',
        "next_prefix": "接下来，",
        "completed_ready": "谢谢，我们已收集到所有必填信息。你现在可以下载已完成的表单。",
        "completed_generating": "谢谢，我们已经收集完所有信息。系统正在生成已完成的表单，很快就可以下载。",
        "barge_in_prefix": "明白了，我们继续。",
        "still_need": "我还需要“{label}”这个字段的值。{question}",
    },
    "hi": {
        "this_form": "यह फॉर्म",
        "combo_question": '"{label}" के लिए एक विकल्प चुनें: {options}। मुझे कौन-सा विकल्प चुनना चाहिए?',
        "checkbox_question": '"{label}" के लिए क्या मुझे हाँ या नहीं चिह्नित करना चाहिए?',
        "text_question": '"{label}" के लिए मुझे क्या भरना चाहिए?',
        "intro": 'नमस्ते। अब हम "{form_name}" भरेंगे। मैं आपकी चरण-दर-चरण मदद करूँगा। {question}',
        "next_prefix": "अगला, ",
        "completed_ready": "धन्यवाद। हमें सभी आवश्यक जानकारी मिल गई है। आपका भरा हुआ फॉर्म अब डाउनलोड के लिए तैयार है।",
        "completed_generating": "धन्यवाद। हमें सभी आवश्यक जानकारी मिल गई है। आपका फॉर्म बन रहा है और जल्द ही डाउनलोड के लिए तैयार होगा।",
        "barge_in_prefix": "ठीक है, आगे बढ़ते हैं। ",
        "still_need": "मुझे अभी भी {label} चाहिए। {question}",
    },
}


def _resolve_language_selection(raw_language_code: str) -> tuple[str, str]:
    normalized = str(raw_language_code or "").strip()
    if normalized in SUPPORTED_INTERVIEW_LANGUAGES:
        return normalized, SUPPORTED_INTERVIEW_LANGUAGES[normalized]
    return "en-US", SUPPORTED_INTERVIEW_LANGUAGES["en-US"]


def _to_stt_language_code(language_code: str) -> str:
    normalized = str(language_code or "").strip()
    if not normalized:
        return ""
    if normalized in STT_LANGUAGE_CODE_MAP:
        return STT_LANGUAGE_CODE_MAP[normalized]
    if "-" in normalized:
        normalized = normalized.split("-", 1)[0]
    return normalized.lower()


def _normalize_for_match(text: str) -> str:
    return re.sub(r"[^\w]+", " ", text.lower(), flags=re.UNICODE).strip()


def _fallback_label_from_key(field_key: str) -> str:
    text = str(field_key).replace("_", " ").replace("\t", " ")
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", text)
    text = re.sub(r"([A-Za-z])(\d)", r"\1 \2", text)
    text = re.sub(r"\s+", " ", text).strip()
    if text.lower() in {"i full name", "i, full name"}:
        return "Full name"
    return text or str(field_key)


def _decode_pdf_token(value: str) -> str:
    if not value:
        return ""
    text = unquote(str(value))
    text = re.sub(r"#([0-9A-Fa-f]{2})", lambda m: bytes.fromhex(m.group(1)).decode("latin1"), text)
    return " ".join(text.split()).strip()


def _clean_pdf_label(label: str, fallback: str) -> str:
    text = _decode_pdf_token(label or "")
    if not text:
        text = _decode_pdf_token(fallback)
    marker = "Type in the date or use the arrow keys to select a date."
    if marker in text:
        text = text.split(marker, 1)[0].strip()
    text = text.rstrip(":;,. ").strip()
    if text.lower() in {"i, full name", "i full name"}:
        text = "Full name"
    if text:
        looks_key_like = bool(text) and all(sep not in text for sep in [" ", "/", "(", ")", ",", "-", ":"])
        return _fallback_label_from_key(text) if looks_key_like else text
    return _fallback_label_from_key(fallback)


def _extract_widget_options(widget) -> list[str]:
    options: list[str] = []
    seen = set()

    raw_choices = getattr(widget, "choice_values", None)
    if callable(raw_choices):
        raw_choices = raw_choices()
    raw_choices = raw_choices or []
    for choice in raw_choices:
        item = _decode_pdf_token(str(choice))
        if item and item.lower() != "off" and item not in seen:
            seen.add(item)
            options.append(item)

    button_states = getattr(widget, "button_states", None)
    if callable(button_states):
        button_states = button_states()
    button_states = button_states or {}
    if not isinstance(button_states, dict):
        button_states = {}
    for state_values in button_states.values():
        for value in state_values or []:
            item = _decode_pdf_token(str(value))
            if item and item.lower() != "off" and item not in seen:
                seen.add(item)
                options.append(item)

    on_state = getattr(widget, "on_state", "")
    if callable(on_state):
        on_state = on_state()
    on_state = _decode_pdf_token(str(on_state or ""))
    if on_state and on_state.lower() != "off" and on_state not in seen:
        options.append(on_state)

    return options


def _normalize_field_meta_item(item: dict) -> dict:
    field_key = str(item.get("key", "")).strip()
    label = str(item.get("label", "")).strip() or _fallback_label_from_key(field_key)
    field_type = str(item.get("type", "Text")).strip() or "Text"
    options = []
    for option in item.get("options", []) if isinstance(item.get("options"), list) else []:
        clean = str(option).strip()
        if clean and clean not in options:
            options.append(clean)

    if field_type == "CheckBox" and not options:
        options = ["Yes", "No"]

    return {
        "key": field_key,
        "label": label,
        "type": field_type,
        "options": options,
    }


def _build_field_meta(schema: dict) -> dict[str, dict]:
    fields_meta: dict[str, dict] = {}
    interview_fields = schema.get("interview_fields", [])
    if isinstance(interview_fields, list):
        for item in interview_fields:
            if not isinstance(item, dict):
                continue
            normalized = _normalize_field_meta_item(item)
            key = normalized.get("key", "")
            if key and key not in fields_meta:
                fields_meta[key] = normalized

    if fields_meta:
        return fields_meta

    # Backward-compatible fallback for agents saved before interview_fields metadata existed.
    for raw in schema.get("widget_names", []) if isinstance(schema.get("widget_names"), list) else []:
        key = str(raw).strip()
        if key and key not in fields_meta:
            fields_meta[key] = {
                "key": key,
                "label": _fallback_label_from_key(key),
                "type": "Text",
                "options": [],
            }
    return fields_meta


def _build_field_meta_from_pdf(pdf_path: str) -> dict[str, dict]:
    fields_meta: dict[str, dict] = {}
    if not pdf_path or not os.path.exists(pdf_path):
        return fields_meta

    try:
        with fitz.open(pdf_path) as document:
            for page in document:
                for widget in page.widgets() or []:
                    key = str(getattr(widget, "field_name", "") or "").strip()
                    if not key:
                        continue

                    field_type = str(getattr(widget, "field_type_string", "Text") or "Text").strip() or "Text"
                    label = _clean_pdf_label(str(getattr(widget, "field_label", "") or ""), key)
                    options = _extract_widget_options(widget)

                    item = fields_meta.get(key)
                    if not item:
                        item = {
                            "key": key,
                            "label": label,
                            "type": field_type,
                            "options": [],
                        }
                        fields_meta[key] = item
                    elif not item.get("label") and label:
                        item["label"] = label

                    existing_options = set(item.get("options", []))
                    for option in options:
                        if option not in existing_options:
                            item["options"].append(option)
                            existing_options.add(option)

        for item in fields_meta.values():
            if item.get("type") == "CheckBox" and not item.get("options"):
                item["options"] = ["Yes", "No"]
    except Exception as exc:
        logger.warning("Could not rebuild interview field metadata from PDF: %s", exc)
        return {}

    return fields_meta


def _field_meta_for(session: InterviewSession, field_key: str) -> dict:
    fallback = {
        "key": field_key,
        "label": _fallback_label_from_key(field_key),
        "type": "Text",
        "options": [],
    }
    item = session.field_meta.get(field_key)
    if not isinstance(item, dict):
        return fallback
    merged = {**fallback, **item}
    if merged.get("type") == "CheckBox" and not merged.get("options"):
        merged["options"] = ["Yes", "No"]
    return merged


def _language_family(language_code: str) -> str:
    return str(language_code or "").split("-", 1)[0].lower()


def _copy_for_language(language_code: str) -> dict[str, str]:
    family = _language_family(language_code)
    return LANGUAGE_COPY.get(family, LANGUAGE_COPY["en"])


def _should_localize_labels(language_code: str) -> bool:
    return _language_family(language_code) != "en"


def _display_label(field_meta: dict, language_code: str = "en-US") -> str:
    if _should_localize_labels(language_code):
        localized = str(field_meta.get("localized_label", "")).strip()
        if localized:
            return localized
    return str(field_meta.get("label", "")).strip() or _fallback_label_from_key(str(field_meta.get("key", "")))


def _localize_field_labels_with_gemini(*, field_meta: dict[str, dict], language_code: str, language_label: str) -> dict[str, str]:
    if not field_meta or not _should_localize_labels(language_code):
        return {}

    payload_items = []
    for key, item in field_meta.items():
        label = str((item or {}).get("label", "")).strip() or _fallback_label_from_key(key)
        payload_items.append({"key": key, "label": label})

    if not payload_items:
        return {}

    prompt = f"""
You are translating PDF field labels for a voice form assistant.
Target language: "{language_label}" (BCP-47 "{language_code}").

Input labels (JSON):
{json.dumps(payload_items, ensure_ascii=False)}

Return STRICT JSON:
{{
  "translations": [
    {{"key": "string", "label": "string"}}
  ]
}}

Rules:
- Keep the same meaning as the source label.
- Keep labels short and natural for spoken prompts.
- Do not return empty labels.
- Preserve field order by key mapping.
""".strip()

    response = run_gemini_json(
        prompt=prompt,
        response_schema={
            "type": "object",
            "properties": {
                "translations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "key": {"type": "string"},
                            "label": {"type": "string"},
                        },
                        "required": ["key", "label"],
                    },
                }
            },
            "required": ["translations"],
        },
    )

    localized: dict[str, str] = {}
    for item in response.get("translations", []) if isinstance(response.get("translations"), list) else []:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key", "")).strip()
        label = str(item.get("label", "")).strip()
        if key in field_meta and label:
            localized[key] = label
    return localized


def _build_field_question(field_meta: dict, language_code: str = "en-US") -> str:
    label = _display_label(field_meta, language_code)
    field_type = str(field_meta.get("type", "Text")).strip()
    options = field_meta.get("options", []) if isinstance(field_meta.get("options"), list) else []
    copy = _copy_for_language(language_code)

    if field_type in {"ComboBox", "RadioButton"} and options:
        options_text = ", ".join(options)
        return copy["combo_question"].format(label=label, options=options_text)
    if field_type == "CheckBox":
        return copy["checkbox_question"].format(label=label)
    return copy["text_question"].format(label=label)


def _build_system_prompt(form_name: str, missing_fields: list[str], field_meta: dict[str, dict], language_code: str, language_label: str) -> str:
    ordered_fields = json.dumps(
        [
            {
                "key": key,
                "label": _display_label(field_meta.get(key) or {}, language_code),
                "english_label": (field_meta.get(key) or {}).get("label", _fallback_label_from_key(key)),
                "type": (field_meta.get(key) or {}).get("type", "Text"),
                "options": (field_meta.get(key) or {}).get("options", []),
            }
            for key in missing_fields
        ]
    )
    return (
        "You are a voice assistant helping the user fill a form.\n"
        f'Form title: "{form_name or "Untitled form"}"\n'
        f'Assistant response language: "{language_label}" (BCP-47 code "{language_code}").\n'
        f"Required fields in strict order: {ordered_fields}\n"
        "Rules:\n"
        "1) Ask for exactly one missing field at a time, in order.\n"
        "2) Use only user-facing labels from \"label\", never technical keys.\n"
        "3) For ComboBox/RadioButton fields, ask user to choose one valid option.\n"
        "4) For CheckBox fields, ask yes/no.\n"
        "5) If answer is adequate, acknowledge and move to the next field.\n"
        "6) If answer is unclear/incomplete, ask a concise clarification for that same field.\n"
        "7) If user interrupts, briefly acknowledge and steer back to current field.\n"
        "8) Never request fields outside the required list.\n"
        f'9) All spoken assistant responses must be in "{language_label}".\n'
        "10) normalized_value must be English for form filling (translate or transliterate when needed)."
    )


def _build_first_prompt(form_name: str, first_field_meta: dict, language_code: str = "en-US") -> str:
    copy = _copy_for_language(language_code)
    question = _build_field_question(first_field_meta, language_code)
    form_title = form_name or copy["this_form"]
    return copy["intro"].format(form_name=form_title, question=question)


def _build_next_field_prompt(next_field_meta: dict, language_code: str = "en-US") -> str:
    copy = _copy_for_language(language_code)
    return copy["next_prefix"] + _build_field_question(next_field_meta, language_code)


def _mentions_field_label(text: str, field_label: str) -> bool:
    normalized_text = _normalize_for_match(text)
    normalized_field = _normalize_for_match(field_label)
    if not normalized_text or not normalized_field:
        return False
    if normalized_field in normalized_text:
        return True
    field_tokens = [token for token in normalized_field.split() if len(token) > 2]
    if not field_tokens:
        return False
    overlap = sum(1 for token in field_tokens if token in normalized_text)
    return overlap >= max(2, min(3, len(field_tokens)))


def _ensure_next_question(*, assistant_response: str, next_field_meta: dict, language_code: str = "en-US") -> str:
    response = assistant_response.strip()
    next_prompt = _build_next_field_prompt(next_field_meta, language_code)
    next_label = _display_label(next_field_meta, language_code)
    if not response:
        return next_prompt
    if "?" in response or _mentions_field_label(response, next_label):
        return response
    clean = response.rstrip()
    if clean and clean[-1] not in ".!?":
        clean = f"{clean}."
    return f"{clean} {next_prompt}".strip()


def _coerce_checkbox_value(value: str) -> str:
    normalized = _normalize_for_match(value)
    yes_tokens = {
        "yes",
        "y",
        "true",
        "checked",
        "check",
        "on",
        "1",
        "selected",
        "x",
        "mark yes",
        "affirmative",
        "consent",
        "si",
        "sí",
        "oui",
        "ja",
        "sim",
        "hai",
        "はい",
        "예",
        "да",
        "shi",
        "是",
        "haan",
        "हाँ",
    }
    no_tokens = {
        "no",
        "n",
        "false",
        "unchecked",
        "uncheck",
        "off",
        "0",
        "mark no",
        "decline",
        "do not consent",
        "non",
        "nein",
        "nao",
        "não",
        "iie",
        "いいえ",
        "아니요",
        "нет",
        "bu",
        "不是",
        "nahin",
        "नहीं",
    }
    if normalized in yes_tokens:
        return "Yes"
    if normalized in no_tokens:
        return "No"
    if " not " in f" {normalized} " and "consent" in normalized:
        return "No"
    if "consent" in normalized:
        return "Yes"
    return ""


def _map_value_to_allowed_option(value: str, options: list[str]) -> str:
    if not options:
        return value.strip()
    raw = value.strip()
    if not raw:
        return ""
    if raw in options:
        return raw

    normalized_raw = _normalize_for_match(raw)
    normalized_options = {option: _normalize_for_match(option) for option in options}

    for option, normalized_option in normalized_options.items():
        if normalized_raw == normalized_option:
            return option

    for option, normalized_option in normalized_options.items():
        if normalized_raw and normalized_raw in normalized_option:
            return option
        if normalized_option and normalized_option in normalized_raw:
            return option

    return ""


def _coerce_value_for_field(field_meta: dict, value: str) -> str:
    field_type = str(field_meta.get("type", "Text"))
    options = field_meta.get("options", []) if isinstance(field_meta.get("options"), list) else []
    if field_type == "CheckBox":
        checkbox_value = _coerce_checkbox_value(value)
        if checkbox_value:
            if checkbox_value in options:
                return checkbox_value
            # Keep semantic yes/no even when PDF uses widget values like "On".
            return checkbox_value
        if not options:
            return ""
        mapped = _map_value_to_allowed_option(value, options)
        return mapped
    if field_type in {"ComboBox", "RadioButton"}:
        return _map_value_to_allowed_option(value, options)
    return value.strip()


def _checkbox_is_yes(value: str) -> bool:
    return _coerce_checkbox_value(value) == "Yes"


def _widget_on_state(widget) -> str:
    on_state = getattr(widget, "on_state", "")
    if callable(on_state):
        on_state = on_state()
    return str(on_state or "").strip()


def _assign_widget_value(widget, value: str) -> None:
    field_type = str(getattr(widget, "field_type_string", "") or "")
    text_value = str(value or "").strip()

    if field_type == "CheckBox":
        on_state = _widget_on_state(widget) or "Yes"
        normalized_text = _normalize_for_match(text_value)
        normalized_on_state = _normalize_for_match(on_state)
        mapped_option = _map_value_to_allowed_option(text_value, _extract_widget_options(widget))
        if (
            _checkbox_is_yes(text_value)
            or (normalized_on_state and normalized_text == normalized_on_state)
            or (_normalize_for_match(mapped_option) not in {"", "off"})
        ):
            widget.field_value = on_state
        else:
            widget.field_value = "Off"
    elif field_type == "RadioButton":
        options = _extract_widget_options(widget)
        mapped = _map_value_to_allowed_option(text_value, options)
        widget.field_value = mapped or text_value
    else:
        widget.field_value = text_value

    widget.update()


def _fill_pdf_with_answers(pdf_path: str, answers: dict[str, str]) -> bytes:
    with fitz.open(pdf_path) as doc:
        processed_radio_fields: set[str] = set()
        for page in doc:
            for widget in page.widgets() or []:
                field_key = str(getattr(widget, "field_name", "") or "").strip()
                if field_key and field_key in answers:
                    field_type = str(getattr(widget, "field_type_string", "") or "")
                    if field_type == "RadioButton":
                        if field_key in processed_radio_fields:
                            continue
                        processed_radio_fields.add(field_key)
                    _assign_widget_value(widget, str(answers[field_key]))
        # Ask viewers to respect updated appearance streams.
        try:
            doc.need_appearances(True)
        except Exception:
            pass
        return doc.write()


def _finalize_completed_interview(*, session: InterviewSession, agent: dict) -> dict:
    pdf_path = str(agent.get("pdf_path", "") or "").strip()
    if not pdf_path or not os.path.exists(pdf_path):
        raise RuntimeError("Original PDF file is missing for this agent.")

    filled_pdf_bytes = _fill_pdf_with_answers(pdf_path, session.answers)
    filled_pdf_path = COMPLETED_DIR / f"{session.session_id}_completed.pdf"
    filled_pdf_path.write_bytes(filled_pdf_bytes)

    save_completed_session(
        session_id=session.session_id,
        agent_id=session.agent_id,
        answers=session.answers,
        filled_pdf_path=str(filled_pdf_path),
        language_code=session.language_code,     
        language_label=session.language_label, 
    )

    session_id = session.session_id
    return {
        "download_url": f"/api/admin/dashboard/sessions/{session_id}/download",
        "pdf_preview_url": f"/api/admin/dashboard/sessions/{session_id}/pdf",
    }


# Add these helper functions after line 220 (_build_field_meta):

def _group_related_fields(field_meta: dict[str, dict]) -> dict[str, list[str]]:
    """Group fields by base name (removes [0], [1] indices)"""
    field_groups = {}
    for field_key in field_meta.keys():
        base_name = re.sub(r'\[\d+\]$', '', field_key)
        if base_name not in field_groups:
            field_groups[base_name] = []
        field_groups[base_name].append(field_key)
    return field_groups


def _build_grouped_field_question(base_name: str, fields: list[str], field_meta: dict[str, dict], language_code: str = "en-US") -> str:
    """Build question for a group of related fields"""
    if len(fields) == 1:
        # Single field, use regular question
        return _build_field_question(field_meta[fields[0]], language_code)
    
    # Multiple fields - checkbox group
    first_field_meta = field_meta[fields[0]]
    label = _display_label(first_field_meta, language_code)
    options = [f.split('.')[-1] for f in fields]
    copy = _copy_for_language(language_code)
    
    # Build multi-select question
    options_text = ", ".join(options)
    return f'For "{label}", which of these apply? Options: {options_text}. Select all that apply.'


# Replace _evaluate_turn_with_gemini function (line 733) with this:

def _evaluate_turn_with_gemini(
    *,
    form_name: str,
    current_field: str,
    current_field_meta: dict,
    related_fields: list[str],  # NEW: all fields in this group
    next_field_meta: dict | None,
    user_input: str,
    missing_fields: list[dict],
    answers: dict[str, str],
    was_interruption: bool,
    language_code: str,
    language_label: str,
) -> dict:
    current_label = _display_label(current_field_meta, language_code)
    current_type = str(current_field_meta.get("type", "Text")).strip() or "Text"
    current_options = current_field_meta.get("options", []) if isinstance(current_field_meta.get("options"), list) else []
    
    # NEW: Handle grouped fields
    is_grouped = len(related_fields) > 1
    if is_grouped:
        current_options = [f.split('.')[-1] for f in related_fields]
    
    next_label = ""
    next_type = ""
    next_options: list[str] = []
    if isinstance(next_field_meta, dict):
        next_label = _display_label(next_field_meta, language_code)
        next_type = str(next_field_meta.get("type", "")).strip()
        next_options = next_field_meta.get("options", []) if isinstance(next_field_meta.get("options"), list) else []

    prompt = f"""
You are validating one turn in a voice form interview.
Form title: "{form_name or "Untitled form"}"
Required assistant response language: "{language_label}" (BCP-47 code "{language_code}")

Current field technical key (internal only): "{current_field}"
Current field label (speak this): "{current_label}"
Current field type: "{current_type}"
{'This is a multi-select field group.' if is_grouped else ''}
Current field allowed options (if any): {json.dumps(current_options)}
Next field label (if current is accepted): "{next_label}"
Next field type (if current is accepted): "{next_type}"
Next field allowed options (if any): {json.dumps(next_options)}
Remaining fields in order: {json.dumps(missing_fields)}
Already collected answers: {json.dumps(answers)}
User transcript: "{user_input}"
Interruption while assistant was speaking: {str(was_interruption).lower()}

Return STRICT JSON:
{{
  "intent": "data|clarification|acknowledgment|barge_in",
  "is_answer_adequate": true/false,
  "normalized_value": "string (empty if inadequate)",
  "collected_values": ["array of selected options for multi-select"],
  "assistant_response": "short spoken response"
}}

Rules:
- For multi-select fields, return ALL selected options in collected_values array
- Example: User says "A and C" → collected_values: ["A", "C"]
- Mark as adequate ONLY when user clearly provided the value for the current field label.
- Never speak or repeat the technical key; always use the label.
- normalized_value is what will be written into the PDF and it must be English.
- If user speaks a non-English value, translate to natural English when possible.
- For names/addresses/proper nouns in non-Latin scripts, transliterate to Latin characters.
- For ComboBox/RadioButton fields with options, normalized_value must be one of the allowed options exactly.
- For CheckBox fields, normalized_value must be "Yes" or "No" unless a different allowed option is listed.
- If unclear, off-topic, partial, or ambiguous, mark inadequate and ask clarification.
- If interruption/side question, use intent "barge_in", acknowledge briefly, then return to current field.
- If answer is adequate:
  - assistant_response must confirm the captured value for the CURRENT field label.
  - if Next field label is non-empty, assistant_response must also ask that next field in the same response.
  - if next field type is ComboBox/RadioButton and options exist, assistant_response must list those options in the question.
  - the next question must always be a complete natural sentence, never a fragment.
  - never output one-word or two-word prompts, and never output just the field name or "X?".
  - bad examples: "Dropdown2?", "Name?", "Province?".
  - good example: "Thank you. Next, which province or territory should I enter for this form?"
- Never ask for multiple fields at once.
- Never invent field names.
- assistant_response must be entirely in "{language_label}".
""".strip()

    response = run_gemini_json(
        prompt=prompt,
        response_schema={
            "type": "object",
            "properties": {
                "intent": {"type": "string", "enum": ["data", "clarification", "acknowledgment", "barge_in"]},
                "is_answer_adequate": {"type": "boolean"},
                "normalized_value": {"type": "string"},
                "collected_values": {"type": "array", "items": {"type": "string"}},
                "assistant_response": {"type": "string"},
            },
            "required": ["intent", "is_answer_adequate", "normalized_value", "assistant_response"],
        },
    )
    
    # NEW: Store collected_values for grouped fields
    if is_grouped and response.get("collected_values"):
        response["related_fields"] = related_fields
    
    return response


# Update _evaluate_and_update_session function (line 873) to handle grouped fields:

def _evaluate_and_update_session(
    *,
    agent_id: str,
    session: InterviewSession,
    user_input: str,
    was_interruption: bool,
) -> dict:
    copy = _copy_for_language(session.language_code)

    if session.completed:
        return {
            "session_id": session.session_id,
            "completed": True,
            "current_field": None,
            "missing_fields": [],
            "answers": session.answers,
            "language_code": session.language_code,
            "language_label": session.language_label,
            "intent": "acknowledgment",
            "is_answer_adequate": True,
            "assistant_response": copy["completed_ready"],
        }

    current_field = session.current_field
    if not current_field:
        raise RuntimeError("No active field in session.")
    
    current_field_meta = _field_meta_for(session, current_field)
    current_label = _display_label(current_field_meta, session.language_code)
    
    # NEW: Get field groups and find related fields
    field_groups = _group_related_fields(session.field_meta)
    base_name = re.sub(r'\[\d+\]$', '', current_field)
    related_fields = field_groups.get(base_name, [current_field])
    
    next_field_meta = None
    if len(session.missing_fields) > len(related_fields):
        next_field_key = session.missing_fields[len(related_fields)]
        next_field_meta = _field_meta_for(session, next_field_key)

    logger.info(
        "Interview turn received agent_id=%s session_id=%s current_field=%s related_fields=%s interruption=%s user_input=%s",
        agent_id,
        session.session_id,
        current_field,
        related_fields,
        was_interruption,
        user_input[:240],
    )

    evaluation = _evaluate_turn_with_gemini(
        form_name=session.form_name,
        current_field=current_field,
        current_field_meta=current_field_meta,
        related_fields=related_fields,  # NEW
        next_field_meta=next_field_meta,
        user_input=user_input,
        missing_fields=[
            {
                "key": key,
                "label": _display_label(_field_meta_for(session, key), session.language_code),
                "type": _field_meta_for(session, key).get("type", "Text"),
                "options": _field_meta_for(session, key).get("options", []),
            }
            for key in session.missing_fields
        ],
        answers=session.answers,
        was_interruption=was_interruption,
        language_code=session.language_code,
        language_label=session.language_label,
    )

    intent = str(evaluation.get("intent", "clarification"))
    is_answer_adequate = bool(evaluation.get("is_answer_adequate", False))
    raw_normalized_value = str(evaluation.get("normalized_value", "")).strip()
    collected_values = evaluation.get("collected_values", [])
    assistant_response = str(evaluation.get("assistant_response", "")).strip()

    # NEW: Handle grouped field answers
    if is_answer_adequate and collected_values and len(related_fields) > 1:
        # Map collected values to related fields
        for i, field_key in enumerate(related_fields):
            if i < len(collected_values):
                session.answers[field_key] = collected_values[i]
            else:
                session.answers[field_key] = ""
        session.missing_fields = session.missing_fields[len(related_fields):]
        session.updated_at = datetime.now(timezone.utc).isoformat()
    elif is_answer_adequate and raw_normalized_value:
        normalized_value = _coerce_value_for_field(current_field_meta, raw_normalized_value)
        if normalized_value:
            session.answers[current_field] = normalized_value
            session.missing_fields = session.missing_fields[1:]
            session.updated_at = datetime.now(timezone.utc).isoformat()
        else:
            is_answer_adequate = False

    if is_answer_adequate:
        if session.completed:
            if not assistant_response:
                assistant_response = copy["completed_generating"]
        else:
            next_field = session.current_field or "the next field"
            next_field_meta = _field_meta_for(session, next_field)
            assistant_response = assistant_response or _build_next_field_prompt(next_field_meta, session.language_code)
    else:
        session.updated_at = datetime.now(timezone.utc).isoformat()
        if not assistant_response:
            if intent == "barge_in":
                assistant_response = f'{copy["barge_in_prefix"]}{_build_field_question(current_field_meta, session.language_code)}'
            else:
                assistant_response = copy["still_need"].format(
                    label=current_label,
                    question=_build_field_question(current_field_meta, session.language_code),
                )

    logger.info(
        "Interview turn evaluated agent_id=%s session_id=%s intent=%s adequate=%s completed=%s next_field=%s",
        agent_id,
        session.session_id,
        intent,
        is_answer_adequate,
        session.completed,
        session.current_field,
    )

    return {
        "session_id": session.session_id,
        "completed": session.completed,
        "current_field": session.current_field,
        "missing_fields": session.missing_fields,
        "answers": session.answers,
        "language_code": session.language_code,
        "language_label": session.language_label,
        "intent": intent,
        "is_answer_adequate": is_answer_adequate,
        "assistant_response": assistant_response,
    }


def _attach_completion_artifacts(*, session: InterviewSession, result: dict) -> dict:
    if not result.get("completed"):
        return result

    agent = get_agent(session.agent_id)
    if not agent:
        logger.warning("Could not finalize completed session %s because agent was not found.", session.session_id)
        return result

    try:
        artifacts = _finalize_completed_interview(session=session, agent=agent)
        result.update(artifacts)
    except Exception as exc:
        logger.exception("Failed to finalize completed interview session %s: %s", session.session_id, exc)
    return result


def _synthesize_with_elevenlabs(text: str) -> tuple[bytes, str]:
    api_key = os.getenv("ELEVENLABS_API_KEY", "").strip()
    voice_id = os.getenv("ELEVENLABS_VOICE_ID", "").strip()
    tts_model = os.getenv("ELEVENLABS_TTS_MODEL", "eleven_flash_v2_5").strip()

    if not api_key:
        raise RuntimeError("Missing ELEVENLABS_API_KEY.")
    if not voice_id:
        raise RuntimeError("Missing ELEVENLABS_VOICE_ID.")

    response = requests.post(
        f"{ELEVENLABS_API_BASE}/text-to-speech/{voice_id}",
        headers={
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
        json={
            "text": text,
            "model_id": tts_model,
        },
        timeout=25,
    )

    if not response.ok:
        logger.error("ElevenLabs TTS failed status=%s body=%s", response.status_code, response.text[:400])
        raise RuntimeError("ElevenLabs TTS request failed.")

    return response.content, "audio/mpeg"


def _transcribe_with_elevenlabs(*, audio_bytes: bytes, filename: str, content_type: str, language_code: str = "") -> str:
    api_key = os.getenv("ELEVENLABS_API_KEY", "").strip()
    stt_model = os.getenv("ELEVENLABS_STT_MODEL", "scribe_v1").strip()
    fallback_language_code = os.getenv("ELEVENLABS_STT_LANGUAGE", "").strip()
    selected_language_code = _to_stt_language_code(language_code) or fallback_language_code

    if not api_key:
        raise RuntimeError("Missing ELEVENLABS_API_KEY.")

    data: dict[str, str] = {"model_id": stt_model}
    if selected_language_code:
        data["language_code"] = selected_language_code

    response = requests.post(
        f"{ELEVENLABS_API_BASE}/speech-to-text",
        headers={"xi-api-key": api_key},
        files={"file": (filename, audio_bytes, content_type)},
        data=data,
        timeout=40,
    )

    if not response.ok:
        logger.error("ElevenLabs STT failed status=%s body=%s", response.status_code, response.text[:400])
        raise RuntimeError("ElevenLabs STT request failed.")

    payload = response.json()
    transcript = str(payload.get("text") or payload.get("transcript") or "").strip()
    return transcript


@interview_bp.post("/agent/<agent_id>/interview/start")
def start_interview(agent_id: str) -> tuple:
    agent = get_agent(agent_id)
    if not agent:
        return jsonify({"error": "Agent not found."}), 404

    schema = agent.get("schema", {}) if isinstance(agent.get("schema"), dict) else {}
    has_interview_fields = isinstance(schema.get("interview_fields"), list) and bool(schema.get("interview_fields"))
    field_meta = _build_field_meta(schema)
    if not has_interview_fields:
        rebuilt_meta = _build_field_meta_from_pdf(str(agent.get("pdf_path", "") or ""))
        if rebuilt_meta:
            field_meta = rebuilt_meta
    if not field_meta:
        return jsonify({"error": "Agent has no fields to interview."}), 400

    normalized_fields = [key for key in field_meta.keys() if str(key).strip()]
    form_name = str(agent.get("agent_name", "")).strip() or "this form"

    data = request.get_json(silent=True) if request.is_json else None
    if data is None:
        data = {}
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid JSON body"}), 400

    selected_language_code, selected_language_label = _resolve_language_selection(str(data.get("language_code", "")).strip())

    session_id = uuid.uuid4().hex[:12]
    session = InterviewSession(
        session_id=session_id,
        agent_id=agent_id,
        missing_fields=normalized_fields,
        form_name=form_name,
        field_meta=field_meta,
        language_code=selected_language_code,
        language_label=selected_language_label,
    )
    session.created_at = datetime.now(timezone.utc).isoformat()
    SESSIONS[session_id] = session
    save_session_start(session_id, agent_id, session.created_at)

    if ENABLE_LABEL_LOCALIZATION and _should_localize_labels(session.language_code):
        try:
            localized_labels = _localize_field_labels_with_gemini(
                field_meta=session.field_meta,
                language_code=session.language_code,
                language_label=session.language_label,
            )
            for key, localized_label in localized_labels.items():
                entry = session.field_meta.get(key)
                if isinstance(entry, dict) and localized_label:
                    entry["localized_label"] = localized_label
        except Exception as exc:
            logger.warning(
                "Could not localize field labels for session %s language=%s: %s",
                session_id,
                session.language_code,
                exc,
            )

    SESSIONS[session_id] = session

    first_field = session.current_field or "the first field"
    first_field_meta = _field_meta_for(session, first_field)
    return (
        jsonify(
            {
                "session_id": session.session_id,
                "agent_id": agent_id,
                "current_field": session.current_field,
                "missing_fields": session.missing_fields,
                "answers": session.answers,
                "completed": session.completed,
                "language_code": session.language_code,
                "language_label": session.language_label,
                "system_prompt": _build_system_prompt(
                    session.form_name, session.missing_fields, session.field_meta, session.language_code, session.language_label
                ),
                "first_prompt": _build_first_prompt(session.form_name, first_field_meta, session.language_code),
            }
        ),
        200,
    )


# Add this function after _finalize_completed_interview (around line 700):

def _require_session(agent_id: str, session_id: str) -> InterviewSession | tuple:
    """Validate and return session, or return error tuple"""
    if not session_id:
        return jsonify({"error": "Missing session_id"}), 400
    
    session = SESSIONS.get(session_id)
    if not session:
        return jsonify({"error": "Session not found or expired"}), 404
    
    if session.agent_id != agent_id:
        return jsonify({"error": "Session does not belong to this agent"}), 403
    
    return session

@interview_bp.post("/agent/<agent_id>/interview/turn")
def process_interview_turn(agent_id: str) -> tuple:
    try:
        data = request.get_json(silent=True)
        if data is None or not isinstance(data, dict):
            return jsonify({"error": "Invalid or missing JSON body"}), 400

        session_id = str(data.get("session_id", "")).strip()
        user_input = str(data.get("user_input", "")).strip()
        was_interruption = bool(data.get("was_interruption", False))

        if not session_id or not user_input:
            return jsonify({"error": "Missing session_id or user_input"}), 400

        session_or_error = _require_session(agent_id, session_id)
        if isinstance(session_or_error, tuple):
            return session_or_error
        session = session_or_error

        result = _evaluate_and_update_session(
            agent_id=agent_id,
            session=session,
            user_input=user_input,
            was_interruption=was_interruption,
        )
        result = _attach_completion_artifacts(session=session, result=result)
        return (
            jsonify(result),
            200,
        )
    except GeminiAuthError as exc:
        logger.warning("Interview turn blocked by Gemini auth issue: %s", exc)
        return jsonify({"error": str(exc), "code": "GEMINI_AUTH"}), 502
    except GeminiRateLimitError as exc:
        logger.warning("Interview turn blocked by Gemini rate limit: %s", exc)
        return jsonify({"error": str(exc), "code": "GEMINI_RATE_LIMIT"}), 429
    except GeminiRequestError as exc:
        logger.warning("Interview turn failed due to Gemini request issue: %s", exc)
        return jsonify({"error": str(exc), "code": "GEMINI_REQUEST"}), 502
    except Exception as exc:
        logger.exception("Interview turn processing failed: %s", exc)
        return jsonify({"error": "Failed to process interview turn."}), 500


@interview_bp.post("/agent/<agent_id>/interview/speak")
def speak_text(agent_id: str) -> tuple:
    try:
        data = request.get_json(silent=True)
        if data is None or not isinstance(data, dict):
            return jsonify({"error": "Invalid or missing JSON body"}), 400

        text = str(data.get("text", "")).strip()
        if not text:
            return jsonify({"error": "Missing text"}), 400

        if not get_agent(agent_id):
            return jsonify({"error": "Agent not found."}), 404

        audio_bytes, audio_mime = _synthesize_with_elevenlabs(text)
        return (
            jsonify(
                {
                    "audio_mime_type": audio_mime,
                    "audio_base64": base64.b64encode(audio_bytes).decode("ascii"),
                }
            ),
            200,
        )
    except Exception as exc:
        logger.exception("Interview speak failed: %s", exc)
        return jsonify({"error": "Failed to synthesize assistant speech.", "code": "ELEVENLABS_TTS"}), 502


@interview_bp.post("/agent/<agent_id>/interview/turn-audio")
def process_interview_turn_audio(agent_id: str) -> tuple:
    try:
        session_id = str(request.form.get("session_id", "")).strip()
        was_interruption = str(request.form.get("was_interruption", "false")).strip().lower() == "true"
        audio_file = request.files.get("audio")

        if not session_id:
            return jsonify({"error": "Missing session_id"}), 400
        if not audio_file:
            return jsonify({"error": "Missing audio file"}), 400

        session_or_error = _require_session(agent_id, session_id)
        if isinstance(session_or_error, tuple):
            return session_or_error
        session = session_or_error

        audio_bytes = audio_file.read()
        if not audio_bytes:
            return jsonify({"error": "Uploaded audio is empty"}), 400

        transcript = _transcribe_with_elevenlabs(
            audio_bytes=audio_bytes,
            filename=audio_file.filename or "turn_audio.webm",
            content_type=audio_file.mimetype or "audio/webm",
            language_code=session.language_code,
        )
        if not transcript:
            return jsonify({"error": "No speech detected in audio. Please try again."}), 400

        result = _evaluate_and_update_session(
            agent_id=agent_id,
            session=session,
            user_input=transcript,
            was_interruption=was_interruption,
        )
        result = _attach_completion_artifacts(session=session, result=result)

        assistant_response = str(result.get("assistant_response", "")).strip()
        audio_mime_type = ""
        audio_base64 = ""
        if assistant_response:
            tts_audio, audio_mime_type = _synthesize_with_elevenlabs(assistant_response)
            audio_base64 = base64.b64encode(tts_audio).decode("ascii")

        result["user_transcript"] = transcript
        result["audio_mime_type"] = audio_mime_type
        result["audio_base64"] = audio_base64
        result["language_code"] = session.language_code
        result["language_label"] = session.language_label
        return jsonify(result), 200
    except GeminiAuthError as exc:
        logger.warning("Interview audio turn blocked by Gemini auth issue: %s", exc)
        return jsonify({"error": str(exc), "code": "GEMINI_AUTH"}), 502
    except GeminiRateLimitError as exc:
        logger.warning("Interview audio turn blocked by Gemini rate limit: %s", exc)
        return jsonify({"error": str(exc), "code": "GEMINI_RATE_LIMIT"}), 429
    except GeminiRequestError as exc:
        logger.warning("Interview audio turn failed due to Gemini request issue: %s", exc)
        return jsonify({"error": str(exc), "code": "GEMINI_REQUEST"}), 502
    except Exception as exc:
        logger.exception("Interview audio turn processing failed: %s", exc)
        return jsonify({"error": "Failed to process interview audio turn.", "code": "ELEVENLABS_OR_PIPELINE"}), 502
