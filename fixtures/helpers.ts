import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function respondJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

export function respond(res: ServerResponse, status: number, headers: Record<string, string>, body: string): void {
  res.writeHead(status, headers)
  res.end(body)
}

export function trackRequestSocket(req: IncomingMessage, res: ServerResponse, sockets: Set<Socket>): void {
  req.socket.setNoDelay(true)
  sockets.add(req.socket)
  res.on('close', () => sockets.delete(req.socket))
}

export function closeTrackedServer(server: Server, sockets: Set<Socket>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    for (const socket of sockets) socket.destroy()
    server.close((err) => (err ? reject(err) : resolve()))
  })
}
