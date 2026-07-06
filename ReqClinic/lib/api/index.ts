import { ApiClient } from './client';
import type { ApiTransport } from './transport';

let clientInstance: ApiClient | null = null;

export function getApiClient(): ApiClient {
  if (!clientInstance) {
    const transportMode = process.env.NEXT_PUBLIC_API_TRANSPORT;
    const useHttp =
      transportMode === 'http' ||
      (transportMode === 'auto' && !!process.env.NEXT_PUBLIC_API_BASE_URL);
    const transport = useHttp
      ? (require('./http-transport').createHttpTransport() as ApiTransport)
      : (require('@/mocks').createMockTransport() as ApiTransport);
    clientInstance = new ApiClient(transport);
  }
  return clientInstance;
}

export { ApiClient };
export * from './types';
export * from './errors';
