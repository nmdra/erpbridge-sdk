import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Socket } from 'node:net'
import type { LogRecord } from '../src/types.js'
import { closeTrackedServer, respondJson, trackRequestSocket } from './helpers.js'

export interface LogsSseOptions {
  /** Records returned by `GET /api/logs/recent`. */
  recentLogs?: LogRecord[]
  /** Overrides the `/api/logs/recent` response body (contract-violation tests). */
  recentBody?: unknown
  /** Records emitted on each SSE connection, then the stream stays open. */
  events?: LogRecord[]
  /** Delay between emitted records. */
  intervalMs?: number
  /** Close the connection after emitting this many records (reconnect tests). */
  closeAfterEmitted?: number
  /** Per-connection gate: return true to answer the SSE request with 500. */
  shouldFail?: () => boolean
}

export interface LogsSseFixture {
  url: string
  close(): Promise<void>
  /** Number of SSE connections the fixture has accepted. */
  connections(): number
}

/** A node:http fixture serving the logs REST surface the server exposes. */
export async function startLogsSseFixture(options: LogsSseOptions = {}): Promise<LogsSseFixture> {
  const recentLogs = options.recentLogs ?? []
  const recentBody = options.recentBody ?? recentLogs
  const events = options.events ?? []
  const intervalMs = options.intervalMs ?? 10
  let connections = 0
  const sockets = new Set<Socket>()

  const server: Server = createServer(async (req, res) => {
    trackRequestSocket(req, res, sockets)
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (req.method === 'GET' && url.pathname === '/api/logs/recent') {
      respondJson(res, 200, recentBody)
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/logs/stream') {
      connections++
      if (options.shouldFail?.()) {
        respondJson(res, 500, { error: 'boom: fixture failure' })
        return
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      let sent = 0
      const timer = setInterval(() => {
        if (sent >= events.length) return
        const record = events[sent++]
        if (record === undefined) return
        res.write(`data: ${JSON.stringify(record)}\n\n`)
        if (options.closeAfterEmitted !== undefined && sent >= options.closeAfterEmitted) {
          clearInterval(timer)
          res.end()
        }
      }, intervalMs)
      res.on('close', () => clearInterval(timer))
      return
    }

    respondJson(res, 404, { error: 'not found in fixture' })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    connections: () => connections,
    close: () => closeTrackedServer(server, sockets),
  }
}