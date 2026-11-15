import { create } from 'zustand'
import { ProjectReport } from '@codepulse/shared'
import type { ApiFinding, ComponentInfo, TechStack } from '@codepulse/shared'
import { apiFetch, readError } from '../services/apiClient'

export interface Project {
  id: string
  projectId: string
  name: string
  description?: string
  userId?: string
  status: string
  createdAt: number | string
  updatedAt?: number | string
  language?: string
  languages?: string[]
  repositoryUrl?: string
  /** Number of files uploaded for this project */
  fileCount?: number
  /** Languages the scanner detected in the latest analysis. */
  detectedLanguages?: string[]
  /** Frameworks the scanner detected in the latest analysis. */
  detectedFrameworks?: string[]
  /** The services/packages the project is made of. */
  components?: ComponentInfo[]
  /** The grouped technical stack of the project. */
  techStack?: TechStack
}

export interface Analysis {
  id: string
  projectId: string
  totalFindings: number
  critical: number
  high: number
  medium: number
  low: number
  info: number
  findings: ApiFinding[]
  createdAt: string
}

interface AppState {
  // Projects
  projects: Project[]
  loading: boolean
  error: string | null
  
  // Selected project
  selectedProject: Project | null
  selectedProjectAnalyses: Analysis[]
  
  // Data
  reports: ProjectReport[]
  latestReport?: ProjectReport
  
  // Actions
  fetchProjects: () => Promise<void>
  deleteProject: (id: string) => Promise<void>
  
  deleteAnalysis: (id: string) => Promise<void>
  
  removeReport: (id: string) => void
  
  setError: (error: string | null) => void
  clearError: () => void
}

export const useAppStore = create<AppState>((set) => ({
  // Initial state
  projects: [],
  loading: false,
  error: null,
  selectedProject: null,
  selectedProjectAnalyses: [],
  reports: [],
  latestReport: undefined,

  // Project actions
  fetchProjects: async () => {
    set({ loading: true, error: null, projects: [] })
    try {
      const response = await apiFetch('/projects')
      if (!response.ok) throw new Error(await readError(response, `Failed to load projects (HTTP ${response.status}).`))
      const projects = await response.json()
      set({
        projects: projects.map((p: Project) => ({ ...p, projectId: p.id }))
      })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error' })
    } finally {
      set({ loading: false })
    }
  },

  deleteProject: async (id) => {
    set({ loading: true, error: null })
    try {
      const response = await apiFetch(`/projects/${id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await readError(response, 'Failed to delete project'))
      set((state) => ({
        projects: state.projects.filter(p => p.id !== id),
        selectedProject: state.selectedProject?.id === id ? null : state.selectedProject
      }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error' })
    } finally {
      set({ loading: false })
    }
  },

  deleteAnalysis: async (id) => {
    set({ loading: true, error: null })
    try {
      const response = await apiFetch(`/analysis/${id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await readError(response, 'Failed to delete analysis'))
      set((state) => ({
        selectedProjectAnalyses: state.selectedProjectAnalyses.filter(a => a.id !== id)
      }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error' })
    } finally {
      set({ loading: false })
    }
  },

  removeReport: (id) =>
    set((state) => ({
      reports: state.reports.filter((r) => r.id !== id),
    })),

  // Utilities
  setError: (error) => set({ error }),
  clearError: () => set({ error: null })
}))
