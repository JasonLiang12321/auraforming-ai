import { Link, useLocation } from 'react-router-dom'
import { useI18n } from '../i18n/I18nProvider'

export default function PortalHeader() {
  const location = useLocation()
  const { t, uiLanguage, setUiLanguage, supportedLanguages } = useI18n()
  const isAdmin = location.pathname === '/admin'
  const isAgents = location.pathname.startsWith('/admin/agents')
  const isDashboard = location.pathname.startsWith('/admin/dashboard')

  return (
    <header className="portalHeader">
      <Link className="brandMark wordmark" to="/" aria-label="auraforming.ai">
        <span className="wordmarkText">auraforming</span>
        <span className="wordmarkOrb" aria-hidden="true"></span>
        <span className="wordmarkText">ai</span>
      </Link>
      <nav className="portalNav">
        <Link className={isAdmin ? 'navLink createLinkNav active' : 'navLink createLinkNav'} to="/admin">
          {t('nav_create_link')}
        </Link>
        <Link className={isAgents ? 'navLink active' : 'navLink'} to="/admin/agents">
          {t('nav_agents')}
        </Link>
        <Link className={isDashboard ? 'navLink active' : 'navLink'} to="/admin/dashboard">
          {t('nav_intakes')}
        </Link>
      </nav>
      <label className="portalLanguageSelect">
        <span>{t('nav_language_label')}</span>
        <select value={uiLanguage} onChange={(event) => setUiLanguage(event.target.value)}>
          {supportedLanguages.map((language) => (
            <option key={language.code} value={language.code}>
              {language.label}
            </option>
          ))}
        </select>
      </label>
    </header>
  )
}
