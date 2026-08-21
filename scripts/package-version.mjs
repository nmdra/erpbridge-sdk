import { readFileSync } from 'node:fs'

/** Read the package version for build and test configuration only. */
export function readPackageVersion() {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

export const PACKAGE_VERSION = readPackageVersion()
