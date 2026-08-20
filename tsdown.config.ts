import { defineConfig, type UserConfig } from 'tsdown'

const config: UserConfig = {
  entry: {
    index: 'src/index.ts',
    client: 'src/client.ts',
    rest: 'src/rest.ts',
    types: 'src/types.ts',
  },
  format: ['esm', 'cjs'],
  target: 'node20',
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