export default function HealthCard({ data, error }) {
  if (error) {
    return <p className="error">Backend error: {error}</p>
  }

  if (!data) {
    return <p>Checking backend health...</p>
  }

  return (
    <section className="card">
      <h2>Backend Health</h2>
      <p>Status: {data.status}</p>
      <p>Service: {data.service}</p>
    </section>
  )
}
