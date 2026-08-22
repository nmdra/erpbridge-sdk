import { createServer } from 'node:http'
import type { IncomingMessage, Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readBody, respond } from './helpers.js'

/** A fixture route. `body` may be computed from the incoming request. */
export interface Route {
  method: string
  /** Exact request path (query string ignored for matching). */
  path: string
  /** Response status; may be computed from the incoming request. */
  status?: number | ((req: IncomingMessage, rawBody: string) => number)
  body?: unknown | ((req: IncomingMessage, rawBody: string) => unknown)
  headers?: Record<string, string>
  /** Delay before responding, used to exercise timeouts. */
  delayMs?: number
}

export interface FixtureServer {
  url: string
  close(): Promise<void>
  /** Authorization values observed on requests, for injection assertions. */
  authorizationHeaders(): Array<string | undefined>
}

/** Start a node:http fixture server on a random loopback port. */
export async function startFixtureServer(routes: Route[]): Promise<FixtureServer> {
  const authorizationHeaders: Array<string | undefined> = []
  const server: Server = createServer(async (req, res) => {
    authorizationHeaders.push(req.headers.authorization)
    const rawBody = await readBody(req)
    const url = new URL(req.url ?? '/', 'http://localhost')
    const route = routes.find((r) => r.method === (req.method ?? 'GET') && r.path === url.pathname)
    if (!route) {
      respond(res, 404, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'not found in fixture' }))
      return
    }
    const body = typeof route.body === 'function' ? await route.body(req, rawBody) : route.body
    const payload = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
    const headers = { 'Content-Type': 'application/json', ...route.headers }
    const status = typeof route.status === 'function' ? await route.status(req, rawBody) : (route.status ?? 200)
    const respondNow = () => respond(res, status, headers, payload)
    if (route.delayMs) setTimeout(respondNow, route.delayMs)
    else respondNow()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    authorizationHeaders: () => [...authorizationHeaders],
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  }
}
