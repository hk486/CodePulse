import { FormEvent, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import { AuthError, AuthPrimaryButton, PasswordInput } from '../components/auth/AuthFields'
import { AuthFormContainer, AuthLayout } from '../components/auth/AuthLayout'
import { apiFetch, readError } from '../services/apiClient'

export function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) {
      setError('That reset link is not valid. Request a new one.')
    }
  }, [token])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }

    setBusy(true)
    try {
      const response = await apiFetch('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      })
      if (!response.ok) {
        throw new Error(await readError(response, 'Could not reset the password.'))
      }
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset the password.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <AuthLayout>
        <AuthFormContainer
          title="Your password has been changed"
          subtitle="Every session on this account has been signed out, for your safety."
        >
          <div className="flex items-start gap-3 rounded-xl border border-[rgb(var(--glass-edge-inset))] bg-[rgb(var(--glass-fill-inset))] p-4">
            <CheckCircle2 className="w-5 h-5 text-ink-2 flex-shrink-0 mt-0.5" />
            <p className="text-[14px] text-ink">
              Sign in with the new password to carry on.
            </p>
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
        title="Set a new password"
        subtitle="Choose something you have not used here before."
      >
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <PasswordInput
            id="new-password"
            label="New password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          <PasswordInput
            id="confirm-password"
            label="Confirm new password"
            autoComplete="new-password"
            placeholder="Type it again"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
          />
          {error && <AuthError>{error}</AuthError>}
          <AuthPrimaryButton loading={busy}>
            Change Password
          </AuthPrimaryButton>
        </form>
        <Link className="auth-back" to="/login">
          <ArrowLeft size={16} /> Back to Sign In
        </Link>
      </AuthFormContainer>
    </AuthLayout>
  )
}
