import { useEffect, useMemo, useState } from 'react'
import PortalHeader from '../components/PortalHeader'
import { getDashboardSession, listDashboardSessions } from '../services/api'

function SessionModal({ sessionId, onClose }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const payload = await getDashboardSession(sessionId)
        if (mounted) setSession(payload)
      } catch (err) {
        if (mounted) setError(err.message)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [sessionId])

  return (
    <div className="modalBackdrop" onClick={onClose}>
      <section className="sessionModal" onClick={(event) => event.stopPropagation()}>
        <div className="modalHeader">
          <h2>Intake {sessionId}</h2>
          <button type="button" className="btnGhost" onClick={onClose}>
            Close
          </button>
        </div>

        {loading && <p className="hint">Loading intake details...</p>}
        {error && <p className="error">{error}</p>}

        {session && (
          <div className="modalSplit">
            <div className="modalPane">
              <p className="paneLabel">Extracted JSON</p>
              <pre>{JSON.stringify(session.answers, null, 2)}</pre>
            </div>
            <div className="modalPane">
              <p className="paneLabel">Filled PDF Preview</p>
              <iframe title={`preview-${session.session_id}`} src={session.pdf_preview_url} className="pdfFrame" />
              <a href={session.download_url} className="btnPrimary btnLink" target="_blank" rel="noreferrer">
                Download PDF
              </a>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

export default function AdminDashboardPage() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeSessionId, setActiveSessionId] = useState('')

  const loadSessions = async () => {
    setLoading(true)
    setError('')
    try {
      const payload = await listDashboardSessions()
      setSessions(payload.sessions || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSessions()
  }, [])

  const countLabel = useMemo(() => `${sessions.length} completed intake${sessions.length === 1 ? '' : 's'}`, [sessions.length])

  return (
    <main className="pageShell">
      <PortalHeader />
      <section className="hero">
        <p className="eyebrow">BUSINESS PORTAL</p>
        <h1>Completed Intakes</h1>
        <p className="heroText">Open any intake to review the captured data and the completed form side by side.</p>
      </section>

      <section className="card tableCard">
        <div className="tableHeader">
          <p className="paneLabel">{countLabel}</p>
          <button type="button" className="iconBtn refreshBtn" onClick={loadSessions} aria-label="Refresh intakes" title="Refresh">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4.5 12a7.5 7.5 0 0112.2-5.8l.65.54H15a.75.75 0 000 1.5h4.5a.75.75 0 00.75-.75V3a.75.75 0 00-1.5 0v2.04l-.58-.48A9 9 0 1021 12a.75.75 0 00-1.5 0 7.5 7.5 0 11-15 0z" />
            </svg>
          </button>
        </div>

        {loading ? <p className="hint">Loading intakes...</p> : null}
        {error ? <p className="error">{error}</p> : null}

        {!loading && sessions.length === 0 ? (
          <p className="hint">No completed intakes yet. Finish an interview from an agent link first.</p>
        ) : null}

        {sessions.length > 0 ? (
          <div className="tableWrap">
            <table className="sessionTable">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Agent</th>
                  <th>Fields</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.session_id} onClick={() => setActiveSessionId(session.session_id)}>
                    <td>{session.session_id}</td>
                    <td>{session.agent_id}</td>
                    <td>{session.field_count}</td>
                    <td>{new Date(session.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {activeSessionId ? <SessionModal sessionId={activeSessionId} onClose={() => setActiveSessionId('')} /> : null}
    </main>
  )
}
