import { Conversation } from '@elevenlabs/client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getAgentById, getAgentSignedUrl } from '../services/api'

const MAX_TRANSCRIPT_LINES = 6

export default function AgentPage() {
  const { id } = useParams()
  const conversationRef = useRef(null)
  const rafRef = useRef(0)

  const [agent, setAgent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [stage, setStage] = useState('welcome')
  const [status, setStatus] = useState('idle')
  const [mode, setMode] = useState('listening')
  const [micOn, setMicOn] = useState(false)
  const [error, setError] = useState('')
  const [transcript, setTranscript] = useState([])
  const [inputLevel, setInputLevel] = useState(0)
  const [outputLevel, setOutputLevel] = useState(0)

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
      cancelAnimationFrame(rafRef.current)
      const session = conversationRef.current
      if (session) {
        session.endSession().catch(() => {})
      }
    }
  }, [id])

  useEffect(() => {
    if (stage !== 'active' || !conversationRef.current) {
      cancelAnimationFrame(rafRef.current)
      setInputLevel(0)
      setOutputLevel(0)
      return
    }

    const sample = () => {
      const session = conversationRef.current
      if (!session) return

      const nextInput = Number(session.getInputVolume?.() || 0)
      const nextOutput = Number(session.getOutputVolume?.() || 0)

      setInputLevel((prev) => prev * 0.7 + nextInput * 0.3)
      setOutputLevel((prev) => prev * 0.7 + nextOutput * 0.3)

      rafRef.current = requestAnimationFrame(sample)
    }

    rafRef.current = requestAnimationFrame(sample)
    return () => cancelAnimationFrame(rafRef.current)
  }, [stage])

  const parseStatus = (nextStatus) => {
    if (typeof nextStatus === 'string') return nextStatus
    if (nextStatus && typeof nextStatus === 'object') {
      return nextStatus.status || nextStatus.state || nextStatus.connectionStatus || 'unknown'
    }
    return 'unknown'
  }

  const appendTranscript = (source, message) => {
    if (!message?.trim()) return
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      source,
      message: message.trim(),
    }
    setTranscript((prev) => [...prev, entry].slice(-MAX_TRANSCRIPT_LINES))
  }

  const startInterview = async () => {
    if (conversationRef.current || status === 'connecting') return

    setError('')
    setStatus('connecting')
    setMode('listening')
    setMicOn(false)
    setTranscript([])

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('This browser does not support microphone capture.')
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())

      const signedUrl = await getAgentSignedUrl(id)

      const session = await Conversation.startSession({
        signedUrl,
        connectionType: 'websocket',
        onConnect: () => {
          setStatus('connected')
          setStage('active')
        },
        onDisconnect: () => {
          conversationRef.current = null
          setStatus('disconnected')
          setMicOn(false)
          setStage('welcome')
        },
        onStatusChange: (nextStatus) => {
          setStatus(parseStatus(nextStatus))
        },
        onModeChange: (nextMode) => {
          const modeValue = typeof nextMode === 'string' ? nextMode : nextMode?.mode || 'listening'
          setMode(modeValue)
        },
        onMessage: (message) => {
          appendTranscript(message?.source || 'ai', message?.message || '')
        },
        onError: (message) => {
          setError(message ? 'The connection paused for a moment. Please continue when ready.' : 'Conversation error')
        },
      })

      conversationRef.current = session
      await session.setMicMuted(true)
      setMicOn(false)
    } catch (err) {
      conversationRef.current = null
      setStatus('error')
      const errorMessage =
        err instanceof Error && err.message
          ? err.message
          : 'We could not start the interview yet. Please check microphone permission and try again.'
      setError(errorMessage)
      setStage('welcome')
    }
  }

  const endInterview = async () => {
    const session = conversationRef.current
    if (!session) return
    try {
      await session.endSession()
    } finally {
      conversationRef.current = null
      setStatus('idle')
      setMicOn(false)
      setStage('welcome')
    }
  }

  const toggleMic = async () => {
    const session = conversationRef.current
    if (!session) return
    try {
      const nextMicOn = !micOn
      await session.setMicMuted(!nextMicOn)
      setMicOn(nextMicOn)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update microphone state.')
    }
  }

  const orbState = useMemo(() => {
    if (status === 'connecting') return 'connecting'
    if (mode === 'speaking') return 'speaking'
    if (micOn) return 'listening'
    return 'idle'
  }, [micOn, mode, status])

  const orbScale = useMemo(() => {
    if (orbState === 'speaking') return (1 + Math.min(outputLevel * 0.35, 0.38)).toFixed(3)
    if (orbState === 'listening') return (1 + Math.min(inputLevel * 0.24, 0.2)).toFixed(3)
    if (orbState === 'connecting') return '1.02'
    return '1'
  }, [inputLevel, orbState, outputLevel])

  const orbCaption = useMemo(() => {
    if (status === 'connecting') return 'Connecting you to your assistant...'
    if (mode === 'speaking') return 'I am speaking now. You can interrupt anytime.'
    if (micOn) return 'I am listening. Take your time.'
    return 'When you are ready, turn on your microphone and answer at your own pace.'
  }, [micOn, mode, status])

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
      <main className="agentShell gateShell">
        <section className="gateCard">
          <p className="eyebrow">Secure Intake</p>
          <h1>We need a few details to complete your form.</h1>
          <p className="heroText">Press start to begin a gentle voice interview.</p>
          <button type="button" className="startPulseButton" onClick={startInterview} disabled={status === 'connecting'}>
            {status === 'connecting' ? 'Requesting microphone...' : 'Start Interview'}
          </button>
          {error ? <p className="error">{error}</p> : null}
        </section>
      </main>
    )
  }

  return (
    <main className="agentShell activeShell">
      <section className="orbStage">
        <p className="orbEyebrow">Your Form Assistant</p>
        <div className={`orb ${orbState}`} style={{ '--orb-scale': orbScale }}>
          <div className="orbCore"></div>
        </div>
        <p className="orbCaption">{orbCaption}</p>
      </section>

      <footer className="voiceFooter">
        <div className="voiceControls">
          <button type="button" className={micOn ? 'btnPrimary' : 'btnGhost'} onClick={toggleMic}>
            {micOn ? 'Pause Microphone' : 'Enable Microphone'}
          </button>
          <button type="button" className="btnGhost" onClick={endInterview}>
            Take a Break
          </button>
        </div>

        <section className="transcriptStrip" aria-live="polite">
          {transcript.slice(-2).map((line) => (
            <p key={line.id} className={line.source === 'user' ? 'lineUser' : 'lineAi'}>
              <span>{line.source === 'user' ? 'You' : 'Agent'}</span> {line.message}
            </p>
          ))}
        </section>

        {error ? <p className="error">{error}</p> : null}
      </footer>
    </main>
  )
}
