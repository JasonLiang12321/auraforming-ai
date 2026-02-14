export default function HealthCard({ data, error }) {
  if (error) {
    return (
      <section className="card softCard">
        <h2>API Status</h2>
        <p className="error">Backend error: {error}</p>
      </section>
    )
  }

  if (!data) {
    return (
      <section className="card softCard">
        <h2>API Status</h2>
        <p>Checking backend health...</p>
      </section>
    )
  }

  return (
    <section className="card softCard">
      <h2>API Status</h2>
      <div className="metricRow">
        <p>
          Service <strong>{data.service}</strong>
        </p>
        <p>
          State <span className="statusBadge">{data.status}</span>
        </p>
      </div>
    </section>
  )
}
