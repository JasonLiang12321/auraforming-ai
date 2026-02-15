import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import LandingPage from './pages/LandingPage'
import AdminPage from './pages/AdminPage'
import AdminAgentsPage from './pages/AdminAgentsPage'
import AdminAgentIntakesPage from './pages/AdminAgentIntakesPage'
import AgentPage from './pages/AgentPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/join" element={<LandingPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/agents" element={<AdminAgentsPage />} />
        <Route path="/admin/agents/:agentId/intakes" element={<AdminAgentIntakesPage />} />
        <Route path="/agent/:id" element={<AgentPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
