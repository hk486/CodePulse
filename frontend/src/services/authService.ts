import type { User } from '@codepulse/shared'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

export interface AuthResponse {
  token: string
  userId: string
  username: string
  email: string
  role: string
  fullName?: string | null
  photoUrl?: string | null
}

export interface UserProfile {
  id: string
  username: string
  email: string
  fullName: string | null
  photoUrl: string | null
  role: string
  createdAt: string
}

async function authenticate(path: string, body: object): Promise<AuthResponse> {
  let response: Response
  try {
    response = await fetch(`${API_URL}/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Unable to reach the authentication service. Check that the gateway is running and allows this frontend origin.')
    }
    throw error
  }

  if (!response.ok) {
    const contentType = response.headers.get('content-type') || ''
    const error = contentType.includes('application/json') ? await response.json() : null
    // Show the backend's user-friendly error message directly
    throw new Error(typeof error?.error === 'string' ? error.error : typeof error?.message === 'string' ? error.message : `Request failed (${response.status}).`)
  }

  const data = await response.json()
  if (!data || ['token', 'userId', 'username', 'email', 'role'].some(key => typeof data[key] !== 'string' || !data[key])) {
    throw new Error('The authentication service returned an invalid response.')
  }
  return data as AuthResponse
}

async function authenticatedRequest<T = unknown>(
  path: string,
  options: { method?: string; body?: object }
): Promise<T> {
  const token = typeof window !== 'undefined' ? (localStorage.getItem('token') || sessionStorage.getItem('token')) : null
  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` })
      },
      ...(options.body && { body: JSON.stringify(options.body) })
    })
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Unable to reach the authentication service. Check that the gateway is running and allows this frontend origin.')
    }
    throw error
  }

  if (!response.ok) {
    const contentType = response.headers.get('content-type') || ''
    const error = contentType.includes('application/json') ? await response.json() : null
    throw new Error(
      typeof error?.error === 'string'
        ? error.error
        : typeof error?.message === 'string'
          ? error.message
          : `Request failed (${response.status}).`
    )
  }

  return response.json()
}

export const authService = {
  login: (credentials: { username?: string; email?: string; password: string }) => authenticate('login', credentials),
  register: (details: { fullName: string; email: string; password: string }) => authenticate('register', details),
  getProfile: () => authenticatedRequest<User>('/auth/profile', { method: 'GET' }),
  updateProfile: (data: { fullName?: string; email?: string; photoUrl?: string }) =>
    authenticatedRequest<User>('/auth/profile', { method: 'PATCH', body: data }),
}
