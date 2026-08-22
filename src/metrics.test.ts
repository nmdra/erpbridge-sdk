import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from '../fixtures/http-server.js'
import type { ErpbridgeConfig } from './types.js'
import { createMetricsApi } from './metrics.js'
import { parsePrometheusText } from './prometheus.js'

const metricsText = await readFile(new URL('../fixtures/metrics.txt', import.meta.url), 'utf8')

let fixture: FixtureServer

const config = (): ErpbridgeConfig => ({
  baseUrl: fixture.url,
  mcpUrl: `${fixture.url}/mcp/`,
  timeoutMs: 5000,
  fetch: globalThis.fetch,
})

beforeEach(async () => {
  fixture = await startFixtureServer([{ method: 'GET', path: '/metrics', body: metricsText, headers: { 'Content-Type': 'text/plain; version=0.0.4' } }])
})

afterEach(async () => {
  await fixture.close()
})

describe('createMetricsApi', () => {
  it('text() returns the raw Prometheus exposition body', async () => {
    const api = createMetricsApi(config())
    const body = await api.text()
    expect(body).toBe(metricsText)
    expect(body).toContain('# TYPE mcp_tool_invocations_total counter')
  })

  it('uses the metrics surface credential', async () => {
    const api = createMetricsApi({ ...config(), auth: { metrics: { token: 'sdk-metrics-fixture-token' } } })
    await api.text()
    expect(fixture.authorizationHeaders()).toEqual(['Bearer sdk-metrics-fixture-token'])
  })

  it('parsed() returns counters, gauges, and histograms from the fixture', async () => {
    const api = createMetricsApi(config())
    const { families } = await api.parsed()
    const byName = new Map(families.map((f) => [f.name, f]))

    const counter = byName.get('mcp_tool_invocations_total')
    expect(counter?.type).toBe('counter')
    expect(counter?.samples).toHaveLength(2)
    expect(counter?.samples[0]?.labels).toMatchObject({ tool: 'system.progress_test', cache_status: 'SUCCESS' })
    expect(counter?.samples[0]?.value).toBe(3)

    const gauge = byName.get('mcp_sessions_active')
    expect(gauge?.type).toBe('gauge')
    expect(gauge?.samples[0]).toMatchObject({ labels: {}, value: 1 })

    const histogram = byName.get('mcp_tool_duration_seconds')
    expect(histogram?.type).toBe('histogram')
    expect(histogram?.samples).toHaveLength(28)
    expect(histogram?.help).toContain('Latency')
  })

  it('parses histogram bucket, sum, and count series', async () => {
    const api = createMetricsApi(config())
    const { families } = await api.parsed()
    const histogram = families.find((f) => f.name === 'mcp_tool_duration_seconds')!
    const progress = histogram.samples.filter((s) => s.labels.tool === 'system.progress_test')

    const buckets = progress.filter((s) => s.name?.endsWith('_bucket'))
    expect(buckets).toHaveLength(12)
    expect(buckets.map((b) => b.labels.le)).toEqual(['0.005', '0.01', '0.025', '0.05', '0.1', '0.25', '0.5', '1', '2.5', '5', '10', '+Inf'])
    expect(buckets[buckets.length - 1]?.labels.le).toBe('+Inf')
    expect(buckets[buckets.length - 1]?.value).toBe(3)

    const sum = progress.find((s) => s.name?.endsWith('_sum'))
    expect(sum?.labels).toEqual({ tool: 'system.progress_test' })
    expect(sum?.value).toBeCloseTo(1.203351287, 6)

    const count = progress.find((s) => s.name?.endsWith('_count'))
    expect(count?.value).toBe(3)
  })

  it('skips summary families with a clear report', async () => {
    const api = createMetricsApi(config())
    const { families, skipped } = await api.parsed()
    expect(families.some((f) => f.name === 'go_gc_duration_seconds')).toBe(false)
    expect(skipped).toContainEqual({ name: 'go_gc_duration_seconds', type: 'summary' })
  })

  it('parsed() works when the method is detached from the api object', async () => {
    const api = createMetricsApi(config())
    const { parsed } = api
    const { families } = await parsed()
    expect(families.some((f) => f.name === 'mcp_sessions_active')).toBe(true)
  })
})

describe('parsePrometheusText', () => {
  it('parses scientific-notation and negative values', () => {
    const { families } = parsePrometheusText(
      ['# HELP x_bytes A byte counter', '# TYPE x_bytes counter', 'x_bytes 9.223372036854776e+18', '# TYPE x_neg gauge', 'x_neg -1.5'].join('\n') + '\n',
    )
    const byName = new Map(families.map((f) => [f.name, f]))
    expect(byName.get('x_bytes')?.samples[0]?.value).toBe(9.223372036854776e18)
    expect(byName.get('x_neg')?.samples[0]?.value).toBe(-1.5)
  })

  it('parses NaN and infinity values', () => {
    const { families } = parsePrometheusText('# TYPE x gauge\nx NaN\nx +Inf\n')
    expect(families[0]?.samples[0]?.value).toBeNaN()
    expect(families[0]?.samples[1]?.value).toBe(Infinity)
  })

  it('parses label values with escaped quotes and backslashes', () => {
    const { families } = parsePrometheusText('# TYPE l_count counter\nl_count{a="say \\"hi\\"",b="c\\\\d"} 1\n')
    expect(families[0]?.samples[0]?.labels).toEqual({ a: 'say "hi"', b: 'c\\d' })
  })

  it('handles empty label braces', () => {
    const { families } = parsePrometheusText('# TYPE e_total counter\ne_total{} 2\n')
    expect(families[0]?.samples[0]?.labels).toEqual({})
  })

  it('skips untyped families with a clear report', () => {
    const { families, skipped } = parsePrometheusText('# TYPE mystery untyped\nmystery 1\n')
    expect(families).toHaveLength(0)
    expect(skipped).toContainEqual({ name: 'mystery', type: 'untyped' })
  })
})
