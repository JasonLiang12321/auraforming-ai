import { useEffect, useMemo, useRef, useState } from 'react'

function parseLanguageLabel(label) {
  const value = String(label || '').trim()
  if (!value) {
    return { flag: '🌐', name: '' }
  }

  const [firstToken, ...rest] = value.split(' ')
  if (!rest.length) {
    return { flag: '🌐', name: value }
  }

  return { flag: firstToken, name: rest.join(' ').trim() }
}

export default function LanguagePicker({ className = '', ariaLabel, uiLanguage, setUiLanguage, supportedLanguages }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  const activeLanguage = useMemo(
    () => supportedLanguages.find((language) => language.code === uiLanguage) || supportedLanguages[0],
    [supportedLanguages, uiLanguage],
  )
  const active = useMemo(() => parseLanguageLabel(activeLanguage?.label), [activeLanguage])

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  return (
    <div ref={rootRef} className={`${className} languagePicker${open ? ' open' : ''}`.trim()}>
      <button type="button" className="languagePickerButton" aria-label={ariaLabel} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span className="languagePickerFlag" aria-hidden="true">
          {active.flag}
        </span>
      </button>
      <div className={open ? 'languagePickerMenu open' : 'languagePickerMenu'} role="menu" aria-label={ariaLabel}>
        {supportedLanguages.map((language) => {
          const parsed = parseLanguageLabel(language.label)
          const isActive = language.code === uiLanguage
          return (
            <button
              key={language.code}
              type="button"
              role="menuitemradio"
              aria-checked={isActive}
              className={isActive ? 'languagePickerItem active' : 'languagePickerItem'}
              onClick={() => {
                setUiLanguage(language.code)
                setOpen(false)
              }}
            >
              <span className="languagePickerItemFlag" aria-hidden="true">
                {parsed.flag}
              </span>
              <span className="languagePickerItemName">{parsed.name || language.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
