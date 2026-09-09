import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function readEnv(name: string): string {
  const raw = import.meta.env[name]
  if (typeof raw !== 'string') return ''
  return raw.trim().replace(/^['"]|['"]$/g, '')
}

const url = readEnv('VITE_SUPABASE_URL')
const anonKey = readEnv('VITE_SUPABASE_ANON_KEY')

export function isSupabaseConfigured() {
  return Boolean(
    url &&
      anonKey &&
      url.startsWith('http') &&
      !url.includes('YOUR_PROJECT') &&
      !anonKey.includes('YOUR_ANON'),
  )
}

export function getSupabaseConfigStatus() {
  if (isSupabaseConfigured()) return { ok: true as const, message: 'Supabase connected' }
  if (!url || !anonKey) {
    return {
      ok: false as const,
      message:
        'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Add them to .env and restart npm run dev.',
    }
  }
  return {
    ok: false as const,
    message: 'Invalid Supabase env values. Check .env and restart the dev server.',
  }
}

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error(getSupabaseConfigStatus().message)
  }
  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }
  return client
}
