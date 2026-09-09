import { useState, type FormEvent } from 'react'
import {
  cloudReady,
  loginWithGoogle,
  loginWithPassword,
  registerWithPassword,
  type AuthSession,
} from './lib/auth'
import { getSupabaseConfigStatus } from './lib/supabase'

type Mode = 'login' | 'register'

export function AuthModal({
  open,
  onClose,
  onAuthed,
  initialMode = 'register',
}: {
  open: boolean
  onClose: () => void
  onAuthed: (session: AuthSession) => void
  initialMode?: Mode
}) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = cloudReady()
  const configStatus = getSupabaseConfigStatus()

  if (!open) return null

  async function submit(e: FormEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!ready) {
      setError(configStatus.message)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const session =
        mode === 'login'
          ? await loginWithPassword(email, password)
          : await registerWithPassword(email, password)
      onAuthed(session)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.')
    } finally {
      setBusy(false)
    }
  }

  async function google() {
    if (!ready) {
      setError(configStatus.message)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await loginWithGoogle()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.')
      setBusy(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className={`auth-tab${mode === 'register' ? ' is-active' : ''}`}
            aria-selected={mode === 'register'}
            onClick={() => {
              setMode('register')
              setError(null)
            }}
          >
            Register
          </button>
          <button
            type="button"
            role="tab"
            className={`auth-tab${mode === 'login' ? ' is-active' : ''}`}
            aria-selected={mode === 'login'}
            onClick={() => {
              setMode('login')
              setError(null)
            }}
          >
            Sign in
          </button>
        </div>

        <p className="kicker">{mode === 'login' ? 'Welcome back' : 'Create account'}</p>
        <h2 id="auth-title" className="block-title">
          {mode === 'login' ? 'Sign in to xAutoML' : 'Register for xAutoML'}
        </h2>
        <p className="note note-tight">
          Your account, encrypted files, and runs are saved in Supabase. You can delete files or
          your whole account anytime.
        </p>

        {!ready ? <p className="auth-error">{configStatus.message}</p> : null}

        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {error ? <p className="auth-error">{error}</p> : null}

          <button type="submit" className="btn-primary auth-submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="auth-divider">
          <span>or</span>
        </div>

        <button
          type="button"
          className="btn-ghost-inline auth-google"
          onClick={google}
          disabled={busy}
        >
          Continue with Google
        </button>
      </div>
    </div>
  )
}
