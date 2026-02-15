import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { API_BASE_URL } from '../services/api'

const styles = {
  fieldAnalyticsSection: {
    marginTop: '2rem',
  },
  fieldAnalyticsHeader: {
    marginBottom: '1.5rem',
  },
  fieldCard: {
    padding: '1.5rem',
    marginBottom: '1rem',
    background: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    transition: 'all 0.2s ease',
  },
  fieldCardHover: {
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
    borderColor: '#6366f1',
  },
  fieldHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '1rem',
  },
  fieldName: {
    fontSize: '1.125rem',
    fontWeight: 600,
    color: '#111827',
    marginBottom: '0.25rem',
  },
  fieldLabel: {
    fontSize: '0.875rem',
    color: '#6b7280',
  },
  completionBadge: {
    padding: '0.25rem 0.75rem',
    borderRadius: '12px',
    fontSize: '0.875rem',
    fontWeight: 600,
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '1rem',
    marginTop: '1rem',
  },
  metric: {
    textAlign: 'center',
  },
  metricLabel: {
    fontSize: '0.75rem',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '0.25rem',
  },
  metricValue: {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: '#111827',
  },
  metricSubtext: {
    fontSize: '0.75rem',
    color: '#9ca3af',
    marginTop: '0.25rem',
  },
  sampleValues: {
    marginTop: '1rem',
    padding: '0.75rem',
    background: '#f9fafb',
    borderRadius: '6px',
  },
  sampleLabel: {
    fontSize: '0.75rem',
    color: '#6b7280',
    marginBottom: '0.5rem',
  },
  sampleValueList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.5rem',
  },
  sampleValue: {
    padding: '0.25rem 0.75rem',
    background: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    fontSize: '0.875rem',
  },
}

export default function FieldAnalytics({ agentId }) {
  const { t } = useI18n()
  const [fieldData, setFieldData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [hoveredCard, setHoveredCard] = useState(null)

  useEffect(() => {
    loadFieldAnalytics()
  }, [agentId])

  const loadFieldAnalytics = async () => {
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/agents/${agentId}/analytics/fields`)
      if (!response.ok) throw new Error('Failed to fetch field analytics')
      const data = await response.json()
      setFieldData(data)
    } catch (err) {
      console.error('Field analytics error:', err)
    } finally {
      setLoading(false)
    }
  }

  const getCompletionBadgeStyle = (rate) => {
    let bgColor, textColor
    if (rate >= 80) {
      bgColor = '#d1fae5'
      textColor = '#065f46'
    } else if (rate >= 50) {
      bgColor = '#fef3c7'
      textColor = '#92400e'
    } else {
      bgColor = '#fee2e2'
      textColor = '#991b1b'
    }
    return { ...styles.completionBadge, background: bgColor, color: textColor }
  }

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading field analytics...</div>
  }

  if (!fieldData?.fields?.length) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>No field data available</div>
  }

  return (
    <section style={styles.fieldAnalyticsSection}>
      <div style={styles.fieldAnalyticsHeader}>
        <h2>Field-by-Field Analytics</h2>
        <p style={{ color: '#6b7280', marginTop: '0.5rem' }}>
          Analyzing {fieldData.total_fields} fields • {fieldData.agent_name}
        </p>
      </div>

      {fieldData.fields.map((field, index) => (
        <div
          key={field.field_name}
          style={{
            ...styles.fieldCard,
            ...(hoveredCard === index ? styles.fieldCardHover : {}),
          }}
          onMouseEnter={() => setHoveredCard(index)}
          onMouseLeave={() => setHoveredCard(null)}
        >
          <div style={styles.fieldHeader}>
            <div>
              <div style={styles.fieldName}>
                {field.label || field.field_name}
              </div>
              <div style={styles.fieldLabel}>
                {field.field_type} • Page {field.page_number}
              </div>
            </div>
            <div style={getCompletionBadgeStyle(field.completion_rate)}>
              {field.completion_rate}% Complete
            </div>
          </div>

          <div style={styles.metricsGrid}>
            <div style={styles.metric}>
              <div style={styles.metricLabel}>Completion Rate</div>
              <div style={styles.metricValue}>{field.completion_rate}%</div>
              <div style={styles.metricSubtext}>
                {field.completed_count} completed, {field.incomplete_count} abandoned
              </div>
            </div>
            <div style={styles.metric}>
              <div style={styles.metricLabel}>Total Reached</div>
              <div style={styles.metricValue}>{field.total_reached}</div>
              <div style={styles.metricSubtext}>
                sessions filled this field
              </div>
            </div>
            <div style={styles.metric}>
              <div style={styles.metricLabel}>Avg Length</div>
              <div style={styles.metricValue}>{field.avg_value_length}</div>
              <div style={styles.metricSubtext}>characters</div>
            </div>
          </div>

          {field.sample_values?.length > 0 && (
            <div style={styles.sampleValues}>
              <div style={styles.sampleLabel}>Sample Answers:</div>
              <div style={styles.sampleValueList}>
                {field.sample_values.map((value, i) => (
                  <span key={i} style={styles.sampleValue}>
                    {value}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </section>
  )
}