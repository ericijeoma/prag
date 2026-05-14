export type ErrorCode =
  | 'bad_request'
  | 'missing_env'
  | 'supabase_error'
  | 'initialization_error'
  | 'internal_error'

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details?: unknown

  constructor(message: string, options: { code: ErrorCode; status: number; details?: unknown }) {
    super(message)
    this.name = 'AppError'
    this.code = options.code
    this.status = options.status
    this.details = options.details
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError
}
