/**
 * Error whose message is written for end users and may be returned to clients.
 *
 * New domain code should throw this class for validation, state, or permission
 * failures. Existing services still throw plain `Error` instances with
 * user-facing messages; `isClientSafeError` accepts those too for compatibility.
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

/**
 * Decide whether an error's message is a domain message that clients may see.
 *
 * Compatibility rule: the codebase throws about 150 plain `new Error('...')`
 * domain messages, so a plain `Error` is treated as client-safe unless it
 * carries the markers of an infrastructure failure:
 * - `sqlState` / `errno` / `sqlMessage`: mysql2 reports SQL failures as plain
 *   `Error` objects with these properties; their messages reveal SQL, tables,
 *   and columns.
 * - `code` / `syscall`: Node.js system errors (filesystem, network) are plain
 *   `Error` objects too, and their messages can contain internal paths or hosts.
 * Any other class (`TypeError`, `RangeError`, library errors, ...) is internal
 * by default, because its message describes code, not the user's request.
 */
export const isClientSafeError = (error: unknown): error is Error => {
  if (error instanceof DomainError) return true;
  if (!(error instanceof Error) || error.constructor !== Error) return false;
  const markers = error as Error & Record<string, unknown>;
  return (
    !!error.message &&
    markers.sqlState === undefined &&
    markers.sqlMessage === undefined &&
    markers.errno === undefined &&
    markers.code === undefined &&
    markers.syscall === undefined
  );
};

/**
 * Message to return for a 4xx response built from a caught error.
 *
 * Domain messages pass through unchanged; anything else is logged on the
 * server with its context and replaced by `fallback`, so a database or
 * programming error reaching a domain `catch` block no longer leaks details.
 *
 * @param error Caught value.
 * @param fallback Generic message used when the error is internal.
 * @param context Log prefix identifying the failing operation.
 */
export const clientErrorMessage = (error: unknown, fallback: string, context?: string): string => {
  if (isClientSafeError(error)) return error.message;
  console.error(`${context ?? fallback}:`, error);
  return fallback;
};
