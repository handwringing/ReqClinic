import type { GuestSession, AgreementConsent, QuickSession } from '@/lib/api/types';

export class MockSessionStore {
  private prefix = 'reqclinic:mock:';

  get<T>(key: string): T | null {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(this.prefix + key);
    return raw ? JSON.parse(raw) : null;
  }

  set<T>(key: string, value: T): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(this.prefix + key, JSON.stringify(value));
  }

  remove(key: string): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(this.prefix + key);
  }

  // 快捷方法
  getGuestSession() { return this.get<GuestSession>('guest_session'); }
  setGuestSession(s: GuestSession) { this.set('guest_session', s); }

  getConsents() { return this.get<AgreementConsent[]>('consents') || []; }
  setConsents(c: AgreementConsent[]) { this.set('consents', c); }

  getQuickSession(id: string) { return this.get<QuickSession>(`quick_session:${id}`); }
  setQuickSession(s: QuickSession) { this.set(`quick_session:${s.id}`, s); }
  listQuickSessions(): QuickSession[] {
    if (typeof window === 'undefined') return [];
    return Object.keys(localStorage)
      .filter(k => k.startsWith(this.prefix + 'quick_session:'))
      .map(k => this.get<QuickSession>(k.replace(this.prefix, ''))!)
      .filter(Boolean);
  }
}
