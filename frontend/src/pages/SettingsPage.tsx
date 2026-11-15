import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { authService } from '../services/authService'
import { apiFetch, readError } from '../services/apiClient'
import { downloadFromApi } from '../services/download'
import { ApiKeysPanel } from '../components/ApiKeysPanel'
import { AuditLogPanel } from '../components/AuditLogPanel'
import { WebhooksPanel } from '../components/WebhooksPanel'
import { SchedulesPanel } from '../components/SchedulesPanel'
import { PageHeader } from '../components/ui/PageHeader'
import type { User } from '@codepulse/shared'

interface NotificationPreferences {
  analysisComplete: boolean
  criticalIssues: boolean
  weeklySummary: boolean
  realTimeUpdates: boolean
}
import {
  Mail,
  UserRound,
  LockKeyhole,
  Eye,
  EyeOff,
  ShieldCheck,
  KeyRound,
  Webhook,
  CalendarClock,
  History,
  AlertCircle,
  CheckCircle,
  Clock,
  Bell,
  Check,
  Upload,
  Download,
  LucideIcon,
} from 'lucide-react'

/**
 * One preference, on one row.
 *
 * The rows stack into one list with a hairline between them, so the group
 * reads as a single block rather than as a pile of cards.
 */
function ToggleSwitch({
  checked,
  label,
  description,
  onChange,
  icon: Icon,
}: {
  checked: boolean
  label: string
  description: string
  onChange: () => void
  icon: LucideIcon
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-4">
      <div className="flex items-center gap-4 min-w-0">
        <div className="w-10 h-10 rounded-[10px] bg-surface-raised dark:bg-slate-700 flex items-center justify-center text-ink-2 shrink-0">
          <Icon className="w-[18px] h-[18px]" />
        </div>
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-ink">{label}</div>
          <div className="text-[13px] text-ink-2 mt-0.5">{description}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={onChange}
        className={`relative inline-flex h-7 w-[52px] shrink-0 items-center rounded-full transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card disabled:cursor-not-allowed disabled:opacity-50 ${
          checked
            ? 'bg-accent hover:brightness-95'
            : 'bg-primary-300 hover:bg-primary-400 dark:bg-primary-700 dark:hover:bg-primary-600'
        }`}
        role="switch"
        aria-checked={checked}
        aria-label={label}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full shadow-sm transition-transform duration-200 ease-out ${
            checked ? 'translate-x-[28px] bg-white' : 'translate-x-1 bg-primary-50 dark:bg-primary-200'
          }`}
        />
      </button>
    </div>
  )
}

export function SettingsPage() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('profile')
  const [downloadingData, setDownloadingData] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [dangerNotice, setDangerNotice] = useState('')
  const [formData, setFormData] = useState({
    email: user?.email || '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [notifications, setNotifications] = useState<NotificationPreferences>({
    analysisComplete: true,
    criticalIssues: true,
    weeklySummary: true,
    realTimeUpdates: true,
  })
  const [savingNotifications, setSavingNotifications] = useState(false)
  const [saved, setSaved] = useState(false)
  const [passwordVisible, setPasswordVisible] = useState({
    current: false,
    new: false,
    confirm: false,
  })
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const photoInput = useRef<HTMLInputElement>(null)

  // Load the notification preferences from the backend
  useEffect(() => {
    apiFetch('/notifications/preferences')
      .then(async response => {
        if (!response.ok) throw new Error('Could not load notification preferences.')
        return response.json()
      })
      .then((preferences: NotificationPreferences) => {
        setNotifications(preferences)
      })
      .catch(err => {
        console.error('Failed to load notification preferences:', err)
      })
  }, [])

  // Load profile from backend API on mount
  useEffect(() => {
    authService
      .getProfile()
      .then((profile: User) => {
        setPhotoPreview(profile.photoUrl || null)
        setFormData((prev) => ({ ...prev, email: profile.email || '' }))
      })
      .catch((err) => {
        console.error('Failed to load profile:', err)
      })
  }, [])

  // Save photo to backend API when changed
  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Reject folders and non-files
    if (file.type === '' && !file.name.includes('.')) {
      alert('Please select an image file, not a folder.')
      return
    }

    // Reject non-image files
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file (JPG, PNG). Folders and other file types are not allowed.')
      return
    }

    // Reject unsupported image types
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png']
    if (!allowedTypes.includes(file.type)) {
      alert('Only JPG and PNG images are allowed.')
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      alert('Image must be smaller than 2MB')
      return
    }

    setUploadingPhoto(true)
    try {
      const reader = new FileReader()
      reader.onload = async () => {
        const dataUrl = reader.result as string
        setPhotoPreview(dataUrl)
        try {
          await authService.updateProfile({ photoUrl: dataUrl })
          setSaved(true)
          setTimeout(() => setSaved(false), 3000)
        } catch (err) {
          console.error('Failed to save photo:', err)
          alert('Failed to save photo to server')
        } finally {
          setUploadingPhoto(false)
        }
      }
      reader.readAsDataURL(file)
    } catch (err) {
      setUploadingPhoto(false)
      console.error('Photo upload error:', err)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleNotificationChange = (key: keyof typeof notifications) => {
    setNotifications((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault()
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const saveNotifications = async () => {
    setSavingNotifications(true)
    try {
      const response = await apiFetch('/notifications/preferences', {
        method: 'PUT',
        body: JSON.stringify(notifications)
      })
      if (!response.ok) {
        throw new Error(await readError(response, 'Could not save your notification preferences.'))
      }
      const savedPreferences = await response.json()
      setNotifications(savedPreferences)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setDangerNotice(err instanceof Error ? err.message : 'Could not save your notification preferences.')
    } finally {
      setSavingNotifications(false)
    }
  }

  const handleSaveNotifications = (e: React.FormEvent) => {
    e.preventDefault()
    void saveNotifications()
  }

  const navigationItems = [
    { key: 'profile', label: 'Profile', icon: UserRound },
    { key: 'notifications', label: 'Notifications', icon: Bell },
    { key: 'apiKeys', label: 'API keys', icon: KeyRound },
    { key: 'webhooks', label: 'Webhooks', icon: Webhook },
    { key: 'schedules', label: 'Schedules', icon: CalendarClock },
    { key: 'activity', label: 'Activity', icon: History },
    { key: 'security', label: 'Security', icon: ShieldCheck },
  ]

  /**
   * Download everything that belongs to this account as a single JSON file.
   */
  const handleDownloadData = async () => {
    setDownloadingData(true)
    setDangerNotice('')
    try {
      // The server puts the account together and hands it over as a file.
      await downloadFromApi('account')
      setDangerNotice('Your data was downloaded.')
    } catch (err) {
      setDangerNotice(err instanceof Error ? err.message : 'Could not download your data.')
    } finally {
      setDownloadingData(false)
    }
  }

  /**
   * Permanently delete the account and everything it owns.
   */
  const handleDeleteAccount = async () => {
    const confirmed = window.confirm(
      'Delete your account and every project, analysis and report in it? This cannot be undone.'
    )
    if (!confirmed) return

    setDeletingAccount(true)
    setDangerNotice('')
    try {
      const response = await apiFetch('/auth/account', { method: 'DELETE' })
      if (!response.ok) {
        throw new Error(await readError(response, 'Could not delete your account.'))
      }
      logout()
      navigate('/login', { replace: true })
    } catch (err) {
      setDangerNotice(err instanceof Error ? err.message : 'Could not delete your account.')
      setDeletingAccount(false)
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Settings"
        description="Manage your account preferences and settings"
      />

      {saved && (
        <div className="alert alert-success" role="status">
          <CheckCircle className="w-4 h-4" />
          <span>Changes saved successfully</span>
        </div>
      )}

      {/* Settings Container */}
      <div className="card-flush">
        {/* Tab Navigation. The tab you are on is marked with a rule
            under it, the way a bookmark sits in a page. */}
        <div className="border-b border-[rgb(var(--glass-edge-inset))] px-6 flex gap-6 overflow-x-auto">
          {navigationItems.map((item) => {
            const Icon = item.icon
            const isActive = activeTab === item.key
            return (
              <button
                key={item.key}
                onClick={() => setActiveTab(item.key)}
                aria-current={isActive ? 'page' : undefined}
                className={`relative flex items-center gap-2 h-12 shrink-0 transition-colors duration-150 ${
                  isActive
                    ? 'text-ink font-medium'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
                <span className="text-[15px]">{item.label}</span>
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 right-0 -bottom-px h-[2px] rounded-full bg-accent"
                  />
                )}
              </button>
            )
          })}
        </div>

        {/* Tab Content */}
        <div className="p-6 sm:p-8">
          {/* Profile Tab */}
          {activeTab === 'profile' && (
            <form onSubmit={handleSaveProfile} className="space-y-8">
              <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-8 lg:gap-12">
                {/* Profile Picture */}
                <div className="space-y-4">
                  <h2 className="title">Your picture</h2>
                  <div className="relative w-16 h-16 flex-shrink-0">
                    <div className={`w-16 h-16 rounded-xl flex items-center justify-center text-[24px] font-semibold ${
                      photoPreview ? 'bg-transparent' : 'glass-chip text-ink-2'
                    }`}>
                      {photoPreview ? (
                        <img src={photoPreview} alt="Profile" className="w-full h-full object-cover rounded-2xl" />
                      ) : (
                        (user?.fullName || user?.username)?.[0]?.toUpperCase() || 'U'
                      )}
                    </div>
                    {uploadingPhoto && (
                      <div className="absolute inset-0 bg-black/50 rounded-2xl flex items-center justify-center">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
                          <span className="text-[13px] text-white font-medium">Uploading...</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="btn-secondary inline-flex items-center gap-2 text-[14px] cursor-pointer">
                      <Upload className="w-4 h-4" /> Change Photo
                      <input
                        ref={photoInput}
                        type="file"
                        accept="image/jpeg,image/png,image/jpg"
                        className="hidden"
                        onChange={handlePhotoChange}
                      />
                    </label>
                    <p className="text-[13px] text-ink-3 mt-2">JPG, PNG (max 2MB)</p>
                  </div>
                  <p className="text-[13px] text-ink-3">
                    Your profile picture appears on your dashboard and in project views.
                  </p>
                </div>

                {/* The fields, in one column so they read in order */}
                <div className="space-y-5 max-w-[560px]">
                  <div>
                    <label className="form-label" htmlFor="settings-full-name">Full Name</label>
                    <input
                      id="settings-full-name"
                      type="text"
                      value={user?.fullName || ''}
                      placeholder="John Doe"
                      className="input-field"
                    />
                  </div>

                  <div>
                    <label className="form-label" htmlFor="settings-email">Email Address</label>
                    <div className="relative">
                      <Mail className="input-icon" />
                      <input
                        id="settings-email"
                        type="email"
                        name="email"
                        value={formData.email}
                        onChange={handleInputChange}
                        className="input-field input-with-icon"
                        placeholder="you@company.com"
                      />
                    </div>
                    <p className="form-hint">We'll use this for notifications and account recovery.</p>
                  </div>

                  <div>
                    <label className="form-label" htmlFor="settings-username">Username</label>
                    <div className="relative">
                      <input
                        id="settings-username"
                        type="text"
                        value={user?.username || ''}
                        disabled
                        className="input-field bg-surface-page dark:bg-surface-raised/30 text-ink-3 cursor-not-allowed pr-20"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-3 font-medium">
                        Fixed
                      </span>
                    </div>
                    <p className="form-hint">Your username cannot be changed after account creation.</p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-6 border-t border-[rgb(var(--glass-edge-inset))]">
                <button type="submit" className="btn-primary">
                  Save Changes
                </button>
              </div>
            </form>
          )}

          {/* Notifications Tab */}
          {activeTab === 'notifications' && (
            <form onSubmit={handleSaveNotifications} className="space-y-8">
              <div className="max-w-[720px]">
                <h2 className="title mb-2">Notifications</h2>
                <p className="text-sm text-ink-2">
                  Choose what CodePulse tells you about. These preferences are saved to your account.
                </p>
              </div>

              <div className="divide-y divide-[rgb(var(--glass-edge-inset))] max-w-[720px]">
                <ToggleSwitch
                  checked={notifications.analysisComplete}
                  label="Analysis finished"
                  description="Get a notification when a project analysis finishes"
                  onChange={() => handleNotificationChange('analysisComplete')}
                  icon={Clock}
                />
                <ToggleSwitch
                  checked={notifications.criticalIssues}
                  label="Critical issues"
                  description="Get an extra alert when critical issues are found"
                  onChange={() => handleNotificationChange('criticalIssues')}
                  icon={AlertCircle}
                />
                <ToggleSwitch
                  checked={notifications.weeklySummary}
                  label="Weekly summary"
                  description="A digest of the last seven days: findings, criticals and the projects they came from"
                  onChange={() => handleNotificationChange('weeklySummary')}
                  icon={Check}
                />
                <ToggleSwitch
                  checked={notifications.realTimeUpdates}
                  label="Live updates"
                  description="Keep the bell up to date on its own while you work. Turn it off and it only refreshes when you open it"
                  onChange={() => handleNotificationChange('realTimeUpdates')}
                  icon={Bell}
                />
              </div>

              <div className="flex justify-end pt-6 border-t border-[rgb(var(--glass-edge-inset))] max-w-[720px]">
                <button
                  type="submit"
                  onClick={() => void saveNotifications()}
                  disabled={savingNotifications}
                  className="btn-primary inline-flex items-center gap-2"
                >
                  {savingNotifications ? 'Saving...' : 'Save preferences'}
                </button>
              </div>
            </form>
          )}

          {/* API Keys Tab */}
          {activeTab === 'apiKeys' && (
            <ApiKeysPanel />
          )}

          {/* Webhooks Tab */}
          {activeTab === 'webhooks' && (
            <WebhooksPanel />
          )}

          {/* Schedules Tab */}
          {activeTab === 'schedules' && (
            <SchedulesPanel />
          )}

          {/* Activity Tab */}
          {activeTab === 'activity' && (
            <AuditLogPanel />
          )}

          {/* Security Tab */}
          {activeTab === 'security' && (
            <form onSubmit={handleSaveProfile} className="space-y-8">
              <div className="glass-inset rounded-xl p-6 max-w-[720px]">
                <div className="flex items-start gap-3 mb-6">
                  <ShieldCheck className="w-5 h-5 text-ink-2 mt-0.5" />
                  <div>
                    <div className="text-[14px] font-medium text-ink">Password Requirements</div>
                    <div className="text-[13px] text-ink-2 mt-0.5">
                      Minimum 8 characters, including uppercase, lowercase, and numbers
                    </div>
                  </div>
                </div>

                <div className="space-y-5">
                  <div>
                    <label className="form-label" htmlFor="settings-current-password">Current Password</label>
                    <div className="relative">
                      <LockKeyhole className="input-icon" />
                      <input
                        id="settings-current-password"
                        type={passwordVisible.current ? 'text' : 'password'}
                        name="currentPassword"
                        value={formData.currentPassword}
                        onChange={handleInputChange}
                        className="input-field input-with-icon pr-10"
                        placeholder="••••••••"
                      />
                      <button
                        type="button"
                        onClick={() => setPasswordVisible((p) => ({ ...p, current: !p.current }))}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink-2 dark:hover:text-ink-3"
                        aria-label={passwordVisible.current ? 'Hide the password' : 'Show the password'}
                      >
                        {passwordVisible.current ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="form-label" htmlFor="settings-new-password">New Password</label>
                    <div className="relative">
                      <LockKeyhole className="input-icon" />
                      <input
                        id="settings-new-password"
                        type={passwordVisible.new ? 'text' : 'password'}
                        name="newPassword"
                        value={formData.newPassword}
                        onChange={handleInputChange}
                        className="input-field input-with-icon pr-10"
                        placeholder="••••••••"
                      />
                      <button
                        type="button"
                        onClick={() => setPasswordVisible((p) => ({ ...p, new: !p.new }))}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink-2 dark:hover:text-ink-3"
                        aria-label={passwordVisible.new ? 'Hide the password' : 'Show the password'}
                      >
                        {passwordVisible.new ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="form-label" htmlFor="settings-confirm-password">Confirm New Password</label>
                    <div className="relative">
                      <LockKeyhole className="input-icon" />
                      <input
                        id="settings-confirm-password"
                        type={passwordVisible.confirm ? 'text' : 'password'}
                        name="confirmPassword"
                        value={formData.confirmPassword}
                        onChange={handleInputChange}
                        className="input-field input-with-icon pr-10"
                        placeholder="••••••••"
                      />
                      <button
                        type="button"
                        onClick={() => setPasswordVisible((p) => ({ ...p, confirm: !p.confirm }))}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink-2 dark:hover:text-ink-3"
                        aria-label={passwordVisible.confirm ? 'Hide the password' : 'Show the password'}
                      >
                        {passwordVisible.confirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-6 border-t border-[rgb(var(--glass-edge-inset))] max-w-[720px]">
                <button type="submit" className="btn-primary">
                  Update Password
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Danger Zone */}
      <div className="card">
        <div className="flex items-center gap-3 mb-2">
          <AlertCircle className="w-5 h-5 text-severity-critical" />
          <h2 className="title">Danger Zone</h2>
        </div>
        <p className="text-sm text-ink-2 mb-6">
          Irreversible actions that should be performed with caution.
        </p>
        {dangerNotice && (
          <p role="status" className="glass-inset mb-4 rounded-xl px-4 py-3 text-sm text-ink">
            {dangerNotice}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleDownloadData()}
            disabled={downloadingData}
            className="btn-secondary inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Download className="w-4 h-4" />
            {downloadingData ? 'Preparing...' : 'Download your data'}
          </button>
          <button
            type="button"
            onClick={() => void handleDeleteAccount()}
            disabled={deletingAccount}
            className="btn-danger inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <AlertCircle className="w-4 h-4" />
            {deletingAccount ? 'Deleting...' : 'Delete Account'}
          </button>
        </div>
      </div>
    </div>
  )
}
