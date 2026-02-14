import { useState } from 'react'
import PdfUploadForm from '../components/PdfUploadForm'
import PortalHeader from '../components/PortalHeader'

export default function AdminPage() {
  const [lastAgent, setLastAgent] = useState(null)

  return (
    <main className="pageShell">
      <PortalHeader />

      <section className="hero">
        <p className="eyebrow">BUSINESS PORTAL</p>
        <h1>Guide Clients Through Forms Faster</h1>
        <p className="heroText">
          Upload once, share a private link, and review completed intakes in one place.
        </p>
        <div className="heroActions">
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
