import { FormEvent, useState } from 'react'
import { Mail } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthError, AuthInput, AuthPrimaryButton, PasswordInput } from '../components/auth/AuthFields'
import { AuthFooter, AuthFormContainer, AuthLayout } from '../components/auth/AuthLayout'
import { useAuthStore } from '../stores/authStore'

export function Login() {
  const navigate = useNavigate()
  const { login, loading } = useAuthStore()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!identifier.trim() || !password) {
      setError('Enter your email or username and password.')
      return
    }
    if (identifier.includes('@') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim())) {
      setError('Enter a valid email address.')
      return
    }
    setError('')
    try {
      await login(identifier.trim(), password, remember)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.')
    }
  }

  return <AuthLayout><AuthFormContainer eyebrow="WELCOME BACK" title="Sign in" subtitle="Enter your details to access your workspace.">
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <AuthInput id="login-email" label="Email address or username" icon={Mail} type="text" autoComplete="username"
        placeholder="you@company.com" value={identifier} onChange={e => setIdentifier(e.target.value)} disabled={loading} />
      <PasswordInput id="login-password" label="Password" autoComplete="current-password" placeholder="Enter your password"
        value={password} onChange={e => setPassword(e.target.value)} disabled={loading} />
      <div className="auth-options">
        <label className="auth-checkbox"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /> Remember me</label>
        <Link to="/forgot-password">Forgot password?</Link>
      </div>
      {error && <AuthError>{error}</AuthError>}
      <AuthPrimaryButton loading={loading}>{loading ? 'Signing in...' : 'Sign In'}</AuthPrimaryButton>
    </form>
    <AuthFooter>New to CodePulse? <Link to="/register">Create an account</Link></AuthFooter>
  </AuthFormContainer></AuthLayout>
}
