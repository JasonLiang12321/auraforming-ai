export const SUPPORTED_LANGUAGES = [
  { code: 'en-US', label: '🇺🇸 English (US)' },
  { code: 'en-GB', label: '🇬🇧 English (UK)' },
  { code: 'es-ES', label: '🇪🇸 Español (España)' },
  { code: 'es-MX', label: '🇲🇽 Español (México)' },
  { code: 'fr-FR', label: '🇫🇷 Français' },
  { code: 'de-DE', label: '🇩🇪 Deutsch' },
  { code: 'it-IT', label: '🇮🇹 Italiano' },
  { code: 'pt-BR', label: '🇧🇷 Português (Brasil)' },
  { code: 'ja-JP', label: '🇯🇵 日本語' },
  { code: 'ko-KR', label: '🇰🇷 한국어' },
  { code: 'ru-RU', label: '🇷🇺 Русский' },
  { code: 'zh-CN', label: '🇨🇳 中文（简体）' },
  { code: 'hi-IN', label: '🇮🇳 हिन्दी' },
]

export const DEFAULT_LANGUAGE = 'en-US'

export function languageFamily(languageCode) {
  return String(languageCode || '').split('-', 1)[0].toLowerCase()
}

export function normalizeLanguageCode(languageCode) {
  const normalized = String(languageCode || '').trim()
  if (!normalized) return DEFAULT_LANGUAGE
  if (SUPPORTED_LANGUAGES.some((item) => item.code === normalized)) {
    return normalized
  }

  const family = languageFamily(normalized)
  const familyMatch = SUPPORTED_LANGUAGES.find((item) => languageFamily(item.code) === family)
  return familyMatch?.code || DEFAULT_LANGUAGE
}

export function languageLabel(languageCode) {
  const normalized = normalizeLanguageCode(languageCode)
  return SUPPORTED_LANGUAGES.find((item) => item.code === normalized)?.label || SUPPORTED_LANGUAGES[0].label
}
