import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import MicrophoneToggle from '../components/MicrophoneToggle'

export default function AgentPage() {
  const { id } = useParams()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Initialize agent connection
    setLoading(false)
  }, [id])

  if (loading) {
    return <main className="container"><p>Loading agent interface...</p></main>
  }

  return (
    <main className="container agent-interface">
      <h1>Agent Interface</h1>
      <p className="agent-id">Agent ID: <strong>{id}</strong></p>
      
      <section className="push-to-talk">
        <h2>Push-to-Talk</h2>
        <MicrophoneToggle />
      </section>
    </main>
  )
}
