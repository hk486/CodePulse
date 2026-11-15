import { create } from 'zustand'
import { authService, AuthResponse } from '../services/authService'
import { API_URL } from '../services/apiClient'

interface User {
  userId: string
  username: string
  email: string
  role: string
  fullName?: string | null
}

interface AuthState {
  user: User | null
  token: string | null
  loading: boolean
  error: string | null
  isAuthenticated: boolean
  register: (fullName: string, email: string, password: string) => Promise<void>
  login: (identifier: string, password: string, remember: boolean) => Promise<void>
  logout: () => void
  loadFromStorage: () => void
}

function clearStoredSession() {
  for (const storage of [localStorage, sessionStorage]) {
    storage.removeItem('token')
    storage.removeItem('user')
  }
}

function saveSession(data: AuthResponse, remember: boolean) {
  const { token, ...user } = data
  clearStoredSession()
  const storage = remember ? localStorage : sessionStorage
  storage.setItem('token', token)
  storage.setItem('user', JSON.stringify(user))
  return { token, user, isAuthenticated: true, loading: false, error: null }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  loading: false,
  error: null,
  isAuthenticated: false,

  register: async (fullName, email, password) => {
    set({ loading: true, error: null })
    try {
      const data = await authService.register({ fullName, email, password })
      set(saveSession(data, false))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Registration failed', loading: false })
      throw error
    }
  },

  login: async (identifier, password, remember) => {
    set({ loading: true, error: null })
    try {
      const data = await authService.login(identifier.includes('@')
        ? { email: identifier, password }
        : { username: identifier, password })
      set(saveSession(data, remember))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Sign in failed', loading: false })
      throw error
    }
  },

  logout: () => {
    // The session is ended on the server too, so the token cannot be
    // used again after signing out.
    const token = useAuthStore.getState().token
    if (token) {
      void fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {
        // The local session is cleared either way.
      })
    }
    clearStoredSession()
    set({ user: null, token: null, isAuthenticated: false, error: null })
  },

  loadFromStorage: () => {
    const storage = sessionStorage.getItem('token') ? sessionStorage : localStorage
    const token = storage.getItem('token')
    const userStr = storage.getItem('user')
    if (token && userStr) {
      try {
        const user: User = JSON.parse(userStr)
        if (!user || typeof user.userId !== 'string' || typeof user.username !== 'string'
          || typeof user.email !== 'string' || typeof user.role !== 'string') {
          throw new Error('Invalid stored user')
        }
        set({ token, user, isAuthenticated: true })
      } catch {
        clearStoredSession()
        set({ user: null, token: null, isAuthenticated: false, error: 'Your saved session could not be restored. Please sign in again.' })
      }
    }
  }
}))
