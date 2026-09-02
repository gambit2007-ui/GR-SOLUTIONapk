import { describe, expect, it, vi } from 'vitest';
import { prepareManualCredigrupoCreateReconciliation } from '../createSuccess';
import {
  assertCredigrupoDiscoveryAdmin,
  confirmCredigrupoLoanByProposalId,
  discoverExistingCredigrupoLoan,
  isCredigrupoDiscoveryAlreadyReconciled,
  type CredigrupoLoanReader,
} from '../loanDiscovery';

const borrowerId = '6f099809-e192-4c69-90f3-31540cb81422';
const criteria = {
  borrowerId,
  amountCents: 30000,
  installments: 2,
  createdAt: '2026-09-02T16:50:00.000Z',
  firstPaymentDate: '2026-10-02',
  interestRate: 2.5,
  simulationExternalId: 'SIM-784362',
};

const listLoan = (overrides: Record<string, unknown> = {}) => ({
  id: 'proposal-1',
  status: 'accepted',
  formalization_status: 'awaiting_lender_payment',
  created_at: '2026-09-02T16:51:00.000Z',
  request: {
    id: 'request-1',
    amount: 30000,
    installments: 2,
    interest_rate: 2.5,
    first_payment_date: '2026-10-02',
    borrower: { user_id: borrowerId, document: 'must-not-be-returned' },
  },
  ...overrides,
});

const detailLoan = (overrides: Record<string, unknown> = {}) => ({
  httpStatus: 200,
  data: {
    id: 'proposal-1',
    status: 'accepted',
    formalization_status: 'awaiting_lender_payment',
    created_at: '2026-09-02T16:51:00.000Z',
    loan_requests: {
      id: 'request-1',
      amount: 30000,
      installments: 2,
      interest_rate: 2.5,
      first_payment_date: '2026-10-02',
      borrower: { user_id: borrowerId, document: 'must-not-be-returned' },
    },
    pix: {
      amountCents: 1200,
      expiresAt: '2026-09-03T16:51:00.000Z',
      correlationId: 'correlation-1',
      brcode: '000201-secret',
      qrCodeImage: 'data:image/png;base64,secret',
    },
    apiKey: 'wl_test_must-not-leak',
    ...overrides,
  },
});

const reader = (items: unknown[], detail = detailLoan()) => {
  const listLoansPage = vi.fn(async () => ({ httpStatus: 200, data: items, total: items.length }));
  const getLoan = vi.fn(async () => detail);
  return { listLoansPage, getLoan } satisfies CredigrupoLoanReader;
};

describe('autorizacao da descoberta Credigrupo', () => {
  it('permite ADMIN executar discovery', () => {
    expect(() => assertCredigrupoDiscoveryAdmin({ uid: 'admin-1', admin: true })).not.toThrow();
  });

  it('retorna 401 sem autenticacao', () => {
    expect(() => assertCredigrupoDiscoveryAdmin()).toThrow(expect.objectContaining({ status: 401 }));
  });

  it('retorna 403 para usuario sem permissao ADMIN', () => {
    expect(() => assertCredigrupoDiscoveryAdmin({ uid: 'user-1', admin: false }))
      .toThrow(expect.objectContaining({ status: 403 }));
  });
});

describe('descoberta somente leitura', () => {
  it('usa somente a listagem quando nao existe candidata e nao consulta detalhes', async () => {
    const client = reader([]);
    const result = await discoverExistingCredigrupoLoan(criteria, client);
    expect(result.status).toBe('NOT_FOUND');
    expect(client.listLoansPage).toHaveBeenCalledTimes(1);
    expect(client.getLoan).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('patch');
  });

  it('consulta GET individual somente quando existe exatamente uma candidata', async () => {
    const client = reader([listLoan()]);
    const result = await discoverExistingCredigrupoLoan(criteria, client);
    expect(result.status).toBe('MATCHED');
    expect(client.getLoan).toHaveBeenCalledExactlyOnceWith('proposal-1');
  });

  it('nao escolhe automaticamente entre multiplas candidatas', async () => {
    const client = reader([listLoan(), listLoan({ id: 'proposal-2' })]);
    const result = await discoverExistingCredigrupoLoan(criteria, client);
    expect(result.status).toBe('AMBIGUOUS');
    expect(client.getLoan).not.toHaveBeenCalled();
    if (result.status === 'AMBIGUOUS') expect(result.candidates).toHaveLength(2);
  });

  it('nao produz confirmacao quando a consulta individual diverge nas parcelas', async () => {
    const client = reader([listLoan()], detailLoan({
      loan_requests: {
        id: 'request-1', amount: 30000, installments: 3,
        borrower: { user_id: borrowerId },
      },
    }));
    const result = await discoverExistingCredigrupoLoan(criteria, client);
    expect(result).toMatchObject({ status: 'NOT_FOUND', reason: 'INDIVIDUAL_LOAN_DIVERGED' });
    expect(result).not.toHaveProperty('confirmedResponse');
  });

  it('confirma awaiting_lender_payment com borrower, valor e parcelas exatos', async () => {
    const result = await discoverExistingCredigrupoLoan(criteria, reader([listLoan()]));
    expect(result.status).toBe('MATCHED');
    if (result.status !== 'MATCHED') throw new Error('Expected match');
    expect(result.confirmedResponse).toMatchObject({
      httpStatus: 200,
      proposalId: 'proposal-1',
      requestId: 'request-1',
      status: 'awaiting_lender_payment',
      formalization_status: 'awaiting_lender_payment',
    });
  });

  it('preserva proposalId, requestId e somente metadata segura do PIX', async () => {
    const result = await discoverExistingCredigrupoLoan(criteria, reader([listLoan()]));
    if (result.status !== 'MATCHED') throw new Error('Expected match');
    const reconciliation = prepareManualCredigrupoCreateReconciliation({
      operationId: 'credigrupo-sim-a70T7m6AZraZP2SNZKqV',
      current: { status: 'RECONCILIATION_REQUIRED' },
      confirmedResponse: result.confirmedResponse,
      receivedAt: '2026-09-02T17:00:00.000Z',
    });
    expect(reconciliation.patch).toMatchObject({
      proposalId: 'proposal-1',
      requestId: 'request-1',
      externalStatus: 'awaiting_lender_payment',
      formalizationStatus: 'awaiting_lender_payment',
      unknownProviderStatus: false,
      pix: {
        amountCents: 1200,
        expiresAt: '2026-09-03T16:51:00.000Z',
        correlationId: 'correlation-1',
      },
    });
    const serialized = JSON.stringify(reconciliation);
    expect(serialized).not.toContain('000201-secret');
    expect(serialized).not.toContain('data:image/png');
    expect(serialized).not.toContain('wl_test_must-not-leak');
    expect(serialized).not.toContain('must-not-be-returned');
  });

  it('nao cria ledger, caixa ou qualquer efeito financeiro', async () => {
    const result = await discoverExistingCredigrupoLoan(criteria, reader([listLoan()]));
    if (result.status !== 'MATCHED') throw new Error('Expected match');
    const reconciliation = prepareManualCredigrupoCreateReconciliation({
      operationId: 'credigrupo-sim-a70T7m6AZraZP2SNZKqV',
      current: { status: 'RECONCILIATION_REQUIRED' },
      confirmedResponse: result.confirmedResponse,
      receivedAt: '2026-09-02T17:00:00.000Z',
    });
    expect(reconciliation.patch).not.toHaveProperty('ledger');
    expect(reconciliation.patch).not.toHaveProperty('cashMovement');
    expect(reconciliation.patch).not.toHaveProperty('financialEntry');
    expect(reconciliation.patch).not.toHaveProperty('fundedAt');
    expect(reconciliation.patch.status).toBe('AWAITING_LENDER_PAYMENT');
  });

  it('nao dispara criacao, simulacao, borrower, pagamento, funding ou cancelamento', async () => {
    const dangerous = {
      createLoan: vi.fn(), simulateLoan: vi.fn(), registerBorrower: vi.fn(),
      testPayLoan: vi.fn(), createInstallmentPix: vi.fn(), cancelLoan: vi.fn(),
    };
    await discoverExistingCredigrupoLoan(criteria, reader([listLoan()]));
    Object.values(dangerous).forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  it('reconhece uma segunda execucao reconciliada sem nova descoberta', () => {
    expect(isCredigrupoDiscoveryAlreadyReconciled({
      status: 'AWAITING_LENDER_PAYMENT', proposalId: 'proposal-1',
    })).toBe(true);
    expect(isCredigrupoDiscoveryAlreadyReconciled({
      status: 'RECONCILIATION_REQUIRED', proposalId: 'proposal-1',
    })).toBe(false);
  });
});

describe('conciliacao por proposalId confirmado', () => {
  const evidence = {
    proposalId: 'd9d9738d-373b-49cf-8079-61392063106b',
    requestId: '85e09405-d167-45e8-ab05-5a278788d25f',
    pix: {
      amountCents: 1437,
      expiresAt: '2026-09-03T16:35:00.000Z',
      correlationId: 'ep_lender_payin_d9d9738d_1788366936085',
    },
  };

  const confirmedDetails = (overrides: Record<string, unknown> = {}) => ({
    httpStatus: 200,
    data: {
      id: evidence.proposalId,
      status: 'accepted',
      formalization_status: 'awaiting_lender_payment',
      loan_requests: {
        id: evidence.requestId,
        amount: 30000,
        installments: 2,
        interest_rate: 2.5,
        first_payment_date: '2026-10-02',
        borrower: { user_id: borrowerId, document: 'must-not-leak' },
      },
      ...overrides,
    },
  });

  it('consulta exclusivamente o GET individual e preserva os metadados seguros confirmados', async () => {
    const getLoan = vi.fn(async () => confirmedDetails());
    const result = await confirmCredigrupoLoanByProposalId(criteria, evidence, { getLoan });

    expect(getLoan).toHaveBeenCalledExactlyOnceWith(evidence.proposalId);
    expect(result).toMatchObject({
      detailHttpStatus: 200,
      confirmedResponse: {
        proposalId: evidence.proposalId,
        requestId: evidence.requestId,
        status: 'accepted',
        formalization_status: 'awaiting_lender_payment',
        pix: evidence.pix,
      },
    });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('aceita o contrato oficial do GET quando parcelas, taxa e vencimento nao sao retornados', async () => {
    const getLoan = vi.fn(async () => ({
      httpStatus: 200,
      data: {
        id: evidence.proposalId,
        status: 'accepted',
        formalization_status: 'awaiting_lender_payment',
        loan_requests: {
          id: evidence.requestId,
          amount: 30000,
          borrower: { user_id: borrowerId },
        },
      },
    }));
    await expect(confirmCredigrupoLoanByProposalId(criteria, evidence, { getLoan })).resolves.toMatchObject({
      detailHttpStatus: 200,
    });
  });

  it.each([
    { loan_requests: { id: evidence.requestId, amount: 30001, installments: 2, borrower: { user_id: borrowerId } } },
    { status: 'funded' },
    { formalization_status: 'lender_paid' },
    { loan_requests: { id: evidence.requestId, amount: 30000, installments: 3, borrower: { user_id: borrowerId } } },
  ])('recusa divergencia material sem produzir patch', async (override) => {
    const getLoan = vi.fn(async () => confirmedDetails(override));
    await expect(confirmCredigrupoLoanByProposalId(criteria, evidence, { getLoan }))
      .rejects.toMatchObject({ code: 'CONFIRMED_LOAN_DIVERGED' });
  });
});
