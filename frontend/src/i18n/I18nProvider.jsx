import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { translateUiMessages } from '../services/api'
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, languageFamily, normalizeLanguageCode } from './languages'
import { UI_MESSAGES } from './messages'

const STORAGE_KEY = 'auraforming_ui_language'
const UI_DYNAMIC_CACHE_VERSION = 'v2'
const UI_DYNAMIC_CACHE_PREFIX = `auraforming_ui_language_dynamic_${UI_DYNAMIC_CACHE_VERSION}_`
const UI_DYNAMIC_CACHE_LEGACY_PREFIXES = ['auraforming_ui_language_dynamic_']

function interpolate(template, params = {}) {
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => String(params[key] ?? ''))
}

function isLikelyTranslated(sourceText, targetText) {
  const source = String(sourceText || '').trim()
  const target = String(targetText || '').trim()
  if (!target) return false
  if (source !== target) return true
  if (!/[A-Za-z]/.test(source)) return true
  if (source.length <= 5) return true
  return false
}

function shallowEqualMessages(a = {}, b = {}) {
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  return keysA.every((key) => a[key] === b[key])
}

function readCachedMessagesByFamily(family) {
  const keysToTry = [`${UI_DYNAMIC_CACHE_PREFIX}${family}`, ...UI_DYNAMIC_CACHE_LEGACY_PREFIXES.map((prefix) => `${prefix}${family}`)]
  for (const storageKey of keysToTry) {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        return parsed
      }
    } catch {
      // ignore parse failure and continue
    }
  }
  return null
}

function buildTranslator(languageCode, runtimeMessages) {
  const normalized = normalizeLanguageCode(languageCode)
  const family = languageFamily(normalized)
  const familyMessages = UI_MESSAGES[family] || {}
  const dynamicFamilyMessages = runtimeMessages?.[family] || {}
  const englishMessages = UI_MESSAGES.en || {}

  return (key, params = {}) => {
    const template = dynamicFamilyMessages[key] || familyMessages[key] || englishMessages[key] || key
    return interpolate(template, params)
  }
}

const I18nContext = createContext({
  uiLanguage: DEFAULT_LANGUAGE,
  setUiLanguage: () => {},
  t: (key) => key,
  formatDateTime: (value) => new Date(value).toLocaleString(),
  supportedLanguages: SUPPORTED_LANGUAGES,
})

export function I18nProvider({ children }) {
  const englishMessages = UI_MESSAGES.en || {}
  const [uiLanguage, setUiLanguageState] = useState(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved) return normalizeLanguageCode(saved)

    const browser = navigator.language || navigator.languages?.[0] || DEFAULT_LANGUAGE
    return normalizeLanguageCode(browser)
  })
  const [runtimeMessages, setRuntimeMessages] = useState({})

  const setUiLanguage = (nextLanguage) => {
    const normalized = normalizeLanguageCode(nextLanguage)
    setUiLanguageState(normalized)
    window.localStorage.setItem(STORAGE_KEY, normalized)
  }

  useEffect(() => {
    const family = languageFamily(uiLanguage)
    if (!family || family === 'en') return

    const baseFamilyMessages = UI_MESSAGES[family] || {}
    const missingEntries = Object.fromEntries(
      Object.entries(englishMessages).filter(([key]) => !baseFamilyMessages[key]),
    )
    const missingKeys = Object.keys(missingEntries)
    if (!missingKeys.length) return

    const currentRuntime = runtimeMessages?.[family] || {}
    const hasAllRuntimeKeys = missingKeys.every((key) =>
      isLikelyTranslated(englishMessages[key], currentRuntime[key]),
    )
    if (hasAllRuntimeKeys) return

    const cacheKey = `${UI_DYNAMIC_CACHE_PREFIX}${family}`
    const cached = readCachedMessagesByFamily(family)
    if (cached) {
      setRuntimeMessages((prev) => {
        const prevFamily = prev?.[family] || {}
        if (shallowEqualMessages(prevFamily, cached)) return prev
        return { ...prev, [family]: cached }
      })

      const cachedHasAll = missingKeys.every((key) =>
        isLikelyTranslated(englishMessages[key], cached[key]),
      )
      if (cachedHasAll) return
    }

    let cancelled = false
    const loadMissingTranslations = async () => {
      try {
        const payload = await translateUiMessages(uiLanguage, missingEntries)
        const messages = payload?.messages
        if (cancelled || !messages || typeof messages !== 'object') return
        setRuntimeMessages((prev) => {
          const prevFamily = prev?.[family] || {}
          if (shallowEqualMessages(prevFamily, messages)) return prev
          return { ...prev, [family]: messages }
        })
        window.localStorage.setItem(cacheKey, JSON.stringify(messages))
      } catch {
        // keep static fallback behavior
      }
    }

    void loadMissingTranslations()
    return () => {
      cancelled = true
    }
  }, [englishMessages, runtimeMessages, uiLanguage])

  const t = useMemo(() => buildTranslator(uiLanguage, runtimeMessages), [runtimeMessages, uiLanguage])

  const formatDateTime = (value) => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return String(value || '')
    try {
      return new Intl.DateTimeFormat(uiLanguage, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date)
    } catch {
      return date.toLocaleString()
    }
  }

  useEffect(() => {
    const html = document.documentElement
    html.lang = normalizeLanguageCode(uiLanguage)
    html.setAttribute('translate', 'yes')
  }, [uiLanguage])

  const value = useMemo(
    () => ({
      uiLanguage,
      setUiLanguage,
      t,
      formatDateTime,
      supportedLanguages: SUPPORTED_LANGUAGES,
    }),
    [t, uiLanguage],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return useContext(I18nContext)
}
