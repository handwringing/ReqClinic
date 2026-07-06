// DraftStore：基于 localStorage 的本地草稿存储。
// 保存自定义草稿、分割条比例、协议同意状态、最后访问的会话 ID、原始输入。
// 在 SSR（无 window.localStorage）环境下安全降级为空操作。

const LAST_SESSION_ID_KEY = 'last_session_id';
const ORIGINAL_INPUT_KEY = 'original_input';

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export class DraftStore {
  private prefix = 'reqclinic:draft:';

  // ===== 通用草稿读写 =====

  getDraft(key: string): string | null {
    if (!isBrowser()) return null;
    try {
      return window.localStorage.getItem(this.prefix + key);
    } catch {
      return null;
    }
  }

  setDraft(key: string, value: string): void {
    if (!isBrowser()) return;
    try {
      window.localStorage.setItem(this.prefix + key, value);
    } catch {
      // 配额超限或被禁用时静默忽略
    }
  }

  removeDraft(key: string): void {
    if (!isBrowser()) return;
    try {
      window.localStorage.removeItem(this.prefix + key);
    } catch {
      // 忽略
    }
  }

  // ===== 分割条比例 =====

  getSplitRatio(key: string): number | null {
    const raw = this.getDraft(`split:${key}`);
    if (raw === null) return null;
    const ratio = Number(raw);
    if (Number.isNaN(ratio)) return null;
    return ratio;
  }

  setSplitRatio(key: string, ratio: number): void {
    if (!Number.isFinite(ratio)) return;
    this.setDraft(`split:${key}`, String(ratio));
  }

  // ===== 最后访问的会话 ID =====

  getLastSessionId(): string | null {
    return this.getDraft(LAST_SESSION_ID_KEY);
  }

  setLastSessionId(id: string): void {
    this.setDraft(LAST_SESSION_ID_KEY, id);
  }

  // ===== 原始输入草稿 =====

  getOriginalInput(): string | null {
    return this.getDraft(ORIGINAL_INPUT_KEY);
  }

  setOriginalInput(input: string): void {
    this.setDraft(ORIGINAL_INPUT_KEY, input);
  }
}
