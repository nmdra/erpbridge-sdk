import { defineConfig } from 'vitest/config'
import type { UserConfig } from 'vite'

const config: UserConfig = {
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
  },
}

export default defineConfig(config)