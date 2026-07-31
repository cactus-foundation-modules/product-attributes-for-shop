// How a spec row that differs from variation to variation is summed up for the
// shopper who has not chosen one yet.
//
// The panel shows a variation's own value the moment a full combination is
// picked. Until then it has to say something honest about the whole listing,
// and "honest" changes with the row: a chair whose seat height runs 44cm to
// 56cm is best described by its extremes, a three-way tilt mechanism by its
// three names, and a fabric offered in 92 colours by neither - a 92-item list
// is not a specification, it is a wall.
//
// Pure and server-side, so the union is baked into the first HTML: it is what a
// crawler reads and what anyone without JavaScript keeps.

// Something like "44-56cm", "8.4kg" or "8 hours" - a measurement rather than a
// name. The unit is whatever trails the number(s); values only span together
// when they all carry the SAME unit, so "10kg" and "10cm" are never merged.
// The unit's own spacing is kept per value: "57cm" spans as "57cm", "8 hours"
// as "8 hours" - collapsing the space is right for cm and wrong for words.
const MEASUREMENT = /^(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?(\s*)([a-zA-Z]+)$/

type Measurement = { low: number; high: number; lowText: string; highText: string; sep: string; unit: string }

function parseMeasurement(value: string): Measurement | null {
  const m = MEASUREMENT.exec(value.trim())
  if (!m) return null
  const lowText = m[1] ?? ''
  const highText = m[2] ?? lowText
  const low = Number(lowText)
  const high = Number(highText)
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null
  return { low, high, lowText, highText, sep: m[3] ?? '', unit: m[4] ?? '' }
}

// Above this many distinct values a list stops informing and starts hiding the
// rest of the table. Six is roughly a line of text at the widths this panel is
// read at.
const MAX_LISTED = 6

/**
 * One line's worth of "what this listing offers", from the distinct values its
 * variations carry (already in the order the owner put them in, duplicates
 * removed by the caller).
 *
 * Three shapes, in order of preference:
 *   - every value a measurement in one unit -> the span, "8.4kg - 23.4kg"
 *   - a handful of names -> the list, "Synchro tilt, Anti-shock"
 *   - too many to read -> the count, "92 choices - select your options to see yours"
 */
export function summariseSpecValues(values: string[]): string {
  const first = values[0]
  if (first === undefined) return ''
  if (values.length === 1) return first

  const measurements = values.map(parseMeasurement)
  const firstMeasure = measurements[0]
  if (firstMeasure && measurements.every((m) => m !== null && m.unit === firstMeasure.unit)) {
    let low = firstMeasure
    let high = firstMeasure
    for (const m of measurements) {
      if (!m) continue
      if (m.low < low.low) low = m
      if (m.high > high.high) high = m
    }
    if (low.lowText === high.highText) return `${low.lowText}${low.sep}${low.unit}`
    return `${low.lowText}${low.sep}${low.unit} - ${high.highText}${high.sep}${high.unit}`
  }

  if (values.length <= MAX_LISTED) return values.join(', ')
  return `${values.length} choices - select your options to see yours`
}

// The distinct values of a per-variation row, first-seen order kept so the
// summary follows the owner's own value order rather than an alphabet.
export function distinctSpecValues(values: (string | null)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    if (v == null || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}
