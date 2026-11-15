import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, FolderOpen, Upload, Play } from 'lucide-react'
import { apiFetch, readError } from '../services/apiClient'

/** How many uploaded files are shown at a time. */
const FILES_PER_PAGE = 25

interface FileUploadProps {
  projectId: string
  onAnalyzed?: (analysisId?: string) => void
}

interface StoredFile {
  id: string
  originalFilename: string
  relativePath: string | null
  fileSize: number
}

interface QueuedFile {
  id: number
  file: File
  path: string
  status: 'pending' | 'uploading' | 'success' | 'error'
  error?: string
}

const excludedDirectories = new Set([
  '.git', 'node_modules', 'dist', 'build', 'target', '.next', '.nuxt',
  'coverage', 'venv', '.venv', '__pycache__', '.pytest_cache',
  '.mypy_cache', 'vendor', '.gradle', '.idea',
])

/**
 * Files are sent in batches so a huge project does not open thousands of
 * connections at once. 50 keeps the requests reasonable while staying fast.
 */
const BATCH_SIZE = 50

function formatFileSize(bytes: number) {
  if (bytes === 0) return '0 Bytes'
  const units = ['Bytes', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${Math.round((bytes / 1024 ** index) * 100) / 100} ${units[index]}`
}

export function FileUpload({ projectId, onAnalyzed }: FileUploadProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const nextId = useRef(0)
  const [folderSupported, setFolderSupported] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [queue, setQueue] = useState<QueuedFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadedCount, setUploadedCount] = useState(0)
  const [storedFiles, setStoredFiles] = useState<StoredFile[]>([])
  // How many files there are in total, and how many have been fetched.
  // A project with five thousand files shows twenty of them at a time.
  const [totalFiles, setTotalFiles] = useState(0)
  const [filesPage, setFilesPage] = useState(1)
  const [listError, setListError] = useState('')
  const [selectionMessage, setSelectionMessage] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [analysing, setAnalysing] = useState(false)
  const [analysisError, setAnalysisError] = useState('')

  useEffect(() => {
    const input = folderInput.current
    if (input && 'webkitdirectory' in input) {
      input.setAttribute('webkitdirectory', '')
      setFolderSupported(true)
    }
  }, [])

  const loadFiles = useCallback(
    async (page = 1) => {
      try {
        const response = await apiFetch(
          `/projects/${projectId}/files?page=${page}&pageSize=${FILES_PER_PAGE}`
        )
        if (!response.ok) {
          throw new Error(
            await readError(response, `Could not load uploaded files (HTTP ${response.status}).`)
          )
        }
        const body = await response.json()
        if (body && Array.isArray(body.items)) {
          setStoredFiles(body.items)
          setTotalFiles(body.total ?? body.items.length)
        } else {
          // A server that does not page sends the whole list.
          setStoredFiles(Array.isArray(body) ? body : [])
          setTotalFiles(Array.isArray(body) ? body.length : 0)
        }
        setListError('')
      } catch (error) {
        setListError(error instanceof Error ? error.message : 'Could not load uploaded files.')
      }
    },
    [projectId]
  )

  useEffect(() => { void loadFiles(1) }, [loadFiles])

  const deleteStoredFile = async (id: string) => {
    setDeletingId(id)
    setListError('')
    try {
      const response = await apiFetch(`/projects/${projectId}/files/${id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await readError(response, `Could not delete file (HTTP ${response.status}).`))
      await loadFiles(filesPage)
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'Could not delete file.')
    } finally {
      setDeletingId(null)
    }
  }

  const addFiles = (selected: File[]) => {
    let skipped = 0
    const additions: QueuedFile[] = []

    // When a folder is picked, the browser reports paths as
    // "rootFolder/sub/dir/file.ts". Strip the root folder so the uploaded
    // tree mirrors the project itself.
    const roots = new Set(
      selected
        .map(f => (f.webkitRelativePath || '').split('/')[0])
        .filter(Boolean)
    )
    const singleRoot = roots.size === 1 ? [...roots][0] : null

    for (const file of selected) {
      const fullPath = file.webkitRelativePath || file.name
      const segments = fullPath.split('/').filter(Boolean)
      const relative =
        singleRoot && segments.length > 1 && segments[0] === singleRoot
          ? segments.slice(1).join('/')
          : fullPath

      // Skip anything inside excluded directories
      if (segments.slice(0, -1).some(part => excludedDirectories.has(part))) {
        skipped++
        continue
      }
      additions.push({ id: nextId.current++, file, path: relative, status: 'pending' })
    }

    setQueue(previous => [...previous, ...additions])
    setSelectionMessage(
      skipped
        ? `${skipped} file${skipped === 1 ? '' : 's'} skipped (build output, dependencies, or version control folders).`
        : additions.length === 0
          ? 'No files selected.'
          : `${additions.length} file${additions.length === 1 ? '' : 's'} ready to upload.`
    )
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    if (uploading) return
    const items = Array.from(event.dataTransfer.items)
    if (items.some(item => item.webkitGetAsEntry?.()?.isDirectory)) {
      setSelectionMessage('Folder drag-and-drop is not supported by all browsers. Use "Choose Folder" to keep the folder structure.')
      return
    }
    addFiles(Array.from(event.dataTransfer.files))
  }

  const updateQueuedFile = (id: number, patch: Partial<QueuedFile>) => {
    setQueue(previous => previous.map(item => (item.id === id ? { ...item, ...patch } : item)))
  }

  /**
   * Upload files in batches so a whole project folder uploads quickly.
   */
  const uploadFiles = async () => {
    setUploading(true)
    setListError('')
    const pending = queue.filter(item => item.status !== 'success')
    const skippedOnUpload: string[] = []

    setUploadedCount(0)

    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE)
      const formData = new FormData()
      for (const item of batch) {
        // The third argument sets the multipart filename, which is how the
        // folder structure reaches the server
        formData.append('files', item.file, item.path)
      }

      try {
        const response = await apiFetch(`/projects/${projectId}/upload`, {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          const message = await readError(response, `Upload failed (HTTP ${response.status}).`)
          batch.forEach(item => updateQueuedFile(item.id, { status: 'error', error: message }))
          continue
        }

        const result = await response.json().catch(() => null)
        if (result?.skippedFiles?.length) {
          skippedOnUpload.push(...result.skippedFiles)
        }

        batch.forEach(item => updateQueuedFile(item.id, { status: 'success', error: undefined }))
        setUploadedCount(current => current + batch.length)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Upload failed.'
        batch.forEach(item => updateQueuedFile(item.id, { status: 'error', error: message }))
      }
    }

    await loadFiles()
    setUploading(false)

    if (skippedOnUpload.length > 0) {
      setListError(
        `${skippedOnUpload.length} file${skippedOnUpload.length === 1 ? '' : 's'} were skipped because the file type is not supported: ${skippedOnUpload.slice(0, 5).join(', ')}${skippedOnUpload.length > 5 ? ', ...' : ''}`
      )
    }
  }

  /**
   * Run the analysis over the uploaded project files.
   */
  const runAnalysis = async () => {
    setAnalysing(true)
    setAnalysisError('')
    try {
      const response = await apiFetch(`/analysis/run/${projectId}`, {
        method: 'POST',
      })

      if (!response.ok) {
        let message = `Analysis failed (HTTP ${response.status}).`
        let hint = ''
        let uploadedFiles: string[] = []
        try {
          const errorData = await response.json()
          if (errorData?.error) message = errorData.error
          if (errorData?.hint) hint = errorData.hint
          if (Array.isArray(errorData?.uploadedFiles)) uploadedFiles = errorData.uploadedFiles
        } catch {
          // keep default
        }
        if (uploadedFiles.length > 0) {
          setAnalysisError(
            `${message}\n${hint}\n\nFiles received (${uploadedFiles.length}): ${uploadedFiles.slice(0, 12).join(', ')}${uploadedFiles.length > 12 ? ', ...' : ''}`
          )
        } else {
          setAnalysisError(hint ? `${message}\n${hint}` : message)
        }
        return
      }

      const result = await response.json()
      // The scan is a job, so the answer comes back straight away. The
      // report page follows it as it runs.
      const scanned = result.scannedFiles ?? 0
      setSelectionMessage(
        `The analysis is under way${scanned ? ` across ${scanned} file${scanned === 1 ? '' : 's'}` : ''}.`
      )
      onAnalyzed?.(result.id)
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : 'Analysis failed.')
    } finally {
      setAnalysing(false)
    }
  }

  const completed = queue.filter(item => item.status === 'success').length
  const attempted = queue.filter(item => item.status === 'success' || item.status === 'error').length
  const pendingCount = queue.length - completed
  const hasStoredFiles = storedFiles.length > 0

  return (
    <div className="w-full">
      {listError && (
        <p role="alert" className="mb-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
          {listError}
        </p>
      )}
      {analysisError && (
        <p role="alert" className="mb-3 whitespace-pre-line rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          {analysisError}
        </p>
      )}

      {hasStoredFiles && (
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <h5 className="text-sm font-semibold text-gray-900 dark:text-white">
              Uploaded project files ({totalFiles})
            </h5>
            <button
              type="button"
              onClick={() => void runAnalysis()}
              disabled={analysing}
              className="btn-primary inline-flex items-center gap-2 px-3 py-1.5 text-[13px]"
            >
              {analysing ? (
                <>
                  <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Analysing...
                </>
              ) : (
                <>
                  <Play className="w-3 h-3" />
                  Analyse Now
                </>
              )}
            </button>
          </div>
          {storedFiles.length < totalFiles && (
            <p className="mt-2 mb-1 text-[12px] text-ink-3">
              Showing {storedFiles.length} of {totalFiles}.{' '}
              <button
                type="button"
                onClick={() => {
                  const next = filesPage + 1
                  setFilesPage(next)
                  void loadFiles(next)
                }}
                className="underline underline-offset-2 hover:text-ink-2"
              >
                Show more
              </button>
            </p>
          )}
          <ul className="mt-2 max-h-48 overflow-y-auto scroll-fade text-sm text-ink-2 dark:text-ink-3">
            {storedFiles.map(file => (
              <li key={file.id} className="flex items-center justify-between gap-3 py-1 border-b border-primary-200 dark:border-primary-800 last:border-0">
                <span className="break-all font-mono text-[13px]">
                  {file.relativePath || file.originalFilename}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-[12px] text-ink-3">{formatFileSize(file.fileSize)}</span>
                  <button
                    type="button"
                    disabled={deletingId !== null || uploading}
                    onClick={() => void deleteStoredFile(file.id)}
                    className="text-rose-600 hover:underline disabled:opacity-50 text-[13px]"
                    aria-label={`Delete ${file.relativePath || file.originalFilename}`}
                  >
                    {deletingId === file.id ? 'Deleting...' : 'Delete'}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Drop zone */}
      <div
        onDragOver={event => { event.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          dragging
            ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
            : 'border-primary-300 dark:border-slate-700'
        }`}
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={event => {
            addFiles(Array.from(event.currentTarget.files || []))
            event.currentTarget.value = ''
          }}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          hidden
          onChange={event => {
            addFiles(Array.from(event.currentTarget.files || []))
            event.currentTarget.value = ''
          }}
        />

        <FolderOpen className="w-9 h-9 mx-auto text-ink-3" aria-hidden="true" />
        <p className="mt-2 text-sm font-semibold text-gray-900 dark:text-white">
          Upload your whole project
        </p>
        <p className="mt-1 text-[13px] text-ink-2">
          Choose a folder to keep its structure, then run the analysis on it.
        </p>

        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
            className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-[13px]"
          >
            <Upload className="w-4 h-4" />
            Choose Files
          </button>
          <button
            type="button"
            disabled={uploading || !folderSupported}
            onClick={() => folderInput.current?.click()}
            className="btn-primary inline-flex items-center gap-2 px-3 py-2 text-[13px]"
          >
            <FolderOpen className="w-4 h-4" />
            Choose Folder
          </button>
        </div>

        {!folderSupported && (
          <p className="mt-2 text-[13px] text-severity-medium">
            Your browser does not support folder selection. Use "Choose Files" instead.
          </p>
        )}
        <p className="mt-2 text-[11px] text-ink-3">
          Skips build output, dependencies and version control folders automatically.
        </p>
      </div>

      {selectionMessage && (
        <p role="status" className="mt-3 text-sm text-ink-2">
          {selectionMessage}
        </p>
      )}

      {queue.length > 0 && (
        <div className="mt-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              Ready to upload ({queue.length})
            </h3>
            <div className="flex gap-2">
              {!uploading && (
                <button
                  type="button"
                  onClick={() => setQueue([])}
                  className="px-2 py-1 text-[13px] text-ink-2 hover:text-ink dark:hover:text-ink-3"
                >
                  Clear
                </button>
              )}
              {pendingCount > 0 && (
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => void uploadFiles()}
                  className="btn-primary px-3 py-1.5 text-[13px]"
                >
                  {uploading ? 'Uploading...' : `Upload ${pendingCount} file${pendingCount === 1 ? '' : 's'}`}
                </button>
              )}
            </div>
          </div>

          <p role="status" className="text-[13px] text-ink-2 dark:text-ink-3">
            {completed} of {queue.length} uploaded
            {attempted > completed ? ` (${attempted - completed} failed)` : ''}
            {uploading && uploadedCount > 0 ? ` · ${uploadedCount} sent` : ''}
          </p>
          <progress
            className="w-full h-2"
            max={queue.length}
            value={completed}
            aria-label="Files uploaded"
          />

          {attempted > completed && (
            <ul className="max-h-32 overflow-y-auto space-y-1">
              {queue
                .filter(item => item.status === 'error')
                .map(item => (
                  <li key={item.id} className="flex items-center gap-2 text-[13px] text-severity-critical">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span className="break-all">{item.path}</span>
                    <span className="truncate">— {item.error}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
