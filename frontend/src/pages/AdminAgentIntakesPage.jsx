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

function formatAgentToken(agentId) {
  const raw = String(agentId || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  if (raw.length <= 4) return raw
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`
}

function PdfPreviewModal({ session, formName, onClose }) {
  const { t } = useI18n()
  if (!session) return null

  return (
    <div className="modalBackdrop fullscreenBackdrop" onClick={onClose}>
      <section className="sessionModal previewOnly fullscreenModal" onClick={(event) => event.stopPropagation()}>
        <div className="modalHeader">
          <div className="modalTitleBlock">
            <h2 className="modalTitleStrong">{`${session.session_id} - ${formName}`}</h2>
            <span className="modalIdBadge">{formatAgentToken(session.agent_id)}</span>
          </div>
          <button type="button" className="btnGhost modalCloseButton" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6.7 5.3a1 1 0 0 1 1.4 0L12 9.17l3.9-3.88a1 1 0 1 1 1.4 1.42L13.4 10.6l3.9 3.9a1 1 0 1 1-1.4 1.4L12 12l-3.88 3.9a1 1 0 1 1-1.42-1.4l3.9-3.9-3.9-3.88a1 1 0 0 1 0-1.42z" />
            </svg>
            <span>{t('page_close')}</span>
          </button>
        </div>

        <div className="fullscreenPreviewLayout">
          <div className="modalPane previewPane fullscreenPreviewPane">
            <p className="paneLabel">{t('dashboard_modal_preview')}</p>
            <iframe title={`agent-preview-${session.session_id}`} src={toApiAbsoluteUrl(session.pdf_preview_url)} className="pdfFrame fullscreenPdfFrame" />
            <div className="previewActions previewActionsRight">
              <a className="btnGhost btnLink previewActionLink" href={toApiAbsoluteUrl(session.pdf_preview_url)} target="_blank" rel="noreferrer">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M14 4a1 1 0 0 0 0 2h2.59l-5.3 5.29a1 1 0 1 0 1.42 1.42L18 7.41V10a1 1 0 1 0 2 0V4h-6z" />
                  <path d="M6 5a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-4a1 1 0 1 0-2 0v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4a1 1 0 0 0 0-2H6z" />
                </svg>
                <span>{t('dashboard_modal_open_tab')}</span>
              </a>
              <a className="btnPrimary btnLink previewActionLink" href={toApiAbsoluteUrl(session.download_url)} target="_blank" rel="noreferrer">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42L11 12.59V4a1 1 0 0 1 1-1z" />
                  <path d="M5 15a1 1 0 0 1 1 1v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2a1 1 0 1 1 2 0v2a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-2a1 1 0 0 1 1-1z" />
                </svg>
                <span>{t('dashboard_modal_download')}</span>
              </a>
            </div>
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
                  <th>Form</th>
                  <th>{t('dashboard_table_created')}</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.session_id} onClick={() => setActivePreviewSession(session)}>
                    <td>{session.session_id}</td>
                    <td>
                      <div className="formCell">
                        <span className="formCellName">{title}</span>
                        <span className="tableIdBadge">{formatAgentToken(session.agent_id || agentId)}</span>
                      </div>
                    </td>
                    <td>{formatDateTime(session.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {activePreviewSession ? <PdfPreviewModal session={activePreviewSession} formName={title} onClose={() => setActivePreviewSession(null)} /> : null}
    </main>
  )
}
