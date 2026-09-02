import { describe, expect, it, vi } from 'vitest';
import {
  normalizeCredigrupoCreateSuccess,
  prepareManualCredigrupoCreateReconciliation,
} from '../createSuccess';

const receivedAt = '2026-09-02T12:00:00.000Z';

const response = (overrides: Record<string, unknown> = {}) => ({
  httpStatus: 201,
  requestId: 'request-1',
  proposalId: 'proposal-1',
  status: 'awaiting_lender_payment',
  pix: {
    brcode: '000201-secret-pix-payload',
    qrCodeImage: 'data:image/png;base64,secret',
    amountCents: 1200,
    expiresAt: '2026-09-03T12:00:00.000Z',
    correlationId: 'correlation-1',
  },
  ...overrides,
});

describe('normalizacao do sucesso de criacao Credigrupo', () => {
  it('normaliza resposta 2xx com status conhecido sem perder identificadores', () => {
    expect(normalizeCredigrupoCreateSuccess(response({
      status: 'accepted',
      formalization_status: 'awaiting_lender_payment',
    }), receivedAt)).toMatchObject({
      proposalId: 'proposal-1',
      requestId: 'request-1',
      externalStatus: 'accepted',
      formalizationStatus: 'awaiting_lender_payment',
      internalStatus: 'AWAITING_LENDER_PAYMENT',
      status: 'AWAITING_LENDER_PAYMENT',
      unknownProviderStatus: false,
    });
  });

  it('reconhece awaiting_lender_payment como estado oficial de criacao', () => {
    const normalized = normalizeCredigrupoCreateSuccess(response(), receivedAt);
    expect(normalized.externalStatus).toBe('awaiting_lender_payment');
    expect(normalized.formalizationStatus).toBe('awaiting_lender_payment');
    expect(normalized.internalStatus).toBe('AWAITING_LENDER_PAYMENT');
    expect(normalized.unknownProviderStatus).toBe(false);
  });

  it('preserva status futuro desconhecido e mantem estado interno nao terminal', () => {
    const normalized = normalizeCredigrupoCreateSuccess(response({
      status: 'future_provider_status',
      formalization_status: 'future_formalization_status',
    }), receivedAt);
    expect(normalized.proposalId).toBe('proposal-1');
    expect(normalized.externalStatus).toBe('future_provider_status');
    expect(normalized.formalizationStatus).toBe('future_formalization_status');
    expect(normalized.unknownProviderStatus).toBe(true);
    expect(normalized.internalStatus).toBe('RECONCILIATION_REQUIRED');
    expect(normalized.internalStatus).not.toBe('FUNDED');
  });

  it('nao avanca automaticamente status documentado inesperado na resposta de criacao', () => {
    const normalized = normalizeCredigrupoCreateSuccess(response({ status: 'funded' }), receivedAt);
    expect(normalized.unknownProviderStatus).toBe(false);
    expect(normalized.internalStatus).toBe('RECONCILIATION_REQUIRED');
  });

  it('preserva formalization_status e metadados seguros do PIX', () => {
    const normalized = normalizeCredigrupoCreateSuccess(response({
      formalization_status: 'awaiting_lender_payment',
    }), receivedAt);
    expect(normalized.providerSuccess).toEqual({
      httpStatus: 201,
      proposalId: 'proposal-1',
      requestId: 'request-1',
      externalStatus: 'awaiting_lender_payment',
      formalizationStatus: 'awaiting_lender_payment',
      correlationId: 'correlation-1',
      pix: {
        amountCents: 1200,
        expiresAt: '2026-09-03T12:00:00.000Z',
        correlationId: 'correlation-1',
      },
      receivedAt,
    });
  });

  it('remove brCode, QR Code, API Key e Authorization da persistencia segura', () => {
    const normalized = normalizeCredigrupoCreateSuccess(response({
      apiKey: 'wl_test_must_not_persist',
      Authorization: 'Bearer must-not-persist',
    }), receivedAt);
    const serialized = JSON.stringify(normalized);
    expect(serialized).not.toContain('000201-secret-pix-payload');
    expect(serialized).not.toContain('data:image/png');
    expect(serialized).not.toContain('wl_test_must_not_persist');
    expect(serialized).not.toContain('Bearer must-not-persist');
    expect(serialized.toLowerCase()).not.toContain('brcode');
    expect(serialized.toLowerCase()).not.toContain('qrcode');
  });

  it('nao inclui ledger, caixa, movimento financeiro ou estado funded no patch', () => {
    const normalized = normalizeCredigrupoCreateSuccess(response({ status: 'new_status' }), receivedAt);
    expect(normalized).not.toHaveProperty('ledger');
    expect(normalized).not.toHaveProperty('cashMovement');
    expect(normalized).not.toHaveProperty('financialEntry');
    expect(normalized).not.toHaveProperty('fundedAt');
    expect(normalized.status).toBe('RECONCILIATION_REQUIRED');
  });
});

describe('preparacao de reconciliacao manual sem nova criacao', () => {
  it('mantem o mesmo Operation ID e prepara somente o patch confirmado', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = prepareManualCredigrupoCreateReconciliation({
      operationId: 'credigrupo-sim-a70T7m6AZraZP2SNZKqV',
      current: { status: 'RECONCILIATION_REQUIRED' },
      confirmedResponse: response(),
      receivedAt,
    });

    expect(result.operationId).toBe('credigrupo-sim-a70T7m6AZraZP2SNZKqV');
    expect(result.patch).toMatchObject({
      proposalId: 'proposal-1',
      externalStatus: 'awaiting_lender_payment',
      status: 'AWAITING_LENDER_PAYMENT',
      failureClassification: null,
      lastErrorCode: null,
      providerError: null,
    });
    expect(result.patch).not.toHaveProperty('ledger');
    expect(result.patch).not.toHaveProperty('cashMovement');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('recusa proposalId confirmado diferente do ja preservado', () => {
    expect(() => prepareManualCredigrupoCreateReconciliation({
      operationId: 'operation-1',
      current: { status: 'RECONCILIATION_REQUIRED', proposalId: 'proposal-original' },
      confirmedResponse: response({ proposalId: 'proposal-different' }),
      receivedAt,
    })).toThrowError('O proposalId confirmado difere da operacao local.');
  });
});
