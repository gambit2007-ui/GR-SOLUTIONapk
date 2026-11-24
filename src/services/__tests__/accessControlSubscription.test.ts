import { beforeEach, describe, expect, it, vi } from 'vitest';
const listeners = vi.hoisted(() => [] as { path: string; next: (value: unknown) => void; fail: (value: unknown) => void; stop: ReturnType<typeof vi.fn> }[]);
vi.mock('../../firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  onSnapshot: (path: string, _options: unknown, next: (value: unknown) => void, fail: (value: unknown) => void) => {
    const stop = vi.fn(); listeners.push({ path, next, fail, stop }); return stop;
  },
}));
import { accessControlSubscription } from '../accessControlSubscription';
const snap = (data: unknown, cached = false) => ({ exists: () => data !== null, data: () => data, metadata: { fromCache: cached } });
beforeEach(() => { listeners.length = 0; });
describe('assinatura de acesso sem alterar politica', () => {
  it('nao libera modo aberto com documento ainda vindo do cache', () => {
    const next = vi.fn(); accessControlSubscription('user')(next, vi.fn());
    listeners[0].next(snap(null, true));
    expect(next.mock.lastCall?.[0].authorized).toBe(false);
    listeners[0].next(snap(null));
    expect(next.mock.lastCall?.[0]).toMatchObject({ loading: false, authorized: true, enforced: false });
  });
  it('aguarda perfil confirmado e ignora perfil de configuracao anterior', () => {
    const next = vi.fn(); const stop = accessControlSubscription('user')(next, vi.fn());
    listeners[0].next(snap({ enforced: true }));
    listeners[1].next(snap({ role: 'ADMIN' }, true));
    expect(next.mock.lastCall?.[0].authorized).toBe(false);
    listeners[1].next(snap({ role: 'ADMIN' }));
    expect(next.mock.lastCall?.[0].role).toBe('ADMIN');
    listeners[0].next(snap({ enforced: true }));
    next.mockClear();
    listeners[1].next(snap({ role: 'ADMIN' }));
    expect(next).not.toHaveBeenCalled();
    listeners[2].next(snap(null));
    expect(next.mock.lastCall?.[0].authorized).toBe(false);
    stop(); next.mockClear();
    listeners[2].next(snap({ role: 'ADMIN' }));
    listeners[0].next(snap(null));
    expect(next).not.toHaveBeenCalled();
  });
  it('falha nas configuracoes invalida respostas pendentes do perfil', () => {
    const next = vi.fn(); const fail = vi.fn(); accessControlSubscription('user')(next, fail);
    listeners[0].next(snap({ enforced: true }));
    listeners[0].fail(new Error('permission-denied'));
    next.mockClear(); listeners[1].next(snap({ role: 'ADMIN' }));
    expect(fail).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });
});
