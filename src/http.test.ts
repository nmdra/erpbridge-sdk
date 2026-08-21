import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { startFixtureServer, type FixtureServer, type Route } from '../fixtures/http-server.js'
import { AuthenticationError, ClientError, ErpbridgeError, NotFoundError, RateLimitError, ServerError } from './types.js'
import { request, requestStream, type HttpResponse } from './http.js'

let fixture: FixtureServer

const routes: Route[] = [
  { method: 'GET', path: '/api/bad-request', status: 400, body: { error: 'bad request' } },
  { method: 'GET', path: '/api/admission', status: 422, body: 'invalid tool: metadata.name is required\n' },
  { method: 'GET', path: '/api/ok', body: { ok: true } },
  { method: 'GET', path: '/api/not-found', status: 404, body: { error: 'no such tool' } },
  { method: 'GET', path: '/api/server-error', status: 500, body: { message: 'cache not enabled' } },
  { method: 'GET', path: '/api/unauthorized', status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="erpbridge"' }, body: { error: 'unauthorized' } },
  { method: 'GET', path: '/api/rate-limited', status: 429, headers: { 'Retry-After': '30' }, body: { error: 'too many requests' } },
  { method: 'GET', path: '/api/plain', status: 200, headers: { 'Content-Type': 'text/plain' }, body: 'just text' },
  { method: 'GET', path: '/api/empty', status: 204 },
  { method: 'GET', path: '/api/slow', status: 200, body: { slow: true }, delayMs: 2000 },
  { method: 'POST', path: '/api/echo', body: (req: IncomingMessage, rawBody: string) => ({ method: req.method, body: rawBody }) },
  { method: 'GET', path: '/api/query', body: (req: IncomingMessage) => Object.fromEntries(new URL(req.url ?? '', 'http://localhost').searchParams) },
]

beforeEach(async () => {
  fixture = await startFixtureServer(routes)
})

afterEach(async () => {
  await fixture.close()
})

function cfg(timeoutMs = 500) {
  return { baseUrl: fixture.url, mcpUrl: `${fixture.url}/mcp/`, timeoutMs }
}

describe('request', () => {
  it('returns parsed JSON for 2xx responses', async () => {
    const res = await request(cfg(), { method: 'GET', path: '/api/ok' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('attaches the raw text for non-JSON bodies', async () => {
    const res = await request(cfg(), { method: 'GET', path: '/api/plain' })
    expect(res.body).toBe('just text')
  })

  it('handles empty 204 responses', async () => {
    const res = await request(cfg(), { method: 'GET', path: '/api/empty' })
    expect(res.status).toBe(204)
    expect(res.body).toBe('')
  })

  it('maps 404 to NotFoundError with body attached', async () => {
    await expect(request(cfg(), { method: 'GET', path: '/api/not-found' })).rejects.toMatchObject({
      name: 'NotFoundError',
      status: 404,
      body: { error: 'no such tool' },
    })
    await expect(request(cfg(), { method: 'GET', path: '/api/not-found' })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('maps 401 to AuthenticationError with the WWW-Authenticate hint', async () => {
    await expect(request(cfg(), { method: 'GET', path: '/api/unauthorized' })).rejects.toMatchObject({
      name: 'AuthenticationError',
      hint: 'Bearer realm="erpbridge"',
    })
  })

  it('maps 429 to RateLimitError with Retry-After', async () => {
    await expect(request(cfg(), { method: 'GET', path: '/api/rate-limited' })).rejects.toMatchObject({
      name: 'RateLimitError',
      retryAfter: '30',
    })
  })

  it('maps 400 to ClientError with status and body', async () => {
    await expect(request(cfg(), { method: 'GET', path: '/api/bad-request' })).rejects.toMatchObject({
      name: 'ClientError',
      status: 400,
      body: { error: 'bad request' },
    })
    await expect(request(cfg(), { method: 'GET', path: '/api/bad-request' })).rejects.toBeInstanceOf(ClientError)
  })

  it('maps 422 to ClientError with the admission message', async () => {
    await expect(request(cfg(), { method: 'GET', path: '/api/admission' })).rejects.toMatchObject({
      name: 'ClientError',
      status: 422,
    })
    await expect(request(cfg(), { method: 'GET', path: '/api/admission' })).rejects.toBeInstanceOf(ClientError)
  })

  it('maps 5xx to ServerError with status and body', async () => {
    await expect(request(cfg(), { method: 'GET', path: '/api/server-error' })).rejects.toMatchObject({
      name: 'ServerError',
      status: 500,
      body: { message: 'cache not enabled' },
    })
  })

  it('serializes query parameters and sends JSON bodies', async () => {
    const res = await request<{ method: string; body: string }>(cfg(), {
      method: 'POST',
      path: '/api/echo',
      query: { tool: 'list_employees', page: '2' },
      body: { name: 'alice' },
    })
    expect(res.body.method).toBe('POST')
    expect(JSON.parse(res.body.body)).toEqual({ name: 'alice' })
  })

  it('serializes query parameters on GET', async () => {
    const res = await request<{ tool: string; module: string }>(cfg(), {
      method: 'GET',
      path: '/api/query',
      query: { tool: 'x', module: 'y', missing: undefined },
    })
    expect(res.body).toEqual({ tool: 'x', module: 'y' })
  })

  it('aborts with an ErpbridgeError when the timeout elapses', async () => {
    await expect(request(cfg(50), { method: 'GET', path: '/api/slow' })).rejects.toBeInstanceOf(ErpbridgeError)
  })

  it('honours an external AbortSignal', async () => {
    const controller = new AbortController()
    const promise = request(cfg(5000), { method: 'GET', path: '/api/slow', signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toBeInstanceOf(ErpbridgeError)
  })

  it('skips the per-request timeout when noTimeout is set', async () => {
    const promise = request(cfg(50), { method: 'GET', path: '/api/slow', noTimeout: true })
    const res = await promise
    expect(res.body).toEqual({ slow: true })
  })
})

describe('requestStream', () => {
  it('returns a Response for streaming consumers with mapped errors', async () => {
    const res = await requestStream(cfg(), { method: 'GET', path: '/api/ok' })
    expect(res).toBeInstanceOf(Response)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('maps HTTP errors on streamed requests', async () => {
    await expect(requestStream(cfg(), { method: 'GET', path: '/api/not-found' })).rejects.toBeInstanceOf(NotFoundError)
  })
})