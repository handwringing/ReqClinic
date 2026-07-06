import type { MockTransport } from './transport';

export type MockHandler<TReq = unknown, TRes = unknown> = (
  request: TReq,
  options: { idempotencyKey?: string; signal?: AbortSignal },
  transport: MockTransport
) => Promise<TRes>;

export class MockRouteRegistry {
  private handlers: Map<string, MockHandler> = new Map();
  private allowedStatuses: Map<string, number[]> = new Map();

  register<TReq, TRes>(
    operationId: string,
    handler: MockHandler<TReq, TRes>,
    allowedStatuses: number[] = [200]
  ): void {
    this.handlers.set(operationId, handler as MockHandler);
    this.allowedStatuses.set(operationId, allowedStatuses);
  }

  get(operationId: string): MockHandler | undefined {
    return this.handlers.get(operationId);
  }

  has(operationId: string): boolean {
    return this.handlers.has(operationId);
  }

  list(): string[] {
    return Array.from(this.handlers.keys());
  }
}
