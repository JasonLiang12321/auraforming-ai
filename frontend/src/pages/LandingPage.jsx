import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

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
  const navigate = useNavigate()
  const CODE_LENGTH = 8
  const [stage, setStage] = useState('hero')
  const [introPhase, setIntroPhase] = useState('intro')
  const [codeChars, setCodeChars] = useState(Array.from({ length: CODE_LENGTH }, () => ''))
  const [clientError, setClientError] = useState('')
  const inputRefs = useRef([])

  const joinedCode = useMemo(() => codeChars.join(''), [codeChars])

  const parseAgentIdInput = (value) => {
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

  useEffect(() => {
    const dockTimer = window.setTimeout(() => setIntroPhase('dock'), 1400)
    const readyTimer = window.setTimeout(() => setIntroPhase('ready'), 2350)

    return () => {
      window.clearTimeout(dockTimer)
      window.clearTimeout(readyTimer)
    }
  }, [])

  useEffect(() => {
    if (stage !== 'client') return
    const firstEmptyIndex = codeChars.findIndex((char) => !char)
    const focusIndex = firstEmptyIndex === -1 ? CODE_LENGTH - 1 : firstEmptyIndex
    inputRefs.current[focusIndex]?.focus()
  }, [CODE_LENGTH, codeChars, stage])

  const connectWithCode = (chars) => {
    const code = chars.join('').trim()
    if (code.length !== CODE_LENGTH) return
    setClientError('')
    navigate(`/agent/${encodeURIComponent(code)}?autostart=1`)
  }

  const setSingleChar = (index, rawValue) => {
    const cleaned = rawValue.replace(/[^A-Za-z0-9_-]/g, '')
    if (!cleaned) {
      setCodeChars((prev) => {
        const next = [...prev]
        next[index] = ''
        return next
      })
      return
    }

    if (cleaned.length > 1) {
      setCodeChars((prev) => {
        const next = [...prev]
        for (let i = 0; i < cleaned.length && index + i < CODE_LENGTH; i += 1) {
          next[index + i] = cleaned[i]
        }
        const nextEmpty = next.findIndex((char) => !char)
        if (nextEmpty === -1) {
          connectWithCode(next)
        } else {
          inputRefs.current[nextEmpty]?.focus()
        }
        return next
      })
      return
    }

    setCodeChars((prev) => {
      const next = [...prev]
      next[index] = cleaned
      if (index < CODE_LENGTH - 1) {
        inputRefs.current[index + 1]?.focus()
      }
      if (next.every(Boolean)) {
        connectWithCode(next)
      }
      return next
    })
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
      setClientError('Use letters and numbers only.')
      return
    }

    const next = Array.from({ length: CODE_LENGTH }, (_, index) => pasted[index] || '')
    setCodeChars(next)
    if (next.every(Boolean)) {
      connectWithCode(next)
    }
  }

  const goToIntent = () => setStage('intent')

  const goToStepOne = () => {
    setClientError('')
    setCodeChars(Array.from({ length: CODE_LENGTH }, () => ''))
    setStage('hero')
  }

  const chooseAdmin = () => navigate('/admin')

  const chooseClient = () => {
    setClientError('')
    setCodeChars(Array.from({ length: CODE_LENGTH }, () => ''))
    setStage('client')
  }

  return (
    <main className={`landingShell ${introPhase === 'ready' ? 'ready' : 'preload'}`}>
      <div className="zenBackdrop" aria-hidden="true">
        <span className="zenBlob blobA"></span>
        <span className="zenBlob blobB"></span>
        <span className="zenBlob blobC"></span>
      </div>

      <div className={`landingIntro intro-${introPhase}`}>
        <button type="button" className="landingLogo landingLogoButton wordmark animateLetters" aria-label="auraforming.ai" onClick={goToStepOne}>
          <span className="wordmarkText">{renderWordmarkLetters('auraforming', 0)}</span>
          <span className="wordmarkOrb" style={{ '--letter-index': 10.7 }} aria-hidden="true"></span>
          <span className="wordmarkText">{renderWordmarkLetters('ai', 12)}</span>
        </button>
      </div>

      <section className="landingHero">
        <div className={`landingStageCard stage-${stage}`}>
          {stage === 'hero' ? (
            <div className="landingStage heroStage">
              <h1 className="landingTitle">Paperwork, humanized.</h1>
              <p className="landingSubtitle">Breeze through complex forms with a helpful voice.</p>

              <div className="simulationFrame" aria-hidden="true">
                <div className="videoOrb"></div>
                <div className="demoLines">
                  <p>Client: &quot;What does indemnity mean here?&quot;</p>
                  <p>Assistant: &quot;Let&apos;s practice that with a quick real-life example.&quot;</p>
                  <p>Assistant: &quot;Great. Now we&apos;ll continue your form.&quot;</p>
                </div>
              </div>

              <div className="beginFocus">
                <button type="button" className="beginButton" onClick={goToIntent}>
                  Begin
                </button>
              </div>
            </div>
          ) : null}

          {stage === 'intent' ? (
            <div className="landingStage intentStage">
              <p className="eyebrow">Step 2</p>
              <h2 className="intentTitle">How can we help you today?</h2>

              <div className="gatewayCards">
                <button type="button" className="gatewayCard" onClick={chooseAdmin}>
                  <BusinessIcon />
                  <p className="gatewayLabel">I want to create a form</p>
                  <p className="gatewayDesc">Upload a PDF and generate a guided interview link for clients.</p>
                </button>

                <button type="button" className="gatewayCard" onClick={chooseClient}>
                  <ClientIcon />
                  <p className="gatewayLabel">I was asked to fill out a form</p>
                  <p className="gatewayDesc">Enter your ID and start a guided voice interview with no account.</p>
                </button>
              </div>
            </div>
          ) : null}

          {stage === 'client' ? (
            <div className="landingStage clientStage">
              <button type="button" className="gatewayBack" onClick={() => setStage('intent')}>
                Back
              </button>
              <p className="eyebrow">Step 3</p>
              <h2 className="intentTitle">Please enter your unique Form ID.</h2>

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

              <p className="clientHint">Type or paste your 8-character code. We&apos;ll connect automatically.</p>
              {clientError ? <p className="error">{clientError}</p> : null}
              <p className="idPreview">{joinedCode ? `Current code: ${joinedCode}` : 'Waiting for code...'}</p>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  )
}
