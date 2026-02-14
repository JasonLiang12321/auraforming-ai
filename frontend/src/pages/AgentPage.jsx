import { Conversation } from '@elevenlabs/client'
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import PortalHeader from '../components/PortalHeader'
import { getAgentById, getAgentSignedUrl } from '../services/api'

export default function AgentPage() {
  const { id } = useParams()
  const conversationRef = useRef(null)
  const debugSeqRef = useRef(0)
  const [agent, setAgent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('idle')
  const [micOn, setMicOn] = useState(false)
  const [error, setError] = useState('')
  const [debugEvents, setDebugEvents] = useState([])

  const parseStatus = (nextStatus) => {
    if (typeof nextStatus === 'string') return nextStatus
    if (nextStatus && typeof nextStatus === 'object') {
      return nextStatus.status || nextStatus.state || nextStatus.connectionStatus || 'unknown'
    }
    return 'unknown'
  }

  const addDebug = (label, details = '') => {
    const timestamp = new Date().toLocaleTimeString()
    const normalized =
      typeof details === 'string' ? details : details ? JSON.stringify(details) : ''
    const next = {
      id: `${Date.now()}-${debugSeqRef.current++}`,
      timestamp,
      label,
      details: normalized,
    }
    setDebugEvents((prev) => [next, ...prev].slice(0, 80))
  }

  useEffect(() => {
    let isMounted = true

    const loadAgent = async () => {
      addDebug('Loading agent payload', { id })
      setLoading(true)
      setError('')
      try {
        const payload = await getAgentById(id)
        if (!isMounted) return
        setAgent(payload)
        addDebug('Agent payload loaded', {
          agent_id: payload.agent_id,
          has_schema: Boolean(payload.schema),
        })
      } catch (err) {
        if (!isMounted) return
        setError(err.message)
        addDebug('Agent load failed', err.message)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadAgent()

    return () => {
      isMounted = false
      const session = conversationRef.current
      if (session) {
        addDebug('Unmount cleanup: ending active session')
        session.endSession().catch(() => {})
      }
    }
  }, [id])

  const startInterview = async () => {
    if (conversationRef.current || status === 'connecting') {
      addDebug('Start skipped', 'Session already active or connecting')
      return
    }

    setError('')
    setStatus('connecting')
    addDebug('Start interview clicked')

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        addDebug('Browser missing getUserMedia')
        throw new Error('This browser does not support microphone capture.')
      }

      addDebug('Requesting microphone permission')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
      addDebug('Microphone access granted')

      addDebug('Requesting signed URL from backend')
      const signedUrl = await getAgentSignedUrl(id)
      try {
        const parsed = new URL(signedUrl)
        addDebug('Signed URL received', { host: parsed.host, path: parsed.pathname })
      } catch {
        addDebug('Signed URL received (unparsed)')
      }

      const schemaFields = Array.isArray(agent?.schema?.widget_names) ? agent.schema.widget_names : []
      const missingFields = schemaFields
      const dynamicVariables = {
        FIRST_MISSING_FIELD_NAME: missingFields[0] || 'field',
        REQUIRED_FIELDS_JSON: JSON.stringify(schemaFields),
        MISSING_FIELDS_LIST: missingFields.join(', '),
      }
      addDebug('Prepared dynamic variables', {
        first: dynamicVariables.FIRST_MISSING_FIELD_NAME,
        required_count: schemaFields.length,
      })

      addDebug('Starting ElevenLabs SDK session')
      const session = await Conversation.startSession({
        signedUrl,
        connectionType: 'websocket',
        dynamicVariables,
        onConnect: (event) => {
          addDebug('SDK onConnect', event)
          setStatus('connected')
        },
        onDisconnect: (event) => {
          addDebug('SDK onDisconnect', event)
          conversationRef.current = null
          setStatus('disconnected')
          setMicOn(false)
        },
        onStatusChange: (nextStatus) => {
          addDebug('SDK onStatusChange', nextStatus)
          setStatus(parseStatus(nextStatus))
        },
        onMessage: (message) => {
          addDebug('SDK onMessage', message)
        },
        onDebug: (debugMessage) => {
          addDebug('SDK onDebug', debugMessage)
        },
        onError: (event) => {
          addDebug('SDK onError', event)
          setError(event?.message || 'Conversation error')
        },
      })

      conversationRef.current = session
      addDebug('Session created')
      await session.setMicMuted(true)
      setMicOn(false)
      addDebug('Mic set to muted by default')

      try {
        await session.sendUserMessage('Please greet the client and start the interview.')
        addDebug('Greeting trigger sent')
      } catch {
        addDebug('Greeting trigger failed or blocked by agent config')
        // Greeting can still come from the agent's configured first message.
      }
    } catch (err) {
      conversationRef.current = null
      setStatus('error')
      setError(err.message || 'Could not start interview session.')
      addDebug('Start interview error', err.message)
    }
  }

  const endInterview = async () => {
    const session = conversationRef.current
    if (!session) {
      addDebug('End skipped', 'No active session')
      return
    }

    addDebug('Terminate session clicked')

    try {
      await session.endSession()
      addDebug('Session terminated')
    } finally {
      conversationRef.current = null
      setStatus('idle')
      setMicOn(false)
    }
  }

  const toggleMic = async () => {
    const session = conversationRef.current
    if (!session) {
      addDebug('Mic toggle skipped', 'No active session')
      return
    }

    try {
      const nextMicOn = !micOn
      await session.setMicMuted(!nextMicOn)
      setMicOn(nextMicOn)
      addDebug('Mic toggled', nextMicOn ? 'unmuted' : 'muted')
    } catch (err) {
      setError(err.message || 'Could not update microphone state.')
      addDebug('Mic toggle error', err.message)
    }
  }

  if (loading) {
    return (
      <main className="pageShell">
        <PortalHeader />
        <section className="hero">
          <p className="eyebrow">Client Node</p>
          <h1>Booting Voice Interface</h1>
          <p className="heroText">Loading agent configuration...</p>
        </section>
      </main>
    )
  }

  if (!agent) {
    return (
      <main className="pageShell">
        <PortalHeader />
        <section className="hero">
          <p className="eyebrow">Client Node</p>
          <h1>Link Signature Not Found</h1>
          <p className="error">{error || 'Agent not found.'}</p>
        </section>
      </main>
    )
  }

  return (
    <main className="pageShell">
      <PortalHeader />

      <section className="hero">
        <p className="eyebrow">Client Node</p>
        <h1>Realtime Voice Session</h1>
        <p className="heroText">
          Secure channel established. Start the session, then toggle your microphone while responding.
        </p>
      </section>

      <section className="card sessionCard">
        <div className="sessionMeta">
          <p>
            Agent ID <code>{id}</code>
          </p>
          <p>
            Status <span className={`statusDot status-${status}`}></span> <strong>{status}</strong>
          </p>
        </div>

        <div className="waveRow" aria-hidden="true">
          <span className={micOn ? 'waveBar live' : 'waveBar'}></span>
          <span className={micOn ? 'waveBar live' : 'waveBar'}></span>
          <span className={micOn ? 'waveBar live' : 'waveBar'}></span>
          <span className={micOn ? 'waveBar live' : 'waveBar'}></span>
          <span className={micOn ? 'waveBar live' : 'waveBar'}></span>
        </div>

        <div className="voiceActions">
          {!conversationRef.current ? (
            <button type="button" onClick={startInterview} disabled={status === 'connecting'} className="btnPrimary">
              {status === 'connecting' ? 'Connecting...' : 'Initialize Session'}
            </button>
          ) : (
            <button type="button" onClick={endInterview} className="btnDanger">
              Terminate Session
            </button>
          )}

          <button type="button" onClick={toggleMic} disabled={!conversationRef.current} className="talkButton">
            {micOn ? 'Mic Live' : 'Activate Mic'}
          </button>
        </div>

        {error && <p className="error">{error}</p>}
        <p className="hint">
          Best quality: use headphones and allow microphone access when prompted by the browser.
        </p>

        <details className="debugPanel" open>
          <summary>Debug Timeline ({debugEvents.length})</summary>
          <div className="debugList">
            {debugEvents.length === 0 ? (
              <p className="hint">No debug events yet.</p>
            ) : (
              debugEvents.map((item) => (
                <p key={item.id} className="debugRow">
                  <span className="debugTime">{item.timestamp}</span>
                  <span className="debugLabel">{item.label}</span>
                  {item.details && <span className="debugDetails">{item.details}</span>}
                </p>
              ))
            )}
          </div>
        </details>
      </section>
    </main>
  )
}
