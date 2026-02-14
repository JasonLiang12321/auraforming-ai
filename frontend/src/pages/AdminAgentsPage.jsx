import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PortalHeader from '../components/PortalHeader'
import { deleteAgent, listAgents } from '../services/api'

export default function AdminAgentsPage() {
  const navigate = useNavigate()
  const [agents, setAgents] = useState([])
  const [loadingAgents, setLoadingAgents] = useState(true)
  const [agentsError, setAgentsError] = useState('')

  const loadAgents = async () => {
    setLoadingAgents(true)
    setAgentsError('')
    try {
      const payload = await listAgents()
      setAgents(Array.isArray(payload?.agents) ? payload.agents : [])
    } catch (err) {
      setAgentsError(err instanceof Error ? err.message : 'Could not load agents.')
    } finally {
      setLoadingAgents(false)
    }
  }

  useEffect(() => {
    void loadAgents()
  }, [])

  const handleDelete = async (agent) => {
    const displayName = agent.agent_name?.trim() || 'Untitled Agent'
    const confirmed = window.confirm(`Delete agent "${displayName}"? This also removes related intakes.`)
    if (!confirmed) return
    try {
      await deleteAgent(agent.agent_id)
      await loadAgents()
    } catch (err) {
      setAgentsError(err instanceof Error ? err.message : 'Could not delete agent.')
    }
  }

  const countLabel = useMemo(() => `${agents.length} agent${agents.length === 1 ? '' : 's'}`, [agents.length])

  return (
    <main className="pageShell">
      <PortalHeader />

      <section className="hero">
        <p className="eyebrow">BUSINESS PORTAL</p>
        <h1>Manage Agents</h1>
        <p className="heroText">Select any agent row to view its latest client intakes.</p>
      </section>

      <section className="card tableCard">
        <div className="tableHeader">
          <p className="paneLabel">{countLabel}</p>
          <button type="button" className="iconBtn refreshBtn" onClick={loadAgents} aria-label="Refresh agents" title="Refresh">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4.5 12a7.5 7.5 0 0112.2-5.8l.65.54H15a.75.75 0 000 1.5h4.5a.75.75 0 00.75-.75V3a.75.75 0 00-1.5 0v2.04l-.58-.48A9 9 0 1021 12a.75.75 0 00-1.5 0 7.5 7.5 0 11-15 0z" />
            </svg>
          </button>
        </div>

        {loadingAgents ? <p className="hint">Loading agents...</p> : null}
        {agentsError ? <p className="error">{agentsError}</p> : null}
        {!loadingAgents && !agentsError && agents.length === 0 ? <p className="hint">No agents yet. Create one from the Create Link tab.</p> : null}

        {agents.length > 0 ? (
          <div className="agentsGrid">
            {agents.map((agent) => (
              <article
                key={agent.agent_id}
                className="agentTile"
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/admin/agents/${agent.agent_id}/intakes`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    navigate(`/admin/agents/${agent.agent_id}/intakes`)
                  }
                }}
              >
                <div className="agentTileMain">
                  <p className="agentTileName">{agent.agent_name || 'Untitled Agent'}</p>
                  <p className="agentTileMeta">
                    ID <code>{agent.agent_id}</code>
                  </p>
                  <p className="agentTileMeta">Fields: {agent.field_count}</p>
                  <p className="agentTileMeta">Created: {new Date(agent.created_at).toLocaleString()}</p>
                </div>
                <div className="agentTileActions">
                  <a
                    className="iconBtn"
                    href={agent.share_url || `/agent/${encodeURIComponent(agent.agent_id)}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`Open interview link for ${agent.agent_name || agent.agent_id}`}
                    title="Open start interview page"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M14 3h7v7h-2V6.4l-9.3 9.3-1.4-1.4L17.6 5H14V3z" />
                      <path d="M5 5h7v2H7v10h10v-5h2v7H5V5z" />
                    </svg>
                  </a>
                  <button
                    type="button"
                    className="iconBtn danger"
                    onClick={(event) => {
                      event.stopPropagation()
                      void handleDelete(agent)
                    }}
                    aria-label={`Delete agent ${agent.agent_name || agent.agent_id}`}
                    title="Delete agent"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm-2 6h10l-1 11H8L7 9z" />
                    </svg>
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  )
}
