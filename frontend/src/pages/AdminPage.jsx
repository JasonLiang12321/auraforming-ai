import { useState } from 'react'
import PdfUploadForm from '../components/PdfUploadForm'
import PortalHeader from '../components/PortalHeader'
import { useI18n } from '../i18n/I18nProvider'

export default function AdminPage() {
  const { t } = useI18n()
  const [lastAgent, setLastAgent] = useState(null)

  return (
    <main className="pageShell">
      <PortalHeader />

      <section className="hero">
        <p className="eyebrow">{t('business_portal')}</p>
        <h1>{t('admin_hero_title')}</h1>
        <p className="heroText">{t('admin_hero_text')}</p>
        <div className="heroActions">
          {lastAgent?.share_url ? (
            <a className="btnGhost btnLink" href={lastAgent.share_url} target="_blank" rel="noreferrer">
              {t('admin_open_latest_agent')}
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
