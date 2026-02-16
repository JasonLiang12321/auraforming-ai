import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import LanguagePicker from '../components/LanguagePicker'
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
  const location = useLocation()
  const searchParams = new URLSearchParams(location.search)
  const CODE_LENGTH = 8
  const isPhoneViewport = typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches
  const isJoinRequested = location.pathname === '/join' || searchParams.get('join') === '1'
  const freezeLogoIntro = searchParams.get('freezeLogo') === '1'
  const [stage, setStage] = useState('hero')
  const [isPhone, setIsPhone] = useState(() => isPhoneViewport)
  const [introPhase, setIntroPhase] = useState(() => {
    if (freezeLogoIntro) return 'intro'
    return isPhoneViewport || isJoinRequested ? 'ready' : 'intro'
  })
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [codeChars, setCodeChars] = useState(Array.from({ length: CODE_LENGTH }, () => ''))
  const [clientError, setClientError] = useState('')
  const [clientStatus, setClientStatus] = useState('idle')
  const [hasStartedScrolling, setHasStartedScrolling] = useState(() => (typeof window !== 'undefined' ? window.scrollY > 8 : false))
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
    const mediaQuery = window.matchMedia('(max-width: 700px)')
    const handleBreakpointChange = (event) => setIsPhone(event.matches)

    setIsPhone(mediaQuery.matches)
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleBreakpointChange)
      return () => mediaQuery.removeEventListener('change', handleBreakpointChange)
    }

    mediaQuery.addListener(handleBreakpointChange)
    return () => mediaQuery.removeListener(handleBreakpointChange)
  }, [])

  useEffect(() => {
    if (freezeLogoIntro) return
    if (!isJoinRequested) return
    setIntroPhase('ready')
    setClientError('')
    setCodeChars(Array.from({ length: CODE_LENGTH }, () => ''))
    setClientStatus('idle')
    setStage('client')
  }, [CODE_LENGTH, freezeLogoIntro, isJoinRequested])

  useEffect(() => {
    if (freezeLogoIntro) return
    if (!isPhone) return
    setIntroPhase('ready')
  }, [freezeLogoIntro, isPhone])

  useEffect(() => {
    if (!isPhone) {
      setMobileMenuOpen(false)
    }
  }, [isPhone])

  useEffect(() => {
    if (freezeLogoIntro || isPhone || isJoinRequested) return
    const dockTimer = window.setTimeout(() => setIntroPhase('dock'), 1300)
    const headerTimer = window.setTimeout(() => setIntroPhase('header'), 2050)
    const readyTimer = window.setTimeout(() => setIntroPhase('ready'), 2850)

    return () => {
      window.clearTimeout(dockTimer)
      window.clearTimeout(headerTimer)
      window.clearTimeout(readyTimer)
    }
  }, [freezeLogoIntro, isJoinRequested, isPhone])

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
    const nodes = Array.from(document.querySelectorAll('[data-scroll-reveal]'))
    if (!nodes.length) return

    const updateRevealState = () => {
      const viewportHeight = window.innerHeight || 1
      const enterTop = viewportHeight * 0.98
      const exitTop = viewportHeight * 0.28

      nodes.forEach((node) => {
        const rect = node.getBoundingClientRect()
        const isActive = rect.top < enterTop && rect.bottom > exitTop
        const isAfter = rect.bottom <= exitTop

        node.classList.toggle('is-active', isActive)
        node.classList.toggle('is-after', isAfter)
      })
    }

    nodes.forEach((node) => {
      node.classList.remove('is-active', 'is-after')
    })

    const rafId = window.requestAnimationFrame(updateRevealState)
    window.addEventListener('scroll', updateRevealState, { passive: true })
    window.addEventListener('resize', updateRevealState)

    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('scroll', updateRevealState)
      window.removeEventListener('resize', updateRevealState)
    }
  }, [])

  useEffect(() => {
    const handleScrollStart = () => {
      if (window.scrollY > 8) {
        setHasStartedScrolling(true)
      }
    }

    handleScrollStart()
    window.addEventListener('scroll', handleScrollStart, { passive: true })
    return () => window.removeEventListener('scroll', handleScrollStart)
  }, [])

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

  const openJoinFromHeader = () => {
    chooseClient()
    setMobileMenuOpen(false)
  }

  const handleScrollCueClick = () => {
    const nextSection = document.querySelector('.landingPoweredBy')
    nextSection?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <>
      <main className={`landingShell ${shellPhase} intro-${introPhase}`} style={shellStyle}>
      <div className="zenBackdrop" aria-hidden="true">
        <span className="zenBlob blobA"></span>
        <span className="zenBlob blobB"></span>
        <span className="zenBlob blobC"></span>
      </div>

      <div className={`landingIntro intro-${introPhase}`}>
        <button
          type="button"
          className="landingLogo landingLogoButton landingBrandWordmark wordmark animateLetters"
          aria-label={t('brand_aria_label')}
          onClick={goToStepOne}
        >
          <span className="wordmarkText">{renderWordmarkLetters('auraforming', 0)}</span>
          <span className="wordmarkOrb" style={{ '--letter-index': 10.7 }} aria-hidden="true"></span>
          <span className="wordmarkText">{renderWordmarkLetters('ai', 12)}</span>
        </button>
      </div>

      <section className="landingTopbar" aria-hidden={!(introPhase === 'header' || introPhase === 'ready')}>
        <header className="landingHeaderPanel">
          <div className="landingHeaderBrandSlot">
            <Link
              ref={brandTargetRef}
              className="landingHeaderBrandLink landingBrandWordmark wordmark"
              to="/"
              aria-label={t('brand_aria_label')}
              onClick={goToStepOne}
            >
              <span className="wordmarkText">{renderWordmarkLetters('auraforming', 0)}</span>
              <span className="wordmarkOrb" aria-hidden="true"></span>
              <span className="wordmarkText">{renderWordmarkLetters('ai', 12)}</span>
            </Link>
          </div>
          <button
            type="button"
            className={mobileMenuOpen ? 'landingHeaderMenuButton open' : 'landingHeaderMenuButton'}
            aria-label={t('nav_menu_label')}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
          <div className={mobileMenuOpen ? 'landingHeaderControls open' : 'landingHeaderControls'}>
            <nav className="landingHeaderNavGhost">
              <Link className="landingHeaderNavLink" to="/admin" onClick={() => setMobileMenuOpen(false)}>
                {t('nav_create_link')}
              </Link>
              <Link className="landingHeaderNavLink" to="/admin/agents" onClick={() => setMobileMenuOpen(false)}>
                {t('nav_agents')}
              </Link>
              <button
                type="button"
                className={stage === 'client' ? 'landingHeaderNavLink landingHeaderNavButton active' : 'landingHeaderNavLink landingHeaderNavButton'}
                onClick={openJoinFromHeader}
              >
                {t('nav_join')}
              </button>
            </nav>
            <LanguagePicker
              className="landingHeaderLanguageSelect"
              ariaLabel={t('nav_language_label')}
              uiLanguage={uiLanguage}
              setUiLanguage={setUiLanguage}
              supportedLanguages={supportedLanguages}
            />
          </div>
        </header>
      </section>

      <section className="landingHero scrollReveal fromLeft" data-scroll-reveal>
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
                    aria-label={t('landing_form_id_char_aria', { index: index + 1 })}
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

        {stage === 'hero' && !hasStartedScrolling ? (
          <button type="button" className="landingScrollCue" onClick={handleScrollCueClick} aria-label="Scroll down">
            <span>Scroll down</span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        ) : null}

      </section>

      <section className="landingPoweredBy scrollReveal fromLeft" data-scroll-reveal>
        <div className="poweredByContainer">
          <h2 className="poweredByTitle">{t('landing_powered_by')}</h2>
          <div className="poweredByLogos">
            <span className="poweredByLogo geminiLogo">{t('landing_powered_gemini')}</span>
            <span className="poweredByLogo elevenlabsLogo">{t('landing_powered_elevenlabs')}</span>
          </div>
        </div>
      </section>

      <section className="landingAccessibility scrollReveal fromRight" data-scroll-reveal>
        <div className="accessibilityContainer">
          <h2 className="accessibilityTitle">{t('landing_accessibility')}</h2>
          <ul className="accessibilityList">
            <li className="accessibilityItem">{t('landing_accessibility_languages')}</li>
            <li className="accessibilityItem">{t('landing_accessibility_platform')}</li>
            <li className="accessibilityItem">{t('landing_accessibility_input')}</li>
            <li className="accessibilityItem">{t('landing_accessibility_resilient')}</li>
            <li className="accessibilityItem">{t('landing_accessibility_privacy')}</li>
          </ul>
        </div>
      </section>
    </main>

    <footer className="landingFooter">
      <div className="footerContent">
        <div className="footerItem">
          <span className="footerLabel">{t('footer_address_label')}:</span>
          <span className="footerValue">{t('footer_address')}</span>
        </div>
        <div className="footerDivider"></div>
        <div className="footerItem">
          <span className="footerLabel">{t('footer_phone_label')}:</span>
          <span className="footerValue">{t('footer_phone')}</span>
        </div>
        <div className="footerDivider"></div>
        <div className="footerItem">
          <span className="footerLabel">{t('footer_email_label')}:</span>
          <span className="footerValue">{t('footer_email')}</span>
        </div>
      </div>
    </footer>
    </>
  )
}
