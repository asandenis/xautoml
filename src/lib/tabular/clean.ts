import type { ParsedTable } from './parse'

export type CleanReport = {
  rowsIn: number
  rowsOut: number
  features: number
  missingImputed: number
  outliersClipped: number
  steps: string[]
  /** cleaned matrix: col0 = y, rest = X */
  matrix: number[][]
  headers: string[]
}

function median(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0)
}

function iqrBounds(values: number[]) {
  if (values.length < 4) {
    return { lo: -Infinity, hi: Infinity }
  }
  const sorted = [...values].sort((a, b) => a - b)
  const q1 = sorted[Math.floor(sorted.length * 0.25)] ?? sorted[0]!
  const q3 = sorted[Math.floor(sorted.length * 0.75)] ?? sorted[sorted.length - 1]!
  const iqr = q3 - q1
  return { lo: q1 - 1.5 * iqr, hi: q3 + 1.5 * iqr }
}

export function cleanTabular(table: ParsedTable): CleanReport {
  const colCount = table.headers.length
  const steps: string[] = []
  let missingImputed = 0
  let outliersClipped = 0

  // Drop rows where dependent (col 0) is missing
  let working = table.rows.filter((row) => !Number.isNaN(row[0]))
  const droppedY = table.rows.length - working.length
  if (droppedY > 0) {
    steps.push(`Dropped ${droppedY} row(s) with missing dependent value`)
  }

  // Median impute predictors (and keep y as-is)
  const medians = Array.from({ length: colCount }, (_, c) => {
    const vals = working.map((r) => r[c]!).filter((v) => !Number.isNaN(v))
    return median(vals)
  })

  working = working.map((row) =>
    row.map((v, c) => {
      if (!Number.isNaN(v)) return v
      if (c === 0) return v
      missingImputed += 1
      return medians[c] ?? 0
    }),
  )
  if (missingImputed > 0) {
    steps.push(`Median-imputed ${missingImputed} missing predictor value(s)`)
  } else {
    steps.push('No missing predictor values')
  }

  // Drop any remaining incomplete rows
  working = working.filter((row) => row.every((v) => !Number.isNaN(v)))

  // IQR outlier clipping per column
  const bounds = Array.from({ length: colCount }, (_, c) =>
    iqrBounds(working.map((r) => r[c]!)),
  )
  working = working.map((row) =>
    row.map((v, c) => {
      const { lo, hi } = bounds[c]!
      if (v < lo) {
        outliersClipped += 1
        return lo
      }
      if (v > hi) {
        outliersClipped += 1
        return hi
      }
      return v
    }),
  )
  if (outliersClipped > 0) {
    steps.push(`Clipped ${outliersClipped} outlier value(s) via IQR (1.5×)`)
  } else {
    steps.push('No IQR outliers detected')
  }

  steps.push('First column treated as dependent variable (y)')

  if (working.length < 3) {
    throw new Error('Not enough clean rows to fit a regression (need ≥ 3).')
  }

  return {
    rowsIn: table.rows.length,
    rowsOut: working.length,
    features: colCount - 1,
    missingImputed,
    outliersClipped,
    steps,
    matrix: working,
    headers: table.headers,
  }
}
