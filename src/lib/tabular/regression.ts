export type RegressionResult = {
  intercept: number
  coefficients: { name: string; value: number }[]
  r2: number
  mae: number
  rmse: number
  n: number
  /** For charting: actual y, predicted y, and first predictor (if any) */
  points: { x: number; y: number; yHat: number }[]
  equation: string
}

function transpose(m: number[][]) {
  const rows = m.length
  const cols = m[0]?.length ?? 0
  const out = Array.from({ length: cols }, () => Array<number>(rows).fill(0))
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) out[j]![i] = m[i]![j]!
  }
  return out
}

function matMul(a: number[][], b: number[][]) {
  const n = a.length
  const m = b[0]?.length ?? 0
  const p = b.length
  const out = Array.from({ length: n }, () => Array<number>(m).fill(0))
  for (let i = 0; i < n; i += 1) {
    for (let k = 0; k < p; k += 1) {
      const aik = a[i]![k]!
      for (let j = 0; j < m; j += 1) out[i]![j]! += aik * b[k]![j]!
    }
  }
  return out
}

function invert(matrix: number[][]) {
  const n = matrix.length
  const a = matrix.map((row) => [...row])
  const inv = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  )

  for (let col = 0; col < n; col += 1) {
    let pivot = col
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r
    }
    if (Math.abs(a[pivot]![col]!) < 1e-12) {
      throw new Error('Singular matrix — predictors may be collinear or constant.')
    }
    ;[a[col], a[pivot]] = [a[pivot]!, a[col]!]
    ;[inv[col], inv[pivot]] = [inv[pivot]!, inv[col]!]

    const div = a[col]![col]!
    for (let j = 0; j < n; j += 1) {
      a[col]![j]! /= div
      inv[col]![j]! /= div
    }
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue
      const factor = a[r]![col]!
      for (let j = 0; j < n; j += 1) {
        a[r]![j]! -= factor * a[col]![j]!
        inv[r]![j]! -= factor * inv[col]![j]!
      }
    }
  }
  return inv
}

export function fitLinearRegression(
  matrix: number[][],
  headers: string[],
): RegressionResult {
  const n = matrix.length
  const p = (matrix[0]?.length ?? 1) - 1
  if (p < 1) throw new Error('Need at least one independent variable.')

  const y = matrix.map((row) => row[0]!)
  const X = matrix.map((row) => [1, ...row.slice(1)])

  const Xt = transpose(X)
  const XtX = matMul(Xt, X)
  const XtY = matMul(
    Xt,
    y.map((v) => [v]),
  )
  const beta = matMul(invert(XtX), XtY).map((row) => row[0]!)

  const intercept = beta[0]!
  const coefficients = headers.slice(1).map((name, i) => ({
    name,
    value: beta[i + 1]!,
  }))

  const yHat = X.map((row) => row.reduce((s, v, i) => s + v * beta[i]!, 0))
  const yMean = y.reduce((s, v) => s + v, 0) / n
  const ssTot = y.reduce((s, v) => s + (v - yMean) ** 2, 0)
  const ssRes = y.reduce((s, v, i) => s + (v - yHat[i]!) ** 2, 0)
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot
  const mae = y.reduce((s, v, i) => s + Math.abs(v - yHat[i]!), 0) / n
  const rmse = Math.sqrt(ssRes / n)

  const xForPlot = matrix.map((row) => row[1] ?? 0)
  const points = y.map((yi, i) => ({
    x: xForPlot[i]!,
    y: yi,
    yHat: yHat[i]!,
  }))

  const terms = coefficients
    .map((c) => `${c.value >= 0 ? '+' : '-'} ${Math.abs(c.value).toFixed(3)}·${c.name}`)
    .join(' ')
  const equation = `${headers[0]} = ${intercept.toFixed(3)} ${terms}`

  return { intercept, coefficients, r2, mae, rmse, n, points, equation }
}
