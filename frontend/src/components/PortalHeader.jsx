import { Link, useLocation } from 'react-router-dom'

export default function PortalHeader() {
  const location = useLocation()
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
          Create Link
        </Link>
        <Link className={isAgents ? 'navLink active' : 'navLink'} to="/admin/agents">
          Agents
        </Link>
        <Link className={isDashboard ? 'navLink active' : 'navLink'} to="/admin/dashboard">
          Intakes
        </Link>
      </nav>
    </header>
  )
}
