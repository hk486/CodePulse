import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Mail, CheckCircle2 } from 'lucide-react'
import { AuthError, AuthInput, AuthPrimaryButton } from '../components/auth/AuthFields'
import { AuthFormContainer, AuthLayout } from '../components/auth/AuthLayout'
import { apiFetch, readError } from '../services/apiClient'

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  // With no mail server there is no inbox to check, so the server hands
  // the link back. It is only ever returned outside production.
  const [resetUrl, setResetUrl] = useState('')

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.')
      return
    }

    try {
      const response = await apiFetch('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      })
      if (!response.ok) {
        throw new Error(await readError(response, 'Could not start the password reset.'))
      }
      const result = await response.json()
      setSent(true)
      setResetUrl(result.resetUrl || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the password reset.')
    }
  }

  if (sent) {
    return (
      <AuthLayout>
        <AuthFormContainer
          title="Check your inbox"
          subtitle="If an account exists for that address, a reset link is on its way."
        >
          <div className="flex items-start gap-3 rounded-xl border border-[rgb(var(--glass-edge-inset))] bg-[rgb(var(--glass-fill-inset))] p-4">
            <CheckCircle2 className="w-5 h-5 text-ink-2 flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[14px] text-ink">
                The link is good for one hour and can be used once.
              </p>
              {resetUrl && (
                <p className="mt-3 text-[13px] text-ink-2">
                  No mail server is configured on this instance, so here is the link:{' '}
                  <Link to={resetUrl.replace(/^https?:\/\/[^/]+/, '')} className="auth-link break-all">
                    reset your password
                  </Link>
                </p>
              )}
            </div>
          </div>
          <Link className="auth-back" to="/login">
            <ArrowLeft size={16} /> Back to Sign In
          </Link>
        </AuthFormContainer>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <AuthFormContainer
        title="Forgot your password?"
        subtitle="Enter your registered email address and we will send you a link to set a new one."
      >
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <AuthInput
            id="reset-email"
            label="Email address"
            icon={Mail}
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          {error && <AuthError>{error}</AuthError>}
          <AuthPrimaryButton>Send Reset Link</AuthPrimaryButton>
        </form>
        <Link className="auth-back" to="/login">
          <ArrowLeft size={16} /> Back to Sign In
        </Link>
      </AuthFormContainer>
    </AuthLayout>
  )
}
