const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5050'

export async function getHealth() {
  const response = await fetch(`${API_BASE_URL}/api/health`)

  if (!response.ok) {
    throw new Error(`Health check failed (${response.status})`)
  }

  return response.json()
}
