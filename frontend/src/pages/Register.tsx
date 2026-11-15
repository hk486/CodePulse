import { FormEvent, useState } from 'react'
import { Mail, UserRound } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthError, AuthInput, AuthPrimaryButton, PasswordInput, PasswordStrengthIndicator } from '../components/auth/AuthFields'
import { AuthFooter, AuthFormContainer, AuthLayout } from '../components/auth/AuthLayout'
import { useAuthStore } from '../stores/authStore'

export function Register() {
  const navigate = useNavigate()
  const { register, loading } = useAuthStore()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!fullName.trim() || !email.trim() || !password || !confirmation) {
      setError('Complete all fields to create your account.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.')
      return
    }
    if (password.length < 8) {
      setError('Your password must be at least 8 characters.')
      return
    }
    if (password !== confirmation) {
      setError('Passwords do not match.')
      return
    }
    setError('')
    try {
      await register(fullName.trim(), email.trim(), password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create account.')
    }
  }

  return <AuthLayout><AuthFormContainer title="Create your account" subtitle="Start understanding and improving your code quality.">
    <form className="auth-form auth-form-register" onSubmit={handleSubmit} noValidate>
      <AuthInput id="register-name" label="Full name" icon={UserRound} autoComplete="name" placeholder="Alex Morgan"
        value={fullName} onChange={e => setFullName(e.target.value)} disabled={loading} />
      <AuthInput id="register-email" label="Work email" icon={Mail} type="email" autoComplete="email" placeholder="you@company.com"
        value={email} onChange={e => setEmail(e.target.value)} disabled={loading} />
      <div><PasswordInput id="register-password" label="Password" autoComplete="new-password" placeholder="Create a password"
        value={password} onChange={e => setPassword(e.target.value)} disabled={loading} />
        <PasswordStrengthIndicator password={password} /></div>
      <PasswordInput id="register-confirm" label="Confirm password" autoComplete="new-password" placeholder="Confirm your password"
        value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={loading} />
      <p className="auth-policy-notice">Terms and privacy policies have not been published yet.</p>
      {error && <AuthError>{error}</AuthError>}
      <AuthPrimaryButton loading={loading}>{loading ? 'Creating account...' : 'Create Account'}</AuthPrimaryButton>
    </form>
    <AuthFooter>Already have an account? <Link to="/login">Sign in</Link></AuthFooter>
  </AuthFormContainer></AuthLayout>
}
