import { describe, expect, it } from 'vitest'
import { parseSse } from './sse.js'

const streamFrom = (chunks: string[]): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
      controller.close()
    },
  })

const collect = async (gen: AsyncGenerator<string>): Promise<string[]> => {
  const out: string[] = []
  for await (const event of gen) out.push(event)
  return out
}

describe('parseSse', () => {
  it('yields data payloads from `data:` lines', async () => {
    const gen = parseSse(streamFrom(['data: {"a":1}\n\n', 'data: {"b":2}\n\n']))
    expect(await collect(gen)).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('splits lines across chunk boundaries', async () => {
    const gen = parseSse(streamFrom(['data: {"a":', '1}\n\nda', 'ta: {"b":2}\n\n']))
    expect(await collect(gen)).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('handles CRLF line endings', async () => {
    const gen = parseSse(streamFrom(['data: {"a":1}\r\n\r\n']))
    expect(await collect(gen)).toEqual(['{"a":1}'])
  })

  it('ignores comments and non-data fields', async () => {
    const gen = parseSse(streamFrom([': keepalive\nevent: log\nid: 7\ndata: {"a":1}\n\n']))
    expect(await collect(gen)).toEqual(['{"a":1}'])
  })

  it('joins multiple data lines of one event', async () => {
    const gen = parseSse(streamFrom(['data: {"a":1}\ndata: {"b":2}\n\n']))
    expect(await collect(gen)).toEqual(['{"a":1}\n{"b":2}'])
  })

  it('flushes a pending event at stream end without a trailing blank line', async () => {
    const gen = parseSse(streamFrom(['data: {"a":1}\n\n', 'data: {"b":2}']))
    expect(await collect(gen)).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('flushes a pending event when the stream ends after a bare newline', async () => {
    const gen = parseSse(streamFrom(['data: {"a":1}\n', 'data: {"b":2}\n']))
    expect(await collect(gen)).toEqual(['{"a":1}\n{"b":2}'])
  })
})