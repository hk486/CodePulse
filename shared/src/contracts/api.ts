/**
 * The shapes the API answers with.
 *
 * These live here, in the package the frontend and the scanner share, so a
 * change to what the server sends is a change to one file and the compiler
 * points at every place that has to follow.
 */

import type { Severity, Category, Confidence } from "../models/Finding.js";
import type { TechStack, ComponentInfo, Facet } from "../types/ProjectDetection.js";
import type { PipelineRecord, LanguageCoverage } from "./pipeline.js";

/** What every account has. */
export interface User {
  userId: string;
  username: string;
  email: string;
  fullName: string | null;
  role: string;
  photoUrl: string | null;
}

/** The answer to signing in or signing up. */
export interface AuthResponse {
  token: string;
  user: User;
}

/** A project. */
export interface Project {
  id: string;
  name: string;
  path: string | null;
  description: string | null;
  languages: string[];
  userId: string | null;
  repositoryUrl: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/** What is in a project. */
export interface ProjectStats {
  projectId: string;
  name: string;
  files: number;
  bytes: number;
  analyses: number;
  findings: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  languages: string[];
  lastAnalysisAt: string | null;
  lastAnalysisId: string | null;
}

/** One file that was uploaded. */
export interface ProjectFile {
  id: string;
  projectId: string;
  originalFilename: string;
  relativePath: string | null;
  fileSize: number | null;
  storedPath: string;
  createdAt: string;
}

/** The answer to an upload. */
export interface UploadResponse {
  files: ProjectFile[];
  count: number;
  skippedFiles: string[];
  extracted: boolean;
  scanPath: string;
  projectSize: number;
}

/** One finding. */
export interface ApiFinding {
  id: string;
  ruleId?: string;
  title: string;
  description?: string;
  severity: Severity | string;
  category: Category | string;
  confidence?: Confidence | string;
  language?: string;
  facet?: Facet | string;
  componentId?: string;
  toolRuleId?: string;
  recommendation?: string;
  /** What to do about it. The shared finding model calls it this. */
  suggestedAction?: string;
  location?: {
    filePath: string;
    startLine: number;
    endLine?: number;
    startColumn?: number;
    endColumn?: number;
    snippet?: string;
  };
}

/** The counts of the findings. */
export interface FindingSummary {
  totalFindings: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  byCategory?: Record<string, number>;
  byLanguage?: Record<string, number>;
  byFacet?: Record<string, number>;
  byComponent?: Record<string, number>;
}

/** How a scan is going. */
export type AnalysisStatus = "queued" | "running" | "completed" | "failed";

/** The gate: what would hold a build. */
export interface Gate {
  failed: boolean;
  reason: string;
  offenders: {
    severity: string;
    ruleId?: string;
    title?: string;
    filePath?: string;
    line?: number;
  }[];
}

/** A run. It is a job while it is going, and a result when it is done. */
export interface Analysis {
  id: string;
  projectId: string;
  status: AnalysisStatus | string;
  progress: number;
  stage: string | null;
  error?: string | null;
  totalFindings: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  findingsCount: number;
  findings: ApiFinding[];
  scannedFiles: number | null;
  analyzedSource: string | null;
  detectedLanguages: string[];
  detectedFrameworks: string[];
  components: ComponentInfo[];
  techStack: TechStack;
  projectType: string | null;
  coverage: Record<string, unknown> | null;
  analyzersRun: string[];
  executionTime: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  reportId: string | null;
  gate: Gate | null;
  /** What the analysis actually did: the stages, the analyzers, the coverage. */
  pipeline?: PipelineRecord | null;
}

/** The answer to a request for a scan. */
export interface AnalysisQueued {
  id: string;
  projectId: string;
  status: AnalysisStatus;
  progress: number;
  stage: string;
  message: string;
  findingsCount: number;
  queuedAt: string;
  alreadyRunning?: boolean;
}

/** A frozen snapshot of a run. */
export interface Report {
  id: string;
  analysisId: string;
  projectId: string;
  format: string;
  content: string;
  createdAt: string;
}

/** A notification. */
export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
  severity: string;
  read: boolean;
  createdAt: string;
}

/** Which notifications are wanted. */
export interface NotificationPreferences {
  analysisComplete: boolean;
  criticalIssues: boolean;
  weeklySummary: boolean;
  realTimeUpdates: boolean;
}

/** The bell's answer: the notifications and the preferences. */
export interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
  preferences: NotificationPreferences;
}

/** An API key, without the secret. */
export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt?: string | null;
}

/** A new API key, with the secret. It is only ever shown once. */
export interface ApiKeyCreated extends ApiKey {
  key: string;
  message: string;
}

/** An entry in the audit log. */
export interface AuditEntry {
  id: string;
  action: string;
  detail: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

/** The answer to a request for a download. */
export interface DownloadLink {
  url: string;
  expiresIn: number;
}

/** The kinds of download there are. */
export type DownloadKind = "analysis" | "report" | "account";
