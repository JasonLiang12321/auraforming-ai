import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import LanguagePicker from './LanguagePicker'
import { useI18n } from '../i18n/I18nProvider'

export default function PortalHeader() {
  const location = useLocation()
  const { t, uiLanguage, setUiLanguage, supportedLanguages } = useI18n()
  const [isPhone, setIsPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const isAdmin = location.pathname === '/admin'
  const isAgents = location.pathname.startsWith('/admin/agents')
  const isJoin = location.pathname === '/' || location.pathname === '/join'

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 700px)')
    const handleChange = (event) => setIsPhone(event.matches)

    setIsPhone(mediaQuery.matches)
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }

    mediaQuery.addListener(handleChange)
    return () => mediaQuery.removeListener(handleChange)
  }, [])

  useEffect(() => {
    if (!isPhone) {
      setMobileMenuOpen(false)
    }
  }, [isPhone])

  const closeMobileMenu = () => setMobileMenuOpen(false)

  return (
    <header className="portalHeader">
      <Link className="brandMark wordmark" to="/" aria-label="auraforming.ai" onClick={closeMobileMenu}>
        <span className="wordmarkText">auraforming</span>
        <span className="wordmarkOrb" aria-hidden="true"></span>
        <span className="wordmarkText">ai</span>
      </Link>
      <button
        type="button"
        className={mobileMenuOpen ? 'portalMenuButton open' : 'portalMenuButton'}
        aria-label="Menu"
        aria-expanded={mobileMenuOpen}
        onClick={() => setMobileMenuOpen((open) => !open)}
      >
        <span></span>
        <span></span>
        <span></span>
      </button>
      <div className={mobileMenuOpen ? 'portalHeaderControls open' : 'portalHeaderControls'}>
        <nav className="portalNav">
          <Link className={isAdmin ? 'navLink createLinkNav active' : 'navLink createLinkNav'} to="/admin" onClick={closeMobileMenu}>
            {t('nav_create_link')}
          </Link>
          <Link className={isAgents ? 'navLink active' : 'navLink'} to="/admin/agents" onClick={closeMobileMenu}>
            {t('nav_agents')}
          </Link>
          <Link className={isJoin ? 'navLink active' : 'navLink'} to="/join" onClick={closeMobileMenu}>
            {t('nav_join')}
          </Link>
        </nav>
        <LanguagePicker
          className="portalLanguageSelect"
          ariaLabel={t('nav_language_label')}
          uiLanguage={uiLanguage}
          setUiLanguage={setUiLanguage}
          supportedLanguages={supportedLanguages}
        />
      </div>
    </header>
  )
}
