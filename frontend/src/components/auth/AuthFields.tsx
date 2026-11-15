import { AlertCircle, Eye, EyeOff, LoaderCircle, LockKeyhole, LucideIcon } from 'lucide-react'
import { ComponentPropsWithoutRef, ReactNode, useState } from 'react'

type InputProps = ComponentPropsWithoutRef<'input'> & { label: string; icon: LucideIcon; error?: string; trailing?: ReactNode }

export function AuthInput({ label, icon: Icon, error, trailing, id, ...props }: InputProps) {
  return <div className="auth-field">
    <label htmlFor={id}>{label}</label>
    <div className={`auth-input-wrap${error ? ' has-error' : ''}`}>
      <Icon size={18} className="auth-input-icon" aria-hidden="true" />
      <input id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} {...props} />
      {trailing}
    </div>
    {error && <span className="auth-field-error" id={`${id}-error`}>{error}</span>}
  </div>
}

export function PasswordInput(props: Omit<InputProps, 'icon' | 'type' | 'trailing'>) {
  const [visible, setVisible] = useState(false)
  return <AuthInput {...props} icon={LockKeyhole} type={visible ? 'text' : 'password'}
    trailing={<button type="button" className="auth-password-toggle" onClick={() => setVisible(!visible)}
      aria-label={`${visible ? 'Hide' : 'Show'} ${props.label.toLowerCase()}`}>
      {visible ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>} />
}

export function PasswordStrengthIndicator({ password }: { password: string }) {
  const score = [password.length >= 8, /[a-z]/.test(password) && /[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length
  const strength = password ? ['Weak', 'Weak', 'Fair', 'Good', 'Strong'][score] : 'Not set'
  return <div className="auth-strength">
    <div className="auth-strength-label"><span>Password strength</span><span>{strength}</span></div>
    <div className="auth-strength-bars" aria-label={`Password strength: ${strength}`}>
      {[1, 2, 3, 4].map(n => <span key={n} className={password && n <= score ? 'active' : ''} />)}
    </div>
    <p>At least 8 characters. Use a mix of letters, numbers and symbols for a stronger password.</p>
  </div>
}

export function AuthPrimaryButton({ loading, children }: { loading?: boolean; children: ReactNode }) {
  return <button type="submit" className="auth-submit" disabled={loading}>
    {loading && <LoaderCircle className="auth-spinner" size={18} aria-hidden="true" />}{children}
  </button>
}

export function AuthError({ children }: { children: ReactNode }) {
  return <div className="auth-error" role="alert"><AlertCircle size={18} /><span>{children}</span></div>
}
