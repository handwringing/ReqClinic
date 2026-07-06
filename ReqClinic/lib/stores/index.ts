import { DraftStore } from './draft-store';
import { EventReceiver } from './event-receiver';

export { DraftStore, EventReceiver };
export type { StoredEvent, P0EventName } from './event-receiver';
export { P0_EVENTS } from './event-receiver';

let draftStoreInstance: DraftStore | null = null;
let eventReceiverInstance: EventReceiver | null = null;

// DraftStore 单例：浏览器端访问 localStorage，SSR 端返回无副作用的实例。
export function getDraftStore(): DraftStore {
  if (!draftStoreInstance) {
    draftStoreInstance = new DraftStore();
  }
  return draftStoreInstance;
}

// EventReceiver 单例：内存事件缓冲，全局共享。
export function getEventReceiver(): EventReceiver {
  if (!eventReceiverInstance) {
    eventReceiverInstance = new EventReceiver();
  }
  return eventReceiverInstance;
}
