import { useEffect, useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { useTheme } from '../contexts/ThemeContext'
import {
  Menu,
  X,
  LogOut,
  Settings,
  Moon,
  Sun,
  BarChart3,
  ChevronDown,
  Grid,
  FileText,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { NotificationBell } from './NotificationBell'
import { GlobalSearch } from './GlobalSearch'
import { BrandLogo } from './ui/BrandLogo'

export function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuthStore()
  const { theme, toggleTheme } = useTheme()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false)
  // The sidebar opens with its labels showing, so the navigation reads as
  // a list of places rather than a column of icons. The choice is
  // remembered between visits.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    const stored = window.localStorage.getItem('sidebar-collapsed')
    return stored === null ? false : stored === 'true'
  })

  const toggleSidebar = () => {
    setSidebarCollapsed(previous => {
      const next = !previous
      window.localStorage.setItem('sidebar-collapsed', String(next))
      return next
    })
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
    setProfileDropdownOpen(false)
  }

  const isActive = (path: string) => location.pathname === path

  // The drawer is for small screens, so it closes as soon as the user
  // has gone somewhere.
  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  const navigationItems = [
    { path: '/', label: 'Dashboard', icon: BarChart3, description: 'Overview & KPIs' },
    { path: '/projects', label: 'Projects', icon: Grid, description: 'Manage repositories' },
    { path: '/reports', label: 'Reports', icon: FileText, description: 'Analysis snapshots' },
    { path: '/settings', label: 'Settings', icon: Settings, description: 'Preferences' },
  ]

  return (
    <div className="flex h-screen bg-transparent overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarCollapsed ? 'w-[72px]' : 'w-[240px]'
        } flex flex-col transition-[width] duration-200 hidden md:flex z-20
          bg-white/72 dark:bg-white/[0.04]
          border-r border-white/80 dark:border-white/[0.07]
          shadow-[1px_0_0_rgb(15_23_42_/_0.04)] dark:shadow-none`}
      >
        {/* Logo & Branding. The wordmark starts on the same line as the
            labels in the navigation, so the column reads as one grid. */}
        <div
          className={`h-[76px] flex items-center border-b border-primary-200 dark:border-primary-800 ${
            sidebarCollapsed ? 'justify-center px-0' : 'px-3'
          }`}
        >
          <Link
            to="/"
            className={`flex items-center min-w-0 ${sidebarCollapsed ? 'justify-center' : ''}`}
            title={sidebarCollapsed ? 'CodePulse' : undefined}
          >
            <BrandLogo showText={!sidebarCollapsed} tagline="Engineering intelligence" />
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navigationItems.map((item) => {
            const Icon = item.icon
            const isCurrentPage = isActive(item.path)

            return (
              <Link
                key={item.path}
                to={item.path}
                aria-current={isCurrentPage ? 'page' : undefined}
                className={`group relative flex items-center gap-3 h-10 rounded-[10px] transition-colors duration-150 ${
                  sidebarCollapsed ? 'justify-center pl-0 pr-0' : 'pl-4 pr-3'
                } ${
                  isCurrentPage
                    ? 'bg-primary-300/70 dark:bg-white/[0.11] text-ink font-medium'
                    : 'text-ink-2 hover:bg-white/70 dark:hover:bg-white/[0.06] hover:text-ink'
                }`}
                title={sidebarCollapsed ? item.label : undefined}
              >
                {/* The page you are on, marked at the edge of the row and
                    clear of the icon beside it. */}
                {isCurrentPage && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-accent"
                  />
                )}
                <Icon
                  className={`w-5 h-5 flex-shrink-0 ${
                    isCurrentPage ? 'text-ink' : 'text-ink-3 group-hover:text-ink-2'
                  }`}
                  strokeWidth={1.75}
                />
                {!sidebarCollapsed && (
                  <span className="text-[15px] truncate">{item.label}</span>
                )}
              </Link>
            )
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="border-t border-primary-200 dark:border-primary-800 p-3 flex-shrink-0">
          <button
            onClick={toggleSidebar}
            className={`w-full flex items-center gap-3 h-10 rounded-[10px] text-ink-3 hover:bg-[rgb(var(--glass-fill-hover))] hover:text-ink transition-colors duration-150 ${
              sidebarCollapsed ? 'justify-center pl-0 pr-0' : 'pl-4 pr-3'
            }`}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="w-5 h-5 flex-shrink-0" strokeWidth={1.75} />
            ) : (
              <>
                <PanelLeftClose className="w-5 h-5 flex-shrink-0" strokeWidth={1.75} />
                <span className="text-[15px]">Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* The drawer. On a small screen the sidebar is not on the page at
          all, so the navigation and the search live here. */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
          <aside
            className="relative w-[288px] max-w-[85vw] h-full flex flex-col
              bg-white/97 dark:bg-white/[0.08]
              border-r border-white/85 dark:border-white/[0.08]
              shadow-[18px_0_60px_-24px_rgb(15_23_42_/_0.45)]"
            role="dialog"
            aria-label="Navigation"
          >
            <div className="h-[76px] px-3 border-b border-[rgb(var(--glass-edge-inset))] flex items-center justify-between gap-2">
              <Link to="/" className="flex items-center min-w-0">
                <BrandLogo showText tagline="Engineering intelligence" />
              </Link>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-2 rounded-xl text-ink-2 hover:bg-[rgb(var(--glass-fill-hover))] transition-colors"
                aria-label="Close the menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-3 pt-4">
              <GlobalSearch variant="drawer" />
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
              {navigationItems.map((item) => {
                const Icon = item.icon
                const isCurrentPage = isActive(item.path)
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    aria-current={isCurrentPage ? 'page' : undefined}
                    className={`group relative flex items-center gap-3 h-11 pl-4 pr-3 rounded-[10px] transition-colors duration-150 ${
                      isCurrentPage
                        ? 'bg-primary-300/70 dark:bg-white/[0.11] text-ink font-medium'
                        : 'text-ink-2 hover:bg-white/70 dark:hover:bg-white/[0.06] hover:text-ink'
                    }`}
                  >
                    {isCurrentPage && (
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-accent"
                      />
                    )}
                    <Icon className="w-5 h-5 flex-shrink-0" strokeWidth={1.75} />
                    <div className="min-w-0">
                      <div className="text-[15px] truncate">{item.label}</div>
                      <div className="text-[12px] text-ink-3 truncate mt-0.5">{item.description}</div>
                    </div>
                  </Link>
                )
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between z-10 sticky top-0
          bg-white/62 dark:bg-white/[0.045]
          border-b border-white/80 dark:border-white/[0.07]
          backdrop-blur-md
          shadow-[0_1px_0_rgb(15_23_42_/_0.04)] dark:shadow-none">
          <div className="flex items-center gap-3 flex-1 max-w-full">
            {/* Mobile Menu Button */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="md:hidden w-10 h-10 grid place-items-center hover:bg-[rgb(var(--glass-fill-hover))] rounded-xl text-ink-2 dark:text-ink-3 transition-colors shrink-0"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>

          {/* Header Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Search */}
            <GlobalSearch />

            {/* Notifications */}
            <NotificationBell />

            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="w-10 h-10 grid place-items-center text-ink-2 dark:text-ink-3 hover:text-ink-2 dark:hover:text-ink-2 hover:bg-[rgb(var(--glass-fill-hover))] dark:hover:bg-[rgb(var(--glass-fill-hover))] rounded-xl transition-colors shrink-0"
              title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            >
              {theme === 'light' ? <Moon className="w-[19px] h-[19px]" /> : <Sun className="w-[19px] h-[19px]" />}
            </button>

            {/* User Profile Dropdown */}
            <div className="relative shrink-0">
              <button
                onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                className="flex items-center gap-2 h-10 pl-1.5 pr-2 rounded-xl hover:bg-[rgb(var(--glass-fill-hover))] dark:hover:bg-[rgb(var(--glass-fill-hover))] transition-colors"
              >
                <div className="w-8 h-8 glass-chip text-ink-2 rounded-full flex items-center justify-center text-[13px] font-medium">
                  {(user?.fullName || user?.username)?.[0]?.toUpperCase() || 'U'}
                </div>
                <ChevronDown className="w-4 h-4 text-ink-3" strokeWidth={1.75} />
              </button>

              {/* Dropdown Menu */}
              {profileDropdownOpen && (
                <div className="glass-pop absolute right-0 mt-2 w-56 rounded-xl overflow-hidden z-50">
                  <div className="px-4 py-3 border-b border-[rgb(var(--glass-edge-inset))]">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{user?.fullName || user?.username}</p>
                    <p className="text-[12px] text-ink-2">{user?.email}</p>
                  </div>
                  <Link
                    to="/settings"
                    className="flex items-center gap-3 px-4 py-3 text-sm text-ink dark:text-ink-3 hover:bg-[rgb(var(--glass-fill-hover))] dark:hover:bg-[rgb(var(--glass-fill-hover))] transition-colors"
                    onClick={() => setProfileDropdownOpen(false)}
                  >
                    <Settings className="w-4 h-4 text-ink-3" />
                    Settings
                  </Link>
                  <div className="px-4 py-3 border-t border-primary-200 dark:border-primary-800">
                    <button
                      onClick={handleLogout}
                      className="flex items-center gap-3 w-full px-4 py-3 text-sm text-severity-critical hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors text-left"
                    >
                      <LogOut className="w-4 h-4" />
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto bg-transparent">
          {/* One entrance for the page. Everything inside is static. */}
          <div className="px-4 sm:px-6 lg:px-8 py-8 max-w-[1560px] fade-in">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
