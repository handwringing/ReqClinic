const RAW_BASE_PATH = process.env.NEXT_PUBLIC_SITE_BASE_PATH ?? '';

export const SITE_BASE_PATH = normalizeBasePath(RAW_BASE_PATH);

export function withSiteBasePath(path: string): string {
  if (!path || !SITE_BASE_PATH) return path;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('#')) return path;
  if (!path.startsWith('/')) return path;
  if (path === SITE_BASE_PATH || path.startsWith(`${SITE_BASE_PATH}/`)) return path;
  return `${SITE_BASE_PATH}${path}`;
}

function normalizeBasePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '';
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}`;
}
