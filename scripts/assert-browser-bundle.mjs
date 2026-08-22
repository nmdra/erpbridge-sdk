import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite'

const workspace = process.cwd()
const tempRoot = mkdtempSync(join(tmpdir(), 'erpbridge-sdk-browser-'))
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
  const packedEsm = await import(new URL('./dist/client.mjs', `file://${packageRoot}/`))
  if (typeof packedEsm.createClient !== 'function') throw new Error('packed ESM client entry did not load')
  const packedRequire = createRequire(join(packageRoot, 'package.json'))
  if (typeof packedRequire(join(packageRoot, 'dist/client.cjs')).createClient !== 'function') {
    throw new Error('packed CJS client entry did not load')
  }
  mkdirSync(consumerRoot, { recursive: true })
  writeFileSync(
    join(consumerRoot, 'root.ts'),
    "import { createClient } from '@erpbridge/sdk'\nconst client = createClient({ baseUrl: 'https://bridge.example.com' })\nexport const mcp = client.mcp\nexport const tools = client.tools\n",
  )
  writeFileSync(
    join(consumerRoot, 'client.ts'),
    "import { createClient } from '@erpbridge/sdk/client'\nconst client = createClient({ baseUrl: 'https://bridge.example.com' })\nexport const mcp = client.mcp\nexport const tools = client.tools\n",
  )

  const result = await build({
    configFile: false,
    root: consumerRoot,
    logLevel: 'error',
    resolve: {
      conditions: ['browser', 'import', 'default'],
    },
    build: {
      write: false,
      target: 'es2022',
      rollupOptions: {
        input: {
          root: join(consumerRoot, 'root.ts'),
          client: join(consumerRoot, 'client.ts'),
        },
      },
    },
  })
  const outputs = Array.isArray(result) ? result.flatMap((item) => item.output) : result.output
  const code = outputs.map((item) => ('code' in item ? item.code : '')).join('\n')
  if (/node:[a-z-]+|createRequire/.test(code)) {
    throw new Error('browser bundle contains a Node-only module or createRequire')
  }
  console.log(`browser bundle passed: ${outputs.length} output chunks`)
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
