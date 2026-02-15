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
  if (/^(pdf|json|api|gemini|auraforming|elevenlabs)$/i.test(source)) return true
  return false
}

function shallowEqualMessages(a = {}, b = {}) {
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  return keysA.every((key) => a[key] === b[key])
}

function mergeTranslatedMessages({ englishMessages = {}, previousMessages = {}, incomingMessages = {} }) {
  const merged = { ...previousMessages }
  for (const [key, nextValueRaw] of Object.entries(incomingMessages || {})) {
    const nextValue = String(nextValueRaw || '')
    if (!nextValue) continue

    const sourceValue = String(englishMessages[key] || '')
    const previousValue = String(previousMessages[key] || '')
    const nextLooksTranslated = isLikelyTranslated(sourceValue, nextValue)
    const previousLooksTranslated = isLikelyTranslated(sourceValue, previousValue)

    // Never overwrite a good translation with an English echo from a weaker pass.
    if (nextLooksTranslated || !previousLooksTranslated) {
      merged[key] = nextValue
    }
  }
  return merged
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
    const sourceTemplate = String(englishMessages[key] || '')
    const dynamicTemplate = String(dynamicFamilyMessages[key] || '')
    const staticTemplate = String(familyMessages[key] || '')
    const useDynamic = dynamicTemplate && isLikelyTranslated(sourceTemplate, dynamicTemplate)
    const template = (useDynamic ? dynamicTemplate : '') || staticTemplate || dynamicTemplate || sourceTemplate || key
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
    const currentRuntime = runtimeMessages?.[family] || {}
    const needsTranslationEntries = Object.fromEntries(
      Object.entries(englishMessages).filter(([key, sourceText]) => {
        const staticText = baseFamilyMessages[key]
        return !isLikelyTranslated(sourceText, staticText)
      }),
    )
    const allCandidateKeys = Object.keys(needsTranslationEntries)
    if (!allCandidateKeys.length) return

    const cacheKey = `${UI_DYNAMIC_CACHE_PREFIX}${family}`
    const cached = readCachedMessagesByFamily(family)
    let resolvedRuntime = currentRuntime
    if (cached) {
      resolvedRuntime = mergeTranslatedMessages({
        englishMessages,
        previousMessages: currentRuntime,
        incomingMessages: cached,
      })
      setRuntimeMessages((prev) => {
        const prevFamily = prev?.[family] || {}
        const merged = mergeTranslatedMessages({
          englishMessages,
          previousMessages: prevFamily,
          incomingMessages: cached,
        })
        if (shallowEqualMessages(prevFamily, merged)) return prev
        return { ...prev, [family]: merged }
      })
    }

    const unresolvedEntries = Object.fromEntries(
      Object.entries(needsTranslationEntries).filter(([key, sourceText]) =>
        !isLikelyTranslated(sourceText, resolvedRuntime[key]),
      ),
    )
    if (!Object.keys(unresolvedEntries).length) return

    let cancelled = false
    const loadMissingTranslations = async () => {
      try {
        const payload = await translateUiMessages(uiLanguage, unresolvedEntries)
        const messages = payload?.messages
        if (cancelled || !messages || typeof messages !== 'object') return
        let nextFamilyMessages = null
        setRuntimeMessages((prev) => {
          const prevFamily = prev?.[family] || {}
          const merged = mergeTranslatedMessages({
            englishMessages,
            previousMessages: prevFamily,
            incomingMessages: messages,
          })
          if (shallowEqualMessages(prevFamily, merged)) return prev
          nextFamilyMessages = merged
          return { ...prev, [family]: merged }
        })
        if (nextFamilyMessages) {
          window.localStorage.setItem(cacheKey, JSON.stringify(nextFamilyMessages))
        }
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
