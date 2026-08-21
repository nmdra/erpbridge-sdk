import { ProtocolError } from './types.js'

export const INTERNAL_ERROR_CODE = -32000

export function protocolError(message: string, cause?: unknown): ProtocolError {
  return new ProtocolError(message, { code: INTERNAL_ERROR_CODE, ...(cause !== undefined ? { cause } : {}) })
}
