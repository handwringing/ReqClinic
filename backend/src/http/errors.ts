/**
 * Unified API error envelope.
 *
 * Every error response is shaped as:
 *   { error: { code, message, details?, retryable, request_id? } }
 *
 * `code` is an UPPER_SNAKE_CASE machine-readable token that clients branch on;
 * `message` is a human-readable description; `details` carries structured
 * field-level diagnostics; `retryable` hints whether a client should retry;
 * `request_id` correlates to server logs.
 */

export interface ApiErrorDetails {
  [key: string]: unknown;
}

export interface ApiErrorOptions {
  details?: ApiErrorDetails;
  retryable?: boolean;
  requestId?: string;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetails;
    retryable: boolean;
    request_id?: string;
  };
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: ApiErrorDetails;
  readonly retryable: boolean;
  readonly requestId?: string;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    opts: ApiErrorOptions = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = opts.details;
    this.retryable = opts.retryable ?? false;
    this.requestId = opts.requestId;
    // Restore prototype chain when thrown across boundaries.
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  /** Serialize to the wire envelope. */
  toResponse(): ApiErrorEnvelope {
    const body: ApiErrorEnvelope['error'] = {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
    if (this.details !== undefined) body.details = this.details;
    if (this.requestId !== undefined) body.request_id = this.requestId;
    return { error: body };
  }

  // ---- Static factories -------------------------------------------------

  /** 401 — caller is not authenticated. */
  static unauthenticated(message = 'Authentication required'): ApiError {
    return new ApiError(401, 'UNAUTHENTICATED', message);
  }

  /** 403 — caller is authenticated but lacks permission. */
  static forbidden(message = 'Forbidden'): ApiError {
    return new ApiError(403, 'FORBIDDEN', message);
  }

  /** 404 — referenced resource does not exist. */
  static notFound(message = 'Resource not found', resource?: string): ApiError {
    return new ApiError(404, 'NOT_FOUND', message, {
      details: resource ? { resource } : undefined,
    });
  }

  /** 400 — request body/query failed field or schema validation (§ValidationError). */
  static validationError(details: ApiErrorDetails, message = 'Validation failed'): ApiError {
    return new ApiError(400, 'VALIDATION_ERROR', message, { details });
  }

  /** 409 — generic conflict with caller-supplied code/message. */
  static conflict(code: string, message: string, opts?: ApiErrorOptions): ApiError {
    return new ApiError(409, code, message, opts);
  }

  /** 403 — active agreement consent missing or withdrawn. */
  static agreementRequired(message = 'Agreement consent is required'): ApiError {
    return new ApiError(403, 'AGREEMENT_REQUIRED', message);
  }

  /** 429 — caller has exceeded the rate limit. */
  static rateLimited(retryAfter: number, message = 'Rate limit exceeded'): ApiError {
    return new ApiError(429, 'RATE_LIMITED', message, {
      retryable: true,
      details: { retry_after_seconds: retryAfter },
    });
  }

  /** 409 — optimistic concurrency check on `expected_version` failed. */
  static versionConflict(message = 'Resource version conflict'): ApiError {
    return new ApiError(409, 'VERSION_CONFLICT', message, { retryable: true });
  }

  /** 409 — idempotency key reused with a different request payload. */
  static idempotencyConflict(message = 'Idempotency key conflict'): ApiError {
    return new ApiError(409, 'IDEMPOTENCY_CONFLICT', message);
  }

  /** 409 — a domain gate (e.g. baseline approval) has not been satisfied. */
  static gateNotPassed(message = 'Gate has not been passed'): ApiError {
    return new ApiError(409, 'GATE_NOT_PASSED', message);
  }

  /** 409 — operation requires an approved baseline. */
  static baselineNotApproved(message = 'Baseline has not been approved'): ApiError {
    return new ApiError(409, 'BASELINE_NOT_APPROVED', message);
  }

  /** 409 — quick-session upgrade transaction failed atomically. */
  static upgradeFailed(message = 'Quick session upgrade failed'): ApiError {
    return new ApiError(409, 'UPGRADE_FAILED', message);
  }

  /** 503 — AI model is temporarily unavailable. */
  static modelBusy(message = 'AI model is busy'): ApiError {
    return new ApiError(503, 'MODEL_BUSY', message, { retryable: true });
  }

  /** 503 — AI job queue is full. */
  static queueFull(message = 'AI job queue is full'): ApiError {
    return new ApiError(503, 'QUEUE_FULL', message, { retryable: true });
  }
}
