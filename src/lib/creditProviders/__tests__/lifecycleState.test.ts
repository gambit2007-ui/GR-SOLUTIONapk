import { describe, expect, it } from 'vitest';
import { resolveCredigrupoLifecycleTransition } from '../lifecycleState';

describe('maquina de estados Credigrupo pos-assinatura', () => {
  it('avanca da espera de assinaturas para assinado sem inventar funding', () => {
    expect(resolveCredigrupoLifecycleTransition('AWAITING_SIGNATURES', 'loan.signed')).toEqual({
      outcome: 'ADVANCE',
      targetStatus: 'SIGNED',
      formalizationStatus: 'completed',
    });
  });

  it('trata o mesmo estagio como duplicado', () => {
    expect(resolveCredigrupoLifecycleTransition('SIGNED', 'loan.signed').outcome).toBe('DUPLICATE');
    expect(resolveCredigrupoLifecycleTransition('FUNDED', 'loan.funded').outcome).toBe('DUPLICATE');
  });

  it('impede evento antigo de regredir estado mais avancado', () => {
    expect(resolveCredigrupoLifecycleTransition('SIGNED', 'ccb_ready_for_signature').outcome).toBe('STALE');
    expect(resolveCredigrupoLifecycleTransition('FUNDED', 'loan.signed').outcome).toBe('STALE');
    expect(resolveCredigrupoLifecycleTransition('FUNDED', 'ccb_ready_for_signature').outcome).toBe('STALE');
  });

  it('aceita cancelamento antes do funding e ignora cancelamento tardio depois dele', () => {
    expect(resolveCredigrupoLifecycleTransition('SIGNED', 'loan.cancelled').outcome).toBe('ADVANCE');
    expect(resolveCredigrupoLifecycleTransition('FUNDED', 'loan.cancelled').outcome).toBe('STALE');
  });
});
