import { describe, expect, it, vi } from 'vitest';
import { createRealtimeResource, type ResourceSubscription } from '../realtimeResource';
import { getViewDataStatus, type DataStatuses } from '../viewDataStatus';

const fixture = () => {
  let next!: Parameters<ResourceSubscription<number>>[0];
  let fail!: Parameters<ResourceSubscription<number>>[1];
  const stop = vi.fn();
  const start = vi.fn<ResourceSubscription<number>>((onData, onError) => { next = onData; fail = onError; return stop; });
  const error = vi.fn();
  const resource = createRealtimeResource(0, true, start, error);
  const unsubscribe = resource.subscribe(vi.fn());
  return { resource, next, fail, start, stop, error, unsubscribe };
};

describe('estado das leituras financeiras', () => {
  it('nao confunde erro com saldo zero nem dados locais com confirmacao', () => {
    const f = fixture();
    expect(f.resource.getSnapshot().status).toBe('loading');
    f.next(500, false);
    expect(f.resource.getSnapshot()).toEqual({ data: 500, status: 'loading' });
    f.next(500);
    f.fail(new Error('permission-denied'));
    expect(f.resource.getSnapshot()).toEqual({ data: 500, status: 'error' });
    f.next(0);
    expect(f.resource.getSnapshot()).toEqual({ data: 0, status: 'ready' });
  });
  it('ignora respostas atrasadas depois de sair da sessao', () => {
    const f = fixture();
    f.next(500);
    f.unsubscribe();
    f.next(999);
    f.fail(new Error('late'));
    expect(f.resource.getSnapshot()).toEqual({ data: 0, status: 'loading' });
    expect(f.error).not.toHaveBeenCalled();
    expect(f.stop).toHaveBeenCalledOnce();
  });
  it('compartilha uma assinatura e limpa na ultima saida, inclusive StrictMode', () => {
    const f = fixture();
    const other = f.resource.subscribe(vi.fn());
    f.unsubscribe();
    expect(f.stop).not.toHaveBeenCalled();
    other();
    expect(f.stop).toHaveBeenCalledOnce();
    const again = f.resource.subscribe(vi.fn());
    expect(f.start).toHaveBeenCalledTimes(2);
    again();
  });
  it('nao conecta recursos desativados', () => {
    const start = vi.fn();
    const resource = createRealtimeResource([], false, start);
    resource.subscribe(vi.fn())();
    expect(start).not.toHaveBeenCalled();
    expect(resource.getSnapshot().status).toBe('idle');
  });
  it('falha na inicializacao deixa o recurso indisponivel', () => {
    const resource = createRealtimeResource(0, true, () => { throw new Error('offline'); });
    resource.subscribe(vi.fn());
    expect(resource.getSnapshot().status).toBe('error');
  });
});

describe('bloqueio de telas com dados incompletos', () => {
  const ready: DataStatuses = { customers: 'ready', loans: 'ready', cash: 'ready', fees: 'ready', movements: 'ready', snapshots: 'ready' };
  it.each(['loans', 'cash', 'fees', 'movements', 'snapshots'] as const)('bloqueia relatorios quando %s falha', (source) => {
    expect(getViewDataStatus('REPORTS', { ...ready, [source]: 'error' })).toBe('error');
    expect(getViewDataStatus('REPORTS', { ...ready, [source]: 'loading' })).toBe('loading');
  });
  it('nao bloqueia telas por colecoes que elas nao usam', () => {
    expect(getViewDataStatus('LOANS', { ...ready, movements: 'idle', snapshots: 'idle', loans: 'idle' })).toBe('ready');
    expect(getViewDataStatus('SIMULATION', { ...ready, cash: 'error' })).toBe('ready');
  });
});
