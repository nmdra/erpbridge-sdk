import { describe, expect, it } from 'vitest'
import { createClient } from '../../src/index.js'
import { NotFoundError, ServerError } from '../../src/types.js'

const serverUrl = process.env.ERPBridge_TEST_SERVER
const integration = serverUrl ? describe : describe.skip

function makeClient(timeoutMs = 15_000) {
  return createClient({ baseUrl: serverUrl!, timeoutMs })
}

// Probed at collection time (runIf is evaluated when the test is defined).
let cacheDisabled = false
if (serverUrl) {
  try {
    await makeClient().cache.stats()
  } catch (error) {
    cacheDisabled = error instanceof ServerError && error.status === 503
  }
}

integration('ERPBridge live integration (error paths)', () => {
  it('mcp.callTool() on an unknown tool maps to NotFoundError', async () => {
    const client = makeClient()
    await client.mcp.connect()
    await expect(client.mcp.callTool('nonexistent_tool', {})).rejects.toBeInstanceOf(NotFoundError)
    await client.close()
  })

  it('invoke() on an unknown tool maps to NotFoundError', async () => {
    const client = makeClient()
    await expect(client.invoke('nonexistent_tool', {})).rejects.toBeInstanceOf(NotFoundError)
  })

  it.runIf(cacheDisabled)('cache.flush() maps a disabled cache to ServerError 503', async () => {
    const client = makeClient()
    await expect(client.cache.flush({ all: true })).rejects.toMatchObject({
      name: 'ServerError',
      status: 503,
    })
  })

  it('tools proxy on an unknown name maps to NotFoundError', async () => {
    const client = makeClient()
    await client.mcp.connect()
    await expect(client.tools.nonexistent_tool!({})).rejects.toBeInstanceOf(NotFoundError)
    await client.close()
  })
})