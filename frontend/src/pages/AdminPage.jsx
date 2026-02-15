import { useState } from 'react'
import { Link } from 'react-router-dom'
import PdfUploadForm from '../components/PdfUploadForm'
import PortalHeader from '../components/PortalHeader'

export default function AdminPage() {
  const [lastAgent, setLastAgent] = useState(null)

  return (
    <main className="pageShell">
      <PortalHeader />

      <section className="hero">
        <p className="eyebrow adminEyebrow">Business Portal</p>
        <h1>Give Clients a Calm, Guided Way to Complete Complex Forms</h1>
        <p className="heroText">
          Upload a fillable PDF form and we'll automatically generate a private interview link. Complete and review sessions seamlessly with any microphone.
        </p>
        <div className="heroActions">
          <Link className="btnPrimary btnLink" to="/admin/dashboard">
            Open Session Dashboard
          </Link>
          {lastAgent?.share_url ? (
            <a className="btnGhost btnLink" href={lastAgent.share_url} target="_blank" rel="noreferrer">
              Open Latest Agent
            </a>
          ) : null}
        </div>
      </section>

      <section className="singleColumn">
        <PdfUploadForm onCreated={setLastAgent} />
      </section>
    </main>
  )
}
