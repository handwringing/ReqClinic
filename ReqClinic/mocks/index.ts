import { MockTransport } from './transport';
import { MockRouteRegistry } from './registry';
import { MockSessionStore } from './session-store';
import { registerAllHandlers } from './handlers';

export function createMockTransport(): MockTransport {
  const registry = new MockRouteRegistry();
  const store = new MockSessionStore();
  registerAllHandlers(registry, store);
  return new MockTransport(registry);
}

export { MockTransport, MockRouteRegistry, MockSessionStore };
