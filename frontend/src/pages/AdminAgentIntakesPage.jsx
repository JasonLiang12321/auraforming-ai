import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import PortalHeader from '../components/PortalHeader'
import { useI18n } from '../i18n/I18nProvider'
import { API_BASE_URL, getAgentById, listAgentSessions } from '../services/api'


const styles = {
  analyticsCard: {
    marginBottom: '2rem',
    padding: 0,
    background: 'white',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
    overflow: 'hidden',
  },
  analyticsHeader: {
    margin: 0,
    padding: '1.5rem',
    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
    color: 'white',
    fontSize: '1.5rem',
    fontWeight: 600,
  },
  analyticsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '1px',
    background: '#e5e7eb',
    padding: '1px',
  },
  statCard: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '1rem',
    padding: '1.5rem',
    background: 'white',
    position: 'relative',
    transition: 'all 0.2s ease',
  },
  statCardBorder: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '4px',
    transition: 'width 0.2s ease',
  },
  statIcon: {
    fontSize: '2rem',
    lineHeight: 1,
    opacity: 0.9,
  },
  statContent: {
    flex: 1,
    minWidth: 0,
  },
  statLabel: {
    fontSize: '0.75rem',
    color: '#6b7280',
    margin: '0 0 0.5rem 0',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  statValue: {
    fontSize: '1.875rem',
    fontWeight: 700,
    color: '#111827',
    lineHeight: 1,
    margin: 0,
  },
  progressBar: {
    height: '6px',
    background: '#e5e7eb',
    borderRadius: '3px',
    marginTop: '0.75rem',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
    borderRadius: '3px',
    transition: 'width 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
  },
  languageList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.5rem',
    marginTop: '0.75rem',
  },
  languageBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0.25rem 0.75rem',
    background: '#f3f4f6',
    color: '#374151',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    fontSize: '0.75rem',
    fontWeight: 500,
  },
}

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

// NEW: Analytics Dashboard Component
function AnalyticsDashboard({ analytics, loading }) {
  const { t } = useI18n()
  
  if (loading) {
    return (
      <section style={styles.analyticsCard}>
        <h2 style={styles.analyticsHeader}>{t('Agent Analytics')}</h2>
        <p style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
          {t('loading_analytics')}
        </p>
      </section>
    )
  }

  if (!analytics) return null

  const StatCard = ({ icon, label, value, type, children }) => (
    <div 
      style={styles.statCard}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = '#f9fafb'
        const border = e.currentTarget.querySelector('.stat-border')
        if (border) border.style.width = '6px'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'white'
        const border = e.currentTarget.querySelector('.stat-border')
        if (border) border.style.width = '4px'
      }}
    >
      <div 
        className="stat-border"
        style={{
          ...styles.statCardBorder,
          background: type === 'completed' ? '#10b981' : 
                     type === 'incomplete' ? '#f59e0b' : 
                     type === 'rate' ? '#3b82f6' : '#d1d5db'
        }}
      />
      <div style={styles.statIcon}>{icon}</div>
      <div style={styles.statContent}>
        <p style={styles.statLabel}>{label}</p>
        <p style={styles.statValue}>{value}</p>
        {children}
      </div>
    </div>
  )

  return (
    <section style={styles.analyticsCard}>
      <h2 style={styles.analyticsHeader}>{t('Agent Analytics')}</h2>
      <div style={styles.analyticsGrid}>
        <StatCard 
          icon="📊" 
          label={t('analytics_total_sessions')} 
          value={analytics.total_sessions}
        />

        <StatCard 
          icon="✅" 
          label={t('analytics_completed')} 
          value={analytics.completed_sessions}
          type="completed"
        />

        <StatCard 
          icon="⏸️" 
          label={t('analytics_incomplete')} 
          value={analytics.incomplete_sessions}
          type="incomplete"
        />

        <StatCard 
          icon="📈" 
          label={t('analytics_completion_rate')} 
          value={`${analytics.completion_rate}%`}
          type="rate"
        >
          <div style={styles.progressBar}>
            <div 
              style={{
                ...styles.progressFill,
                width: `${analytics.completion_rate}%`
              }}
            />
          </div>
        </StatCard>

        <StatCard 
          icon="⏱️" 
          label={t('analytics_avg_duration')} 
          value={analytics.avg_duration}
        />

        <StatCard 
          icon="💬" 
          label={t('analytics_total_turns')} 
          value={analytics.total_turns}
        />

        <StatCard 
          icon="🌍" 
          label={t('analytics_languages')}
        >
          <div style={styles.languageList}>
            {analytics.languages?.map(lang => (
              <span key={lang.code} style={styles.languageBadge}>
                {lang.label} ({lang.count})
              </span>
            )) || <span className="hint">N/A</span>}
          </div>
        </StatCard>

        <StatCard 
          icon="📝" 
          label={t('analytics_avg_fields')} 
          value={analytics.avg_fields_completed}
        />
      </div>
    </section>
  )
}
export default function AdminAgentIntakesPage() {
  const { t, formatDateTime } = useI18n()
  const { agentId = '' } = useParams()
  const [agent, setAgent] = useState(null)
  const [sessions, setSessions] = useState([])
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [analyticsLoading, setAnalyticsLoading] = useState(true)
  const [error, setError] = useState('')
  const [activePreviewSession, setActivePreviewSession] = useState(null)

  const loadAnalytics = async () => {
    setAnalyticsLoading(true)
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/agents/${agentId}/analytics`)
      if (!response.ok) throw new Error('Failed to fetch analytics')
      const data = await response.json()
      setAnalytics(data)
    } catch (err) {
      console.error('Analytics error:', err)
    } finally {
      setAnalyticsLoading(false)
    }
  }

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
    void loadAnalytics()
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

      {/* NEW: Analytics Dashboard */}
      <AnalyticsDashboard analytics={analytics} loading={analyticsLoading} />

      <section className="card tableCard">
        <div className="tableHeader">
          <p className="paneLabel">{countLabel}</p>
          <button type="button" className="iconBtn refreshBtn" onClick={() => { loadIntakes(); loadAnalytics(); }} aria-label={t('dashboard_refresh')} title={t('dashboard_refresh')}>
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