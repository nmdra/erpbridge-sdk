import type { McpClient } from './mcp.js'
import { INVALID_PARAMS_CODE } from './mcp.js'
import type { ToolCallArguments, ToolDefinition, ToolResult } from './types.js'
import { NotFoundError, ProtocolError } from './types.js'

/** An executable proxy handle for one exact registered tool name. */
export interface ToolFunction {
  (args?: ToolCallArguments): Promise<ToolResult>
  /** Chained handle for dotted tool names (`tools.system.progress_test`). */
  [name: string]: ToolFunction
}

/**
 * Build the `client.tools` proxy: `tools.<exactName>(args)` calls the tool by
 * its exact registered name, discovering the tool list lazily on first use.
 * Dotted names chain (`tools.system.progress_test({})`). Unknown names throw
 * {@link NotFoundError} listing the available tools; schema violations throw
 * {@link ProtocolError} (draft-07 subset: `required` + per-property `type`).
 */
export function createToolsProxy(mcp: McpClient): Record<string, ToolFunction> {
  let discovered: Map<string, ToolDefinition> | undefined

  const ensureDiscovered = async (): Promise<Map<string, ToolDefinition>> => {
    if (discovered === undefined) {
      const tools = await mcp.listTools()
      discovered = new Map(tools.map((t) => [t.name, t]))
    }
    return discovered
  }

  const handle = (name: string): ToolFunction => {
    const fn = (async (args?: ToolCallArguments): Promise<ToolResult> => {
      const byName = await ensureDiscovered()
      const def = byName.get(name)
      if (def === undefined) {
        const available = [...byName.keys()].sort().join(', ')
        throw new NotFoundError(`unknown tool '${name}'; available tools: ${available}`)
      }
      const params = args ?? {}
      validateArgs(name, def, params)
      return mcp.callTool(name, params)
    }) as ToolFunction
    return new Proxy(fn, {
      get(target, prop, receiver) {
        if (typeof prop === 'string') return handle(`${name}.${prop}`)
        return Reflect.get(target, prop, receiver)
      },
    })
  }

  return new Proxy({} as Record<string, ToolFunction>, {
    get(_target, prop, receiver) {
      if (typeof prop === 'string') return handle(prop)
      return Reflect.get(_target, prop, receiver)
    },
  })
}

function validateArgs(name: string, def: ToolDefinition, args: ToolCallArguments): void {
  const schema = def.inputSchema ?? {}
  const required = schema.required
  if (Array.isArray(required)) {
    const missing = required.filter((key): key is string => typeof key === 'string' && args[key] === undefined)
    if (missing.length > 0) {
      throw new ProtocolError(`invalid arguments for tool '${name}': missing required field(s): ${missing.join(', ')}`, {
        code: INVALID_PARAMS_CODE,
      })
    }
  }

  const properties = schema.properties
  if (properties !== null && typeof properties === 'object' && !Array.isArray(properties)) {
    for (const [key, value] of Object.entries(properties as Record<string, { type?: string | string[] }>)) {
      if (args[key] === undefined) continue
      const expected = value.type
      if (typeof expected !== 'string' || matchesType(args[key], expected)) continue
      throw new ProtocolError(`invalid arguments for tool '${name}': field '${key}' must be of type ${expected}, got ${typeof args[key]}`, {
        code: INVALID_PARAMS_CODE,
      })
    }
  }
}

function matchesType(value: unknown, expected: string): boolean {
  switch (expected) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number'
    case 'integer':
      return Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    case 'array':
      return Array.isArray(value)
    case 'null':
      return value === null
    default:
      return true
  }
}