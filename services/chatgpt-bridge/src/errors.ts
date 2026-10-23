export class BridgeError extends Error {
  constructor(public code: string, message: string, public status = 400, public ambiguous = false, public remoteId?: string) {
    super(message);
  }
}

export function errorInfo(error: unknown) {
  return error instanceof BridgeError
    ? { code: error.code, message: error.message, may_have_been_sent: error.ambiguous, ...(error.remoteId && { remote_id: error.remoteId }) }
    : { code: 'internal_error', message: 'Erreur interne du service.', may_have_been_sent: false };
}
