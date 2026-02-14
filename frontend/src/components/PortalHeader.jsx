import { Link, useLocation } from 'react-router-dom'

export default function PortalHeader() {
  const location = useLocation()

  return (
    <header className="portalHeader">
      <Link className="brandMark" to="/admin">
        SynapseOps
      </Link>
      <nav className="portalNav">
        <Link className={location.pathname.startsWith('/admin') ? 'navLink active' : 'navLink'} to="/admin">
          Admin
        </Link>
        <span className="navHint">client node: /agent/&lt;id&gt;</span>
      </nav>
    </header>
  )
}
