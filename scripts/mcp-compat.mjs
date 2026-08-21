/**
 * T5 compatibility spike: initialize + tools/list against a real ERPBridge
 * server, verifying protocol version negotiation and graceful fallback of the
 * OAuth protected-resource metadata probe (the server hosts no such metadata).
 *
 * Usage: ERPBridge_TEST_SERVER=http://localhost:8080 node scripts/mcp-compat.mjs
 * Exits 0 on success, non-zero on failure.
 */
import { readFileSync } from 'node:fs'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const { version: SDK_VERSION } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const serverUrl = process.env.ERPBridge_TEST_SERVER
if (!serverUrl) {
  console.log('ERPBridge_TEST_SERVER is not set; skipping compatibility spike')
  process.exit(0)
}

const mcpUrl = new URL('/mcp/', serverUrl)

async function main() {
  console.log(`spike: connecting to ${mcpUrl.href}`)
  const client = new Client({ name: 'erpbridge-sdk-compat-spike', version: SDK_VERSION })
  const transport = new StreamableHTTPClientTransport(mcpUrl, { fetch: globalThis.fetch })
  await client.connect(transport)
  console.log('spike: initialize + capability negotiation OK')

  const res = await client.listTools()
  console.log(`spike: tools/list OK — ${res.tools.length} tools`)
  for (const tool of res.tools.slice(0, 5)) {
    console.log(`  - ${tool.name}`)
  }

  await transport.close()
  await client.close()
  console.log('spike: PASS')
  process.exit(0)
}

main().catch((error) => {
  console.error(`spike: FAIL — ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  process.exit(1)
})