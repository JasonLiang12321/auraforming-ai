import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getAgentById, speakInterviewText, startGuidedInterview, submitInterviewAudioTurn } from '../services/api'

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
  },
}

function buildDataUri(audioMimeType, audioBase64) {
  return `data:${audioMimeType || 'audio/mpeg'};base64,${audioBase64}`
}

function createRecorder(stream) {
  const mime = 'audio/webm;codecs=opus'
  if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(mime)) {
    return new MediaRecorder(stream, { mimeType: mime })
  }
  return new MediaRecorder(stream)
}

function toMicSetupError(err) {
  const isLocalhost =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '[::1]'
  const secureContextError = !window.isSecureContext && !isLocalhost
  const errName = typeof err === 'object' && err && 'name' in err ? String(err.name) : ''
  const rawMessage = err instanceof Error ? err.message : ''

  if (secureContextError || errName === 'SecurityError') {
    return 'Microphone access requires HTTPS (or localhost). Open this app on localhost or enable HTTPS.'
  }
  if (errName === 'NotAllowedError' || /denied|not allowed/i.test(rawMessage)) {
    return 'Microphone permission was blocked. Click the lock icon in your browser and allow microphone access, then try again.'
  }
  if (errName === 'NotFoundError') {
    return 'No microphone was found on this device. Connect a microphone and try again.'
  }
  if (errName === 'NotReadableError') {
    return 'Microphone is currently in use by another app. Close other apps using the mic and try again.'
  }
  if (errName === 'AbortError') {
    return 'Microphone initialization was interrupted. Please try again.'
  }

  return rawMessage || 'We could not start the interview yet. Please check microphone permission and try again.'
}

function formatAgentToken(agentId) {
  const raw = String(agentId || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  if (raw.length <= 4) return raw
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`
}

export default function AgentPage() {
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

  const playAssistantAudio = async (audioMimeType, audioBase64) => {
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
        reject(new Error('Could not play assistant audio.'))
      }
      audio.play().catch((err) => {
        cleanup()
        reject(err)
      })
    })

    if (activeAudioRef.current === audio) {
      activeAudioRef.current = null
    }

    if (!interviewState?.completed) {
      setMode('listening')
      setStatus('connected')
    }
  }

  const teardownSessionMedia = () => {
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
    setMicOn(false)
  }

  const handleTurnError = async (err) => {
    const message = err instanceof Error ? err.message : 'I had trouble understanding that. Please try once more.'
    const errorCode = typeof err === 'object' && err && 'code' in err ? String(err.code || '') : ''
    const statusCode = typeof err === 'object' && err && 'status' in err ? Number(err.status) : 0

    const authIssue = errorCode === 'GEMINI_AUTH' || /gemini api key|invalid or expired|gemini_auth|api key/i.test(message)
    const rateLimited = errorCode === 'GEMINI_RATE_LIMIT' || statusCode === 429 || /rate limit|resource exhausted|quota/i.test(message)

    if (authIssue) {
      setError('Gemini key is invalid/expired. Update GEMINI_API_KEY, restart backend, then start interview again.')
      setMicOn(false)
      setMode('idle')
      setStatus('error')
      return
    }

    if (rateLimited) {
      setError('Gemini is rate-limited right now. Wait a few seconds, then keep answering.')
      setStatus('connected')
      return
    }

    setError(message)
    setStatus('connected')
  }

  const submitRecordedTurn = async (audioBlob, wasInterruption) => {
    const sessionId = interviewSessionIdRef.current
    if (!sessionId) {
      setError('Interview session is not ready. Please restart the interview.')
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

      if (result.audio_base64) {
        await playAssistantAudio(result.audio_mime_type, result.audio_base64)
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
      setError('Microphone stream is not available. Restart interview.')
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
        setError('Hold the mic a little longer before releasing.')
        setStatus('connected')
        setMode('listening')
        return
      }

      if (!audioBlob.size) {
        setError('No audio captured. Please try again.')
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
    setShowEndConfirm(false)
    completionLoggedRef.current = false
    interviewSessionIdRef.current = ''

    try {
      await ensureToneContext()

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('This browser does not support microphone capture.')
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream

      const guided = await startGuidedInterview(id)
      interviewSessionIdRef.current = guided.session_id
      setInterviewState(guided)

      setStage('active')
      setStatus('connected')
      setMode('listening')

      const opening = await speakInterviewText(id, guided.first_prompt)
      await playAssistantAudio(opening.audio_mime_type, opening.audio_base64)
    } catch (err) {
      teardownSessionMedia()
      setStatus('error')
      setError(toMicSetupError(err))
      setStage('welcome')
    }
  }

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
        setError('We could not open this interview link right now.')
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    void load()

    return () => {
      isMounted = false
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
    if (interviewState?.completed) return 'All required fields are captured. You can end this session.'
    if (status === 'connecting') return 'Preparing your interview...'
    if (status === 'processing') return 'Thinking...'
    if (mode === 'speaking') return 'Assistant is speaking now.'
    if (status === 'recording') return 'Recording... release to send.'
    return 'Hold the microphone button to talk. Release to send.'
  }, [interviewState, mode, status])

  const stateLabel = useMemo(() => {
    if (status === 'recording') return 'Recording'
    if (status === 'processing') return 'Thinking'
    if (mode === 'speaking') return 'Speaking'
    if (status === 'connecting') return 'Connecting'
    if (status === 'error') return 'Error'
    return 'Ready'
  }, [mode, status])

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
          <p className="eyebrow">Preparing Session</p>
          <h1>Loading your secure interview link...</h1>
        </section>
      </main>
    )
  }

  if (!agent) {
    return (
      <main className="agentShell gateShell">
        <section className="gateCard">
          <p className="eyebrow">Link Error</p>
          <h1>This interview link is unavailable</h1>
          <p className="error">{error || 'Agent not found.'}</p>
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
                Back to landing
              </Link>
            </div>
          </div>
          <div className="gateHero">
            <p className="eyebrow">Secure Intake</p>
            <div className="gateTitleRow">
              <h1 className="gateFormTitle">{agent.agent_name?.trim() || 'Untitled Form'}</h1>
              <span className="gateFormToken" aria-label={`Form ID ${agent.agent_id}`}>
                ID {formatAgentToken(agent.agent_id)}
              </span>
            </div>
            <p className="heroText gateHeroText">Start your guided voice interview when you are ready.</p>
            <button type="button" className="startPulseButton" onClick={startInterview} disabled={status === 'connecting'}>
              {status === 'connecting' ? 'Requesting microphone...' : 'Start My Interview'}
            </button>
            {error ? <p className="error">{error}</p> : null}
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="agentShell activeShell">
      <section className="orbStage">
        <p className="orbEyebrow">Your Form Assistant</p>
        <p className={`statusPill ${stateClass}`}>{stateLabel}</p>
        <div className={`orb ${orbState}`} style={{ '--orb-scale': orbScale }}>
          <div className="orbCore"></div>
        </div>
        <p className="orbCaption">{orbCaption}</p>
      </section>

      <footer className="voiceFooter">
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
            aria-label="Hold to talk"
          >
            <svg className="micGlyph" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 15a4 4 0 0 0 4-4V7a4 4 0 1 0-8 0v4a4 4 0 0 0 4 4Zm-6-4a1 1 0 0 1 2 0 4 4 0 0 0 8 0 1 1 0 1 1 2 0 6 6 0 0 1-5 5.91V20h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-3.09A6 6 0 0 1 6 11Z" />
            </svg>
          </button>
          <p className="micHint">Hold to talk. Release to send.</p>
          <button type="button" className="endSessionTextButton" onClick={() => setShowEndConfirm(true)}>
            End Session
          </button>
        </div>

        {error ? <p className="error">{error}</p> : null}
      </footer>

      {showEndConfirm ? (
        <div className="confirmOverlay" role="dialog" aria-modal="true" aria-label="Confirm end session">
          <div className="confirmDialog">
            <p className="eyebrow">Confirm</p>
            <h3>End this interview session?</h3>
            <p>This will stop the microphone and close the current session.</p>
            <div className="confirmActions">
              <button type="button" className="btnGhost" onClick={() => setShowEndConfirm(false)}>
                Keep Interview
              </button>
              <button type="button" className="btnPrimary" onClick={endInterview}>
                Yes, End Session
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
