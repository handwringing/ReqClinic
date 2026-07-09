export const REQUIREMENT_INPUT_HINT =
  '这句话还不够像一个需求，请补充你想做什么、给谁用、希望得到什么结果。';

interface ModelHealth {
  ai?: {
    model_api_ready?: boolean;
    api_key_configured?: boolean | null;
  };
}

export function looksLikeRequirementInput(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (/^[\d\s.,，。:：;；!?！？_-]+$/.test(text)) return false;
  const compact = text.replace(/\s+/g, '');
  if (/^[a-zA-Z0-9_-]+$/.test(compact) && !/[一-龥]/.test(compact)) return false;
  if (/[一-龥]/.test(text) && /想|需要|希望|做|写|生成|设计|开发|策划|整理|分析|优化|搭建|制作|创建|准备|确认|改/.test(text)) {
    return true;
  }
  return /[一-龥]/.test(text) && text.length >= 8;
}

function backendRootUrl(): string | null {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!baseUrl) return null;
  return baseUrl.replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '');
}

export async function hasModelApiAccess(): Promise<boolean> {
  const rootUrl = backendRootUrl();
  if (!rootUrl) return false;
  try {
    const res = await fetch(`${rootUrl}/health`, {
      cache: 'no-store',
      credentials: 'include',
    });
    if (!res.ok) return false;
    const health = (await res.json()) as ModelHealth;
    return health.ai?.model_api_ready === true || health.ai?.api_key_configured === true;
  } catch {
    return false;
  }
}
