import { defineConfig, type UserConfig } from 'tsdown'
import { PACKAGE_VERSION } from './scripts/package-version.mjs'

const config: UserConfig = {
  entry: {
    index: 'src/index.ts',
    client: 'src/client.ts',
    rest: 'src/rest.ts',
    types: 'src/types.ts',
  },
  format: ['esm', 'cjs'],
  platform: 'neutral',
  target: 'es2022',
  define: {
    __ERPBRIDGE_SDK_VERSION__: JSON.stringify(PACKAGE_VERSION),
  },
  dts: true,
  clean: true,
  fixedExtension: true,
  deps: {
    neverBundle: ['@modelcontextprotocol/client'],
  },
  publint: true,
  attw: true,
}

export default config
