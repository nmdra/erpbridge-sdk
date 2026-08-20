import { defineConfig } from 'vitest/config'
import type { UserConfig } from 'vite'

const config: UserConfig = {
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      reporter: ['text', 'json-summary'],
    },
  },
}

export default config