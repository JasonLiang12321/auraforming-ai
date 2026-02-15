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
  const [pendingDeleteAgent, setPendingDeleteAgent] = useState(null)
  const [deletingAgentId, setDeletingAgentId] = useState('')

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

  const confirmDeleteAgent = async () => {
    if (!pendingDeleteAgent) return
    const agentToDelete = pendingDeleteAgent
    setDeletingAgentId(agentToDelete.agent_id)
    try {
      await deleteAgent(agentToDelete.agent_id)
      setPendingDeleteAgent(null)
      await loadAgents()
    } catch (err) {
      setAgentsError(err instanceof Error ? err.message : t('agents_error_delete'))
    } finally {
      setDeletingAgentId('')
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
            {agents.map((agent) => {
              const intakeCount = Number.isFinite(Number(agent.intake_count)) ? Number(agent.intake_count) : 0
              return (
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
                    <div className="agentTileHeading">
                      <p className="agentTileName">{agent.agent_name || t('agents_untitled')}</p>
                      <p className="agentTileIdBadge">
                        <code>{agent.agent_id}</code>
                      </p>
                    </div>
                    <p className="agentTileMeta">
                      {intakeCount === 1 ? t('agent_intakes_count_one', { count: intakeCount }) : t('agent_intakes_count_many', { count: intakeCount })}
                    </p>
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
                        <path d="M9 3h6l1.2 2H19a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h2.8L9 3zm0.6 2-.6 1H6v12h12V6h-3.2l-.6-1H9.6z" />
                        <path d="M8 10h8v1.6H8zm0 3.2h8v1.6H8z" />
                      </svg>
                    </a>
                    <button
                      type="button"
                      className="iconBtn danger"
                      onClick={(event) => {
                        event.stopPropagation()
                        setPendingDeleteAgent(agent)
                      }}
                      aria-label={`${t('agents_delete_title')}: ${agent.agent_name || agent.agent_id}`}
                      title={t('agents_delete_title')}
                      disabled={deletingAgentId === agent.agent_id}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm-2 6h10l-1 11H8L7 9z" />
                      </svg>
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        ) : null}
      </section>

      {pendingDeleteAgent ? (
        <div className="confirmOverlay" role="dialog" aria-modal="true" aria-label={t('agents_delete_title')}>
          <div className="confirmDialog">
            <p className="eyebrow">{t('agent_confirm')}</p>
            <h3>{t('agents_delete_title')}</h3>
            <p>{t('agents_delete_confirm', { name: pendingDeleteAgent.agent_name?.trim() || t('agents_untitled') })}</p>
            <div className="confirmActions">
              <button type="button" className="btnGhost" onClick={() => setPendingDeleteAgent(null)} disabled={Boolean(deletingAgentId)}>
                {t('page_back')}
              </button>
              <button type="button" className="btnPrimary" onClick={() => void confirmDeleteAgent()} disabled={Boolean(deletingAgentId)}>
                {deletingAgentId ? t('upload_prepare') : t('agents_delete_title')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
