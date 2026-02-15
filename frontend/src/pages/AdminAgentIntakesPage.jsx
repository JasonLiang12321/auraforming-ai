import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import PortalHeader from '../components/PortalHeader'
import { useI18n } from '../i18n/I18nProvider'
import { API_BASE_URL, getAgentById, listAgentSessions } from '../services/api'

function toApiAbsoluteUrl(path) {
  if (!path) return ''
  if (/^https?:\/\//i.test(path)) return path
  return `${API_BASE_URL}${path}`
}

function PdfPreviewModal({ session, onClose }) {
  const { t } = useI18n()
  if (!session) return null

  return (
    <div className="modalBackdrop" onClick={onClose}>
      <section className="sessionModal previewOnly" onClick={(event) => event.stopPropagation()}>
        <div className="modalHeader">
          <h2>{t('agent_intakes_preview_title', { id: session.session_id })}</h2>
          <button type="button" className="btnGhost" onClick={onClose}>
            {t('page_close')}
          </button>
        </div>

        <div className="modalPane previewPane">
          <p className="paneLabel">{t('dashboard_modal_preview')}</p>
          <iframe title={`agent-preview-${session.session_id}`} src={toApiAbsoluteUrl(session.pdf_preview_url)} className="pdfFrame" />
          <div className="previewActions">
            <a className="btnGhost btnLink" href={toApiAbsoluteUrl(session.pdf_preview_url)} target="_blank" rel="noreferrer">
              {t('dashboard_modal_open_tab')}
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}

export default function AdminAgentIntakesPage() {
  const { t, formatDateTime } = useI18n()
  const { agentId = '' } = useParams()
  const [agent, setAgent] = useState(null)
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activePreviewSession, setActivePreviewSession] = useState(null)

  const loadIntakes = async () => {
    setLoading(true)
    setError('')
    try {
      const [agentPayload, sessionsPayload] = await Promise.all([getAgentById(agentId), listAgentSessions(agentId)])
      setAgent(agentPayload || null)
      setSessions(Array.isArray(sessionsPayload?.sessions) ? sessionsPayload.sessions : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : t('agent_intakes_error'))
      setSessions([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!agentId) return
    void loadIntakes()
  }, [agentId])

  const countLabel = useMemo(
    () =>
      sessions.length === 1
        ? t('agent_intakes_count_one', { count: sessions.length })
        : t('agent_intakes_count_many', { count: sessions.length }),
    [sessions.length, t],
  )
  const title = agent?.agent_name?.trim() || t('agents_untitled')

  return (
    <main className="pageShell">
      <PortalHeader />

      <section className="hero">
        <p className="eyebrow">{t('business_portal')}</p>
        <h1>{title}</h1>
        <p className="heroText">
          {t('agent_intakes_viewing')} <Link to="/admin/agents">{t('agent_intakes_back')}</Link>
        </p>
      </section>

      <section className="card tableCard">
        <div className="tableHeader">
          <p className="paneLabel">{countLabel}</p>
          <button type="button" className="iconBtn refreshBtn" onClick={loadIntakes} aria-label={t('dashboard_refresh')} title={t('dashboard_refresh')}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4.5 12a7.5 7.5 0 0112.2-5.8l.65.54H15a.75.75 0 000 1.5h4.5a.75.75 0 00.75-.75V3a.75.75 0 00-1.5 0v2.04l-.58-.48A9 9 0 1021 12a.75.75 0 00-1.5 0 7.5 7.5 0 11-15 0z" />
            </svg>
          </button>
        </div>

        {loading ? <p className="hint">{t('loading_intakes')}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {!loading && !error && sessions.length === 0 ? <p className="hint">{t('agent_intakes_empty')}</p> : null}

        {sessions.length > 0 ? (
          <div className="tableWrap">
            <table className="sessionTable">
              <thead>
                <tr>
                  <th>{t('dashboard_table_session')}</th>
                  <th>{t('dashboard_table_fields')}</th>
                  <th>{t('dashboard_table_created')}</th>
                  <th>{t('agent_intakes_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.session_id}>
                    <td>{session.session_id}</td>
                    <td>{session.field_count}</td>
                    <td>{formatDateTime(session.created_at)}</td>
                    <td>
                      <div className="tableActionRow">
                        <button type="button" className="btnGhost" onClick={() => setActivePreviewSession(session)}>
                          {t('agent_intakes_preview_pdf')}
                        </button>
                        <a className="btnGhost btnLink" href={toApiAbsoluteUrl(session.pdf_preview_url)} target="_blank" rel="noreferrer">
                          {t('agent_intakes_new_tab')}
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {activePreviewSession ? <PdfPreviewModal session={activePreviewSession} onClose={() => setActivePreviewSession(null)} /> : null}
    </main>
  )
}
