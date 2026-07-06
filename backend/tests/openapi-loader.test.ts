import { describe, it, expect } from 'vitest';
import {
  loadOpenApi,
  getOperationSpec,
  listOperationIds,
  toRoutePath,
} from '../src/http/openapi-loader';

describe('openapi-loader', () => {
  it('loadOpenApi returns a Map of 108 operations', () => {
    const ops = loadOpenApi();
    expect(ops).toBeInstanceOf(Map);
    expect(ops.size).toBe(108);
  });

  it('createQuickSession maps to POST /api/v1/quick-sessions', () => {
    const spec = getOperationSpec('createQuickSession');
    expect(spec.method).toBe('post');
    expect(spec.path).toBe('/api/v1/quick-sessions');
    expect(spec.tag).toBe('快速问诊');
    // Body is required for a write operation.
    expect(spec.requestBody?.required).toBe(true);
  });

  it('getJobStatus maps to GET /api/v1/ai-jobs/{id}', () => {
    const spec = getOperationSpec('getJobStatus');
    expect(spec.method).toBe('get');
    expect(spec.path).toBe('/api/v1/ai-jobs/{id}');
    // The path parameter must be resolved from the $ref'd parameter.
    const pathParam = spec.parameters.find((p) => p.in === 'path');
    expect(pathParam).toBeDefined();
    expect(pathParam?.name).toBe('id');
    expect(pathParam?.required).toBe(true);
  });

  it('listOperationIds returns all 108 ids including the samples', () => {
    const ids = listOperationIds();
    expect(ids).toHaveLength(108);
    expect(ids).toContain('createQuickSession');
    expect(ids).toContain('getJobStatus');
  });

  it('toRoutePath converts {param} to :param and adds the API prefix', () => {
    expect(toRoutePath('/quick-sessions/{id}')).toBe(
      '/api/v1/quick-sessions/:id',
    );
  });

  it('toRoutePath is idempotent for already-prefixed paths', () => {
    expect(toRoutePath('/api/v1/ai-jobs/{id}')).toBe('/api/v1/ai-jobs/:id');
    expect(toRoutePath('/api/v1/quick-sessions')).toBe(
      '/api/v1/quick-sessions',
    );
  });

  it('getOperationSpec throws for an unknown operationId', () => {
    expect(() => getOperationSpec('doesNotExist')).toThrow(/Unknown operationId/);
  });
});
