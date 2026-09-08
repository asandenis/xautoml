import { decryptBytes, encryptBytes } from './crypto'
import type { FileKind, UploadedFile } from './files'
import { fileFingerprint, toUploadedFile } from './files'
import { setProfileStorage } from './auth'
import { QUOTAS, canAddFiles } from './quotas'
import { getSupabase } from './supabase'

type DocumentRow = {
  id: string
  user_id: string
  name: string
  size: number
  mime_type: string
  ext: string
  kind: FileKind
  storage_path: string
  iv: string
  fingerprint: string
  added_at: string
}

function pathFor(userId: string, id: string) {
  return `${userId}/${id}.bin`
}

export async function loadUploads(
  userId: string,
  dataKey: CryptoKey,
): Promise<UploadedFile[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('user_id', userId)
    .order('added_at', { ascending: true })
  if (error) throw new Error(error.message)

  const files: UploadedFile[] = []
  for (const row of (data ?? []) as DocumentRow[]) {
    const { data: blob, error: downloadError } = await supabase.storage
      .from('documents')
      .download(row.storage_path)
    if (downloadError || !blob) continue
    try {
      const plain = await decryptBytes(
        dataKey,
        row.iv,
        await blobToCiphertextB64(blob),
      )
      const file = new File([plain], row.name, {
        type: row.mime_type,
        lastModified: Date.parse(row.added_at) || Date.now(),
      })
      files.push({
        id: row.id,
        file,
        name: row.name,
        size: row.size,
        type: row.mime_type,
        lastModified: file.lastModified,
        ext: row.ext,
        kind: row.kind,
        addedAt: Date.parse(row.added_at) || Date.now(),
      })
    } catch {
      // skip undecryptable
    }
  }
  return files
}

async function blobToCiphertextB64(blob: Blob): Promise<string> {
  const text = await blob.text()
  // stored as base64 text for portability
  return text
}

function b64ToBlob(b64: string, type = 'application/octet-stream') {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}

export async function syncUploads(
  userId: string,
  dataKey: CryptoKey,
  files: UploadedFile[],
): Promise<void> {
  const supabase = getSupabase()
  const { data: existing, error } = await supabase
    .from('documents')
    .select('*')
    .eq('user_id', userId)
  if (error) throw new Error(error.message)

  const rows = (existing ?? []) as DocumentRow[]
  const wanted = new Map(files.map((f) => [f.id, f]))
  const existingIds = new Set(rows.map((r) => r.id))

  for (const row of rows) {
    if (wanted.has(row.id)) continue
    await supabase.storage.from('documents').remove([row.storage_path])
    await supabase.from('documents').delete().eq('id', row.id)
  }

  for (const file of files) {
    if (existingIds.has(file.id)) continue
    const buffer = await file.file.arrayBuffer()
    const { iv, ciphertext } = await encryptBytes(dataKey, buffer)
    const storagePath = pathFor(userId, file.id)
    const { error: upErr } = await supabase.storage
      .from('documents')
      .upload(storagePath, b64ToBlob(ciphertext), {
        upsert: true,
        contentType: 'text/plain',
      })
    if (upErr) throw new Error(upErr.message)

    const { error: insertErr } = await supabase.from('documents').insert({
      id: file.id,
      user_id: userId,
      name: file.name,
      size: file.size,
      mime_type: file.type,
      ext: file.ext,
      kind: file.kind,
      storage_path: storagePath,
      iv,
      fingerprint: fileFingerprint(file.file),
      added_at: new Date(file.addedAt).toISOString(),
    })
    if (insertErr) throw new Error(insertErr.message)
  }

  const storageUsed = files.reduce((s, f) => s + f.size, 0)
  await setProfileStorage(userId, storageUsed)
}

export async function clearUploads(userId: string): Promise<void> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('documents')
    .select('storage_path')
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
  const paths = (data ?? []).map((r) => r.storage_path as string)
  if (paths.length) await supabase.storage.from('documents').remove(paths)
  await supabase.from('documents').delete().eq('user_id', userId)
  await setProfileStorage(userId, 0)
}

export function validateIncoming(
  currentFiles: UploadedFile[],
  incoming: File[],
): { accepted: UploadedFile[]; error: string | null } {
  const acceptedFiles: File[] = []
  const built: UploadedFile[] = []
  const seen = new Set(currentFiles.map((f) => fileFingerprint(f.file)))

  for (const file of incoming) {
    const uploaded = toUploadedFile(file)
    if (!uploaded) continue
    const key = fileFingerprint(file)
    if (seen.has(key)) continue
    acceptedFiles.push(file)
    built.push(uploaded)
    seen.add(key)
  }

  const used = currentFiles.reduce((s, f) => s + f.size, 0)
  const err = canAddFiles(used, currentFiles.length, acceptedFiles)
  if (err) return { accepted: [], error: err }
  if (built.length + currentFiles.length > QUOTAS.maxFiles) {
    return { accepted: [], error: `File limit reached (${QUOTAS.maxFiles} max).` }
  }
  return { accepted: built, error: null }
}
