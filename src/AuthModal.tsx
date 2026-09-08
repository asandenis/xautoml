import { useState, type FormEvent } from 'react'
import {
  cloudReady,
  loginWithGoogle,
  loginWithPassword,
  registerWithPassword,
  type AuthSession,
} from './lib/auth'

type Mode = 'login' | 'register'

export function AuthModal({
  open,
  onClose,
  onAuthed,
}: {
  open: boolean
  onClose: () => void
  onAuthed: (session: AuthSession) => void
}) {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = cloudReady()

  if (!open) return null

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ready) {
      setError('Add Supabase keys to .env before signing in.')
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
      setError('Add Supabase keys to .env before using Google.')
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
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="kicker">{mode === 'login' ? 'Welcome back' : 'Create account'}</p>
        <h2 id="auth-title" className="block-title">
          {mode === 'login' ? 'Sign in to xAutoML' : 'Register for xAutoML'}
        </h2>
        <p className="note note-tight">
          Accounts, documents, and runs are stored in Supabase (free tier). Files are encrypted
          with AES-GCM before upload.
        </p>

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

          <button type="submit" className="btn-primary auth-submit" disabled={busy || !ready}>
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
          disabled={busy || !ready}
        >
          Continue with Google
        </button>

        {!ready ? (
          <p className="upload-warn">Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.</p>
        ) : null}

        <p className="auth-switch">
          {mode === 'login' ? (
            <>
              No account?{' '}
              <button type="button" className="text-btn" onClick={() => setMode('register')}>
                Register
              </button>
            </>
          ) : (
            <>
              Already registered?{' '}
              <button type="button" className="text-btn" onClick={() => setMode('login')}>
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
