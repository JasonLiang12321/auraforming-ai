import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AdminPage from './pages/AdminPage'
import AgentPage from './pages/AgentPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/agent/:id" element={<AgentPage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
