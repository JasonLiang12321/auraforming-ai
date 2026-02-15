import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getAgentById } from '../services/api'
import { useI18n } from '../i18n/I18nProvider'

function BusinessIcon() {
  return (
    <svg viewBox="0 0 64 64" className="gatewayIcon" aria-hidden="true">
      <rect x="11" y="18" width="42" height="30" rx="6" />
      <path d="M20 30h24M20 38h18" />
      <path d="M24 18v-4h16v4" />
    </svg>
  )
}

function ClientIcon() {
  return (
    <svg viewBox="0 0 64 64" className="gatewayIcon" aria-hidden="true">
      <path d="M12 20c0-5.5 4.5-10 10-10h20c5.5 0 10 4.5 10 10v12c0 5.5-4.5 10-10 10H29l-11 8 2-8h-8z" />
      <circle cx="24" cy="26" r="2.2" />
      <circle cx="32" cy="26" r="2.2" />
      <circle cx="40" cy="26" r="2.2" />
    </svg>
  )
}

function renderWordmarkLetters(text, startIndex = 0) {
  return Array.from(text).map((char, index) => (
    <span key={`${text}-${index}`} className="wordmarkLetter" style={{ '--letter-index': startIndex + index }}>
      {char}
    </span>
  ))
}

export default function LandingPage() {
  const { t, uiLanguage, setUiLanguage, supportedLanguages } = useI18n()
  const navigate = useNavigate()
  const CODE_LENGTH = 8
  const [stage, setStage] = useState('hero')
  const [introPhase, setIntroPhase] = useState('intro')
  const [codeChars, setCodeChars] = useState(Array.from({ length: CODE_LENGTH }, () => ''))
  const [clientError, setClientError] = useState('')
  const [clientStatus, setClientStatus] = useState('idle')
  const [introTarget, setIntroTarget] = useState(null)
  const inputRefs = useRef([])
  const validationSeqRef = useRef(0)
  const brandTargetRef = useRef(null)

  function parseAgentIdInput(value) {
    const trimmed = value.trim()
    if (!trimmed) return ''

    const directPathMatch = trimmed.match(/\/agent\/([^/?#]+)/i)
    if (directPathMatch?.[1]) return directPathMatch[1]

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      try {
        const url = new URL(trimmed)
        const pathMatch = url.pathname.match(/\/agent\/([^/?#]+)/i)
        if (pathMatch?.[1]) return pathMatch[1]
      } catch {
        return ''
      }
    }

    return trimmed
  }

  const joinedCode = useMemo(() => codeChars.join(''), [codeChars])
  const shellPhase = useMemo(() => {
    if (introPhase === 'ready') return 'ready'
    if (introPhase === 'header') return 'framing'
    return 'preload'
  }, [introPhase])

  const shellStyle = useMemo(() => {
    if (!introTarget) return undefined
    return {
      '--intro-target-left': `${introTarget.left}px`,
      '--intro-target-top': `${introTarget.top}px`,
    }
  }, [introTarget])

  useEffect(() => {
    const dockTimer = window.setTimeout(() => setIntroPhase('dock'), 1300)
    const headerTimer = window.setTimeout(() => setIntroPhase('header'), 2050)
    const readyTimer = window.setTimeout(() => setIntroPhase('ready'), 2850)

    return () => {
      window.clearTimeout(dockTimer)
      window.clearTimeout(headerTimer)
      window.clearTimeout(readyTimer)
    }
  }, [])

  useEffect(() => {
    const updateIntroTarget = () => {
      const node = brandTargetRef.current
      if (!node) return
      const rect = node.getBoundingClientRect()
      const next = {
        left: Number(rect.left.toFixed(2)),
        top: Number(rect.top.toFixed(2)),
      }

      setIntroTarget((current) => {
        if (current && current.left === next.left && current.top === next.top) {
          return current
        }
        return next
      })
    }

    updateIntroTarget()
    const rafId = window.requestAnimationFrame(updateIntroTarget)
    window.addEventListener('resize', updateIntroTarget)
    window.addEventListener('orientationchange', updateIntroTarget)

    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', updateIntroTarget)
      window.removeEventListener('orientationchange', updateIntroTarget)
    }
  }, [uiLanguage])

  useEffect(() => {
    if (stage !== 'client') return
    const firstEmptyIndex = codeChars.findIndex((char) => !char)
    const focusIndex = firstEmptyIndex === -1 ? CODE_LENGTH - 1 : firstEmptyIndex
    inputRefs.current[focusIndex]?.focus()
  }, [CODE_LENGTH, codeChars, stage])

  useEffect(() => {
    if (stage !== 'client') return
    if (joinedCode.length !== CODE_LENGTH) {
      setClientStatus('idle')
      return
    }

    let cancelled = false
    const seq = validationSeqRef.current + 1
    validationSeqRef.current = seq
    setClientStatus('checking')
    setClientError('')

    const validate = async () => {
      try {
        await getAgentById(joinedCode)
        if (cancelled || validationSeqRef.current !== seq) return
        setClientStatus('valid')
      } catch {
        if (cancelled || validationSeqRef.current !== seq) return
        setClientStatus('invalid')
        setClientError(t('landing_invalid_code'))
      }
    }

    void validate()
    return () => {
      cancelled = true
    }
  }, [CODE_LENGTH, joinedCode, stage])

  const continueWithCode = () => {
    if (clientStatus !== 'valid') {
      setClientError(t('landing_invalid_code'))
      return
    }
    navigate(`/agent/${encodeURIComponent(joinedCode)}?autostart=1`)
  }

  const setSingleChar = (index, rawValue) => {
    const cleaned = rawValue.replace(/[^A-Za-z0-9_-]/g, '')
    if (!cleaned) {
      setCodeChars((prev) => {
        const next = [...prev]
        next[index] = ''
        return next
      })
      setClientError('')
      setClientStatus('idle')
      return
    }

    if (cleaned.length > 1) {
      setCodeChars((prev) => {
        const next = [...prev]
        for (let i = 0; i < cleaned.length && index + i < CODE_LENGTH; i += 1) {
          next[index + i] = cleaned[i]
        }
        const nextEmpty = next.findIndex((char) => !char)
        if (nextEmpty !== -1) {
          inputRefs.current[nextEmpty]?.focus()
        }
        return next
      })
      setClientError('')
      setClientStatus('idle')
      return
    }

    setCodeChars((prev) => {
      const next = [...prev]
      next[index] = cleaned
      if (index < CODE_LENGTH - 1) {
        inputRefs.current[index + 1]?.focus()
      }
      return next
    })
    setClientError('')
    setClientStatus('idle')
  }

  const handleKeyDown = (index, event) => {
    if (event.key === 'Backspace' && !codeChars[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault()
      inputRefs.current[index - 1]?.focus()
    }
    if (event.key === 'ArrowRight' && index < CODE_LENGTH - 1) {
      event.preventDefault()
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handlePaste = (event) => {
    event.preventDefault()
    const parsed = parseAgentIdInput(event.clipboardData.getData('text'))
    const pasted = parsed.replace(/[^A-Za-z0-9_-]/g, '').slice(0, CODE_LENGTH)

    if (!pasted) {
      setClientError(t('landing_invalid_code'))
      setClientStatus('invalid')
      return
    }

    const next = Array.from({ length: CODE_LENGTH }, (_, index) => pasted[index] || '')
    setCodeChars(next)
    setClientError('')
    setClientStatus('idle')
  }

  const goToIntent = () => setStage('intent')

  const goToStepOne = () => {
    setClientError('')
    setCodeChars(Array.from({ length: CODE_LENGTH }, () => ''))
    setClientStatus('idle')
    setStage('hero')
  }

  const chooseAdmin = () => navigate('/admin')

  const chooseClient = () => {
    setClientError('')
    setCodeChars(Array.from({ length: CODE_LENGTH }, () => ''))
    setClientStatus('idle')
    setStage('client')
  }

  return (
    <main className={`landingShell ${shellPhase} intro-${introPhase}`} style={shellStyle}>
      <div className="zenBackdrop" aria-hidden="true">
        <span className="zenBlob blobA"></span>
        <span className="zenBlob blobB"></span>
        <span className="zenBlob blobC"></span>
      </div>

      <div className={`landingIntro intro-${introPhase}`}>
        <button type="button" className="landingLogo landingLogoButton landingBrandWordmark wordmark animateLetters" aria-label="auraforming.ai" onClick={goToStepOne}>
          <span className="wordmarkText">{renderWordmarkLetters('auraforming', 0)}</span>
          <span className="wordmarkOrb" style={{ '--letter-index': 10.7 }} aria-hidden="true"></span>
          <span className="wordmarkText">{renderWordmarkLetters('ai', 12)}</span>
        </button>
      </div>

      <section className="landingTopbar" aria-hidden={!(introPhase === 'header' || introPhase === 'ready')}>
        <header className="landingHeaderPanel">
          <div className="landingHeaderBrandSlot" aria-hidden="true">
            <span ref={brandTargetRef} className="landingHeaderBrandGhost landingBrandWordmark wordmark">
              <span className="wordmarkText">{renderWordmarkLetters('auraforming', 0)}</span>
              <span className="wordmarkOrb" aria-hidden="true"></span>
              <span className="wordmarkText">{renderWordmarkLetters('ai', 12)}</span>
            </span>
          </div>
          <nav className="landingHeaderNavGhost">
            <Link className="landingHeaderNavLink" to="/admin">
              {t('nav_create_link')}
            </Link>
            <Link className="landingHeaderNavLink" to="/admin/agents">
              {t('nav_agents')}
            </Link>
            <Link className="landingHeaderNavLink" to="/admin/dashboard">
              {t('nav_intakes')}
            </Link>
          </nav>
          <label className="landingHeaderLanguageSelect">
            <span>{t('nav_language_label')}</span>
            <select value={uiLanguage} onChange={(event) => setUiLanguage(event.target.value)}>
              {supportedLanguages.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </select>
          </label>
        </header>
      </section>

      <section className="landingHero">
        <div className={`landingStageCard stage-${stage}`}>
          {stage === 'hero' ? (
            <div className="landingStage heroStage">
              <h1 className="landingTitle">{t('landing_title')}</h1>
              <p className="landingSubtitle">{t('landing_subtitle')}</p>

              <div className="beginFocus">
                <button type="button" className="beginButton" onClick={goToIntent}>
                  {t('landing_begin')}
                </button>
              </div>

              <div className="heroColumns">
                <div className="heroColumn heroColumnText">
                  <h2 className="heroColumnTitle">{t('landing_column_title')}</h2>
                  <ul className="heroFeatureList">
                    <li className="heroFeatureItem">{t('landing_feature_voice_text')}</li>
                    <li className="heroFeatureItem">{t('landing_feature_clarify')}</li>
                    <li className="heroFeatureItem">{t('landing_feature_enterprise')}</li>
                    <li className="heroFeatureItem">{t('landing_feature_business')}</li>
                    <li className="heroFeatureItem">{t('landing_feature_resilient')}</li>
                    <li className="heroFeatureItem">{t('landing_feature_centralized')}</li>
                  </ul>
                </div>
                <div className="heroColumn heroColumnDemo">
                  <div className="simulationFrame" aria-hidden="true">
                    <div className="videoOrb"></div>
                    <div className="demoLines">
                      <p>{t('landing_demo_client')}</p>
                      <p>{t('landing_demo_assistant_1')}</p>
                      <p>{t('landing_demo_client_2')}</p>
                      <p>{t('landing_demo_assistant_4')}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {stage === 'intent' ? (
            <div className="landingStage intentStage">
              <h2 className="intentTitle">{t('landing_help_title')}</h2>

              <div className="gatewayCards">
                <button type="button" className="gatewayCard" onClick={chooseAdmin}>
                  <BusinessIcon />
                  <p className="gatewayLabel">{t('landing_admin_label')}</p>
                  <p className="gatewayDesc">{t('landing_admin_desc')}</p>
                </button>

                <button type="button" className="gatewayCard" onClick={chooseClient}>
                  <ClientIcon />
                  <p className="gatewayLabel">{t('landing_client_label')}</p>
                  <p className="gatewayDesc">{t('landing_client_desc')}</p>
                </button>
              </div>
            </div>
          ) : null}

          {stage === 'client' ? (
            <div className="landingStage clientStage">
              <button type="button" className="gatewayBack" onClick={() => setStage('intent')}>
                {t('page_back')}
              </button>
              <h2 className="intentTitle">{t('landing_enter_form_id')}</h2>

              <div className="idEntryRow" onPaste={handlePaste}>
                {codeChars.map((char, index) => (
                  <input
                    key={`id-${index}`}
                    ref={(node) => {
                      inputRefs.current[index] = node
                    }}
                    className="idBox"
                    inputMode="text"
                    autoComplete="off"
                    maxLength={1}
                    value={char}
                    aria-label={`Form ID character ${index + 1}`}
                    onChange={(event) => setSingleChar(index, event.target.value)}
                    onKeyDown={(event) => handleKeyDown(index, event)}
                  />
                ))}
              </div>

              <button type="button" className="btnGhost continueButtonSmall" onClick={continueWithCode} disabled={clientStatus !== 'valid'}>
                {t('page_continue')}
              </button>

              <p className={clientError ? 'error clientErrorSlot visible' : 'error clientErrorSlot'}>{clientError || ' '}</p>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  )
}
