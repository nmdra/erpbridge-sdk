import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const workspace = process.cwd()
const tempRoot = mkdtempSync(join(tmpdir(), 'erpbridge-sdk-packed-'))
const packageRoot = join(tempRoot, 'node_modules', '@erpbridge', 'sdk')
const consumerRoot = join(tempRoot, 'consumer')
const tarballRoot = join(tempRoot, 'tarball')

try {
  mkdirSync(tarballRoot, { recursive: true })
  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--pack-destination', tarballRoot], {
      cwd: workspace,
      encoding: 'utf8',
    }),
  )
  const packageResult = Array.isArray(packed) ? packed[0] : packed[Object.keys(packed)[0]]
  const packageFile = packageResult?.filename
  if (typeof packageFile !== 'string') throw new Error('npm pack did not return a tarball filename')

  mkdirSync(packageRoot, { recursive: true })
  execFileSync('tar', ['-xzf', join(tarballRoot, packageFile), '-C', packageRoot, '--strip-components=1'])
  mkdirSync(join(tempRoot, 'node_modules', '@modelcontextprotocol'), { recursive: true })
  symlinkSync(
    join(workspace, 'node_modules', '@modelcontextprotocol', 'client'),
    join(tempRoot, 'node_modules', '@modelcontextprotocol', 'client'),
    'junction',
  )

  mkdirSync(consumerRoot, { recursive: true })
  writeFileSync(
    join(consumerRoot, 'esm.mjs'),
    `import { AuthorizationError, createClient } from '@erpbridge/sdk'
import { createClient as createSubpathClient } from '@erpbridge/sdk/client'
import { createSystemApi } from '@erpbridge/sdk/rest'
import { AuthorizationError as SubpathAuthorizationError } from '@erpbridge/sdk/types'

if (typeof createClient !== 'function' || typeof createSubpathClient !== 'function' || typeof createSystemApi !== 'function') {
  throw new Error('packed ESM subpaths did not expose their public factories')
}
if (AuthorizationError !== SubpathAuthorizationError) throw new Error('packed error exports are inconsistent')
`,
  )
  await import(pathToFileURL(join(consumerRoot, 'esm.mjs')).href)

  writeFileSync(
    join(consumerRoot, 'cjs.cjs'),
    `const root = require('@erpbridge/sdk')
const client = require('@erpbridge/sdk/client')
const rest = require('@erpbridge/sdk/rest')
const types = require('@erpbridge/sdk/types')

for (const [name, value] of Object.entries({ root: root.createClient, client: client.createClient, rest: rest.createSystemApi })) {
  if (typeof value !== 'function') throw new Error('packed CJS entry missing ' + name + ' factory')
}
if (root.AuthorizationError !== types.AuthorizationError) throw new Error('packed CJS error exports are inconsistent')
`,
  )
  const packedRequire = createRequire(join(consumerRoot, 'cjs.cjs'))
  packedRequire(join(consumerRoot, 'cjs.cjs'))

  writeFileSync(
    join(consumerRoot, 'types.ts'),
    `import { createClient } from '@erpbridge/sdk'
import { createClient as createSubpathClient } from '@erpbridge/sdk/client'
import { createSystemApi } from '@erpbridge/sdk/rest'
import type { AuthScope, McpToolResult, ToolResult } from '@erpbridge/sdk/types'

declare const mcpResult: McpToolResult
declare const restResult: ToolResult
const scope: AuthScope = 'mcp'
const mcpContent = mcpResult.content
const restPayload = restResult.result
// @ts-expect-error MCP envelopes are not REST results.
const mcpAsRest: ToolResult = mcpResult
// @ts-expect-error REST results are not MCP envelopes.
const restAsMcp: McpToolResult = restResult
void [mcpAsRest, restAsMcp]
void [createClient, createSubpathClient, createSystemApi, scope, mcpContent, restPayload]
`,
  )
  execFileSync(
    join(workspace, 'node_modules', '.bin', 'tsc'),
    [
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      '--target',
      'es2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--lib',
      'es2022,dom',
      join(consumerRoot, 'types.ts'),
    ],
    { cwd: consumerRoot, stdio: 'inherit' },
  )

  console.log('packed ESM/CJS subpaths and type consumers passed')
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
