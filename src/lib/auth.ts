import {
  bufToB64,
  b64ToBuf,
  exportKeyRaw,
  generateDataKey,
  importKeyRaw,
} from './crypto'
import { getSupabase, isSupabaseConfigured } from './supabase'

export type AuthProvider = 'password' | 'google'

export type SessionUser = {
  id: string
  email: string
  provider: AuthProvider
  displayName: string
}

export type AuthSession = {
  user: SessionUser
  dataKey: CryptoKey
}

type ProfileRow = {
  id: string
  email: string
  display_name: string
  data_key_b64: string
  storage_used: number
}

function providerFrom(meta: Record<string, unknown> | undefined): AuthProvider {
  const provider = String(meta?.provider ?? meta?.iss ?? '')
  if (provider.includes('google')) return 'google'
  return 'password'
}

async function ensureProfile(
  userId: string,
  email: string,
  displayName: string,
): Promise<{ profile: ProfileRow; dataKey: CryptoKey }> {
  const supabase = getSupabase()
  const { data: existing, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw new Error(error.message)

  if (existing) {
    const dataKey = await importKeyRaw(b64ToBuf(existing.data_key_b64))
    return { profile: existing as ProfileRow, dataKey }
  }

  const dataKey = await generateDataKey()
  const raw = await exportKeyRaw(dataKey)
  const row = {
    id: userId,
    email,
    display_name: displayName,
    data_key_b64: bufToB64(raw),
    storage_used: 0,
  }
  const { data, error: insertError } = await supabase
    .from('profiles')
    .insert(row)
    .select('*')
    .single()
  if (insertError) throw new Error(insertError.message)
  return { profile: data as ProfileRow, dataKey }
}

async function sessionFromUser(user: {
  id: string
  email?: string | null
  user_metadata?: Record<string, unknown>
  app_metadata?: Record<string, unknown>
}): Promise<AuthSession> {
  const email = (user.email ?? '').toLowerCase()
  if (!email) throw new Error('Account is missing an email address.')
  const displayName =
    String(user.user_metadata?.full_name ?? user.user_metadata?.name ?? email.split('@')[0]) ||
    email
  const { profile, dataKey } = await ensureProfile(user.id, email, displayName)
  return {
    user: {
      id: profile.id,
      email: profile.email,
      provider: providerFrom(user.app_metadata),
      displayName: profile.display_name,
    },
    dataKey,
  }
}

export function cloudReady() {
  return isSupabaseConfigured()
}

export async function restoreSession(): Promise<AuthSession | null> {
  if (!isSupabaseConfigured()) return null
  const supabase = getSupabase()
  const { data, error } = await supabase.auth.getSession()
  if (error) throw new Error(error.message)
  if (!data.session?.user) return null
  return sessionFromUser(data.session.user)
}

export async function registerWithPassword(
  emailInput: string,
  password: string,
): Promise<AuthSession> {
  const email = emailInput.trim().toLowerCase()
  if (!email.includes('@')) throw new Error('Enter a valid email.')
  if (password.length < 8) throw new Error('Password must be at least 8 characters.')

  const supabase = getSupabase()
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw new Error(error.message)
  if (!data.user) throw new Error('Registration failed.')
  if (!data.session) {
    throw new Error('Check your email to confirm the account, then sign in.')
  }
  return sessionFromUser(data.user)
}

export async function loginWithPassword(
  emailInput: string,
  password: string,
): Promise<AuthSession> {
  const supabase = getSupabase()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: emailInput.trim().toLowerCase(),
    password,
  })
  if (error) throw new Error(error.message)
  if (!data.user) throw new Error('Sign-in failed.')
  return sessionFromUser(data.user)
}

export async function loginWithGoogle(): Promise<void> {
  const supabase = getSupabase()
  const redirectTo = `${window.location.origin}/`
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  })
  if (error) throw new Error(error.message)
}

export async function logout(): Promise<void> {
  if (!isSupabaseConfigured()) return
  const { error } = await getSupabase().auth.signOut()
  if (error) throw new Error(error.message)
}

export async function getProfileStorage(userId: string): Promise<number> {
  const { data, error } = await getSupabase()
    .from('profiles')
    .select('storage_used')
    .eq('id', userId)
    .single()
  if (error) throw new Error(error.message)
  return Number(data.storage_used ?? 0)
}

export async function setProfileStorage(userId: string, storageUsed: number) {
  const { error } = await getSupabase()
    .from('profiles')
    .update({ storage_used: storageUsed })
    .eq('id', userId)
  if (error) throw new Error(error.message)
}

export function onAuthChange(handler: (session: AuthSession | null) => void) {
  if (!isSupabaseConfigured()) return () => {}
  const supabase = getSupabase()
  const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
    if (!session?.user || event === 'SIGNED_OUT') {
      handler(null)
      return
    }
    try {
      handler(await sessionFromUser(session.user))
    } catch {
      handler(null)
    }
  })
  return () => data.subscription.unsubscribe()
}
