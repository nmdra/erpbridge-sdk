import type { MetricFamily, MetricSample } from './types.js'

/** A metric family the parser does not support (summary, untyped). */
export interface SkippedFamily {
  name: string
  type: string
}

/** The result of parsing a Prometheus text exposition body. */
export interface ParsedMetrics {
  /** Families with supported types: counter, gauge, and histogram. */
  families: MetricFamily[]
  /**
   * Families skipped because their type is unsupported (summary, untyped),
   * with the type that caused the skip. Histogram `_bucket`/`_sum`/`_count`
   * series are parsed into the histogram family; summaries are not parsed
   * (R4) and surface here instead of silently disappearing.
   */
  skipped: SkippedFamily[]
}

interface FamilyContext {
  name: string
  type: MetricFamily['type']
  help: string
  samples: MetricSample[]
}

type FamilyType = MetricFamily['type']
const SUPPORTED_TYPES: ReadonlySet<FamilyType> = new Set(['counter', 'gauge', 'histogram'])
function isSupportedType(type: string): type is FamilyType {
  return (SUPPORTED_TYPES as ReadonlySet<string>).has(type)
}

/**
 * Line-oriented parser for the Prometheus text exposition format
 * (counters, gauges, and histograms only). Handles `# HELP`/`# TYPE`
 * metadata, label sets with escaped values, float/infinity values, and
 * histogram series (`_bucket` with the `le` label, `_sum`, `_count`).
 */
export function parsePrometheusText(text: string): ParsedMetrics {
  const families: MetricFamily[] = []
  const skipped: SkippedFamily[] = []
  let current: FamilyContext | undefined
  const helpByFamily = new Map<string, string>()

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line === '') continue

    if (line.startsWith('# ')) {
      const [directive, name, ...rest] = line.slice(2).split(' ')
      if (directive === 'HELP' && name) {
        helpByFamily.set(name, rest.join(' '))
        if (current?.name === name) current.help = rest.join(' ')
      } else if (directive === 'TYPE' && name) {
        const type = rest.join(' ')
        flush(current, families)
        if (isSupportedType(type)) {
          current = { name, type, help: helpByFamily.get(name) ?? '', samples: [] }
        } else {
          current = undefined
          skipped.push({ name, type })
        }
      }
      continue
    }

    if (line.startsWith('#')) continue
    if (current === undefined) continue

    const sample = parseSampleLine(line)
    if (sample === undefined) continue
    if (matchesFamily(sample.name, current)) {
      current.samples.push({ name: sample.name, labels: sample.labels, value: sample.value })
    }
  }
  flush(current, families)
  return { families, skipped }
}

function flush(current: FamilyContext | undefined, families: MetricFamily[]): void {
  if (current === undefined) return
  families.push({ name: current.name, type: current.type, help: current.help, samples: current.samples })
}

function matchesFamily(sampleName: string, family: FamilyContext): boolean {
  if (sampleName === family.name) return true
  if (family.type !== 'histogram') return false
  return sampleName === `${family.name}_sum` || sampleName === `${family.name}_count` || sampleName === `${family.name}_bucket`
}

function parseSampleLine(line: string): { name: string; labels: Record<string, string>; value: number } | undefined {
  const braceIndex = line.indexOf('{')
  const spaceIndex = line.indexOf(' ')
  if (braceIndex === -1 && spaceIndex === -1) return undefined
  if (braceIndex === -1 || spaceIndex !== -1 && spaceIndex < braceIndex) {
    const name = line.slice(0, spaceIndex)
    const value = parseValue(line.slice(spaceIndex + 1).trim())
    if (value === undefined) return undefined
    return { name, labels: {}, value }
  }
  const endBrace = line.indexOf('}', braceIndex)
  if (endBrace === -1) return undefined
  const name = line.slice(0, braceIndex)
  const value = parseValue(line.slice(endBrace + 1).trim())
  if (value === undefined) return undefined
  return { name, labels: parseLabels(line.slice(braceIndex, endBrace + 1)), value }
}

function parseValue(raw: string): number | undefined {
  if (raw === '+Inf') return Infinity
  if (raw === '-Inf') return -Infinity
  if (raw === 'NaN') return NaN
  const value = Number(raw)
  return Number.isNaN(value) ? undefined : value
}

function parseLabels(raw: string): Record<string, string> {
  const labels: Record<string, string> = {}
  const inner = raw.startsWith('{') && raw.endsWith('}') ? raw.slice(1, -1) : ''
  if (inner === '') return labels
  let key = ''
  let value = ''
  let state: 'key' | 'eq' | 'value' | 'sep' = 'key'
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (state === 'key') {
      if (c === '=') state = 'eq'
      else if (c !== ' ') key += c
    } else if (state === 'eq') {
      if (c === '"') state = 'value'
    } else if (state === 'value') {
      if (c === '\\') {
        value += inner[i + 1] ?? ''
        i++
      } else if (c === '"') state = 'sep'
      else value += c
    } else if (c === ',') {
      labels[key.trim()] = value
      key = ''
      value = ''
      state = 'key'
    }
  }
  if (key !== '' || value !== '') labels[key.trim()] = value
  return labels
}