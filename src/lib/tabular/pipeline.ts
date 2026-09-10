import { cleanTabular } from './clean'
import { tryParseFirstTabular, type ParsedTable } from './parse'
import { fitLinearRegression, type RegressionResult } from './regression'
import type { UploadedFile } from '../files'

export type TabularPipelineResult = {
  mode: 'tabular'
  fileName: string
  detect: {
    task: string
    target: string
    predictors: string[]
    rows: number
    columns: { name: string; type: string; missing: string; note: string }[]
    source: string
  }
  clean: {
    features: number
    trainRows: number
    rowsIn: number
    missingImputed: number
    outliersClipped: number
    steps: string[]
  }
  automl: {
    bestModel: string
    r2: number
    mae: number
    rmse: number
    intercept: number
    coefficients: { name: string; value: number }[]
    equation: string
  }
  explain: {
    narrative: string
    chart: {
      xLabel: string
      yLabel: string
      points: { x: number; y: number; yHat: number }[]
      /** simple line for single-predictor plot */
      line?: { x0: number; y0: number; x1: number; y1: number }
    }
  }
}

function buildChart(table: ParsedTable, model: RegressionResult) {
  const yLabel = table.headers[0] ?? 'y'
  const xLabel = table.headers[1] ?? 'x'
  const xs = model.points.map((p) => p.x)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)

  // For 1 predictor, plot y vs x with fitted line. For multi, plot actual vs predicted using x=yHat axis trick — still use first predictor on x, overlay y and yHat.
  let line: { x0: number; y0: number; x1: number; y1: number } | undefined
  if (model.coefficients.length === 1) {
    const b0 = model.intercept
    const b1 = model.coefficients[0]!.value
    line = { x0: minX, y0: b0 + b1 * minX, x1: maxX, y1: b0 + b1 * maxX }
  } else {
    // actual vs predicted: use yHat as x
    const sorted = [...model.points].sort((a, b) => a.yHat - b.yHat)
    line = {
      x0: sorted[0]!.yHat,
      y0: sorted[0]!.yHat,
      x1: sorted[sorted.length - 1]!.yHat,
      y1: sorted[sorted.length - 1]!.yHat,
    }
  }

  const points =
    model.coefficients.length === 1
      ? model.points
      : model.points.map((p) => ({ x: p.yHat, y: p.y, yHat: p.yHat }))

  return {
    xLabel: model.coefficients.length === 1 ? xLabel : 'predicted',
    yLabel,
    points,
    line,
  }
}

export async function runTabularPipeline(
  files: UploadedFile[],
): Promise<TabularPipelineResult | null> {
  const parsed = await tryParseFirstTabular(files)
  if (!parsed) return null

  const cleaned = cleanTabular(parsed)
  const model = fitLinearRegression(cleaned.matrix, cleaned.headers)
  const chart = buildChart(parsed, model)

  const top = [...model.coefficients].sort(
    (a, b) => Math.abs(b.value) - Math.abs(a.value),
  )[0]

  return {
    mode: 'tabular',
    fileName: parsed.fileName,
    detect: {
      task: 'Linear regression',
      target: parsed.headers[0]!,
      predictors: parsed.headers.slice(1),
      rows: parsed.rows.length,
      source: parsed.fileName,
      columns: parsed.columns.map((c) => ({
        name: c.name,
        type: 'numeric',
        missing: `${c.missingPct.toFixed(1)}%`,
        note: c.role === 'dependent' ? 'Dependent (y)' : 'Independent (x)',
      })),
    },
    clean: {
      features: cleaned.features,
      trainRows: cleaned.rowsOut,
      rowsIn: cleaned.rowsIn,
      missingImputed: cleaned.missingImputed,
      outliersClipped: cleaned.outliersClipped,
      steps: cleaned.steps,
    },
    automl: {
      bestModel: 'Linear Regression (OLS)',
      r2: model.r2,
      mae: model.mae,
      rmse: model.rmse,
      intercept: model.intercept,
      coefficients: model.coefficients,
      equation: model.equation,
    },
    explain: {
      narrative: top
        ? `Fitted OLS on ${parsed.fileName}. Dependent variable is ${parsed.headers[0]}. Strongest absolute coefficient is ${top.name} (${top.value.toFixed(3)}). R²=${model.r2.toFixed(3)}, MAE=${model.mae.toFixed(3)}.`
        : `Fitted OLS on ${parsed.fileName}.`,
      chart,
    },
  }
}
