import { useEffect, useState } from 'react'
import HealthCard from '../components/HealthCard'
import PdfUploadForm from '../components/PdfUploadForm'
import { getHealth } from '../services/api'

export default function HomePage() {
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
    <main className="container">
      <h1>Hackathon Starter</h1>
      <HealthCard data={data} error={error} />
      <PdfUploadForm />
    </main>
  )
}
