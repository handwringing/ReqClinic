export class ApiClientError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public requestId: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export const ErrorCodes = {
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  AGREEMENT_REQUIRED: 'AGREEMENT_REQUIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  LEGAL_HOLD: 'LEGAL_HOLD',
  BLOCKING_CONFLICT: 'BLOCKING_CONFLICT',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;
