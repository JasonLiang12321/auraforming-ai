import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { API_BASE_URL, getAgentById, getAgentLivePreviewPdf, speakInterviewText, startGuidedInterview, submitInterviewAudioTurn } from '../services/api'
import { useI18n } from '../i18n/I18nProvider'
import { normalizeLanguageCode, SUPPORTED_LANGUAGES } from '../i18n/languages'

const MIN_RECORDING_MS = 500
const INTERVIEW_TURN_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    session_id: 'string',
    user_transcript: 'string',
    completed: 'boolean',
    current_field: 'string|null',
    missing_fields: 'string[]',
    answers: 'Record<string, string>',
    intent: 'data|clarification|acknowledgment|barge_in',
    is_answer_adequate: 'boolean',
    assistant_response: 'string',
    audio_mime_type: 'string',
    audio_base64: 'string',
    download_url: 'string',
    pdf_preview_url: 'string',
  },
}

function buildDataUri(audioMimeType, audioBase64) {
  return `data:${audioMimeType || 'audio/mpeg'};base64,${audioBase64}`
}

function toApiAbsoluteUrl(path) {
  if (!path) return ''
  if (/^https?:\/\//i.test(path)) return path
  return `${API_BASE_URL}${path}`
}

function createRecorder(stream) {
  const mime = 'audio/webm;codecs=opus'
  if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(mime)) {
    return new MediaRecorder(stream, { mimeType: mime })
  }
  return new MediaRecorder(stream)
}

function toMicSetupError(err, t) {
  const isLocalhost =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '[::1]'
  const secureContextError = !window.isSecureContext && !isLocalhost
  const errName = typeof err === 'object' && err && 'name' in err ? String(err.name) : ''
  const rawMessage = err instanceof Error ? err.message : ''

  if (secureContextError || errName === 'SecurityError') {
    return t('err_mic_https')
  }
  if (errName === 'NotAllowedError' || /denied|not allowed/i.test(rawMessage)) {
    return t('err_mic_permission')
  }
  if (errName === 'NotFoundError') {
    return t('err_mic_not_found')
  }
  if (errName === 'NotReadableError') {
    return t('err_mic_in_use')
  }
  if (errName === 'AbortError') {
    return t('err_mic_abort')
  }

  return rawMessage || t('err_mic_default')
}

function formatAgentToken(agentId) {
  const raw = String(agentId || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  if (raw.length <= 4) return raw
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`
}

export default function AgentPage() {
  const { t, uiLanguage } = useI18n()
  const { id } = useParams()

  const interviewSessionIdRef = useRef('')
  const mediaStreamRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const recordingStartedAtRef = useRef(0)
  const isHoldingRef = useRef(false)
  const submittingTurnRef = useRef(false)
  const completionLoggedRef = useRef(false)
  const recordingInterruptionRef = useRef(false)
  const activeAudioRef = useRef(null)
  const livePreviewRequestRef = useRef(0)

  const toneContextRef = useRef(null)
  const toneNodesRef = useRef(null)

  const [agent, setAgent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [stage, setStage] = useState('welcome')
  const [status, setStatus] = useState('idle')
  const [mode, setMode] = useState('idle')
  const [micOn, setMicOn] = useState(false)
  const [error, setError] = useState('')
  const [interviewState, setInterviewState] = useState(null)
  const [showEndConfirm, setShowEndConfirm] = useState(false)
  const [interviewLanguage, setInterviewLanguage] = useState(normalizeLanguageCode(uiLanguage))
  const [livePreviewEnabled, setLivePreviewEnabled] = useState(false)
  const [livePreviewLoading, setLivePreviewLoading] = useState(false)
  const [livePreviewUrl, setLivePreviewUrl] = useState('')
  const [chatModeEnabled, setChatModeEnabled] = useState(false)
  const [lastUserSubtitle, setLastUserSubtitle] = useState('')
  const [lastAssistantSubtitle, setLastAssistantSubtitle] = useState('')

  const stopThinkingTone = () => {
    const nodes = toneNodesRef.current
    toneNodesRef.current = null
    if (!nodes) return

    const { carrierA, carrierB, lfo, filter, depth, master } = nodes
    try {
      lfo.stop()
      carrierA.stop()
      carrierB.stop()
    } catch {
      // ignore
    }

    try {
      lfo.disconnect()
      carrierA.disconnect()
      carrierB.disconnect()
      depth.disconnect()
      filter.disconnect()
      master.disconnect()
    } catch {
      // ignore
    }
  }

  const ensureToneContext = async () => {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return null

    if (!toneContextRef.current) {
      toneContextRef.current = new AudioCtx()
    }

    if (toneContextRef.current.state === 'suspended') {
      await toneContextRef.current.resume()
    }

    return toneContextRef.current
  }

  const startThinkingTone = async () => {
    if (toneNodesRef.current) return
    const ctx = await ensureToneContext()
    if (!ctx) return

    const carrierA = ctx.createOscillator()
    const carrierB = ctx.createOscillator()
    const lfo = ctx.createOscillator()
    const depth = ctx.createGain()
    const filter = ctx.createBiquadFilter()
    const master = ctx.createGain()

    carrierA.type = 'triangle'
    carrierB.type = 'sine'
    carrierA.frequency.value = 88
    carrierB.frequency.value = 121

    lfo.type = 'sine'
    lfo.frequency.value = 0.37

    depth.gain.value = 0.008
    master.gain.value = 0.016
    filter.type = 'lowpass'
    filter.frequency.value = 620

    lfo.connect(depth)
    depth.connect(master.gain)

    carrierA.connect(filter)
    carrierB.connect(filter)
    filter.connect(master)
    master.connect(ctx.destination)

    lfo.start()
    carrierA.start()
    carrierB.start()

    toneNodesRef.current = { carrierA, carrierB, lfo, filter, depth, master }
  }

  const stopActiveAudio = () => {
    const activeAudio = activeAudioRef.current
    if (!activeAudio) return
    try {
      activeAudio.pause()
      activeAudio.currentTime = 0
    } catch {
      // ignore
    }
    activeAudioRef.current = null
  }

  const playAssistantAudio = async (audioMimeType, audioBase64, options = {}) => {
    const { completed = false } = options
    if (!audioBase64) return
    stopActiveAudio()

    const audio = new Audio(buildDataUri(audioMimeType, audioBase64))
    activeAudioRef.current = audio
    setMode('speaking')
    setStatus('speaking')

    await new Promise((resolve, reject) => {
      const cleanup = () => {
        audio.onended = null
        audio.onerror = null
      }
      audio.onended = () => {
        cleanup()
        resolve()
      }
      audio.onerror = () => {
        cleanup()
        reject(new Error(t('err_no_audio')))
      }
      audio.play().catch((err) => {
        cleanup()
        reject(err)
      })
    })

    if (activeAudioRef.current === audio) {
      activeAudioRef.current = null
    }

    if (!completed) {
      setMode('listening')
      setStatus('connected')
    }
  }

  const teardownSessionMedia = (options = {}) => {
    const { silent = false } = options
    isHoldingRef.current = false
    stopActiveAudio()
    stopThinkingTone()

    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state === 'recording') {
      try {
        recorder.stop()
      } catch {
        // ignore
      }
    }
    mediaRecorderRef.current = null

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }

    chunksRef.current = []
    recordingStartedAtRef.current = 0
    if (!silent) {
      setMicOn(false)
    }
  }

  const handleTurnError = async (err) => {
    const message = err instanceof Error ? err.message : t('err_turn_generic')
    const errorCode = typeof err === 'object' && err && 'code' in err ? String(err.code || '') : ''
    const statusCode = typeof err === 'object' && err && 'status' in err ? Number(err.status) : 0

    const authIssue = errorCode === 'GEMINI_AUTH' || /gemini api key|invalid or expired|gemini_auth|api key/i.test(message)
    const rateLimited = errorCode === 'GEMINI_RATE_LIMIT' || statusCode === 429 || /rate limit|resource exhausted|quota/i.test(message)

    if (authIssue) {
      setError(t('err_gemini_auth'))
      setMicOn(false)
      setMode('idle')
      setStatus('error')
      return
    }

    if (rateLimited) {
      setError(t('err_gemini_rate'))
      setStatus('connected')
      return
    }

    setError(message)
    setStatus('connected')
  }

  const submitRecordedTurn = async (audioBlob, wasInterruption) => {
    const sessionId = interviewSessionIdRef.current
    if (!sessionId) {
      setError(t('err_session_not_ready'))
      return
    }

    submittingTurnRef.current = true
    setStatus('processing')
    setMode('listening')

    try {
      const result = await submitInterviewAudioTurn(id, {
        session_id: sessionId,
        audio_blob: audioBlob,
        was_interruption: wasInterruption,
      })

      setInterviewState(result)
      setLastUserSubtitle(String(result.user_transcript || '').trim())
      setLastAssistantSubtitle(String(result.assistant_response || '').trim())

      if (result.audio_base64) {
        await playAssistantAudio(result.audio_mime_type, result.audio_base64, { completed: Boolean(result.completed) })
      } else {
        setStatus('connected')
      }

      if (result.completed) {
        setMicOn(false)
        setMode('idle')
        setStatus('connected')
      }
    } catch (err) {
      await handleTurnError(err)
    } finally {
      submittingTurnRef.current = false
    }
  }

  const stopRecordingAndSubmit = () => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state !== 'recording') return
    recorder.stop()
    setMicOn(false)
  }

  const startRecording = () => {
    if (interviewState?.completed || submittingTurnRef.current) return
    if (status === 'processing' || status === 'connecting') return

    const stream = mediaStreamRef.current
    if (!stream) {
      setError(t('err_mic_stream_missing'))
      return
    }

    if (mode === 'speaking') {
      stopActiveAudio()
      recordingInterruptionRef.current = true
    } else {
      recordingInterruptionRef.current = false
    }

    setError('')
    chunksRef.current = []

    const recorder = createRecorder(stream)
    mediaRecorderRef.current = recorder
    recordingStartedAtRef.current = performance.now()

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data)
      }
    }

    recorder.onstop = () => {
      const durationMs = performance.now() - recordingStartedAtRef.current
      const audioBlob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
      chunksRef.current = []

      if (durationMs < MIN_RECORDING_MS) {
        setError(t('err_hold_longer'))
        setStatus('connected')
        setMode('listening')
        return
      }

      if (!audioBlob.size) {
        setError(t('err_no_audio'))
        setStatus('connected')
        setMode('listening')
        return
      }

      void submitRecordedTurn(audioBlob, recordingInterruptionRef.current)
    }

    recorder.start()
    setMicOn(true)
    setStatus('recording')
    setMode('listening')
  }

  const handleHoldStart = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (isHoldingRef.current) return
    if (status === 'processing' || status === 'connecting') return
    if (interviewState?.completed) return

    event.preventDefault()
    isHoldingRef.current = true
    event.currentTarget.setPointerCapture?.(event.pointerId)
    startRecording()
  }

  const handleHoldEnd = (event) => {
    if (!isHoldingRef.current) return
    isHoldingRef.current = false
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    stopRecordingAndSubmit()
  }

  const endInterview = () => {
    livePreviewRequestRef.current += 1
    setLivePreviewEnabled(false)
    setLivePreviewLoading(false)
    setLivePreviewUrl((current) => {
      if (current?.startsWith('blob:')) {
        URL.revokeObjectURL(current)
      }
      return ''
    })
    setShowEndConfirm(false)
    teardownSessionMedia()
    setMode('idle')
    setStatus('idle')
    setStage('welcome')
    interviewSessionIdRef.current = ''
  }

  const startInterview = async () => {
    if (status === 'connecting') return

    setError('')
    setStatus('connecting')
    setMode('idle')
    setMicOn(false)
    setInterviewState(null)
    setLivePreviewLoading(false)
    setLastUserSubtitle('')
    setLastAssistantSubtitle('')
    if (!livePreviewEnabled) {
      setLivePreviewUrl((current) => {
        if (current?.startsWith('blob:')) {
          URL.revokeObjectURL(current)
        }
        return ''
      })
    }
    setShowEndConfirm(false)
    completionLoggedRef.current = false
    interviewSessionIdRef.current = ''

    try {
      await ensureToneContext()

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(t('err_browser_no_mic'))
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream

      const guided = await startGuidedInterview(id, { language_code: interviewLanguage })
      interviewSessionIdRef.current = guided.session_id
      setInterviewState(guided)
      setLastUserSubtitle('')
      setLastAssistantSubtitle(String(guided.first_prompt || '').trim())
      if (guided?.language_code) {
        const normalized = normalizeLanguageCode(guided.language_code)
        setInterviewLanguage(normalized)
      }

      setStage('active')
      setStatus('connected')
      setMode('listening')

      const opening = await speakInterviewText(id, guided.first_prompt)
      await playAssistantAudio(opening.audio_mime_type, opening.audio_base64)
    } catch (err) {
      teardownSessionMedia()
      setStatus('error')
      setError(toMicSetupError(err, t))
      setStage('welcome')
    }
  }

  useEffect(() => {
    const stopOnNavigation = () => {
      teardownSessionMedia({ silent: true })
    }

    window.addEventListener('popstate', stopOnNavigation)
    window.addEventListener('pagehide', stopOnNavigation)
    window.addEventListener('beforeunload', stopOnNavigation)

    return () => {
      window.removeEventListener('popstate', stopOnNavigation)
      window.removeEventListener('pagehide', stopOnNavigation)
      window.removeEventListener('beforeunload', stopOnNavigation)
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const payload = await getAgentById(id)
        if (!isMounted) return
        setAgent(payload)
      } catch {
        if (!isMounted) return
        setError(t('err_interview_open'))
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    void load()

    return () => {
      isMounted = false
      livePreviewRequestRef.current += 1
      teardownSessionMedia()
      if (toneContextRef.current) {
        toneContextRef.current.close().catch(() => {})
        toneContextRef.current = null
      }
    }
  }, [id])

  useEffect(() => {
    if (status === 'processing') {
      void startThinkingTone()
      return
    }
    stopThinkingTone()
  }, [status])

  useEffect(() => {
    if (stage !== 'welcome') return
    setInterviewLanguage(normalizeLanguageCode(uiLanguage))
  }, [stage, uiLanguage])

  useEffect(() => {
    return () => {
      if (livePreviewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(livePreviewUrl)
      }
    }
  }, [livePreviewUrl])

  const refreshLivePreview = async (answers = {}) => {
    const requestId = livePreviewRequestRef.current + 1
    livePreviewRequestRef.current = requestId
    setLivePreviewLoading(true)
    try {
      const previewBlob = await getAgentLivePreviewPdf(id, answers)
      const objectUrl = URL.createObjectURL(previewBlob)
      if (livePreviewRequestRef.current !== requestId) {
        URL.revokeObjectURL(objectUrl)
        return
      }
      setLivePreviewUrl((current) => {
        if (current?.startsWith('blob:')) {
          URL.revokeObjectURL(current)
        }
        return objectUrl
      })
    } catch (err) {
      if (livePreviewRequestRef.current !== requestId) return
      const message = err instanceof Error ? err.message : t('err_preview_refresh')
      setError(message)
    } finally {
      if (livePreviewRequestRef.current === requestId) {
        setLivePreviewLoading(false)
      }
    }
  }

  useEffect(() => {
    if (!livePreviewEnabled || stage !== 'active') return
    void refreshLivePreview(interviewState?.answers || {})
  }, [id, interviewState?.answers, livePreviewEnabled, stage])

  useEffect(() => {
    if (livePreviewEnabled) return
    livePreviewRequestRef.current += 1
    setLivePreviewLoading(false)
    setLivePreviewUrl((current) => {
      if (current?.startsWith('blob:')) {
        URL.revokeObjectURL(current)
      }
      return ''
    })
  }, [livePreviewEnabled])

  useEffect(() => {
    if (!interviewState?.completed || completionLoggedRef.current) return
    completionLoggedRef.current = true
    console.groupCollapsed('[Interview] Completed session payload')
    console.log('Response schema', INTERVIEW_TURN_RESPONSE_SCHEMA)
    console.log('Final payload', interviewState)
    console.groupEnd()
  }, [interviewState])

  const orbState = useMemo(() => {
    if (status === 'connecting' || status === 'processing') return 'connecting'
    if (mode === 'speaking') return 'speaking'
    if (micOn || status === 'recording') return 'listening'
    return 'idle'
  }, [micOn, mode, status])

  const orbScale = useMemo(() => {
    if (orbState === 'speaking') return '1.08'
    if (orbState === 'listening') return '1.04'
    if (orbState === 'connecting') return '1.02'
    return '1'
  }, [orbState])

  const orbCaption = useMemo(() => {
    if (interviewState?.completed) return t('agent_orb_completed')
    if (status === 'connecting') return t('agent_orb_connecting')
    if (status === 'processing') return t('agent_orb_thinking')
    if (mode === 'speaking') return t('agent_orb_speaking')
    if (status === 'recording') return t('agent_orb_recording')
    return t('agent_orb_ready')
  }, [interviewState, mode, status, t])

  const stateLabel = useMemo(() => {
    if (status === 'recording') return t('agent_state_recording')
    if (status === 'processing') return t('agent_state_thinking')
    if (mode === 'speaking') return t('agent_state_speaking')
    if (status === 'connecting') return t('agent_state_connecting')
    if (status === 'error') return t('agent_state_error')
    return t('agent_state_ready')
  }, [mode, status, t])

  const stateClass = useMemo(() => {
    if (status === 'recording') return 'recording'
    if (status === 'processing') return 'processing'
    if (mode === 'speaking') return 'speaking'
    if (status === 'connecting') return 'connecting'
    if (status === 'error') return 'error'
    return 'connected'
  }, [mode, status])

  if (loading) {
    return (
      <main className="agentShell gateShell">
        <section className="gateCard">
          <p className="eyebrow">{t('agent_loading_eyebrow')}</p>
          <h1>{t('agent_loading_title')}</h1>
        </section>
      </main>
    )
  }

  if (!agent) {
    return (
      <main className="agentShell gateShell">
        <section className="gateCard">
          <p className="eyebrow">{t('agent_link_error_eyebrow')}</p>
          <h1>{t('agent_link_error_title')}</h1>
          <p className="error">{error || t('agent_not_found')}</p>
        </section>
      </main>
    )
  }

  if (stage === 'welcome') {
    return (
      <main className="agentShell gateShell gateShellWelcome">
        <section className="gateCard gateCardOpen">
          <div className="gateTopRow">
            <div className="gateBrandRow">
              <Link className="agentGateBrand wordmark" to="/" aria-label="Go to landing page">
                <span className="wordmarkText">auraforming</span>
                <span className="wordmarkOrb" aria-hidden="true"></span>
                <span className="wordmarkText">ai</span>
              </Link>
              <Link className="backLandingLink" to="/">
                {t('agent_back_landing')}
              </Link>
            </div>
          </div>
          <div className="gateHero">
            <div className="gateTitleRow">
              <h1 className="gateFormTitle">{agent.agent_name?.trim() || t('agent_untitled_form')}</h1>
              <span className="gateFormToken" aria-label={`Form ID ${agent.agent_id}`}>
                {formatAgentToken(agent.agent_id)}
              </span>
            </div>
            <p className="heroText gateHeroText">{t('agent_gate_text')}</p>
            <div className="interviewLanguageControl">
              <label className="interviewLanguageLabel" htmlFor="interview-language-select">
                {t('agent_interview_language')}
              </label>
              <select
                id="interview-language-select"
                className="interviewLanguageSelect"
                value={interviewLanguage}
                onChange={(event) => {
                  const nextLanguage = normalizeLanguageCode(event.target.value)
                  setInterviewLanguage(nextLanguage)
                }}
                disabled={status === 'connecting'}
              >
                {SUPPORTED_LANGUAGES.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.label}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className="startPulseButton" onClick={startInterview} disabled={status === 'connecting'}>
              {status === 'connecting' ? t('agent_requesting_mic') : t('agent_start_interview')}
            </button>
            {error ? <p className="error">{error}</p> : null}
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className={`agentShell activeShell ${livePreviewEnabled ? 'activeShellSplit' : ''}`}>
      <header className="agentSessionBar">
        <div className="agentSessionMeta">
          <p className="orbEyebrow">{t('agent_form_assistant')}</p>
          <p className="agentSessionTitle">{agent.agent_name?.trim() || t('agent_untitled_form')}</p>
          <p className="agentSessionId">{formatAgentToken(agent.agent_id)}</p>
        </div>
        <div className="agentModeToggles">
          <label className="miniToggle">
            <input
              type="checkbox"
              checked={chatModeEnabled}
              onChange={(event) => setChatModeEnabled(event.target.checked)}
              disabled={status === 'connecting'}
            />
            <span className="miniToggleTrack" aria-hidden="true"></span>
            <span className="miniToggleLabel">{t('agent_toggle_chat')}</span>
          </label>
          <label className="miniToggle">
            <input
              type="checkbox"
              checked={livePreviewEnabled}
              onChange={(event) => setLivePreviewEnabled(event.target.checked)}
              disabled={status === 'connecting'}
            />
            <span className="miniToggleTrack" aria-hidden="true"></span>
            <span className="miniToggleLabel">{t('agent_toggle_live_pdf')}</span>
          </label>
        </div>
      </header>

      <section className="activeLayoutGrid">
        <section className="voicePanel">
          <section className="orbStage">
            <p className={`statusPill ${stateClass}`}>{stateLabel}</p>
            <div className={`orb ${orbState}`} style={{ '--orb-scale': orbScale }}>
              <div className="orbCore"></div>
            </div>
            <p className="orbCaption">{orbCaption}</p>
          </section>

          {chatModeEnabled ? (
            <section className="subtitleCard" aria-label="Chat subtitles">
              <p className="paneLabel">{t('agent_subtitles_title')}</p>
              {lastUserSubtitle ? (
                <p className="subtitleLine">
                  <span>{t('agent_subtitle_user')}</span> {lastUserSubtitle}
                </p>
              ) : null}
              {lastAssistantSubtitle ? (
                <p className="subtitleLine">
                  <span>{t('agent_subtitle_assistant')}</span> {lastAssistantSubtitle}
                </p>
              ) : (
                <p className="hint">{t('agent_subtitle_hint')}</p>
              )}
              <div className="waitingSoundPlaceholder" aria-label="Waiting sound placeholder">
                <p className="paneLabel">{t('agent_waiting_sound')}</p>
                <p className="hint">{t('agent_waiting_placeholder')}</p>
              </div>
            </section>
          ) : null}

          <footer className="voiceFooter">
            {interviewState?.completed ? (
              <div className="completionActions">
                {interviewState?.download_url ? (
                  <a className="btnPrimary btnLink" href={toApiAbsoluteUrl(interviewState.download_url)} target="_blank" rel="noreferrer">
                    {t('agent_download_completed')}
                  </a>
                ) : null}
                {interviewState?.pdf_preview_url ? (
                  <a className="btnGhost btnLink" href={toApiAbsoluteUrl(interviewState.pdf_preview_url)} target="_blank" rel="noreferrer">
                    {t('agent_preview_completed')}
                  </a>
                ) : null}
                <button type="button" className="endSessionTextButton" onClick={() => setShowEndConfirm(true)}>
                  {t('agent_end_session')}
                </button>
              </div>
            ) : (
              <div className="micStack">
                <button
                  type="button"
                  className={`micHoldButton ${micOn ? 'active' : ''}`}
                  onPointerDown={handleHoldStart}
                  onPointerUp={handleHoldEnd}
                  onPointerLeave={handleHoldEnd}
                  onPointerCancel={handleHoldEnd}
                  onContextMenu={(event) => event.preventDefault()}
                  disabled={
                    Boolean(interviewState?.completed) ||
                    status === 'processing' ||
                    status === 'connecting' ||
                    status === 'error' ||
                    status === 'speaking' ||
                    mode === 'speaking'
                  }
                  aria-label={t('agent_hold_talk')}
                >
                  <svg className="micGlyph" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 15a4 4 0 0 0 4-4V7a4 4 0 1 0-8 0v4a4 4 0 0 0 4 4Zm-6-4a1 1 0 0 1 2 0 4 4 0 0 0 8 0 1 1 0 1 1 2 0 6 6 0 0 1-5 5.91V20h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-3.09A6 6 0 0 1 6 11Z" />
                  </svg>
                </button>
                <p className="micHint">{t('agent_hold_talk')}</p>
                <button type="button" className="endSessionTextButton" onClick={() => setShowEndConfirm(true)}>
                  {t('agent_end_session')}
                </button>
              </div>
            )}

            {error ? <p className="error">{error}</p> : null}
          </footer>
        </section>

        {livePreviewEnabled ? (
          <aside className="livePreviewSide">
            <section className="livePreviewCard">
              <div className="livePreviewHeader">
                <p className="paneLabel">{t('agent_live_pdf_preview')}</p>
                <span className="livePreviewState">{livePreviewLoading ? t('agent_live_pdf_updating') : t('agent_live_pdf_readonly')}</span>
              </div>
              {livePreviewUrl ? (
                <iframe
                  title={t('agent_live_pdf_preview')}
                  src={`${livePreviewUrl}#toolbar=1&navpanes=0`}
                  className="talkingPdfFrame"
                />
              ) : (
                <p className="hint">{t('agent_live_pdf_preparing')}</p>
              )}
            </section>
          </aside>
        ) : null}
      </section>

      {showEndConfirm ? (
        <div className="confirmOverlay" role="dialog" aria-modal="true" aria-label={t('agent_confirm_end_title')}>
          <div className="confirmDialog">
            <p className="eyebrow">{t('agent_confirm')}</p>
            <h3>{t('agent_confirm_end_title')}</h3>
            <p>{t('agent_confirm_end_text')}</p>
            <div className="confirmActions">
              <button type="button" className="btnGhost" onClick={() => setShowEndConfirm(false)}>
                {t('agent_keep_interview')}
              </button>
              <button type="button" className="btnPrimary" onClick={endInterview}>
                {t('agent_yes_end')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
