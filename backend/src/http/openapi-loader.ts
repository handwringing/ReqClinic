import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

/**
 * OpenAPI loader.
 *
 * Reads `docs/03-api-openapi.yaml` once, resolves `$ref` parameters/responses,
 * and indexes every operation by its `operationId`. The resulting map is the
 * single source of truth that the route registry consults to validate route
 * registrations and to derive Fastify route URLs.
 */

export interface OperationParameter {
  name: string;
  in: string;
  required: boolean;
  schema: any;
}

export interface OperationRequestBody {
  required: boolean;
  content: { 'application/json': { schema: any } };
}

export interface OperationResponse {
  description: string;
  content?: { 'application/json': { schema: any } };
}

export interface OperationSpec {
  operationId: string;
  /** Full path including the API prefix, e.g. "/api/v1/quick-sessions". */
  path: string;
  /** Lowercase HTTP method, e.g. "get" | "post" | "patch" | "delete". */
  method: string;
  tag?: string;
  parameters: OperationParameter[];
  requestBody?: OperationRequestBody;
  responses: Record<string, OperationResponse>;
}

interface OpenApiDoc {
  servers?: Array<{ url: string }>;
  paths?: Record<string, Record<string, any>>;
  components?: {
    parameters?: Record<string, any>;
    responses?: Record<string, any>;
    requestBodies?: Record<string, any>;
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
// backend/src/http → backend/src → backend → repo root → docs
const DOCS_PATH = resolve(__dirname, '../../../docs/03-api-openapi.yaml');

const HTTP_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
] as const;

let cached: Map<string, OperationSpec> | null = null;
let cachedPrefix = '';

/** Resolve a JSON pointer `$ref` (e.g. `#/components/parameters/IdempotencyKey`). */
function resolveRef(doc: OpenApiDoc, ref: string): any {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
  const parts = ref.slice(2).split('/');
  let node: any = doc;
  for (const part of parts) {
    node = node?.[part];
    if (node === undefined) return undefined;
  }
  return node;
}

/** Extract the path prefix (e.g. "/api/v1") from the first server URL. */
function extractPathPrefix(doc: OpenApiDoc): string {
  const url = doc.servers?.[0]?.url;
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    if (!pathname || pathname === '/') return '';
    return pathname.replace(/\/$/, '');
  } catch {
    return '';
  }
}

/**
 * Merge path-item-level and operation-level parameters. Operation-level wins
 * on `(name, in)` collisions. Path parameters default to `required: true`.
 */
function collectParameters(
  doc: OpenApiDoc,
  pathItem: any,
  op: any,
): OperationParameter[] {
  const pathParams = Array.isArray(pathItem?.parameters) ? pathItem.parameters : [];
  const opParams = Array.isArray(op?.parameters) ? op.parameters : [];
  const merged = new Map<string, OperationParameter>();
  for (const p of [...pathParams, ...opParams]) {
    const resolved = p?.$ref ? resolveRef(doc, p.$ref) ?? p : p;
    const name = resolved?.name ?? '';
    const location = resolved?.in ?? '';
    merged.set(`${location}:${name}`, {
      name,
      in: location,
      required: resolved?.required ?? location === 'path',
      schema: resolved?.schema ?? {},
    });
  }
  return Array.from(merged.values());
}

function buildRequestBody(doc: OpenApiDoc, rb: any): OperationRequestBody | undefined {
  if (!rb) return undefined;
  const resolved = rb?.$ref ? resolveRef(doc, rb.$ref) ?? rb : rb;
  const json = resolved?.content?.['application/json'];
  if (!json) return undefined;
  return {
    required: resolved.required ?? false,
    content: { 'application/json': { schema: json.schema ?? {} } },
  };
}

function buildResponses(
  doc: OpenApiDoc,
  responses: Record<string, any>,
): Record<string, OperationResponse> {
  const out: Record<string, OperationResponse> = {};
  for (const [code, resp] of Object.entries(responses ?? {})) {
    const resolved = (resp as any)?.$ref ? resolveRef(doc, (resp as any).$ref) ?? resp : resp;
    const json = resolved?.content?.['application/json'];
    const entry: OperationResponse = { description: resolved?.description ?? '' };
    if (json) {
      entry.content = { 'application/json': { schema: json.schema ?? {} } };
    }
    out[code] = entry;
  }
  return out;
}

function buildOperations(doc: OpenApiDoc, prefix: string): Map<string, OperationSpec> {
  const map = new Map<string, OperationSpec>();
  const paths = doc.paths ?? {};
  for (const [rawPath, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!op || typeof op !== 'object') continue;
      const operationId = op.operationId;
      if (!operationId || typeof operationId !== 'string') continue;
      if (map.has(operationId)) continue; // first declaration wins
      const tag =
        Array.isArray(op.tags) && op.tags.length > 0 ? String(op.tags[0]) : undefined;
      const spec: OperationSpec = {
        operationId,
        path: prefix + rawPath,
        method,
        parameters: collectParameters(doc, pathItem, op),
        responses: buildResponses(doc, op.responses ?? {}),
      };
      if (tag !== undefined) spec.tag = tag;
      const rb = buildRequestBody(doc, op.requestBody);
      if (rb) spec.requestBody = rb;
      map.set(operationId, spec);
    }
  }
  return map;
}

function ensureLoaded(): void {
  if (cached) return;
  const text = readFileSync(DOCS_PATH, 'utf8');
  const doc = parseYaml(text) as OpenApiDoc;
  cachedPrefix = extractPathPrefix(doc);
  cached = buildOperations(doc, cachedPrefix);
}

/** Load (and cache) the OpenAPI spec as an operationId → OperationSpec map. */
export function loadOpenApi(): Map<string, OperationSpec> {
  ensureLoaded();
  return cached!;
}

/** Look up a single operation; throws if the id is not declared in the spec. */
export function getOperationSpec(operationId: string): OperationSpec {
  const ops = loadOpenApi();
  const spec = ops.get(operationId);
  if (!spec) {
    throw new Error(`Unknown operationId: ${operationId}`);
  }
  return spec;
}

/** All declared operationIds. */
export function listOperationIds(): string[] {
  return Array.from(loadOpenApi().keys());
}

/**
 * Convert an OpenAPI path (e.g. `/quick-sessions/{id}`) into a Fastify route
 * path (e.g. `/api/v1/quick-sessions/:id`). Idempotent: paths already carrying
 * the API prefix are left prefixed; `{param}` is always rewritten to `:param`.
 */
export function toRoutePath(openApiPath: string): string {
  ensureLoaded();
  const colon = openApiPath.replace(/\{([^}]+)\}/g, ':$1');
  if (cachedPrefix && colon.startsWith(cachedPrefix)) return colon;
  return cachedPrefix + colon;
}
