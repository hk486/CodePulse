import { create } from 'zustand'
import { ProjectReport } from '@codepulse/shared'

interface AnalysisState {
  reports: ProjectReport[]
  latestReport?: ProjectReport
  addReport: (report: ProjectReport) => void
  removeReport: (id: string) => void
  loadReports: (reports: ProjectReport[]) => void
}

export const useAnalysisStore = create<AnalysisState>((set) => ({
  reports: [],
  latestReport: undefined,

  addReport: (report) =>
    set((state) => ({
      reports: [report, ...state.reports],
      latestReport: report,
    })),

  removeReport: (id) =>
    set((state) => ({
      reports: state.reports.filter((r) => r.id !== id),
    })),

  loadReports: (reports) =>
    set({
      reports,
      latestReport: reports.length > 0 ? reports[0] : undefined,
    }),
}))
