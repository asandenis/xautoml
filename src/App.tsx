import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react'
import { AuthModal } from './AuthModal'
import {
  cloudReady,
  getProfileStorage,
  logout as logoutCloud,
  restoreSession,
  type AuthSession,
} from './lib/auth'
import {
  clearUploads,
  loadUploads,
  syncUploads,
  validateIncoming,
} from './lib/fileStore'
import {
  ACCEPT_ATTR,
  FILE_SECTIONS,
  type FileKind,
  type UploadedFile,
  formatBytes,
  groupByKind,
  isAccepted,
} from './lib/files'
import {
  QUOTAS,
  buildUsage,
  estimateRunResources,
  formatStorage,
  type ResourceMeter,
  type UsageSnapshot,
} from './lib/quotas'
import {
  countRunsToday,
  createRunId,
  dummyResultFor,
  getLatestRun,
  listRuns,
  saveRun,
  type RunRecord,
  type StageId,
} from './lib/runs'

const STAGES: { id: StageId; index: string; label: string }[] = [
  { id: 'detect', index: '01', label: 'Detect' },
  { id: 'clean', index: '02', label: 'Clean' },
  { id: 'automl', index: '03', label: 'AutoML' },
  { id: 'explain', index: '04', label: 'Explain' },
]

const PIPELINE_ORDER: StageId[] = ['detect', 'clean', 'automl', 'explain']

const DEMO_COLUMNS = [
  { name: 'customer_id', type: 'id', missing: '0%', note: 'Unique key' },
  { name: 'tenure_months', type: 'numeric', missing: '0.2%', note: 'Right-skewed' },
  { name: 'monthly_charge', type: 'numeric', missing: '1.1%', note: 'Currency' },
  { name: 'contract_type', type: 'categorical', missing: '0%', note: '3 levels' },
  { name: 'support_tickets', type: 'numeric', missing: '0%', note: 'Count' },
  { name: 'last_login_days', type: 'numeric', missing: '3.4%', note: 'Recency' },
  { name: 'region', type: 'categorical', missing: '0.8%', note: '8 levels' },
  { name: 'churned', type: 'boolean', missing: '0%', note: 'Target' },
]

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function countByKind(files: UploadedFile[]) {
  return FILE_SECTIONS.reduce(
    (acc, section) => {
      acc[section.kind] = files.filter((f) => f.kind === section.kind).length
      return acc
    },
    {} as Record<FileKind, number>,
  )
}

function UsagePanel({ usage, meter, running }: {
  usage: UsageSnapshot | null
  meter: ResourceMeter | null
  running: boolean
}) {
  if (!usage) return null
  return (
    <section className="usage-panel">
      <div className="usage-grid">
        <div className="usage-block">
          <p className="kicker">Storage</p>
          <div className="meter-head">
            <strong>{formatStorage(usage.storageUsed)}</strong>
            <span className="muted">/ {formatStorage(usage.storageLimit)}</span>
          </div>
          <div className="meter-track">
            <div className="meter-fill" style={{ width: `${usage.storagePct}%` }} />
          </div>
          <p className="meter-sub">
            {usage.fileCount}/{usage.fileLimit} files · free-tier cap
          </p>
        </div>
        <div className="usage-block">
          <p className="kicker">Runs today</p>
          <div className="meter-head">
            <strong>{usage.runsToday}</strong>
            <span className="muted">/ {usage.runsPerDayLimit}</span>
          </div>
          <div className="meter-track">
            <div
              className="meter-fill"
              style={{
                width: `${Math.min(100, (usage.runsToday / usage.runsPerDayLimit) * 100)}%`,
              }}
            />
          </div>
          <p className="meter-sub">Resets at local midnight</p>
        </div>
        <div className="usage-block">
          <p className="kicker">{running ? 'Live resources' : 'Last resources'}</p>
          {meter ? (
            <>
              <div className="meter-head">
                <strong>{meter.memoryMb} MB</strong>
                <span className="muted">est. RAM · {meter.stageLabel}</span>
              </div>
              <div className="meter-track">
                <div
                  className="meter-fill is-compute"
                  style={{
                    width: `${Math.min(100, (meter.computeUnits / meter.computeLimit) * 100)}%`,
                  }}
                />
              </div>
              <p className="meter-sub">
                Compute {meter.computeUnits}/{meter.computeLimit} units
              </p>
            </>
          ) : (
            <p className="meter-sub">Run a pipeline to sample resource use.</p>
          )}
        </div>
      </div>
    </section>
  )
}

function RunsHistory({
  runs,
  activeId,
  onSelect,
}: {
  runs: RunRecord[]
  activeId?: string
  onSelect: (run: RunRecord) => void
}) {
  return (
    <section className="runs-history">
      <div className="file-list-head">
        <p className="kicker">Past runs · {runs.length}</p>
      </div>
      {runs.length === 0 ? (
        <p className="file-section-empty">No saved runs yet.</p>
      ) : (
        <ul className="runs-list">
          {runs.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                className={`run-item${activeId === run.id ? ' is-active' : ''}`}
                onClick={() => onSelect(run)}
              >
                <span className="run-item-id">{run.id}</span>
                <span className="run-item-meta">
                  {run.status} · {run.stage} · {run.fileCount} files
                </span>
                <span className="run-item-date">
                  {new Date(run.createdAt).toLocaleString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function StageDetect({ files, run }: { files: UploadedFile[]; run: RunRecord | null }) {
  const counts = countByKind(files)
  const primary = files.find((f) => f.kind === 'numerical') ?? files[0]
  const detect = (run?.result?.detect as { task?: string; target?: string } | undefined) ?? {
    task: 'Binary classification',
    target: 'churned',
  }

  return (
    <div className="panel-grid">
      <section className="block">
        <p className="kicker">Library</p>
        <h2 className="block-title">
          {files.length === 1 ? primary?.name : `${files.length} files sorted`}
        </h2>
        <dl className="meta-list">
          {FILE_SECTIONS.map((section) => (
            <div key={section.kind}>
              <dt>{section.title}</dt>
              <dd>{counts[section.kind]}</dd>
            </div>
          ))}
          <div>
            <dt>Inferred task</dt>
            <dd>{detect.task}</dd>
          </div>
          <div>
            <dt>Target</dt>
            <dd>
              <code>{detect.target}</code>
            </dd>
          </div>
        </dl>
      </section>
      <section className="block block-grow">
        <p className="kicker">Schema</p>
        <h2 className="block-title">Detected columns</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Column</th>
                <th>Type</th>
                <th>Missing</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {DEMO_COLUMNS.map((col) => (
                <tr key={col.name}>
                  <td>
                    <code>{col.name}</code>
                  </td>
                  <td>{col.type}</td>
                  <td>{col.missing}</td>
                  <td className="muted">{col.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function StageClean({ run }: { run: RunRecord | null }) {
  const clean = run?.result?.clean as { features?: number; trainRows?: number } | undefined
  return (
    <div className="panel-grid">
      <section className="block">
        <p className="kicker">Transforms</p>
        <h2 className="block-title">Applied pipeline</h2>
        <p className="note">Dummy cleaning for run {run?.id ?? '—'}</p>
        <dl className="meta-list">
          <div>
            <dt>Features</dt>
            <dd>{clean?.features ?? 22}</dd>
          </div>
          <div>
            <dt>Train rows</dt>
            <dd>{clean?.trainRows?.toLocaleString() ?? '8,736'}</dd>
          </div>
        </dl>
      </section>
      <section className="block">
        <p className="kicker">Output</p>
        <h2 className="block-title">Feature matrix</h2>
        <p className="note">Impute · encode · scale · stratified split (dummy).</p>
      </section>
    </div>
  )
}

function StageAutoml({ run }: { run: RunRecord | null }) {
  const automl = run?.result?.automl as
    | { bestModel?: string; auc?: number; f1?: number }
    | undefined
  return (
    <div className="panel-stack">
      <section className="block">
        <p className="kicker">Model search</p>
        <h2 className="block-title">{automl?.bestModel ?? 'Gradient Boosting'}</h2>
        <dl className="meta-list">
          <div>
            <dt>AUC</dt>
            <dd>
              <code>{(automl?.auc ?? 0.912).toFixed(3)}</code>
            </dd>
          </div>
          <div>
            <dt>F1</dt>
            <dd>
              <code>{(automl?.f1 ?? 0.84).toFixed(2)}</code>
            </dd>
          </div>
        </dl>
      </section>
    </div>
  )
}

function StageExplain({ run }: { run: RunRecord | null }) {
  const explain = run?.result?.explain as { narrative?: string } | undefined
  return (
    <div className="panel-stack">
      <section className="block">
        <p className="kicker">Agent</p>
        <h2 className="block-title">Result narrative</h2>
        <div className="prose">
          <p>
            {explain?.narrative ??
              'Dummy explanation — churn risk rises with inactivity and support load.'}
          </p>
          <p className="muted">Run {run?.id ?? '—'}</p>
        </div>
      </section>
    </div>
  )
}

function FileSections({
  files,
  onRemove,
  onClear,
}: {
  files: UploadedFile[]
  onRemove: (id: string) => void
  onClear: () => void
}) {
  const sections = groupByKind(files)
  return (
    <div className="file-sections">
      <div className="file-list-head">
        <p className="kicker">
          Cloud library · {files.length} file{files.length === 1 ? '' : 's'}
        </p>
        <button type="button" className="text-btn" onClick={onClear}>
          Clear all
        </button>
      </div>
      <div className="section-grid">
        {sections.map((section) => (
          <section key={section.kind} className="file-section">
            <header className="file-section-head">
              <div>
                <h3 className="file-section-title">{section.title}</h3>
                <p className="file-section-hint">{section.hint}</p>
              </div>
              <span className="file-section-count">{section.files.length}</span>
            </header>
            {section.files.length === 0 ? (
              <p className="file-section-empty">No files yet</p>
            ) : (
              <ul className="file-list">
                {section.files.map((f) => (
                  <li key={f.id}>
                    <span className="file-ext">{f.ext}</span>
                    <span className="file-name" title={f.name}>
                      {f.name}
                    </span>
                    <span className="file-size">{formatBytes(f.size)}</span>
                    <button
                      type="button"
                      className="text-btn"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => onRemove(f.id)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}

function UploadZone({
  files,
  onAdd,
  onRemove,
  onClear,
  rejectNote,
}: {
  files: UploadedFile[]
  onAdd: (files: File[]) => void
  onRemove: (id: string) => void
  onClear: () => void
  rejectNote: string | null
}) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleFiles = (list: FileList | File[]) => {
    onAdd(Array.from(list).filter(isAccepted))
  }

  return (
    <div className="upload-block">
      <div
        className={`upload-zone${dragging ? ' is-dragging' : ''}`}
        onDragOver={(e: DragEvent) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e: DragEvent) => {
          e.preventDefault()
          setDragging(false)
        }}
        onDrop={(e: DragEvent) => {
          e.preventDefault()
          setDragging(false)
          if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files)
        }}
      >
        <input
          ref={inputRef}
          id={inputId}
          className="sr-only"
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            if (e.target.files?.length) handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <span className="upload-mark" aria-hidden="true">
          ↑
        </span>
        <div className="upload-copy">
          <strong>{files.length ? 'Add more files' : 'Drop files here'}</strong>
          <span className="muted">
            or{' '}
            <label htmlFor={inputId} className="upload-browse">
              browse
            </label>{' '}
            — encrypted to Supabase · max {Math.round(QUOTAS.maxFileBytes / (1024 * 1024))} MB /
            file
          </span>
        </div>
        <button
          type="button"
          className="btn-ghost-inline"
          onClick={() => inputRef.current?.click()}
        >
          Select files
        </button>
      </div>
      {rejectNote ? <p className="upload-warn">{rejectNote}</p> : null}
      {files.length > 0 ? (
        <FileSections files={files} onRemove={onRemove} onClear={onClear} />
      ) : null}
    </div>
  )
}

export default function App() {
  const configured = cloudReady()
  const [session, setSession] = useState<AuthSession | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [stage, setStage] = useState<StageId>('detect')
  const [ready, setReady] = useState(false)
  const [activeRun, setActiveRun] = useState<RunRecord | null>(null)
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [running, setRunning] = useState(false)
  const [usage, setUsage] = useState<UsageSnapshot | null>(null)
  const [meter, setMeter] = useState<ResourceMeter | null>(null)
  const [rejectNote, setRejectNote] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const runToken = useRef(0)
  const pendingRun = useRef(false)

  const hasData = files.length > 0
  const loggedIn = Boolean(session)

  const refreshUsage = useCallback(async (userId: string, fileList: UploadedFile[]) => {
    const [storageUsed, runsToday] = await Promise.all([
      getProfileStorage(userId).catch(() => fileList.reduce((s, f) => s + f.size, 0)),
      countRunsToday(userId).catch(() => 0),
    ])
    setUsage(
      buildUsage(
        Math.max(storageUsed, fileList.reduce((s, f) => s + f.size, 0)),
        fileList.length,
        runsToday,
      ),
    )
  }, [])

  const hydrateUser = useCallback(
    async (next: AuthSession, memoryFiles: UploadedFile[] = []) => {
      const stored = await loadUploads(next.user.id, next.dataKey)
      const mergedMap = new Map<string, UploadedFile>()
      for (const f of stored) mergedMap.set(f.id, f)
      for (const f of memoryFiles) if (!mergedMap.has(f.id)) mergedMap.set(f.id, f)
      const merged = [...mergedMap.values()]
      const history = await listRuns(next.user.id)
      const latest = history[0] ?? (await getLatestRun(next.user.id))
      setFiles(merged)
      setRuns(history)
      setActiveRun(latest)
      if (latest) setStage(latest.stage)
      if (latest?.resources) {
        setMeter({
          memoryMb: latest.resources.peakMemoryMb,
          memoryLimitMb: QUOTAS.maxMemoryMb,
          computeUnits: latest.resources.computeUnits,
          computeLimit: latest.resources.computeLimit,
          stageLabel: latest.stage,
        })
      }
      await refreshUsage(next.user.id, merged)
    },
    [refreshUsage],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!configured) {
        setReady(true)
        return
      }
      const restored = await restoreSession()
      if (cancelled) return
      if (restored) {
        setSession(restored)
        await hydrateUser(restored)
      }
      if (!cancelled) setReady(true)
    })().catch(() => {
      if (!cancelled) setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [configured, hydrateUser])

  useEffect(() => {
    if (!ready || !session) return
    const handle = window.setTimeout(() => {
      void syncUploads(session.user.id, session.dataKey, files)
        .then(() => {
          setSyncError(null)
          return refreshUsage(session.user.id, files)
        })
        .catch((err) => {
          setSyncError(err instanceof Error ? err.message : 'Sync failed')
        })
    }, 600)
    return () => window.clearTimeout(handle)
  }, [files, ready, session, refreshUsage])

  const addFiles = useCallback(
    (incoming: File[]) => {
      if (!session) {
        setAuthOpen(true)
        setRejectNote('Sign in before uploading data.')
        return
      }
      setFiles((prev) => {
        const { accepted, error } = validateIncoming(prev, incoming)
        setRejectNote(error)
        if (!accepted.length) return prev
        return [...prev, ...accepted]
      })
    },
    [session],
  )

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => {
      const next = prev.filter((f) => f.id !== id)
      if (next.length === 0) setStage('detect')
      return next
    })
  }, [])

  const clearFiles = useCallback(() => {
    setFiles([])
    setStage('detect')
    if (session) void clearUploads(session.user.id).then(() => refreshUsage(session.user.id, []))
  }, [session, refreshUsage])

  const onAuthed = useCallback(
    async (next: AuthSession) => {
      setSession(next)
      await hydrateUser(next, files)
    },
    [files, hydrateUser],
  )

  const logout = useCallback(async () => {
    runToken.current += 1
    setRunning(false)
    await logoutCloud().catch(() => {})
    setSession(null)
    setFiles([])
    setRuns([])
    setActiveRun(null)
    setUsage(null)
    setMeter(null)
    setStage('detect')
  }, [])

  const startRun = useCallback(async () => {
    if (!configured) return
    if (!session) {
      pendingRun.current = true
      setAuthOpen(true)
      return
    }
    if (!files.length || running) return

    const runsToday = await countRunsToday(session.user.id)
    if (runsToday >= QUOTAS.maxRunsPerDay) {
      setRejectNote(`Daily run limit reached (${QUOTAS.maxRunsPerDay}/day on free tier).`)
      await refreshUsage(session.user.id, files)
      return
    }

    pendingRun.current = false
    const token = ++runToken.current
    const totalBytes = files.reduce((s, f) => s + f.size, 0)
    const estimate = estimateRunResources(totalBytes, files.length)
    const now = Date.now()
    let compute = 0
    const run: RunRecord = {
      id: createRunId(),
      userId: session.user.id,
      status: 'running',
      stage: 'detect',
      fileCount: files.length,
      createdAt: now,
      updatedAt: now,
      summary: 'Pipeline started',
      result: {},
      resources: {
        peakMemoryMb: estimate.memoryMb,
        computeUnits: 0,
        computeLimit: estimate.computeLimit,
        durationMs: 0,
      },
    }

    setRunning(true)
    setActiveRun(run)
    setStage('detect')
    await saveRun(run)

    for (const nextStage of PIPELINE_ORDER) {
      if (runToken.current !== token) return
      compute = Math.min(
        estimate.computeLimit,
        compute + Math.round(estimate.computeLimit / PIPELINE_ORDER.length),
      )
      const updated: RunRecord = {
        ...run,
        stage: nextStage,
        updatedAt: Date.now(),
        summary: `Dummy ${nextStage} complete`,
        status: nextStage === 'explain' ? 'complete' : 'running',
        completedAt: nextStage === 'explain' ? Date.now() : undefined,
        result: { ...run.result, [nextStage]: dummyResultFor(nextStage) },
        resources: {
          peakMemoryMb: estimate.memoryMb,
          computeUnits: compute,
          computeLimit: estimate.computeLimit,
          durationMs: Date.now() - now,
        },
      }
      Object.assign(run, updated)
      setStage(nextStage)
      setActiveRun({ ...updated })
      setMeter({
        memoryMb: estimate.memoryMb,
        memoryLimitMb: QUOTAS.maxMemoryMb,
        computeUnits: compute,
        computeLimit: estimate.computeLimit,
        stageLabel: nextStage,
      })
      await saveRun(updated)
      await sleep(nextStage === 'explain' ? 650 : 1000)
    }

    if (runToken.current === token) {
      setRunning(false)
      const history = await listRuns(session.user.id)
      setRuns(history)
      await refreshUsage(session.user.id, files)
    }
  }, [configured, files, refreshUsage, running, session])

  useEffect(() => {
    if (!session || !pendingRun.current || !files.length || running) return
    pendingRun.current = false
    void startRun()
  }, [session, files.length, running, startRun])

  const selectRun = (run: RunRecord) => {
    if (running) return
    setActiveRun(run)
    setStage(run.stage)
    setMeter({
      memoryMb: run.resources.peakMemoryMb,
      memoryLimitMb: QUOTAS.maxMemoryMb,
      computeUnits: run.resources.computeUnits,
      computeLimit: run.resources.computeLimit,
      stageLabel: run.stage,
    })
  }

  const statusLabel = !ready
    ? 'Restoring…'
    : running
      ? `Running · ${stage}`
      : activeRun?.status === 'complete'
        ? 'Run complete'
        : hasData
          ? 'Ready to run'
          : 'Waiting for data'

  return (
    <div className="app">
      <div className="app-bg" aria-hidden="true">
        <div className="app-grid" />
        <div className="app-noise" />
      </div>

      <header className="topbar">
        <div className="topbar-brand">
          <span className="wordmark">xAutoML</span>
          <span className="topbar-sep" aria-hidden="true" />
          <span className="run-label">Run</span>
          <code className="run-id">{activeRun?.id ?? '—'}</code>
        </div>
        <div className="topbar-actions">
          <div className={`topbar-status${hasData && !running ? '' : ' is-waiting'}`}>
            <span className="status-dot" aria-hidden="true" />
            <span>{statusLabel}</span>
          </div>
          {loggedIn ? (
            <>
              <span className="account-chip" title={session!.user.email}>
                {session!.user.displayName}
              </span>
              <button type="button" className="text-btn" onClick={logout}>
                Sign out
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-ghost-inline"
              onClick={() => setAuthOpen(true)}
              disabled={!configured}
            >
              Sign in
            </button>
          )}
        </div>
      </header>

      <div className="shell">
        {!configured ? (
          <div className="auth-banner">
            <p>
              Connect a free Supabase project to save accounts, encrypted documents, and run
              history. Copy `.env.example` → `.env` and run `supabase/schema.sql`.
            </p>
          </div>
        ) : null}

        {configured && !loggedIn ? (
          <div className="auth-banner">
            <p>Sign in required — you must authenticate before uploading any data.</p>
            <button type="button" className="btn-primary" onClick={() => setAuthOpen(true)}>
              Sign in / Register
            </button>
          </div>
        ) : null}

        {loggedIn ? <UsagePanel usage={usage} meter={meter} running={running} /> : null}
        {syncError ? <p className="upload-warn">Sync: {syncError}</p> : null}

        {loggedIn ? (
          <UploadZone
            files={files}
            onAdd={addFiles}
            onRemove={removeFile}
            onClear={clearFiles}
            rejectNote={rejectNote}
          />
        ) : (
          <div className="upload-block" aria-hidden="true">
            <div className="upload-zone is-inert">
              <span className="upload-mark" aria-hidden="true">
                ↑
              </span>
              <div className="upload-copy">
                <strong>Upload locked</strong>
                <span className="muted">Sign in above to enable data upload.</span>
              </div>
            </div>
          </div>
        )}

        <div className="run-bar">
          <div className="run-bar-copy">
            <p className="kicker">Pipeline</p>
            <p className="run-bar-title">
              {running
                ? `Executing ${stage}…`
                : !loggedIn
                  ? 'Sign in to upload and run'
                  : hasData
                    ? 'Run clean → AutoML → explain'
                    : 'Upload data to enable Run'}
            </p>
          </div>
          <button
            type="button"
            className="btn-primary run-btn"
            disabled={!configured || !hasData || running}
            onClick={startRun}
          >
            {running ? 'Running…' : 'Run'}
          </button>
        </div>

        <nav className="stage-nav" aria-label="Pipeline stages">
          {STAGES.map((s) => {
            const locked = !hasData
            const isActive = stage === s.id && hasData
            const runStatus = activeRun?.status
            const doneIdx = PIPELINE_ORDER.indexOf(activeRun?.stage ?? 'detect')
            const thisIdx = PIPELINE_ORDER.indexOf(s.id)
            const passed =
              Boolean(activeRun) && (runStatus === 'complete' || (running && thisIdx < doneIdx))
            return (
              <button
                key={s.id}
                type="button"
                className={`stage-tab${isActive ? ' is-active' : ''}${locked ? ' is-locked' : ''}${passed && !isActive ? ' is-done' : ''}`}
                onClick={() => {
                  if (!locked && !running) setStage(s.id)
                }}
                disabled={locked || running}
                aria-current={isActive ? 'step' : undefined}
              >
                <span className="stage-index">{s.index}</span>
                <span className="stage-label">{s.label}</span>
              </button>
            )
          })}
        </nav>

        <main className="workspace" key={`${activeRun?.id ?? 'none'}-${hasData ? stage : 'empty'}`}>
          {!hasData ? (
            <section className="empty-workspace">
              <p className="kicker">Pipeline locked</p>
              <h2 className="block-title">
                {loggedIn ? 'Upload data, then press Run.' : 'Sign in, then upload data to run.'}
              </h2>
              <p className="note">
                Free-tier limits: {formatStorage(QUOTAS.maxStorageBytes)} storage,{' '}
                {QUOTAS.maxFiles} files, {QUOTAS.maxRunsPerDay} runs/day.
              </p>
            </section>
          ) : null}
          {hasData && stage === 'detect' && <StageDetect files={files} run={activeRun} />}
          {hasData && stage === 'clean' && <StageClean run={activeRun} />}
          {hasData && stage === 'automl' && <StageAutoml run={activeRun} />}
          {hasData && stage === 'explain' && <StageExplain run={activeRun} />}
        </main>

        {loggedIn ? (
          <RunsHistory runs={runs} activeId={activeRun?.id} onSelect={selectRun} />
        ) : null}
      </div>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} onAuthed={onAuthed} />
    </div>
  )
}
