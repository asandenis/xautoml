/** Free-tier oriented limits so many users fit on Supabase + Netlify free plans. */
export const QUOTAS = {
  /** Soft cap per user — ~25 users ≈ 1GB Supabase Storage free tier */
  maxStorageBytes: 40 * 1024 * 1024,
  /** Max files in a library */
  maxFiles: 25,
  /** Single upload size */
  maxFileBytes: 8 * 1024 * 1024,
  /** Daily pipeline executions per user */
  maxRunsPerDay: 15,
  /** Kept run history per user */
  maxRunsStored: 40,
  /** Dummy compute budget per run (scaled by data size) */
  maxComputeUnitsPerRun: 100,
  /** Estimated RAM ceiling shown in the meter (MB) */
  maxMemoryMb: 512,
} as const

export type UsageSnapshot = {
  storageUsed: number
  storageLimit: number
  fileCount: number
  fileLimit: number
  runsToday: number
  runsPerDayLimit: number
  storagePct: number
}

export type ResourceMeter = {
  memoryMb: number
  memoryLimitMb: number
  computeUnits: number
  computeLimit: number
  stageLabel: string
}

export function buildUsage(storageUsed: number, fileCount: number, runsToday: number): UsageSnapshot {
  return {
    storageUsed,
    storageLimit: QUOTAS.maxStorageBytes,
    fileCount,
    fileLimit: QUOTAS.maxFiles,
    runsToday,
    runsPerDayLimit: QUOTAS.maxRunsPerDay,
    storagePct: Math.min(100, (storageUsed / QUOTAS.maxStorageBytes) * 100),
  }
}

export function estimateRunResources(totalBytes: number, fileCount: number): {
  memoryMb: number
  computeLimit: number
} {
  const memoryMb = Math.min(
    QUOTAS.maxMemoryMb,
    Math.max(48, Math.round(totalBytes / (1024 * 1024) * 12 + fileCount * 8)),
  )
  const computeLimit = Math.min(
    QUOTAS.maxComputeUnitsPerRun,
    Math.max(20, Math.round(fileCount * 8 + totalBytes / (512 * 1024))),
  )
  return { memoryMb, computeLimit }
}

export function canAddFiles(
  currentUsed: number,
  currentCount: number,
  incoming: { size: number }[],
): string | null {
  if (currentCount + incoming.length > QUOTAS.maxFiles) {
    return `File limit reached (${QUOTAS.maxFiles} max on the free plan).`
  }
  for (const f of incoming) {
    if (f.size > QUOTAS.maxFileBytes) {
      return `Each file must be ≤ ${Math.round(QUOTAS.maxFileBytes / (1024 * 1024))} MB.`
    }
  }
  const added = incoming.reduce((s, f) => s + f.size, 0)
  if (currentUsed + added > QUOTAS.maxStorageBytes) {
    return `Storage limit reached (${Math.round(QUOTAS.maxStorageBytes / (1024 * 1024))} MB / user).`
  }
  return null
}

export function formatStorage(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
