import { useEffect, useMemo, useState } from 'react'
import PortalHeader from '../components/PortalHeader'
import { useI18n } from '../i18n/I18nProvider'
import { API_BASE_URL, getDashboardSession, listDashboardSessions } from '../services/api'

function toApiAbsoluteUrl(path) {
  if (!path) return ''
  if (/^https?:\/\//i.test(path)) return path
  return `${API_BASE_URL}${path}`
}

function SessionModal({ sessionId, onClose }) {
  const { t } = useI18n()
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
          <h2>{t('dashboard_modal_title', { id: sessionId })}</h2>
          <button type="button" className="btnGhost" onClick={onClose}>
            {t('page_close')}
          </button>
        </div>

        {loading && <p className="hint">{t('loading_intake_details')}</p>}
        {error && <p className="error">{error}</p>}

        {session && (
          <div className="modalSplit intakeModalSplit">
            <div className="modalPane previewPane">
              <p className="paneLabel">{t('dashboard_modal_preview')}</p>
              <iframe title={`preview-${session.session_id}`} src={toApiAbsoluteUrl(session.pdf_preview_url)} className="pdfFrame" />
              <div className="previewActions">
                <a href={toApiAbsoluteUrl(session.pdf_preview_url)} className="btnGhost btnLink" target="_blank" rel="noreferrer">
                  {t('dashboard_modal_open_tab')}
                </a>
                <a href={toApiAbsoluteUrl(session.download_url)} className="btnPrimary btnLink" target="_blank" rel="noreferrer">
                  {t('dashboard_modal_download')}
                </a>
              </div>
            </div>
            <details className="modalPane previewJsonDetails">
              <summary>{t('dashboard_modal_show_json')}</summary>
              <pre>{JSON.stringify(session.answers, null, 2)}</pre>
            </details>
          </div>
        )}
      </section>
    </div>
  )
}

export default function AdminDashboardPage() {
  const { t, formatDateTime } = useI18n()
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

  const countLabel = useMemo(
    () =>
      sessions.length === 1
        ? t('dashboard_count_one', { count: sessions.length })
        : t('dashboard_count_many', { count: sessions.length }),
    [sessions.length, t],
  )

  return (
    <main className="pageShell">
      <PortalHeader />
      <section className="hero">
        <p className="eyebrow">{t('business_portal')}</p>
        <h1>{t('dashboard_title')}</h1>
        <p className="heroText">{t('dashboard_subtitle')}</p>
      </section>

      <section className="card tableCard">
        <div className="tableHeader">
          <p className="paneLabel">{countLabel}</p>
          <button type="button" className="iconBtn refreshBtn" onClick={loadSessions} aria-label={t('dashboard_refresh')} title={t('dashboard_refresh')}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4.5 12a7.5 7.5 0 0112.2-5.8l.65.54H15a.75.75 0 000 1.5h4.5a.75.75 0 00.75-.75V3a.75.75 0 00-1.5 0v2.04l-.58-.48A9 9 0 1021 12a.75.75 0 00-1.5 0 7.5 7.5 0 11-15 0z" />
            </svg>
          </button>
        </div>

        {loading ? <p className="hint">{t('loading_intakes')}</p> : null}
        {error ? <p className="error">{error}</p> : null}

        {!loading && sessions.length === 0 ? (
          <p className="hint">{t('dashboard_empty')}</p>
        ) : null}

        {sessions.length > 0 ? (
          <div className="tableWrap">
            <table className="sessionTable">
              <thead>
                <tr>
                  <th>{t('dashboard_table_session')}</th>
                  <th>{t('dashboard_table_agent')}</th>
                  <th>{t('dashboard_table_fields')}</th>
                  <th>{t('dashboard_table_created')}</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.session_id} onClick={() => setActiveSessionId(session.session_id)}>
                    <td>{session.session_id}</td>
                    <td>{session.agent_id}</td>
                    <td>{session.field_count}</td>
                    <td>{formatDateTime(session.created_at)}</td>
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
