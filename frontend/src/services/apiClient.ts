import { useAuthStore } from '../stores/authStore'

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

/**
 * Fetch wrapper for the CodePulse API.
 *
 * It attaches the bearer token, sets a JSON content type when needed and
 * reacts to an expired session by signing the user out and sending them back
 * to the login page. Without this, a stale token silently uploaded files into
 * the wrong place and the analysis came back empty.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = useAuthStore.getState().token
  const headers = new Headers(init.headers)

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${API_URL}${path}`, { ...init, headers })

  if (response.status === 401 && !path.startsWith('/auth/')) {
    useAuthStore.getState().logout()
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login'
    }
  }

  return response
}

/**
 * Read an error response and turn it into a friendly message.
 */
export async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json()
    if (data?.error) return data.error as string
  } catch {
    // keep the fallback
  }
  return fallback
}
