/**
 * Minimal dependency-free SSE parser (D8): reads `data: <json>\n\n` events
 * from a response body. Handles chunk boundaries, CRLF line endings,
 * comments, non-data fields, and trailing events without a closing blank
 * line. Yields the payload of each complete event.
 */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let dataLines: string[] = []

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newlineIndex: number
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
        buffer = buffer.slice(newlineIndex + 1)
        handleLine(line, dataLines)
        if (line === '') {
          const event = dataLines.join('\n')
          dataLines = []
          if (event !== '') yield event
        }
      }
    }
    buffer += decoder.decode()
    if (buffer !== '') handleLine(buffer.replace(/\r$/, ''), dataLines)
    if (dataLines.length > 0) {
      const event = dataLines.join('\n')
      if (event !== '') yield event
    }
  } finally {
    reader.releaseLock()
  }
}

function handleLine(line: string, dataLines: string[]): void {
  if (line.startsWith(':')) return
  if (line.startsWith('data:')) {
    dataLines.push(line.slice(5).replace(/^ /, ''))
  }
}