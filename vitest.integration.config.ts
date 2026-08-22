import { defineConfig } from 'vitest/config'
import type { UserConfig } from 'vite'
import { PACKAGE_VERSION } from './scripts/package-version.mjs'

const config: UserConfig = {
  define: {
    __ERPBRIDGE_SDK_VERSION__: JSON.stringify(PACKAGE_VERSION),
  },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
  },
}

export default defineConfig(config)
