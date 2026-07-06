export interface ApiTransport {
  request<TReq = unknown, TRes = unknown>(
    operationId: string,
    request?: TReq,
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<TRes>;
}
