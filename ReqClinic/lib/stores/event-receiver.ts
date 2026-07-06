// EventReceiver：本地事件接收器。
// 仅保存 P0 事件的元信息（event_name、event_timestamp、session_id），
// 不含业务正文（原始输入/回答/Prompt 等敏感字段会被 sanitize 移除）。
// 测试人员可通过 export/exportJSON 导出 JSON 用于排查。

// P0 事件清单
export const P0_EVENTS = [
  'quick_session_started',
  'quick_message_sent',
  'quick_brief_generated',
  'quick_brief_exported',
  'quick_session_upgraded',
  'formal_project_created',
  'formal_gate_reviewed',
  'formal_report_compiled',
  'formal_report_released',
  'training_attempt_started',
  'training_feedback_viewed',
  'agreement_accepted',
  'session_deleted',
] as const;

export type P0EventName = (typeof P0_EVENTS)[number];

export interface StoredEvent {
  event_name: string;
  event_timestamp: string;
  session_id?: string;
  properties: Record<string, unknown>;
}

// 敏感字段名（小写匹配）：输入/回答/Prompt/正文等业务内容一律剔除。
const SENSITIVE_KEYS = new Set([
  'input',
  'original_input',
  'answer',
  'prompt',
  'content',
  'text',
  'message',
  'summary',
  'question',
  'response',
  'reply',
  'description',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class EventReceiver {
  private events: StoredEvent[] = [];
  private maxEvents = 500;

  track(eventName: string, properties: Record<string, unknown> = {}): void {
    const sanitized = this.sanitize(properties);
    const sessionId = this.extractSessionId(properties);
    const stored: StoredEvent = {
      event_name: eventName,
      event_timestamp: new Date().toISOString(),
      ...(sessionId !== undefined ? { session_id: sessionId } : {}),
      properties: sanitized,
    };
    this.events.push(stored);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
  }

  export(): StoredEvent[] {
    return this.events.slice();
  }

  exportJSON(): string {
    return JSON.stringify(this.events, null, 2);
  }

  clear(): void {
    this.events = [];
  }

  // 移除敏感字段（input/answer/prompt/content/text/message 等），
  // 同时从 session_id 之外的字段中递归剔除。
  private sanitize(props: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEYS.has(lowerKey)) {
        continue;
      }
      if (lowerKey === 'session_id') {
        // session_id 已提升至顶层，properties 不再保留
        continue;
      }
      if (isPlainObject(value)) {
        result[key] = this.sanitize(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private extractSessionId(props: Record<string, unknown>): string | undefined {
    const raw = props['session_id'];
    if (typeof raw === 'string' && raw.length > 0) {
      return raw;
    }
    return undefined;
  }
}
