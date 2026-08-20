import { request } from './http.js'
import type { ErpbridgeConfig } from './types.js'
import { parsePrometheusText, type ParsedMetrics } from './prometheus.js'

/** The server's metrics surface (`GET /metrics`, Prometheus text format). */
export interface MetricsApi {
  /** Return the raw Prometheus exposition body. */
  text(): Promise<string>
  /**
   * Fetch and parse the exposition body into typed families. Counters,
   * gauges, and histograms are parsed; summary and untyped families are
   * skipped and reported in {@link ParsedMetrics.skipped}.
   */
  parsed(): Promise<ParsedMetrics>
}

/** Build the metrics API over the HTTP core. */
export function createMetricsApi(config: ErpbridgeConfig): MetricsApi {
  const text = async (): Promise<string> => {
    const res = await request<string>(config, { path: '/metrics' })
    return typeof res.body === 'string' ? res.body : JSON.stringify(res.body)
  }
  return {
    text,
    async parsed(): Promise<ParsedMetrics> {
      return parsePrometheusText(await text())
    },
  }
}