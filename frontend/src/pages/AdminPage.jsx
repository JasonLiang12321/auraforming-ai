import { useEffect, useState } from 'react'
import HealthCard from '../components/HealthCard'
import PdfUploadForm from '../components/PdfUploadForm'
import PortalHeader from '../components/PortalHeader'
import { getHealth } from '../services/api'

export default function AdminPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const checkApi = async () => {
      try {
        const response = await getHealth()
        setData(response)
      } catch (err) {
        setError(err.message)
      }
    }

    checkApi()
  }, [])

  return (
    <main className="pageShell">
      <PortalHeader />

      <section className="hero">
        <p className="eyebrow">Ops Console</p>
        <h1>Compile Forms Into Interactive Voice Sessions</h1>
        <p className="heroText">
          Ingest a fillable PDF, generate a unique client node, and launch a real-time conversational pipeline from
          your admin control plane.
        </p>
      </section>

      <section className="gridTwo">
        <HealthCard data={data} error={error} />
        <PdfUploadForm />
      </section>
    </main>
  )
}
