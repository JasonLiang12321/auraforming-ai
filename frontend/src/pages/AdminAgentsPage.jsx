import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PortalHeader from '../components/PortalHeader'
import { useI18n } from '../i18n/I18nProvider'
import { deleteAgent, listAgents } from '../services/api'

export default function AdminAgentsPage() {
  const { t, formatDateTime } = useI18n()
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
      setAgentsError(err instanceof Error ? err.message : t('agents_error_load'))
    } finally {
      setLoadingAgents(false)
    }
  }

  useEffect(() => {
    void loadAgents()
  }, [])

  const handleDelete = async (agent) => {
    const displayName = agent.agent_name?.trim() || t('agents_untitled')
    const confirmed = window.confirm(t('agents_delete_confirm', { name: displayName }))
    if (!confirmed) return
    try {
      await deleteAgent(agent.agent_id)
      await loadAgents()
    } catch (err) {
      setAgentsError(err instanceof Error ? err.message : t('agents_error_delete'))
    }
  }

  const countLabel = useMemo(
    () => (agents.length === 1 ? t('agents_count_one', { count: agents.length }) : t('agents_count_many', { count: agents.length })),
    [agents.length, t],
  )

  return (
    <main className="pageShell">
      <PortalHeader />

      <section className="hero">
        <p className="eyebrow">{t('business_portal')}</p>
        <h1>{t('agents_manage_title')}</h1>
        <p className="heroText">{t('agents_manage_subtitle')}</p>
      </section>

      <section className="card tableCard">
        <div className="tableHeader">
          <p className="paneLabel">{countLabel}</p>
          <button type="button" className="iconBtn refreshBtn" onClick={loadAgents} aria-label={t('agents_refresh')} title={t('agents_refresh')}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4.5 12a7.5 7.5 0 0112.2-5.8l.65.54H15a.75.75 0 000 1.5h4.5a.75.75 0 00.75-.75V3a.75.75 0 00-1.5 0v2.04l-.58-.48A9 9 0 1021 12a.75.75 0 00-1.5 0 7.5 7.5 0 11-15 0z" />
            </svg>
          </button>
        </div>

        {loadingAgents ? <p className="hint">{t('loading_agents')}</p> : null}
        {agentsError ? <p className="error">{agentsError}</p> : null}
        {!loadingAgents && !agentsError && agents.length === 0 ? <p className="hint">{t('agents_empty')}</p> : null}

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
                  <p className="agentTileName">{agent.agent_name || t('agents_untitled')}</p>
                  <p className="agentTileMeta">
                    ID <code>{agent.agent_id}</code>
                  </p>
                  <p className="agentTileMeta">{t('agents_field_count', { count: agent.field_count })}</p>
                  <p className="agentTileMeta">{t('agents_created', { value: formatDateTime(agent.created_at) })}</p>
                </div>
                <div className="agentTileActions">
                  <a
                    className="iconBtn"
                    href={agent.share_url || `/agent/${encodeURIComponent(agent.agent_id)}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`${t('agents_open_title')}: ${agent.agent_name || agent.agent_id}`}
                    title={t('agents_open_title')}
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
                    aria-label={`${t('agents_delete_title')}: ${agent.agent_name || agent.agent_id}`}
                    title={t('agents_delete_title')}
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
