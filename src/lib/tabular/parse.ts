import * as XLSX from 'xlsx'
import type { UploadedFile } from '../files'

export type TabularColumn = {
  name: string
  role: 'dependent' | 'independent'
  missingPct: number
}

export type ParsedTable = {
  fileName: string
  headers: string[]
  /** row-major numeric matrix; NaN for missing */
  rows: number[][]
  columns: TabularColumn[]
}

function isTabularFile(file: UploadedFile) {
  return file.kind === 'numerical' && ['csv', 'tsv', 'xlsx', 'xls'].includes(file.ext)
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') return Number.NaN
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN
  const cleaned = String(value).trim().replace(/,/g, '')
  if (!cleaned) return Number.NaN
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : Number.NaN
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

  const rows = dataRows.map((row) =>
    headers.map((_, colIdx) => toNumber(row[colIdx])),
  )

  // Validate mostly-numeric structure (allow some missing)
  const numericCols = headers.map((_, colIdx) => {
    const values = rows.map((r) => r[colIdx]!)
    const valid = values.filter((v) => !Number.isNaN(v)).length
    return valid / Math.max(1, values.length)
  })
  if (numericCols.some((ratio) => ratio < 0.5)) {
    throw new Error(
      'Expected numerical data under each header (row 1 names, rows 2+ numbers).',
    )
  }

  const columns: TabularColumn[] = headers.map((name, colIdx) => {
    const values = rows.map((r) => r[colIdx]!)
    const missing = values.filter((v) => Number.isNaN(v)).length
    return {
      name,
      role: colIdx === 0 ? 'dependent' : 'independent',
      missingPct: (missing / Math.max(1, values.length)) * 100,
    }
  })

  return { fileName: file.name, headers, rows, columns }
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
