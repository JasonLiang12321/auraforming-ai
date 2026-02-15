import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import PortalHeader from '../components/PortalHeader'
import { getAgentById, listAgentSessions } from '../services/api'

export default function AdminAgentIntakesPage() {
  const { agentId = '' } = useParams()
  const [agent, setAgent] = useState(null)
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadIntakes = async () => {
    setLoading(true)
    setError('')
    try {
      const [agentPayload, sessionsPayload] = await Promise.all([getAgentById(agentId), listAgentSessions(agentId)])
      setAgent(agentPayload || null)
      setSessions(Array.isArray(sessionsPayload?.sessions) ? sessionsPayload.sessions : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load intakes for this agent.')
      setSessions([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!agentId) return
    void loadIntakes()
  }, [agentId])

  const countLabel = useMemo(() => `${sessions.length} intake${sessions.length === 1 ? '' : 's'}`, [sessions.length])
  const title = agent?.agent_name?.trim() || 'Untitled Agent'

  return (
    <main className="pageShell">
      <PortalHeader />

      <section className="hero">
        <p className="eyebrow">BUSINESS PORTAL</p>
        <h1>{title}</h1>
        <p className="heroText">
          Viewing latest intakes for this agent. <Link to="/admin/agents">Back to agents</Link>
        </p>
      </section>

      <section className="card tableCard">
        <div className="tableHeader">
          <p className="paneLabel">{countLabel}</p>
          <button type="button" className="iconBtn refreshBtn" onClick={loadIntakes} aria-label="Refresh intakes" title="Refresh">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4.5 12a7.5 7.5 0 0112.2-5.8l.65.54H15a.75.75 0 000 1.5h4.5a.75.75 0 00.75-.75V3a.75.75 0 00-1.5 0v2.04l-.58-.48A9 9 0 1021 12a.75.75 0 00-1.5 0 7.5 7.5 0 11-15 0z" />
            </svg>
          </button>
        </div>

        {loading ? <p className="hint">Loading intakes...</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {!loading && !error && sessions.length === 0 ? <p className="hint">No completed intakes yet.</p> : null}

        {sessions.length > 0 ? (
          <div className="tableWrap">
            <table className="sessionTable">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Fields</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.session_id}>
                    <td>{session.session_id}</td>
                    <td>{session.field_count}</td>
                    <td>{new Date(session.created_at).toLocaleString()}</td>
                    <td>
                      <a className="btnGhost btnLink" href={session.pdf_preview_url} target="_blank" rel="noreferrer">
                        Preview PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  )
}
