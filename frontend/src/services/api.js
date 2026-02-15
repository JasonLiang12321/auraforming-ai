export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5050'

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

export async function translateUiMessages(language_code, source_messages) {
  const response = await fetch(`${API_BASE_URL}/api/gemini/ui-translations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language_code, source_messages }),
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw new Error(payload.error || `Could not translate UI messages (${response.status})`)
  }
  return payload
}

export async function uploadPdf(file, agentName = '') {
  const formData = new FormData()
  formData.append('file', file)
  if (agentName.trim()) {
    formData.append('agent_name', agentName.trim())
  }

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

export async function listAgents() {
  const response = await fetch(`${API_BASE_URL}/api/admin/agents`)
  const payload = await readJson(response)
  if (!response.ok) {
    throw new Error(payload.error || `Could not load agents (${response.status})`)
  }
  return payload
}

export async function listAgentSessions(agentId) {
  const response = await fetch(`${API_BASE_URL}/api/admin/agents/${agentId}/sessions`)
  const payload = await readJson(response)
  if (!response.ok) {
    throw new Error(payload.error || `Could not load agent sessions (${response.status})`)
  }
  return payload
}

export async function deleteAgent(agentId) {
  const response = await fetch(`${API_BASE_URL}/api/admin/agents/${agentId}`, {
    method: 'DELETE',
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw new Error(payload.error || `Could not delete agent (${response.status})`)
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

export async function getAgentLivePreviewPdf(agentId, answers) {
  const response = await fetch(`${API_BASE_URL}/api/agent/${agentId}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers }),
  })

  if (!response.ok) {
    let message = `Could not generate live preview (${response.status})`
    try {
      const payload = await readJson(response)
      message = payload.error || message
    } catch {
      // ignore parse error
    }
    throw new Error(message)
  }

  return response.blob()
}

export async function getAgentSignedUrl(agentId) {
  const response = await fetch(`${API_BASE_URL}/api/agent/${agentId}/signed-url`)
  const payload = await readJson(response)
  if (!response.ok) {
    throw new Error(payload.error || `Could not start voice session (${response.status})`)
  }
  return payload.signed_url
}

export async function startGuidedInterview(agentId, options = {}) {
  const { language_code = '' } = options
  const response = await fetch(`${API_BASE_URL}/api/agent/${agentId}/interview/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language_code }),
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw new Error(payload.error || `Could not start interview state (${response.status})`)
  }
  return payload
}

export async function speakInterviewText(agentId, text) {
  const response = await fetch(`${API_BASE_URL}/api/agent/${agentId}/interview/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  const payload = await readJson(response)
  if (!response.ok) {
    const error = new Error(payload.error || `Could not synthesize speech (${response.status})`)
    error.code = payload.code || ''
    error.status = response.status
    throw error
  }
  return payload
}

export async function submitInterviewTurn(agentId, turnPayload) {
  const response = await fetch(`${API_BASE_URL}/api/agent/${agentId}/interview/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(turnPayload),
  })
  const payload = await readJson(response)
  if (!response.ok) {
    const error = new Error(payload.error || `Could not process interview turn (${response.status})`)
    error.code = payload.code || ''
    error.status = response.status
    throw error
  }
  return payload
}

export async function submitInterviewAudioTurn(agentId, { session_id, audio_blob, was_interruption = false }) {
  const formData = new FormData()
  formData.append('session_id', session_id)
  formData.append('was_interruption', String(Boolean(was_interruption)))
  formData.append('audio', audio_blob, 'turn.webm')

  const response = await fetch(`${API_BASE_URL}/api/agent/${agentId}/interview/turn-audio`, {
    method: 'POST',
    body: formData,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    const error = new Error(payload.error || `Could not process audio turn (${response.status})`)
    error.code = payload.code || ''
    error.status = response.status
    throw error
  }
  return payload
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
