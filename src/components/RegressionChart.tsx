type ChartPoint = { x: number; y: number; yHat: number }
type ChartLine = { x0: number; y0: number; x1: number; y1: number }

export function RegressionChart({
  xLabel,
  yLabel,
  points,
  line,
}: {
  xLabel: string
  yLabel: string
  points: ChartPoint[]
  line?: ChartLine
}) {
  const width = 640
  const height = 360
  const pad = { top: 24, right: 20, bottom: 44, left: 56 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom

  if (!points.length) {
    return <p className="note">No points to plot.</p>
  }

  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  if (line) {
    xs.push(line.x0, line.x1)
    ys.push(line.y0, line.y1)
  }

  let minX = Math.min(...xs)
  let maxX = Math.max(...xs)
  let minY = Math.min(...ys)
  let maxY = Math.max(...ys)
  if (minX === maxX) {
    minX -= 1
    maxX += 1
  }
  if (minY === maxY) {
    minY -= 1
    maxY += 1
  }

  const sx = (x: number) => pad.left + ((x - minX) / (maxX - minX)) * innerW
  const sy = (y: number) => pad.top + (1 - (y - minY) / (maxY - minY)) * innerH

  return (
    <div className="chart-wrap">
      <svg
        className="regression-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Scatter plot of ${yLabel} vs ${xLabel}`}
      >
        <rect x="0" y="0" width={width} height={height} fill="transparent" />
        {/* grid */}
        {Array.from({ length: 5 }, (_, i) => {
          const y = pad.top + (innerH * i) / 4
          const x = pad.left + (innerW * i) / 4
          return (
            <g key={i}>
              <line
                x1={pad.left}
                x2={pad.left + innerW}
                y1={y}
                y2={y}
                stroke="rgba(255,255,255,0.08)"
              />
              <line
                y1={pad.top}
                y2={pad.top + innerH}
                x1={x}
                x2={x}
                stroke="rgba(255,255,255,0.08)"
              />
            </g>
          )
        })}
        <line
          x1={pad.left}
          y1={pad.top + innerH}
          x2={pad.left + innerW}
          y2={pad.top + innerH}
          stroke="rgba(255,255,255,0.35)"
        />
        <line
          x1={pad.left}
          y1={pad.top}
          x2={pad.left}
          y2={pad.top + innerH}
          stroke="rgba(255,255,255,0.35)"
        />

        {points.map((p, i) => (
          <circle
            key={i}
            cx={sx(p.x)}
            cy={sy(p.y)}
            r={3.2}
            fill="rgba(244,244,244,0.85)"
          />
        ))}

        {line ? (
          <line
            x1={sx(line.x0)}
            y1={sy(line.y0)}
            x2={sx(line.x1)}
            y2={sy(line.y1)}
            stroke="#ffffff"
            strokeWidth={1.75}
          />
        ) : null}

        <text
          x={pad.left + innerW / 2}
          y={height - 12}
          textAnchor="middle"
          fill="rgba(154,154,154,1)"
          fontSize="12"
          fontFamily="Geist Mono, monospace"
        >
          {xLabel}
        </text>
        <text
          x={16}
          y={pad.top + innerH / 2}
          textAnchor="middle"
          fill="rgba(154,154,154,1)"
          fontSize="12"
          fontFamily="Geist Mono, monospace"
          transform={`rotate(-90 16 ${pad.top + innerH / 2})`}
        >
          {yLabel}
        </text>
      </svg>
      <p className="chart-legend">
        Points = observed · Line = fitted linear model
      </p>
    </div>
  )
}
