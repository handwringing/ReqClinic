import { describe, it, expect } from 'vitest';
import { RouteRegistry } from '../src/http/route-registry';
import { loadOpenApi } from '../src/http/openapi-loader';

describe('RouteRegistry', () => {
  it('throws when registering an operationId not in the OpenAPI spec', () => {
    const registry = new RouteRegistry(loadOpenApi());
    expect(() => registry.register('doesNotExist', async () => null)).toThrow(
      /not declared in the OpenAPI spec/,
    );
  });

  it('registers a valid operationId and exposes it via getRegisteredIds', () => {
    const registry = new RouteRegistry(loadOpenApi());
    registry.register('createQuickSession', async () => ({ ok: true }));
    expect(registry.getRegisteredIds()).toContain('createQuickSession');
  });

  it('assertAllRegistered throws and lists the missing ids when incomplete', () => {
    const registry = new RouteRegistry(loadOpenApi());
    registry.register('createQuickSession', async () => null);
    registry.register('getJobStatus', async () => null);

    expect(() => registry.assertAllRegistered()).toThrow(
      /OpenAPI operations not registered/,
    );

    // The error message lists how many are missing out of the full set.
    try {
      registry.assertAllRegistered();
      throw new Error('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/106 of 108 missing/);
      // Registered ids must not appear in the missing list.
      expect(msg).not.toMatch(/\bcreateQuickSession\b/);
      expect(msg).not.toMatch(/\bgetJobStatus\b/);
    }
  });

  it('assertAllRegistered passes when every operation is registered', () => {
    const registry = new RouteRegistry(loadOpenApi());
    for (const id of loadOpenApi().keys()) {
      registry.register(id, async () => null);
    }
    expect(() => registry.assertAllRegistered()).not.toThrow();
  });

  it('getRegisteredIds is empty before anything is registered', () => {
    const registry = new RouteRegistry(loadOpenApi());
    expect(registry.getRegisteredIds()).toEqual([]);
  });
});
