import * as XLSX from 'xlsx'
import type { UploadedFile } from '../files'

export type TabularColumn = {
  name: string
  role: 'dependent' | 'independent'
  missingPct: number
  /** Cells that were text/symbols coerced to missing */
  nonNumericPct: number
}

export type ParsedTable = {
  fileName: string
  headers: string[]
  /** row-major numeric matrix; NaN for missing / non-numeric */
  rows: number[][]
  columns: TabularColumn[]
  nonNumericCells: number
}

function isTabularFile(file: UploadedFile) {
  return file.kind === 'numerical' && ['csv', 'tsv', 'xlsx', 'xls'].includes(file.ext)
}

/** Coerce cell to number; non-numeric / blank → NaN (treated as missing later). */
function toNumber(value: unknown): { n: number; coerced: boolean } {
  if (value === null || value === undefined) return { n: Number.NaN, coerced: false }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { n: value, coerced: false } : { n: Number.NaN, coerced: true }
  }
  if (typeof value === 'boolean') return { n: value ? 1 : 0, coerced: true }

  let cleaned = String(value).trim()
  if (!cleaned) return { n: Number.NaN, coerced: false }

  const lower = cleaned.toLowerCase()
  if (
    lower === 'na' ||
    lower === 'n/a' ||
    lower === 'nan' ||
    lower === 'null' ||
    lower === 'none' ||
    lower === '-' ||
    lower === '--' ||
    lower === '?' ||
    lower === '#n/a' ||
    lower === '#value!' ||
    lower === '#div/0!'
  ) {
    return { n: Number.NaN, coerced: true }
  }

  // Strip currency / percent / spaces; keep digits, sign, decimal, exponent
  const hadJunk = /[^0-9eE.+_\-\s,]/.test(cleaned) || /[%$€£¥]/.test(cleaned)
  cleaned = cleaned
    .replace(/[$€£¥%\s]/g, '')
    .replace(/,/g, '')
  if (!cleaned) return { n: Number.NaN, coerced: true }

  const n = Number(cleaned)
  if (Number.isFinite(n)) return { n, coerced: hadJunk }
  return { n: Number.NaN, coerced: true }
}

export async function parseTabularFile(file: UploadedFile): Promise<ParsedTable> {
  const buffer = await file.file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', raw: false })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new Error('Workbook has no sheets.')

  const matrix = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
  })

  if (matrix.length < 2) {
    throw new Error('Need a header row and at least one data row.')
  }

  const headerRow = matrix[0] ?? []
  const headers = headerRow.map((h, i) => {
    const name = String(h ?? '').trim()
    return name || `col_${i + 1}`
  })

  if (headers.length < 2) {
    throw new Error('Need a dependent column plus at least one predictor.')
  }

  const dataRows = matrix.slice(1).filter((row) =>
    row.some((cell) => String(cell ?? '').trim() !== ''),
  )

  let nonNumericCells = 0
  const rows = dataRows.map((row) =>
    headers.map((_, colIdx) => {
      const raw = row[colIdx]
      const blank = raw === null || raw === undefined || String(raw).trim() === ''
      const { n } = toNumber(raw)
      if (!blank && Number.isNaN(n)) nonNumericCells += 1
      return n
    }),
  )

  // Pool is numerical if enough cells parse as numbers; non-numeric → missing
  const totalCells = rows.length * headers.length
  const numericCells = rows.reduce(
    (acc, row) => acc + row.filter((v) => !Number.isNaN(v)).length,
    0,
  )
  if (totalCells === 0 || numericCells / totalCells < 0.25) {
    throw new Error(
      'Expected mostly numerical data under each header (non-numeric cells are allowed and treated as missing).',
    )
  }

  const yValid = rows.filter((r) => !Number.isNaN(r[0])).length
  if (yValid < 3) {
    throw new Error('Dependent column (first) needs at least 3 numeric values.')
  }

  const columns: TabularColumn[] = headers.map((name, colIdx) => {
    const values = rows.map((r) => r[colIdx]!)
    const missing = values.filter((v) => Number.isNaN(v)).length
    return {
      name,
      role: colIdx === 0 ? 'dependent' : 'independent',
      missingPct: (missing / Math.max(1, values.length)) * 100,
      nonNumericPct: (missing / Math.max(1, values.length)) * 100,
    }
  })

  return { fileName: file.name, headers, rows, columns, nonNumericCells }
}

/** Pick the first CSV/XLSX that matches the numerical schema; otherwise null. */
export async function tryParseFirstTabular(
  files: UploadedFile[],
): Promise<ParsedTable | null> {
  const candidates = files.filter(isTabularFile)
  for (const file of candidates) {
    try {
      return await parseTabularFile(file)
    } catch {
      // try next candidate / fall back to dummy pipeline
    }
  }
  return null
}
