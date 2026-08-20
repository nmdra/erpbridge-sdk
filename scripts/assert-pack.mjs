import { execFileSync } from 'node:child_process'

const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' })
const parsed = JSON.parse(out)
const result = Array.isArray(parsed) ? parsed[0] : parsed[Object.keys(parsed)[0]]
const names = result.files.map((f) => f.path)

const required = [
  'package.json',
  'README.md',
  'dist/index.mjs',
  'dist/index.cjs',
  'dist/index.d.mts',
  'dist/index.d.cts',
  'src/index.ts',
]

const errors = []
for (const r of required) {
  if (!names.includes(r)) errors.push(`missing from tarball: ${r}`)
}
for (const n of names) {
  if (n === 'package.json' || n === 'README.md' || n === 'CHANGELOG.md') continue
  if (n.startsWith('dist/') || n.startsWith('src/')) continue
  errors.push(`unexpected file in tarball: ${n}`)
}

if (errors.length > 0) {
  console.error('pack assertions failed:')
  for (const e of errors) console.error(` - ${e}`)
  process.exit(1)
}
console.log(`pack assertions passed: ${names.length} files, dist/src/package.json/README.md only`)