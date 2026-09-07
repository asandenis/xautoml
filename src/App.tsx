import { useCallback, useId, useRef, useState, type DragEvent, type ChangeEvent } from 'react'

type StageId = 'detect' | 'clean' | 'automl' | 'explain'

type UploadedFile = {
  id: string
  file: File
  name: string
  size: number
  ext: string
  kind: FileKind
}

type FileKind = 'table' | 'document' | 'image' | 'audio' | 'other'

const STAGES: { id: StageId; index: string; label: string }[] = [
  { id: 'detect', index: '01', label: 'Detect' },
  { id: 'clean', index: '02', label: 'Clean' },
  { id: 'automl', index: '03', label: 'AutoML' },
  { id: 'explain', index: '04', label: 'Explain' },
]

const ACCEPTED_EXTENSIONS = [
  'csv',
  'tsv',
  'xls',
  'xlsx',
  'parquet',
  'json',
  'pdf',
  'doc',
  'docx',
  'odt',
  'txt',
  'rtf',
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'mp3',
  'wav',
  'flac',
  'ogg',
  'm4a',
] as const

const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(',')

const TABLE_EXTS = new Set(['csv', 'tsv', 'xls', 'xlsx', 'parquet', 'json'])
const DOC_EXTS = new Set(['pdf', 'doc', 'docx', 'odt', 'txt', 'rtf'])
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a'])

const DEMO_DATASET = {
  rows: 12_480,
  cols: 14,
  task: 'Binary classification',
  target: 'churned',
}

const COLUMNS = [
  { name: 'customer_id', type: 'id', missing: '0%', note: 'Unique key' },
  { name: 'tenure_months', type: 'numeric', missing: '0.2%', note: 'Right-skewed' },
  { name: 'monthly_charge', type: 'numeric', missing: '1.1%', note: 'Currency' },
  { name: 'contract_type', type: 'categorical', missing: '0%', note: '3 levels' },
  { name: 'support_tickets', type: 'numeric', missing: '0%', note: 'Count' },
  { name: 'last_login_days', type: 'numeric', missing: '3.4%', note: 'Recency' },
  { name: 'region', type: 'categorical', missing: '0.8%', note: '8 levels' },
  { name: 'churned', type: 'boolean', missing: '0%', note: 'Target' },
]

const CLEAN_STEPS = [
  { action: 'Drop', detail: 'customer_id — identifier, no predictive value' },
  { action: 'Impute', detail: 'median for tenure_months, monthly_charge, last_login_days' },
  { action: 'Encode', detail: 'one-hot contract_type, region' },
  { action: 'Scale', detail: 'standardize numeric features' },
  { action: 'Split', detail: '70 / 15 / 15 train · val · test, stratified on churned' },
]

const MODELS = [
  { name: 'Gradient Boosting', auc: 0.912, f1: 0.84, status: 'best' as const },
  { name: 'Random Forest', auc: 0.894, f1: 0.81, status: 'ok' as const },
  { name: 'Logistic Regression', auc: 0.861, f1: 0.76, status: 'ok' as const },
  { name: 'SVM (RBF)', auc: 0.848, f1: 0.74, status: 'ok' as const },
]

const FEATURES = [
  { name: 'last_login_days', weight: 0.28 },
  { name: 'monthly_charge', weight: 0.21 },
  { name: 'support_tickets', weight: 0.17 },
  { name: 'contract_type=month-to-month', weight: 0.14 },
  { name: 'tenure_months', weight: 0.11 },
]

function extensionOf(name: string) {
  const parts = name.toLowerCase().split('.')
  return parts.length > 1 ? parts.at(-1)! : ''
}

function kindOf(ext: string): FileKind {
  if (TABLE_EXTS.has(ext)) return 'table'
  if (DOC_EXTS.has(ext)) return 'document'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  return 'other'
}

function isAccepted(file: File) {
  const ext = extensionOf(file.name)
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileKey(file: File) {
  return `${file.name}::${file.size}::${file.lastModified}`
}

function StageDetect({ files }: { files: UploadedFile[] }) {
  const primary = files[0]
  const kinds = [...new Set(files.map((f) => f.kind))]

  return (
    <div className="panel-grid">
      <section className="block">
        <p className="kicker">Dataset</p>
        <h2 className="block-title">{files.length === 1 ? primary.name : `${files.length} files`}</h2>
        <dl className="meta-list">
          <div>
            <dt>Files</dt>
            <dd>{files.length}</dd>
          </div>
          <div>
            <dt>Total size</dt>
            <dd>{formatBytes(files.reduce((sum, f) => sum + f.size, 0))}</dd>
          </div>
          <div>
            <dt>Modalities</dt>
            <dd>{kinds.join(' · ')}</dd>
          </div>
          <div>
            <dt>Inferred task</dt>
            <dd>{DEMO_DATASET.task}</dd>
          </div>
          <div>
            <dt>Target</dt>
            <dd>
              <code>{DEMO_DATASET.target}</code>
            </dd>
          </div>
        </dl>
      </section>

      <section className="block block-grow">
        <p className="kicker">Schema</p>
        <h2 className="block-title">Detected columns</h2>
        <p className="note note-tight">
          Hard-coded preview from tabular signal
          {primary ? (
            <>
              {' '}
              in <code>{primary.name}</code>
            </>
          ) : null}
          .
        </p>
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
              {COLUMNS.map((col) => (
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

function StageClean() {
  return (
    <div className="panel-grid">
      <section className="block">
        <p className="kicker">Transforms</p>
        <h2 className="block-title">Applied pipeline</h2>
        <ol className="action-list">
          {CLEAN_STEPS.map((step, i) => (
            <li key={step.action + i}>
              <span className="action-tag">{step.action}</span>
              <span>{step.detail}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="block">
        <p className="kicker">Output</p>
        <h2 className="block-title">Feature matrix</h2>
        <dl className="meta-list">
          <div>
            <dt>Train rows</dt>
            <dd>8,736</dd>
          </div>
          <div>
            <dt>Val / test</dt>
            <dd>1,872 / 1,872</dd>
          </div>
          <div>
            <dt>Features</dt>
            <dd>22 after encoding</dd>
          </div>
          <div>
            <dt>Class balance</dt>
            <dd>26.4% positive</dd>
          </div>
        </dl>
        <p className="note">
          Missing values filled. Categoricals expanded. Ready for model search.
        </p>
      </section>
    </div>
  )
}

function StageAutoml() {
  return (
    <div className="panel-grid">
      <section className="block block-grow">
        <p className="kicker">Model search</p>
        <h2 className="block-title">Leaderboard</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>AUC</th>
                <th>F1</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {MODELS.map((model) => (
                <tr key={model.name} className={model.status === 'best' ? 'is-best' : undefined}>
                  <td>{model.name}</td>
                  <td>
                    <code>{model.auc.toFixed(3)}</code>
                  </td>
                  <td>
                    <code>{model.f1.toFixed(2)}</code>
                  </td>
                  <td className="muted">{model.status === 'best' ? 'selected' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="block">
        <p className="kicker">Importance</p>
        <h2 className="block-title">Top drivers</h2>
        <ul className="bar-list">
          {FEATURES.map((f) => (
            <li key={f.name}>
              <div className="bar-label">
                <code>{f.name}</code>
                <span>{Math.round(f.weight * 100)}%</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${f.weight * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function StageExplain() {
  return (
    <div className="panel-stack">
      <section className="block">
        <p className="kicker">Agent</p>
        <h2 className="block-title">Result narrative</h2>
        <div className="prose">
          <p>
            This looks like a <strong>churn prediction</strong> problem. The best model is{' '}
            <strong>Gradient Boosting</strong> (AUC 0.912, F1 0.84 on the held-out test set).
          </p>
          <p>
            Churn risk rises sharply when customers go quiet:{' '}
            <code>last_login_days</code> is the strongest signal, followed by higher{' '}
            <code>monthly_charge</code> and frequent <code>support_tickets</code>. Month-to-month
            contracts also elevate risk versus annual plans.
          </p>
          <p>
            Treat high-score accounts with outreach before day-30 inactivity. The model is strong
            but not perfect—false positives cluster among new high-ARPU users in the first 90 days
            of tenure.
          </p>
        </div>
      </section>

      <section className="block">
        <p className="kicker">Caveats</p>
        <ul className="plain-list">
          <li>Target leakage check passed — no post-churn fields in features.</li>
          <li>Region has mild imbalance; calibration may drift for rare regions.</li>
          <li>3.4% missing on last_login_days was median-imputed — monitor online.</li>
        </ul>
      </section>
    </div>
  )
}

function UploadZone({
  files,
  onAdd,
  onRemove,
  onClear,
}: {
  files: UploadedFile[]
  onAdd: (files: File[]) => void
  onRemove: (id: string) => void
  onClear: () => void
}) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [rejectNote, setRejectNote] = useState<string | null>(null)

  const handleFiles = useCallback(
    (list: FileList | File[]) => {
      const incoming = Array.from(list)
      const accepted = incoming.filter(isAccepted)
      const rejected = incoming.length - accepted.length
      setRejectNote(
        rejected > 0
          ? `${rejected} file${rejected === 1 ? '' : 's'} skipped — unsupported type`
          : null,
      )
      if (accepted.length) onAdd(accepted)
    },
    [onAdd],
  )

  const onDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
  }

  const onDragLeave = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files)
  }

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) handleFiles(e.target.files)
    e.target.value = ''
  }

  return (
    <div className="upload-block">
      <div
        className={`upload-zone${dragging ? ' is-dragging' : ''}${files.length ? ' has-files' : ''}`}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          id={inputId}
          className="sr-only"
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          onChange={onChange}
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
            — CSV, XLSX, PDF, DOC/DOCX, ODT, JPG, PNG, MP3, WAV, and more
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
        <div className="file-list-wrap">
          <div className="file-list-head">
            <p className="kicker">
              Uploaded · {files.length} file{files.length === 1 ? '' : 's'}
            </p>
            <button type="button" className="text-btn" onClick={onClear}>
              Clear all
            </button>
          </div>
          <ul className="file-list">
            {files.map((f) => (
              <li key={f.id}>
                <span className="file-kind">{f.kind}</span>
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
        </div>
      ) : null}
    </div>
  )
}

function EmptyWorkspace() {
  return (
    <section className="empty-workspace" aria-live="polite">
      <p className="kicker">Pipeline locked</p>
      <h2 className="block-title">Upload data to unlock Detect, Clean, AutoML, and Explain.</h2>
      <p className="note">
        Add one or more files above. Until then, pipeline stages stay unavailable.
      </p>
    </section>
  )
}

export default function App() {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [stage, setStage] = useState<StageId>('detect')
  const hasData = files.length > 0

  const addFiles = useCallback((incoming: File[]) => {
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => fileKey(f.file)))
      const next = [...prev]
      for (const file of incoming) {
        const key = fileKey(file)
        if (seen.has(key)) continue
        seen.add(key)
        const ext = extensionOf(file.name)
        next.push({
          id: `${key}-${crypto.randomUUID()}`,
          file,
          name: file.name,
          size: file.size,
          ext,
          kind: kindOf(ext),
        })
      }
      return next
    })
  }, [])

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
  }, [])

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
          <code className="run-id">{hasData ? 'run_7f3a2c' : '—'}</code>
        </div>
        <div className={`topbar-status${hasData ? '' : ' is-waiting'}`}>
          <span className="status-dot" aria-hidden="true" />
          <span>{hasData ? 'Pipeline ready' : 'Waiting for data'}</span>
        </div>
      </header>

      <div className="shell">
        <UploadZone
          files={files}
          onAdd={addFiles}
          onRemove={removeFile}
          onClear={clearFiles}
        />

        <nav className="stage-nav" aria-label="Pipeline stages">
          {STAGES.map((s) => {
            const locked = !hasData
            return (
              <button
                key={s.id}
                type="button"
                className={`stage-tab${stage === s.id && hasData ? ' is-active' : ''}${locked ? ' is-locked' : ''}`}
                onClick={() => {
                  if (!locked) setStage(s.id)
                }}
                disabled={locked}
                aria-current={stage === s.id && hasData ? 'step' : undefined}
                title={locked ? 'Upload data to unlock this stage' : undefined}
              >
                <span className="stage-index">{s.index}</span>
                <span className="stage-label">{s.label}</span>
              </button>
            )
          })}
        </nav>

        <main className="workspace" key={hasData ? stage : 'empty'}>
          {!hasData && <EmptyWorkspace />}
          {hasData && stage === 'detect' && <StageDetect files={files} />}
          {hasData && stage === 'clean' && <StageClean />}
          {hasData && stage === 'automl' && <StageAutoml />}
          {hasData && stage === 'explain' && <StageExplain />}
        </main>
      </div>
    </div>
  )
}
