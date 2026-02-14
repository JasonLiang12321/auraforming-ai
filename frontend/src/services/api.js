const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5050'

async function readJson(response) {
  const text = await response.text()
  return text ? JSON.parse(text) : {}
}

export async function getHealth() {
  const response = await fetch(`${API_BASE_URL}/api/health`)
  const payload = await readJson(response)
  if (!response.ok) throw new Error(payload.error || `Health check failed (${response.status})`)
  return payload
}

export async function uploadPdf(file) {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(`${API_BASE_URL}/api/admin/upload`, {
    method: 'POST',
    body: formData,
  })

  const payload = await readJson(response)
  if (!response.ok) {
    throw new Error(payload.error || `Upload failed (${response.status})`)
  }

  return payload
}

export async function getAgentById(agentId) {
  const response = await fetch(`${API_BASE_URL}/api/agent/${agentId}`)
  const payload = await readJson(response)
  if (!response.ok) {
    throw new Error(payload.error || `Could not load agent (${response.status})`)
  }
  return payload
}

export async function getAgentSignedUrl(agentId) {
  const response = await fetch(`${API_BASE_URL}/api/agent/${agentId}/signed-url`)
  const payload = await readJson(response)
  if (!response.ok) {
    throw new Error(payload.error || `Could not start voice session (${response.status})`)
  }
  return payload.signed_url
}

export async function listDashboardSessions() {
  const response = await fetch(`${API_BASE_URL}/api/admin/dashboard/sessions`)
  const payload = await readJson(response)
  if (!response.ok) {
    throw new Error(payload.error || `Could not load dashboard sessions (${response.status})`)
  }
  return payload
}

export async function getDashboardSession(sessionId) {
  const response = await fetch(`${API_BASE_URL}/api/admin/dashboard/sessions/${sessionId}`)
  const payload = await readJson(response)
  if (!response.ok) {
    throw new Error(payload.error || `Could not load dashboard session (${response.status})`)
  }
  return payload
}
