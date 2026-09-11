import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react'
import { AuthModal } from './AuthModal'
import { RegressionChart } from './components/RegressionChart'
import {
  cloudReady,
  deleteOwnAccount,
  logout as logoutCloud,
  onAuthChange,
  restoreSession,
  type AuthSession,
} from './lib/auth'
import {
  clearUploads,
  deleteUpload,
  downloadUploadedFile,
  getLibraryStats,
  loadUploads,
  snapshotFiles,
  syncUploads,
  validateIncoming,
  type RunFileSnapshot,
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
  deleteRun,
  dummyResultFor,
  listRuns,
  saveRun,
  type RunRecord,
  type StageId,
} from './lib/runs'
import { runTabularPipeline, type TabularPipelineResult } from './lib/tabular/pipeline'

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

type DetectResult = {
  task?: string
  target?: string
  predictors?: string[]
  rows?: number
  source?: string
  columns?: { name: string; type: string; missing: string; note: string }[]
}

type CleanResult = {
  features?: number
  trainRows?: number
  rowsIn?: number
  missingImputed?: number
  outliersClipped?: number
  steps?: string[]
}

type AutomlResult = {
  bestModel?: string
  auc?: number
  f1?: number
  r2?: number
  mae?: number
  rmse?: number
  intercept?: number
  coefficients?: { name: string; value: number }[]
  equation?: string
}

type ExplainResult = {
  narrative?: string
  chart?: {
    xLabel: string
    yLabel: string
    points: { x: number; y: number; yHat: number }[]
    line?: { x0: number; y0: number; x1: number; y1: number }
  }
}

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
  onDelete,
}: {
  runs: RunRecord[]
  activeId?: string
  onSelect: (run: RunRecord) => void
  onDelete: (run: RunRecord) => void
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
            <li key={run.id} className="run-row">
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
              <button
                type="button"
                className="run-delete"
                aria-label={`Delete run ${run.id}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(run)
                }}
              >
                Delete
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
  const detect = (run?.result?.detect as DetectResult | undefined) ?? {
    task: 'Binary classification',
    target: 'churned',
  }
  const columns = detect.columns?.length ? detect.columns : DEMO_COLUMNS

  return (
    <div className="panel-grid">
      <section className="block">
        <p className="kicker">Library</p>
        <h2 className="block-title">
          {detect.source ?? (files.length === 1 ? primary?.name : `${files.length} files sorted`)}
        </h2>
        <dl className="meta-list">
          {FILE_SECTIONS.map((section) => (
            <div key={section.kind}>
              <dt>{section.title}</dt>
              <dd>{counts[section.kind]}</dd>
            </div>
          ))}
          {detect.rows != null ? (
            <div>
              <dt>Rows</dt>
              <dd>{detect.rows.toLocaleString()}</dd>
            </div>
          ) : null}
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
              {columns.map((col) => (
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
  const clean = run?.result?.clean as CleanResult | undefined
  const isReal = Boolean(clean?.steps?.length)
  return (
    <div className="panel-grid">
      <section className="block">
        <p className="kicker">Transforms</p>
        <h2 className="block-title">Applied pipeline</h2>
        <p className="note">
          {isReal
            ? `Cleaning for run ${run?.id ?? '—'}`
            : `Dummy cleaning for run ${run?.id ?? '—'}`}
        </p>
        <dl className="meta-list">
          <div>
            <dt>Features</dt>
            <dd>{clean?.features ?? 22}</dd>
          </div>
          <div>
            <dt>Rows out</dt>
            <dd>{clean?.trainRows?.toLocaleString() ?? '8,736'}</dd>
          </div>
          {clean?.rowsIn != null ? (
            <div>
              <dt>Rows in</dt>
              <dd>{clean.rowsIn.toLocaleString()}</dd>
            </div>
          ) : null}
          {clean?.missingImputed != null ? (
            <div>
              <dt>Imputed</dt>
              <dd>{clean.missingImputed}</dd>
            </div>
          ) : null}
          {clean?.outliersClipped != null ? (
            <div>
              <dt>Outliers clipped</dt>
              <dd>{clean.outliersClipped}</dd>
            </div>
          ) : null}
        </dl>
      </section>
      <section className="block">
        <p className="kicker">Steps</p>
        <h2 className="block-title">{isReal ? 'Cleaning log' : 'Feature matrix'}</h2>
        {isReal ? (
          <ul className="plain-list">
            {clean!.steps!.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        ) : (
          <p className="note">Impute · encode · scale · stratified split (dummy).</p>
        )}
      </section>
    </div>
  )
}

function StageAutoml({ run }: { run: RunRecord | null }) {
  const automl = run?.result?.automl as AutomlResult | undefined
  const isLinear = Boolean(automl?.equation || automl?.r2 != null)
  return (
    <div className="panel-stack">
      <section className="block">
        <p className="kicker">Model</p>
        <h2 className="block-title">{automl?.bestModel ?? 'Gradient Boosting'}</h2>
        <dl className="meta-list">
          {isLinear ? (
            <>
              <div>
                <dt>R²</dt>
                <dd>
                  <code>{(automl?.r2 ?? 0).toFixed(3)}</code>
                </dd>
              </div>
              <div>
                <dt>MAE</dt>
                <dd>
                  <code>{(automl?.mae ?? 0).toFixed(3)}</code>
                </dd>
              </div>
              <div>
                <dt>RMSE</dt>
                <dd>
                  <code>{(automl?.rmse ?? 0).toFixed(3)}</code>
                </dd>
              </div>
              <div>
                <dt>Intercept</dt>
                <dd>
                  <code>{(automl?.intercept ?? 0).toFixed(3)}</code>
                </dd>
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
        </dl>
        {automl?.equation ? (
          <p className="note">
            <code>{automl.equation}</code>
          </p>
        ) : null}
      </section>
      {automl?.coefficients?.length ? (
        <section className="block">
          <p className="kicker">Coefficients</p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Variable</th>
                  <th>β</th>
                </tr>
              </thead>
              <tbody>
                {automl.coefficients.map((c) => (
                  <tr key={c.name}>
                    <td>
                      <code>{c.name}</code>
                    </td>
                    <td>
                      <code>{c.value.toFixed(4)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  )
}

function StageExplain({ run }: { run: RunRecord | null }) {
  const explain = run?.result?.explain as ExplainResult | undefined
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
      {explain?.chart?.points?.length ? (
        <section className="block">
          <p className="kicker">Fit</p>
          <h2 className="block-title">Regression graph</h2>
          <RegressionChart
            xLabel={explain.chart.xLabel}
            yLabel={explain.chart.yLabel}
            points={explain.chart.points}
            line={explain.chart.line}
          />
        </section>
      ) : null}
    </div>
  )
}

function FileSections({
  files,
  title,
  emptyLabel,
  removeLabel,
  onRemove,
  onClear,
  onDownload,
  clearLabel,
  showDownload = true,
}: {
  files: UploadedFile[]
  title: string
  emptyLabel: string
  removeLabel: string
  onRemove: (id: string) => void
  onClear?: () => void
  onDownload?: (file: UploadedFile) => void
  clearLabel?: string
  showDownload?: boolean
}) {
  const sections = groupByKind(files)
  return (
    <div className="file-sections">
      <div className="file-list-head">
        <p className="kicker">
          {title} · {files.length}
        </p>
        {onClear ? (
          <button type="button" className="text-btn" onClick={onClear}>
            {clearLabel ?? 'Clear'}
          </button>
        ) : null}
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
              <p className="file-section-empty">{emptyLabel}</p>
            ) : (
              <ul className="file-list">
                {section.files.map((f) => (
                  <li key={f.id}>
                    <span className="file-ext">{f.ext}</span>
                    <span className="file-name" title={f.name}>
                      {f.name}
                    </span>
                    <span className="file-size">{formatBytes(f.size)}</span>
                    {showDownload && onDownload ? (
                      <button
                        type="button"
                        className="text-btn"
                        aria-label={`Download ${f.name}`}
                        onClick={() => onDownload(f)}
                      >
                        Download
                      </button>
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      className="text-btn text-btn-danger"
                      aria-label={`${removeLabel} ${f.name}`}
                      onClick={() => onRemove(f.id)}
                    >
                      {removeLabel}
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

function LibraryPanel({
  files,
  stagedIds,
  onDownload,
  onDelete,
  onDeleteAll,
  onAddToRun,
}: {
  files: UploadedFile[]
  stagedIds: Set<string>
  onDownload: (file: UploadedFile) => void
  onDelete: (id: string) => void
  onDeleteAll: () => void
  onAddToRun: (id: string) => void
}) {
  return (
    <section className="library-panel">
      <div className="file-list-head">
        <p className="kicker">
          All saved files · {files.length} (database)
        </p>
        {files.length > 0 ? (
          <button type="button" className="text-btn text-btn-danger" onClick={onDeleteAll}>
            Delete all from DB
          </button>
        ) : null}
      </div>
      <p className="note note-tight">
        Permanent library. Delete here removes the file from Supabase. Removing from a run section
        above only unstages it for the next run.
      </p>
      {files.length === 0 ? (
        <p className="file-section-empty">No files saved yet.</p>
      ) : (
        <ul className="file-list library-list">
          {files.map((f) => {
            const staged = stagedIds.has(f.id)
            return (
              <li key={f.id}>
                <span className="file-ext">{f.ext}</span>
                <span className="file-name" title={f.name}>
                  {f.name}
                  <span className="file-kind-tag">{f.kind}</span>
                </span>
                <span className="file-size">{formatBytes(f.size)}</span>
                {staged ? (
                  <span className="muted">in next run</span>
                ) : (
                  <button type="button" className="text-btn" onClick={() => onAddToRun(f.id)}>
                    Add to run
                  </button>
                )}
                <button type="button" className="text-btn" onClick={() => onDownload(f)}>
                  Download
                </button>
                <button
                  type="button"
                  className="text-btn text-btn-danger"
                  onClick={() => onDelete(f.id)}
                >
                  Delete from DB
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function RunFilesPanel({
  runId,
  files,
  library,
  onDownload,
}: {
  runId: string
  files: RunFileSnapshot[]
  library: UploadedFile[]
  onDownload: (file: UploadedFile) => void
}) {
  if (!files.length) {
    return (
      <section className="run-files-panel">
        <p className="kicker">Run files</p>
        <p className="note">No file snapshot stored for {runId}.</p>
      </section>
    )
  }

  return (
    <section className="run-files-panel">
      <div className="file-list-head">
        <p className="kicker">
          Files used in {runId} · {files.length}
        </p>
      </div>
      <ul className="file-list">
        {files.map((snap) => {
          const local = library.find((f) => f.id === snap.id)
          return (
            <li key={snap.id}>
              <span className="file-ext">{snap.ext}</span>
              <span className="file-name" title={snap.name}>
                {snap.name}
              </span>
              <span className="file-size">{formatBytes(snap.size)}</span>
              {local ? (
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => onDownload(local)}
                >
                  Download
                </button>
              ) : (
                <span className="muted">removed from library</span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function UploadZone({
  stagedFiles,
  onAdd,
  onUnstage,
  onClearStage,
  rejectNote,
}: {
  stagedFiles: UploadedFile[]
  onAdd: (files: File[]) => void
  onUnstage: (id: string) => void
  onClearStage: () => void
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
          <strong>{stagedFiles.length ? 'Add more to next run' : 'Drop files for next run'}</strong>
          <span className="muted">
            or{' '}
            <label htmlFor={inputId} className="upload-browse">
              browse
            </label>{' '}
            — uploads save to your library; sections below are only for this run
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
      <FileSections
        files={stagedFiles}
        title="Next run"
        emptyLabel="Nothing staged for the next run"
        removeLabel="Remove from run"
        clearLabel="Clear run selection"
        showDownload={false}
        onRemove={onUnstage}
        onClear={onClearStage}
      />
    </div>
  )
}

export default function App() {
  const configured = cloudReady()
  const [session, setSession] = useState<AuthSession | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [files, setFiles] = useState<UploadedFile[]>([]) // permanent library
  const [stagedIds, setStagedIds] = useState<string[]>([])
  const [stage, setStage] = useState<StageId>('detect')
  const [ready, setReady] = useState(false)
  const [activeRun, setActiveRun] = useState<RunRecord | null>(null)
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [running, setRunning] = useState(false)
  const [usage, setUsage] = useState<UsageSnapshot | null>(null)
  const [meter, setMeter] = useState<ResourceMeter | null>(null)
  const [rejectNote, setRejectNote] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [libraryHydrated, setLibraryHydrated] = useState(false)
  const runToken = useRef(0)
  const pendingRun = useRef(false)

  const stagedIdSet = useMemo(() => new Set(stagedIds), [stagedIds])
  const stagedFiles = useMemo(
    () => files.filter((f) => stagedIdSet.has(f.id)),
    [files, stagedIdSet],
  )
  const hasData = stagedFiles.length > 0
  const loggedIn = Boolean(session)
  const activeRunFiles = (activeRun?.result?.files as RunFileSnapshot[] | undefined) ?? []
  const canBrowsePipeline =
    hasData ||
    Boolean(
      activeRun &&
        (activeRun.result.detect ||
          activeRun.result.clean ||
          activeRun.result.automl ||
          activeRun.result.explain),
    )

  const refreshUsage = useCallback(async (userId: string, fileList: UploadedFile[]) => {
    const localBytes = fileList.reduce((s, f) => s + f.size, 0)
    const [libraryStats, runsToday] = await Promise.all([
      getLibraryStats(userId).catch(() => ({
        fileCount: fileList.length,
        storageBytes: localBytes,
      })),
      countRunsToday(userId).catch(() => 0),
    ])
    // Prefer live library rows; fall back to decrypted in-memory list
    const storageUsed =
      libraryStats.fileCount > 0 ? libraryStats.storageBytes : localBytes
    const fileCount =
      libraryStats.fileCount > 0 ? libraryStats.fileCount : fileList.length
    setUsage(buildUsage(storageUsed, fileCount, runsToday))
  }, [])

  const hydrateUser = useCallback(
    async (next: AuthSession, memoryFiles: UploadedFile[] = []) => {
      setLibraryHydrated(false)
      setSyncError(null)
      try {
        const [history, libraryStats, runsToday, stored] = await Promise.all([
          listRuns(next.user.id).catch(() => [] as RunRecord[]),
          getLibraryStats(next.user.id).catch(() => ({ fileCount: 0, storageBytes: 0 })),
          countRunsToday(next.user.id).catch(() => 0),
          loadUploads(next.user.id, next.dataKey).catch((err) => {
            setSyncError(err instanceof Error ? err.message : 'Failed to load saved files')
            return [] as UploadedFile[]
          }),
        ])

        const mergedMap = new Map<string, UploadedFile>()
        for (const f of stored) mergedMap.set(f.id, f)
        for (const f of memoryFiles) if (!mergedMap.has(f.id)) mergedMap.set(f.id, f)
        const merged = [...mergedMap.values()]

        setFiles(merged)
        // Stage nothing / open no past run — user picks a run or stages files manually
        setStagedIds([])
        setRuns(history)
        setActiveRun(null)
        setMeter(null)
        setStage('detect')

        const localBytes = merged.reduce((s, f) => s + f.size, 0)
        const storageUsed =
          libraryStats.fileCount > 0 ? libraryStats.storageBytes : localBytes
        const fileCount =
          libraryStats.fileCount > 0 ? libraryStats.fileCount : merged.length
        setUsage(buildUsage(storageUsed, fileCount, runsToday))
        await refreshUsage(next.user.id, merged)

        if (merged.length !== libraryStats.fileCount && libraryStats.fileCount > 0) {
          setSyncError(
            `Loaded ${merged.length}/${libraryStats.fileCount} library file(s). Some could not be decrypted.`,
          )
        }

        if (memoryFiles.length) {
          await syncUploads(next.user.id, next.dataKey, merged)
        }
      } finally {
        setLibraryHydrated(true)
      }
    },
    [refreshUsage],
  )

  const hydrateUserRef = useRef(hydrateUser)
  hydrateUserRef.current = hydrateUser
  const hydratedUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let chain: Promise<void> = Promise.resolve()

    const applySession = (restored: AuthSession | null, force: boolean) => {
      chain = chain.then(async () => {
        if (cancelled) return
        try {
          if (restored) {
            if (!force && hydratedUserIdRef.current === restored.user.id) {
              if (!cancelled) setReady(true)
              return
            }
            setSession(restored)
            await hydrateUserRef.current(restored)
            hydratedUserIdRef.current = restored.user.id
          } else {
            hydratedUserIdRef.current = null
            setSession(null)
            setFiles([])
            setStagedIds([])
            setRuns([])
            setActiveRun(null)
            setUsage(null)
            setMeter(null)
            setLibraryHydrated(true)
          }
        } catch (err) {
          if (!cancelled) {
            setSyncError(err instanceof Error ? err.message : 'Failed to restore session')
            setLibraryHydrated(true)
          }
        } finally {
          if (!cancelled) setReady(true)
        }
      })
      return chain
    }

    if (!configured) {
      setReady(true)
      return () => {
        cancelled = true
      }
    }

    void restoreSession()
      .then((restored) => applySession(restored, true))
      .catch((err) => {
        if (!cancelled) {
          setSyncError(err instanceof Error ? err.message : 'Failed to restore session')
          setReady(true)
          setLibraryHydrated(true)
        }
      })

    const unsub = onAuthChange((next) => {
      if (cancelled) return
      // restoreSession handles the first paint; only react to real auth changes
      void applySession(next, false)
    })

    return () => {
      cancelled = true
      unsub()
    }
  }, [configured])

  useEffect(() => {
    if (!ready || !session || !libraryHydrated) return
    const handle = window.setTimeout(() => {
      void syncUploads(session.user.id, session.dataKey, files)
        .then(() => {
          setSyncError(null)
          return refreshUsage(session.user.id, files)
        })
        .catch((err) => {
          setSyncError(err instanceof Error ? err.message : 'Sync failed')
        })
    }, 700)
    return () => window.clearTimeout(handle)
  }, [files, ready, session, libraryHydrated, refreshUsage])

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
        setStagedIds((ids) => {
          const next = new Set(ids)
          for (const f of accepted) next.add(f.id)
          return [...next]
        })
        return [...prev, ...accepted]
      })
    },
    [session],
  )

  const unstageFile = useCallback((id: string) => {
    setStagedIds((ids) => ids.filter((x) => x !== id))
  }, [])

  const clearStage = useCallback(() => {
    setStagedIds([])
  }, [])

  const addToRun = useCallback((id: string) => {
    setStagedIds((ids) => (ids.includes(id) ? ids : [...ids, id]))
  }, [])

  const deleteFromLibrary = useCallback(
    (id: string) => {
      const ok = window.confirm('Delete this file permanently from your saved library?')
      if (!ok) return
      setFiles((prev) => prev.filter((f) => f.id !== id))
      setStagedIds((ids) => ids.filter((x) => x !== id))
      if (session) {
        void deleteUpload(session.user.id, id)
          .then(() =>
            refreshUsage(
              session.user.id,
              files.filter((f) => f.id !== id),
            ),
          )
          .catch((err) => {
            setSyncError(err instanceof Error ? err.message : 'Delete failed')
          })
      }
    },
    [session, files, refreshUsage],
  )

  const deleteAllFromLibrary = useCallback(() => {
    const ok = window.confirm('Delete ALL saved files from the database?')
    if (!ok) return
    setFiles([])
    setStagedIds([])
    setStage('detect')
    if (session) {
      void clearUploads(session.user.id)
        .then(() => refreshUsage(session.user.id, []))
        .catch((err) => {
          setSyncError(err instanceof Error ? err.message : 'Clear failed')
        })
    }
  }, [session, refreshUsage])

  const onDownload = useCallback((file: UploadedFile) => {
    downloadUploadedFile(file)
  }, [])

  const onAuthed = useCallback(
    async (next: AuthSession) => {
      hydratedUserIdRef.current = next.user.id
      setSession(next)
      await hydrateUser(next, files)
    },
    [files, hydrateUser],
  )

  const logout = useCallback(async () => {
    runToken.current += 1
    setRunning(false)
    setLibraryHydrated(false)
    hydratedUserIdRef.current = null
    await logoutCloud().catch(() => {})
    setSession(null)
    setFiles([])
    setStagedIds([])
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
    if (!stagedFiles.length || running) return

    const runsToday = await countRunsToday(session.user.id)
    if (runsToday >= QUOTAS.maxRunsPerDay) {
      setRejectNote(`Daily run limit reached (${QUOTAS.maxRunsPerDay}/day on free tier).`)
      await refreshUsage(session.user.id, files)
      return
    }

    pendingRun.current = false
    const token = ++runToken.current
    const runFiles = stagedFiles
    const totalBytes = runFiles.reduce((s, f) => s + f.size, 0)
    const estimate = estimateRunResources(totalBytes, runFiles.length)
    const now = Date.now()
    let compute = 0

    let tabular: TabularPipelineResult | null = null
    try {
      tabular = await runTabularPipeline(runFiles)
    } catch (err) {
      setRejectNote(
        err instanceof Error
          ? `Tabular pipeline failed (${err.message}). Falling back to demo results.`
          : 'Tabular pipeline failed. Falling back to demo results.',
      )
      tabular = null
    }

    const fileSnap = snapshotFiles(runFiles)
    const run: RunRecord = {
      id: createRunId(),
      userId: session.user.id,
      status: 'running',
      stage: 'detect',
      fileCount: runFiles.length,
      createdAt: now,
      updatedAt: now,
      summary: tabular
        ? `Linear regression on ${tabular.fileName}`
        : 'Dummy pipeline started',
      result: { files: fileSnap },
      resources: {
        peakMemoryMb: estimate.memoryMb,
        computeUnits: 0,
        computeLimit: estimate.computeLimit,
        durationMs: 0,
      },
    }

    // Persist full library (not just staged) before finishing
    await syncUploads(session.user.id, session.dataKey, files).catch(() => {})

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
      const stageResult = tabular
        ? tabular[nextStage]
        : dummyResultFor(nextStage)
      const updated: RunRecord = {
        ...run,
        stage: nextStage,
        updatedAt: Date.now(),
        summary: tabular
          ? `${tabular.automl.bestModel} · ${nextStage}`
          : `Dummy ${nextStage} complete`,
        status: nextStage === 'explain' ? 'complete' : 'running',
        completedAt: nextStage === 'explain' ? Date.now() : undefined,
        result: { ...run.result, files: fileSnap, [nextStage]: stageResult },
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
      await sleep(nextStage === 'explain' ? 450 : 700)
    }

    if (runToken.current === token) {
      setRunning(false)
      const history = await listRuns(session.user.id)
      setRuns(history)
      await refreshUsage(session.user.id, files)
    }
  }, [configured, files, stagedFiles, refreshUsage, running, session])

  useEffect(() => {
    if (!session || !pendingRun.current || !stagedFiles.length || running) return
    pendingRun.current = false
    void startRun()
  }, [session, stagedFiles.length, running, startRun])

  const selectRun = (run: RunRecord) => {
    if (running) return
    setActiveRun(run)
    setStage(run.status === 'complete' ? 'explain' : run.stage)
    setMeter({
      memoryMb: run.resources.peakMemoryMb,
      memoryLimitMb: QUOTAS.maxMemoryMb,
      computeUnits: run.resources.computeUnits,
      computeLimit: run.resources.computeLimit,
      stageLabel: run.stage,
    })
  }

  const removeRun = useCallback(
    async (run: RunRecord) => {
      if (!session || running) return
      try {
        await deleteRun(session.user.id, run.id)
        const history = await listRuns(session.user.id)
        setRuns(history)
        if (activeRun?.id === run.id) {
          const next = history[0] ?? null
          setActiveRun(next)
          if (next) {
            setStage(next.status === 'complete' ? 'explain' : next.stage)
            setMeter({
              memoryMb: next.resources.peakMemoryMb,
              memoryLimitMb: QUOTAS.maxMemoryMb,
              computeUnits: next.resources.computeUnits,
              computeLimit: next.resources.computeLimit,
              stageLabel: next.stage,
            })
          } else {
            setMeter(null)
            setStage('detect')
          }
        }
        await refreshUsage(session.user.id, files)
      } catch (err) {
        setSyncError(err instanceof Error ? err.message : 'Failed to delete run')
      }
    },
    [session, running, activeRun?.id, files, refreshUsage],
  )

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
              <button
                type="button"
                className="text-btn text-btn-danger"
                onClick={() => {
                  void (async () => {
                    const ok = window.confirm(
                      'Delete your account and all saved files/runs permanently?',
                    )
                    if (!ok || !session) return
                    try {
                      await deleteOwnAccount()
                      setSession(null)
                      setFiles([])
                      setRuns([])
                      setActiveRun(null)
                      setUsage(null)
                      setMeter(null)
                      setStage('detect')
                    } catch (err) {
                      setRejectNote(
                        err instanceof Error ? err.message : 'Could not delete account.',
                      )
                    }
                  })()
                }}
              >
                Delete account
              </button>
            </>
          ) : (
            <button type="button" className="btn-ghost-inline" onClick={() => setAuthOpen(true)}>
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
          <>
            <UploadZone
              stagedFiles={stagedFiles}
              onAdd={addFiles}
              onUnstage={unstageFile}
              onClearStage={clearStage}
              rejectNote={rejectNote}
            />
            <LibraryPanel
              files={files}
              stagedIds={stagedIdSet}
              onDownload={onDownload}
              onDelete={deleteFromLibrary}
              onDeleteAll={deleteAllFromLibrary}
              onAddToRun={addToRun}
            />
          </>
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

        {loggedIn && activeRun ? (
          <RunFilesPanel
            runId={activeRun.id}
            files={activeRunFiles}
            library={files}
            onDownload={onDownload}
          />
        ) : null}

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
            const locked = !canBrowsePipeline
            const isActive = stage === s.id && canBrowsePipeline
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

        <main
          className="workspace"
          key={`${activeRun?.id ?? 'none'}-${canBrowsePipeline ? stage : 'empty'}`}
        >
          {!canBrowsePipeline ? (
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
          {canBrowsePipeline && stage === 'detect' && (
            <StageDetect files={stagedFiles.length ? stagedFiles : files} run={activeRun} />
          )}
          {canBrowsePipeline && stage === 'clean' && <StageClean run={activeRun} />}
          {canBrowsePipeline && stage === 'automl' && <StageAutoml run={activeRun} />}
          {canBrowsePipeline && stage === 'explain' && <StageExplain run={activeRun} />}
        </main>

        {loggedIn ? (
          <RunsHistory
            runs={runs}
            activeId={activeRun?.id}
            onSelect={selectRun}
            onDelete={(run) => void removeRun(run)}
          />
        ) : null}
      </div>

      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthed={onAuthed}
        initialMode="register"
      />
    </div>
  )
}
