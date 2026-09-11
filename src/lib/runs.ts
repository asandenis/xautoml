import { generateRunId } from './crypto'
import { QUOTAS } from './quotas'
import { getSupabase } from './supabase'

export type StageId = 'detect' | 'clean' | 'automl' | 'explain'
export type RunStatus = 'running' | 'complete' | 'failed'

export type RunResources = {
  peakMemoryMb: number
  computeUnits: number
  computeLimit: number
  durationMs: number
}

export type RunRecord = {
  id: string
  userId: string
  status: RunStatus
  stage: StageId
  fileCount: number
  createdAt: number
  updatedAt: number
  completedAt?: number
  summary: string
  result: Record<string, unknown>
  resources: RunResources
}

type RunRow = {
  id: string
  user_id: string
  status: RunStatus
  stage: StageId
  file_count: number
  summary: string
  result: Record<string, unknown>
  resources: RunResources
  created_at: string
  updated_at: string
  completed_at: string | null
}

function fromRow(row: RunRow): RunRecord {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    stage: row.stage,
    fileCount: row.file_count,
    summary: row.summary,
    result: row.result ?? {},
    resources: row.resources ?? {
      peakMemoryMb: 0,
      computeUnits: 0,
      computeLimit: QUOTAS.maxComputeUnitsPerRun,
      durationMs: 0,
    },
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
    completedAt: row.completed_at ? Date.parse(row.completed_at) : undefined,
  }
}

function toRow(run: RunRecord): Omit<RunRow, 'created_at' | 'updated_at' | 'completed_at'> & {
  created_at: string
  updated_at: string
  completed_at: string | null
} {
  return {
    id: run.id,
    user_id: run.userId,
    status: run.status,
    stage: run.stage,
    file_count: run.fileCount,
    summary: run.summary,
    result: run.result,
    resources: run.resources,
    created_at: new Date(run.createdAt).toISOString(),
    updated_at: new Date(run.updatedAt).toISOString(),
    completed_at: run.completedAt ? new Date(run.completedAt).toISOString() : null,
  }
}

export function createRunId() {
  return generateRunId()
}

export async function listRuns(userId: string): Promise<RunRecord[]> {
  const { data, error } = await getSupabase()
    .from('runs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(QUOTAS.maxRunsStored)
  if (error) throw new Error(error.message)
  return ((data ?? []) as RunRow[]).map(fromRow)
}

export async function saveRun(run: RunRecord): Promise<void> {
  const { error } = await getSupabase().from('runs').upsert(toRow(run))
  if (error) throw new Error(error.message)

  // prune older runs beyond free-tier history cap
  const runs = await listRuns(run.userId)
  if (runs.length > QUOTAS.maxRunsStored) {
    const stale = runs.slice(QUOTAS.maxRunsStored)
    await getSupabase()
      .from('runs')
      .delete()
      .in(
        'id',
        stale.map((r) => r.id),
      )
  }
}

export async function getLatestRun(userId: string): Promise<RunRecord | null> {
  const runs = await listRuns(userId)
  return runs[0] ?? null
}

export async function getRun(userId: string, runId: string): Promise<RunRecord | null> {
  const { data, error } = await getSupabase()
    .from('runs')
    .select('*')
    .eq('user_id', userId)
    .eq('id', runId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? fromRow(data as RunRow) : null
}

export async function deleteRun(userId: string, runId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('runs')
    .delete()
    .eq('user_id', userId)
    .eq('id', runId)
  if (error) throw new Error(error.message)
}

export async function countRunsToday(userId: string): Promise<number> {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const { count, error } = await getSupabase()
    .from('runs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', start.toISOString())
  if (error) throw new Error(error.message)
  return count ?? 0
}

export function dummyResultFor(stage: StageId) {
  switch (stage) {
    case 'detect':
      return { task: 'Binary classification', target: 'churned' }
    case 'clean':
      return { features: 22, trainRows: 8736 }
    case 'automl':
      return { bestModel: 'Gradient Boosting', auc: 0.912, f1: 0.84 }
    case 'explain':
      return {
        narrative:
          'Churn risk rises with inactivity, monthly charge, and support tickets (dummy).',
      }
  }
}
