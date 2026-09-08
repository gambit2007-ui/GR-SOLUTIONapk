import { getApps, deleteApp } from 'firebase-admin/app';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredigrupoClient } from '../../api/_lib/credit-providers/credigrupo/client';
import type { CredigrupoWebhookEvent } from '../../api/_lib/credit-providers/credigrupo/webhook';

const PROJECT_ID = 'demo-gr-solution-credigrupo';
let db: Firestore;
let processStoredCredigrupoEvent: typeof import('../../api/_lib/credit-providers/credigrupo/webhookProcessor').processStoredCredigrupoEvent;
let registerCredigrupoWebhookEvent: typeof import('../../api/_lib/credit-providers/credigrupo/webhookProcessor').registerCredigrupoWebhookEvent;
let recoverCredigrupoCcbSigningLinksFromInbox: typeof import('../../api/_lib/credit-providers/credigrupo/signingLinkRecovery').recoverCredigrupoCcbSigningLinksFromInbox;
let resolveCredigrupoFundingInvestor: typeof import('../../api/_lib/credit-providers/credigrupo/grInvestorSettings').resolveCredigrupoFundingInvestor;
let reserveCredigrupoOperation: typeof import('../../api/_lib/credit-providers/credigrupo/store').reserveCredigrupoOperation;

const forbiddenProviderCalls = [
  vi.spyOn(CredigrupoClient.prototype, 'registerBorrower').mockImplementation(() => {
    throw new Error('FORBIDDEN_PROVIDER_CALL_IN_POST_SIGNATURE_EVENT');
  }),
  vi.spyOn(CredigrupoClient.prototype, 'simulateLoan').mockImplementation(() => {
    throw new Error('FORBIDDEN_PROVIDER_CALL_IN_POST_SIGNATURE_EVENT');
  }),
  vi.spyOn(CredigrupoClient.prototype, 'createLoan').mockImplementation(() => {
    throw new Error('FORBIDDEN_PROVIDER_CALL_IN_POST_SIGNATURE_EVENT');
  }),
  vi.spyOn(CredigrupoClient.prototype, 'createInstallmentPix').mockImplementation(() => {
    throw new Error('FORBIDDEN_PROVIDER_CALL_IN_POST_SIGNATURE_EVENT');
  }),
  vi.spyOn(CredigrupoClient.prototype, 'testPayLoan').mockImplementation(() => {
    throw new Error('FORBIDDEN_PROVIDER_CALL_IN_POST_SIGNATURE_EVENT');
  }),
  vi.spyOn(CredigrupoClient.prototype, 'testPayInstallment').mockImplementation(() => {
    throw new Error('FORBIDDEN_PROVIDER_CALL_IN_POST_SIGNATURE_EVENT');
  }),
];

const expectNoProviderOrFinancialEffects = async () => {
  forbiddenProviderCalls.forEach((providerCall) => expect(providerCall).not.toHaveBeenCalled());
  const [operations, loans, cashMovements, ledger] = await Promise.all([
    db.collection('creditOperations').get(),
    db.collection('loans').get(),
    db.collection('cashMovement').get(),
    db.collection('creditInvestorLedger').get(),
  ]);
  expect(operations.size).toBe(1);
  expect(loans.size).toBe(0);
  expect(cashMovements.size).toBe(0);
  expect(ledger.size).toBe(0);
};

beforeAll(async () => {
  await Promise.all(getApps().map((app) => deleteApp(app)));
  process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
  const firebase = await import('../../api/_lib/firebaseAdmin');
  const processor = await import('../../api/_lib/credit-providers/credigrupo/webhookProcessor');
  const settings = await import('../../api/_lib/credit-providers/credigrupo/grInvestorSettings');
  const store = await import('../../api/_lib/credit-providers/credigrupo/store');
  const signingLinkRecovery = await import('../../api/_lib/credit-providers/credigrupo/signingLinkRecovery');
  db = firebase.adminDb;
  processStoredCredigrupoEvent = processor.processStoredCredigrupoEvent;
  registerCredigrupoWebhookEvent = processor.registerCredigrupoWebhookEvent;
  resolveCredigrupoFundingInvestor = settings.resolveCredigrupoFundingInvestor;
  reserveCredigrupoOperation = store.reserveCredigrupoOperation;
  recoverCredigrupoCcbSigningLinksFromInbox = signingLinkRecovery.recoverCredigrupoCcbSigningLinksFromInbox;
});

beforeEach(async () => {
  // Production financial fixtures run exclusively inside the emulator.
  vi.stubEnv('CREDIGRUPO_ENV', 'production');
  forbiddenProviderCalls.forEach((providerCall) => providerCall.mockClear());
  const collections = await db.listCollections();
  await Promise.all(collections.map(async (collection) => {
    const documents = await collection.listDocuments();
    await Promise.all(documents.map((document) => document.delete()));
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  forbiddenProviderCalls.forEach((providerCall) => providerCall.mockRestore());
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

const paidEvent: CredigrupoWebhookEvent = {
  event: 'installment.paid',
  partnerId: 'partner-1',
  timestamp: '2026-08-25T12:00:00.000Z',
  data: {
    proposalId: 'proposal-1',
    installmentId: 'installment-1',
    installmentNumber: 1,
    amountCents: 11000,
    dueDate: '2026-09-25',
    paidAt: '2026-08-25T14:30:00.000Z',
  },
};

const seedOperation = async (id = 'operation-1', overrides: Record<string, unknown> = {}) => {
  await db.doc(`creditOperations/${id}`).set({
    environment: 'production',
    formalizationType: 'BANCARIZED', provider: 'CREDIGRUPO', proposalId: 'proposal-1',
    customerId: 'customer-1', customerName: 'Cliente', customerPhone: '21999999999',
    borrowerId: 'borrower-1', investorId: 'investor-local-1', externalInvestorId: 'investor-external-1', investorName: 'Investidor',
    fundingSource: 'EXTERNAL', amountCents: 10000, installments: 1, interestRate: 10,
    firstPaymentDate: '2026-09-25', frequency: 'monthly', interestType: 'simple',
    simulation: {
      netAmount: 10000, grossAmount: 11000, totalAmount: 11000, totalInterest: 1000, totalIof: 0, totalFee: 0,
      installments: [{ installmentNumber: 1, amount: 11000, dueDate: '2026-09-25', interest: 1000, principal: 10000, outstandingBalance: 0 }],
    },
    simulationExternalId: 'simulation-1', status: 'AWAITING_SIGNATURES', externalStatus: 'accepted', createdByUid: 'admin-1',
    ...overrides,
  });
};

const seedOwnInvestorOperation = async (id: string, overrides: Record<string, unknown> = {}) => {
  await db.doc(`creditOperations/${id}`).set({
    environment: 'production',
    formalizationType: 'BANCARIZED', provider: 'CREDIGRUPO', proposalId: 'proposal-gr',
    customerId: 'customer-1', customerName: 'Cliente', customerPhone: '21999999999',
    borrowerId: 'borrower-1', accountMode: 'OWN_INVESTOR_KEY', investorType: 'GR', investorName: 'GR SOLUTION',
    fundingSource: 'GR', amountCents: 10000, installments: 1, interestRate: 10,
    firstPaymentDate: '2026-09-25', frequency: 'monthly', interestType: 'simple',
    simulation: {
      netAmount: 10000, grossAmount: 11000, totalAmount: 11000, totalInterest: 1000, totalIof: 0, totalFee: 0,
      installments: [{ installmentNumber: 1, amount: 11000, dueDate: '2026-09-25', interest: 1000, principal: 10000, outstandingBalance: 0 }],
    },
    simulationExternalId: 'simulation-1', status: 'AWAITING_SIGNATURES', externalStatus: 'accepted', createdByUid: 'admin-1',
    ...overrides,
  });
};

const seedLoan = async (id = 'loan-1') => {
  await db.doc(`loans/${id}`).set({
    customerId: 'customer-1', customerName: 'Cliente', amount: 100, interestRate: 10,
    frequency: 'MENSAL', interestType: 'SIMPLES', startDate: '2026-08-25', status: 'ATIVO',
    formalizationType: 'BANCARIZED', provider: 'CREDIGRUPO',
    credigrupo: { proposalId: 'proposal-1' },
    installments: [{ number: 1, amount: 110, dueDate: '2026-09-25', status: 'PENDENTE', credigrupo: { installmentId: 'installment-1' } }],
  });
};

const runEvent = async (id: string, event: CredigrupoWebhookEvent) => {
  const eventRef = db.doc(`creditWebhookEvents/${id}`);
  await eventRef.set({ status: 'RECEIVED', payload: event });
  await processStoredCredigrupoEvent(eventRef, event);
  return eventRef.get();
};

describe('processamento financeiro do webhook Credigrupo', () => {
  it('isola funding e parcelas sandbox sem criar contrato, caixa ou ledger, inclusive duplicados', async () => {
    vi.stubEnv('CREDIGRUPO_ENV', 'sandbox');
    await seedOwnInvestorOperation('sandbox-operation', { environment: 'sandbox', testData: true, proposalId: 'proposal-1' });
    await db.doc('settings/caixa').set({ value: 1234 });
    const funded: CredigrupoWebhookEvent = {
      event: 'loan.funded', partnerId: 'partner-1', timestamp: paidEvent.timestamp,
      data: { proposalId: 'proposal-1', borrowerId: 'borrower-1', amountCents: 10000 },
    };
    await runEvent('sandbox-funded', funded);
    await runEvent('sandbox-funded-again', funded);
    await runEvent('sandbox-paid', paidEvent);
    await runEvent('sandbox-paid-again', paidEvent);
    await runEvent('sandbox-repaid', { ...paidEvent, event: 'installment.investor_repaid' });
    expect((await db.doc('creditOperations/sandbox-operation').get()).data()?.status).toBe('FUNDED');
    expect((await db.doc('settings/caixa').get()).data()?.value).toBe(1234);
    expect((await db.doc('settings/contractCounter').get()).exists).toBe(false);
    expect((await db.doc('creditWebhookEvents/sandbox-paid').get()).data()).toMatchObject({
      status: 'PROCESSED', processingResult: 'SANDBOX_FINANCIAL_EVENT_ISOLATED', financialEffectsApplied: false,
    });
    await expectNoProviderOrFinancialEffects();
  });

  it('quarentena financeira para operacao sem ambiente e preserva arquivadas', async () => {
    await seedOperation('operation-1', { archived: true });
    await runEvent('archived-paid', paidEvent);
    expect((await db.doc('creditWebhookEvents/archived-paid').get()).data()?.processingResult).toBe('ARCHIVED_HOMOLOGATION_EVENT');
    await db.doc('creditOperations/operation-1').set({ archived: false, environment: null }, { merge: true });
    await runEvent('unknown-paid', paidEvent);
    expect((await db.doc('creditWebhookEvents/unknown-paid').get()).data()?.processingResult).toBe('FINANCIAL_ENVIRONMENT_UNCONFIRMED');
    await expectNoProviderOrFinancialEffects();
  });

  it('resolve capital GR somente pelo vinculo configurado e preserva externo', async () => {
    await db.doc('creditInvestors/gr-local-1').set({
      externalId: 'gr-external-1', provider: 'CREDIGRUPO', capitalOrigin: 'GR', name: 'GR Solution', kycStatus: 'approved', active: true,
    });
    await db.doc('creditInvestors/external-local-1').set({
      externalId: 'external-1', provider: 'CREDIGRUPO', capitalOrigin: 'EXTERNAL', name: 'Investidor Externo', kycStatus: 'approved', active: true,
    });
    await db.doc('creditProviderSettings/credigrupo').set({
      grInvestorConfigured: true, grInvestorInternalId: 'gr-local-1', grInvestorId: 'gr-external-1', grInvestorName: 'GR Solution',
    });

    await expect(resolveCredigrupoFundingInvestor('GR', 'external-local-1')).resolves.toMatchObject({
      internalId: 'gr-local-1', externalId: 'gr-external-1', name: 'GR Solution',
    });
    await expect(resolveCredigrupoFundingInvestor('EXTERNAL', 'external-local-1')).resolves.toMatchObject({
      internalId: 'external-local-1', externalId: 'external-1', name: 'Investidor Externo',
    });
  });

  it('bloqueia capital GR sem configuracao', async () => {
    await expect(resolveCredigrupoFundingInvestor('GR')).rejects.toMatchObject({ code: 'GR_INVESTOR_NOT_CONFIGURED' });
  });

  it('reserva BANCARIZED com a GR sem criar investorId ficticio', async () => {
    vi.stubEnv('CREDIGRUPO_ENABLED', 'true');
    vi.stubEnv('CREDIGRUPO_ENV', 'sandbox');
    vi.stubEnv('CREDIGRUPO_ACCOUNT_MODE', 'OWN_INVESTOR_KEY');
    vi.stubEnv('CREDIGRUPO_API_KEY', 'wl_test_rules_fixture');
    vi.stubEnv('CREDIGRUPO_WEBHOOK_SECRET', 'rules-fixture-secret');
    await db.doc('clientes/customer-1').set({ environment: 'sandbox', testData: true, name: 'Fixture' });
    await db.doc('creditSimulations/simulation-gr').set({
      environment: 'sandbox', testData: true,
      customerId: 'customer-1', customerName: 'Cliente', borrowerId: 'borrower-1', accountMode: 'OWN_INVESTOR_KEY', investorType: 'GR',
      request: { customerId: 'customer-1', fundingSource: 'GR', amountCents: 30000, installments: 1, interestRate: 10, firstPaymentDate: '2026-09-25', frequency: 'monthly', interestType: 'simple' },
      response: { externalId: 'simulation-external-1', interestRate: 10, simulation: { netAmount: 30000, grossAmount: 33000, totalAmount: 33000, totalInterest: 3000, totalIof: 0, totalFee: 0, installments: [] } },
      createdByUid: 'admin-1', createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    });

    const result = await reserveCredigrupoOperation(
      { operationId: 'operation-gr', simulationId: 'simulation-gr', fundingSource: 'GR' },
      { uid: 'admin-1', name: 'Admin', admin: true },
    );
    expect(result).toMatchObject({
      duplicate: false,
      operation: { accountMode: 'OWN_INVESTOR_KEY', investorType: 'GR', investorName: 'GR SOLUTION', fundingSource: 'GR' },
    });
    expect(result.operation.investorId).toBeUndefined();
    expect(result.operation.externalInvestorId).toBeUndefined();
    expect((await db.doc('creditOperations/operation-gr').get()).data()).toMatchObject({
      formalizationType: 'BANCARIZED', provider: 'CREDIGRUPO', fundingSource: 'GR',
    });
  });

  it('registra entrega na inbox e ignora evento ja processado', async () => {
    const first = await registerCredigrupoWebhookEvent('incoming-event', paidEvent);
    expect(first.shouldProcess).toBe(true);
    expect((await first.eventRef.get()).data()).toMatchObject({
      eventId: 'incoming-event',
      eventType: 'installment.paid',
      timestamp: paidEvent.timestamp,
      partnerId: paidEvent.partnerId,
      status: 'RECEIVED',
      hmacValidated: true,
    });
    await first.eventRef.set({ status: 'PROCESSED' }, { merge: true });
    const duplicate = await registerCredigrupoWebhookEvent('incoming-event', paidEvent);
    expect(duplicate).toMatchObject({ shouldProcess: false, duplicate: true });
  });

  it('processa duas entregas de installment.paid com efeito financeiro unico', async () => {
    await seedOperation('operation-1', { localLoanId: 'loan-1' });
    await seedLoan();

    const firstRef = db.doc('creditWebhookEvents/delivery-1');
    const duplicateRef = db.doc('creditWebhookEvents/delivery-2');
    await firstRef.set({ status: 'RECEIVED', payload: paidEvent });
    await duplicateRef.set({ status: 'RECEIVED', payload: paidEvent });
    await processStoredCredigrupoEvent(firstRef, paidEvent);
    await processStoredCredigrupoEvent(duplicateRef, paidEvent);

    const [loan, ledger, duplicate] = await Promise.all([
      db.doc('loans/loan-1').get(),
      db.collection('creditInvestorLedger').get(),
      duplicateRef.get(),
    ]);
    expect(loan.data()?.installments[0].paidAmount).toBe(110);
    expect(loan.data()?.status).toBe('QUITADO');
    expect(ledger.size).toBe(1);
    expect(duplicate.data()?.duplicateFinancialEffect).toBe(true);
    expect(duplicate.data()?.status).toBe('PROCESSED');
    const paidLedger = ledger.docs[0].data();
    expect(paidLedger).toMatchObject({
      installmentNumber: 1,
      dueDate: '2026-09-25',
      paidAt: '2026-08-25T14:30:00.000Z',
      occurredAt: '2026-08-25T14:30:00.000Z',
    });
  });

  it('mantem evento sem proposal local como FAILED para reprocessamento', async () => {
    const eventRef = db.doc('creditWebhookEvents/missing-proposal');
    await eventRef.set({ status: 'RECEIVED', payload: paidEvent });
    await processStoredCredigrupoEvent(eventRef, paidEvent);
    const snapshot = await eventRef.get();
    expect(snapshot.data()?.status).toBe('FAILED');
    expect(snapshot.data()?.errorCode).toBe('CREDIGRUPO_OPERATION_NOT_FOUND');
  });

  it('processa aprovacao e rejeicao KYC sem misturar identificadores', async () => {
    await db.doc('creditBorrowers/link-1').set({ borrowerId: 'borrower-1', customerId: 'customer-1', investorId: 'investor-1' });
    await db.doc('creditInvestors/investor-local-1').set({ externalId: 'borrower-1', kycStatus: 'pending_approval', active: false });
    await db.doc('clientes/customer-1').set({ name: 'Cliente' });
    const approved = { event: 'kyc.approved', partnerId: 'partner-1', timestamp: paidEvent.timestamp, data: { userId: 'borrower-1', role: 'borrower', reason: null } };
    const rejected = { event: 'kyc.rejected', partnerId: 'partner-1', timestamp: paidEvent.timestamp, data: { userId: 'borrower-1', role: 'borrower', reason: 'Documento ilegivel' } };
    await runEvent('kyc-approved', approved);
    expect((await db.doc('creditBorrowers/link-1').get()).data()?.kycStatus).toBe('approved');
    expect((await db.doc('creditInvestors/investor-local-1').get()).data()?.kycStatus).toBe('pending_approval');
    await runEvent('kyc-rejected', rejected);
    expect((await db.doc('creditBorrowers/link-1').get()).data()?.kycStatus).toBe('rejected');
  });

  it('ativa e desativa investidor pelo KYC com role user sem alterar tomador', async () => {
    await db.doc('creditInvestors/investor-local-1').set({ externalId: 'investor-external-1', kycStatus: 'pending_approval', active: false });
    await db.doc('creditBorrowers/link-1').set({ borrowerId: 'investor-external-1', kycStatus: 'pending_approval' });
    await runEvent('investor-approved', { event: 'kyc.approved', partnerId: 'partner-1', timestamp: paidEvent.timestamp, data: { userId: 'investor-external-1', role: 'user' } });
    expect((await db.doc('creditInvestors/investor-local-1').get()).data()).toMatchObject({ kycStatus: 'approved', active: true });
    expect((await db.doc('creditBorrowers/link-1').get()).data()?.kycStatus).toBe('pending_approval');
    await runEvent('investor-rejected', { event: 'kyc.rejected', partnerId: 'partner-1', timestamp: paidEvent.timestamp, data: { userId: 'investor-external-1', role: 'user', reason: 'Documento invalido' } });
    expect((await db.doc('creditInvestors/investor-local-1').get()).data()).toMatchObject({ kycStatus: 'rejected', active: false });
  });

  it('nao reativa investidor desativado manualmente ao receber KYC aprovado', async () => {
    await db.doc('creditInvestors/investor-local-1').set({ externalId: 'investor-external-1', manuallyDisabled: true, active: false });
    await runEvent('investor-approved-disabled', { event: 'kyc.approved', partnerId: 'partner-1', timestamp: paidEvent.timestamp, data: { userId: 'investor-external-1', role: 'user' } });
    expect((await db.doc('creditInvestors/investor-local-1').get()).data()).toMatchObject({ kycStatus: 'approved', active: false });
  });

  it('processa CCB, assinatura e cancelamento no estado externo da operacao', async () => {
    await seedOperation();
    await runEvent('ccb-ready', { event: 'ccb_ready_for_signature', partnerId: 'partner-1', timestamp: paidEvent.timestamp, data: { proposalId: 'proposal-1', borrowerSignUrl: 'https://app.zapsign.com.br/a', investorSignUrl: 'https://app.zapsign.com.br/b' } });
    expect((await db.doc('creditOperations/operation-1').get()).data()).toMatchObject({
      status: 'AWAITING_SIGNATURES',
      externalStatus: 'accepted',
      borrowerSignUrl: 'https://app.zapsign.com.br/a',
      investorSignUrl: 'https://app.zapsign.com.br/b',
    });
    await runEvent('loan-signed', { event: 'loan.signed', partnerId: 'partner-1', timestamp: paidEvent.timestamp, data: { proposalId: 'proposal-1', requestId: 'request-1', signedAt: paidEvent.timestamp } });
    expect((await db.doc('creditOperations/operation-1').get()).data()).toMatchObject({
      status: 'SIGNED',
      externalStatus: 'accepted',
      formalizationStatus: 'completed',
    });
    await runEvent('loan-cancelled', { event: 'loan.cancelled', partnerId: 'partner-1', timestamp: paidEvent.timestamp, data: { proposalId: 'proposal-1', requestId: 'request-1', cancelledAt: paidEvent.timestamp } });
    expect((await db.doc('creditOperations/operation-1').get()).data()?.status).toBe('CANCELLED');
    expect((await db.doc('creditOperations/operation-1').get()).data()?.externalStatus).toBe('accepted');
  });

  it('conclui assinatura do tomador com investidor pre-signed sem acionar provider ou financeiro', async () => {
    await seedOwnInvestorOperation('operation-gr', {
      proposalId: 'proposal-gr',
      requestId: 'request-gr',
      status: 'AWAITING_SIGNATURES',
      externalStatus: 'accepted',
      formalizationStatus: 'awaiting_lender_payment',
      investorSignaturePreSigned: true,
      borrowerSignUrl: 'https://sandbox.app.zapsign.com.br/verificar/borrower-token',
    });

    const event = await runEvent('loan-signed-pre-signed', {
      event: 'loan.signed',
      partnerId: 'partner-1',
      timestamp: paidEvent.timestamp,
      data: {
        proposalId: 'proposal-gr',
        requestId: 'request-gr',
        signedAt: paidEvent.timestamp,
        signedCcbUrl: 'https://storage.supabase.co/object/public/ccb/signed.pdf',
      },
    });

    expect((await db.doc('creditOperations/operation-gr').get()).data()).toMatchObject({
      proposalId: 'proposal-gr',
      requestId: 'request-gr',
      status: 'SIGNED',
      externalStatus: 'accepted',
      formalizationStatus: 'completed',
      investorSignaturePreSigned: true,
      signedAt: paidEvent.timestamp,
      ccbUrl: 'https://storage.supabase.co/object/public/ccb/signed.pdf',
    });
    expect((await db.doc('creditOperations/operation-gr').get()).data()?.investorSignUrl).toBeUndefined();
    expect(event.data()).toMatchObject({
      status: 'PROCESSED',
      processingResult: 'LIFECYCLE_ADVANCED',
      stateBefore: 'AWAITING_SIGNATURES',
      stateTarget: 'SIGNED',
    });
    await expectNoProviderOrFinancialEffects();
  });

  it('ignora loan.signed duplicado sem repetir efeitos ou alterar a proposta', async () => {
    await seedOwnInvestorOperation('operation-gr', {
      proposalId: 'proposal-gr',
      requestId: 'request-gr',
      status: 'AWAITING_SIGNATURES',
      investorSignaturePreSigned: true,
    });
    const signedEvent: CredigrupoWebhookEvent = {
      event: 'loan.signed',
      partnerId: 'partner-1',
      timestamp: paidEvent.timestamp,
      data: { proposalId: 'proposal-gr', requestId: 'request-gr', signedAt: paidEvent.timestamp },
    };

    await runEvent('loan-signed-first', signedEvent);
    const duplicate = await runEvent('loan-signed-duplicate', signedEvent);

    expect((await db.doc('creditOperations/operation-gr').get()).data()).toMatchObject({
      proposalId: 'proposal-gr',
      status: 'SIGNED',
      externalStatus: 'accepted',
      formalizationStatus: 'completed',
    });
    expect(duplicate.data()).toMatchObject({
      status: 'PROCESSED',
      processingResult: 'IGNORED_DUPLICATE_EVENT',
      stateBefore: 'SIGNED',
      stateTarget: 'SIGNED',
    });
    await expectNoProviderOrFinancialEffects();
  });

  it('nao regride SIGNED ao receber CCB antiga fora de ordem', async () => {
    await seedOwnInvestorOperation('operation-gr', {
      proposalId: 'proposal-gr',
      requestId: 'request-gr',
      status: 'SIGNED',
      externalStatus: 'accepted',
      formalizationStatus: 'completed',
      investorSignaturePreSigned: true,
    });

    const stale = await runEvent('ccb-ready-stale', {
      event: 'ccb_ready_for_signature',
      partnerId: 'partner-1',
      timestamp: paidEvent.timestamp,
      data: {
        proposalId: 'proposal-gr',
        requestId: 'request-gr',
        borrowerSignUrl: 'https://sandbox.app.zapsign.com.br/verificar/old-token',
        investorSignUrl: 'pre-signed',
      },
    });

    expect((await db.doc('creditOperations/operation-gr').get()).data()).toMatchObject({
      proposalId: 'proposal-gr',
      status: 'SIGNED',
      externalStatus: 'accepted',
      formalizationStatus: 'completed',
      investorSignaturePreSigned: true,
    });
    expect(stale.data()).toMatchObject({ processingResult: 'IGNORED_STALE_EVENT' });
    await expectNoProviderOrFinancialEffects();
  });

  it('nao regride FUNDED ao receber loan.signed antigo', async () => {
    await seedOwnInvestorOperation('operation-gr', {
      proposalId: 'proposal-gr',
      requestId: 'request-gr',
      status: 'FUNDED',
      externalStatus: 'funded',
      formalizationStatus: 'funded',
      localLoanId: 'loan-existing',
    });

    const stale = await runEvent('loan-signed-after-funded', {
      event: 'loan.signed',
      partnerId: 'partner-1',
      timestamp: paidEvent.timestamp,
      data: { proposalId: 'proposal-gr', requestId: 'request-gr', signedAt: paidEvent.timestamp },
    });

    expect((await db.doc('creditOperations/operation-gr').get()).data()).toMatchObject({
      proposalId: 'proposal-gr',
      status: 'FUNDED',
      externalStatus: 'funded',
      formalizationStatus: 'funded',
      localLoanId: 'loan-existing',
    });
    expect(stale.data()).toMatchObject({ processingResult: 'IGNORED_STALE_EVENT' });
    await expectNoProviderOrFinancialEffects();
  });

  it('persiste links oficiais de sandbox e preserva diagnostico sem tokens', async () => {
    await seedOperation();
    const eventRef = await runEvent('ccb-ready-sandbox', {
      event: 'ccb_ready_for_signature',
      partnerId: 'partner-1',
      timestamp: paidEvent.timestamp,
      data: {
        proposalId: 'proposal-1',
        borrowerSignUrl: 'https://sandbox.app.zapsign.com.br/verificar/borrower-token',
        investorSignUrl: 'https://sandbox.app.zapsign.com.br/verificar/investor-token',
      },
    });
    expect((await db.doc('creditOperations/operation-1').get()).data()).toMatchObject({
      status: 'AWAITING_SIGNATURES',
      borrowerSignUrl: 'https://sandbox.app.zapsign.com.br/verificar/borrower-token',
      investorSignUrl: 'https://sandbox.app.zapsign.com.br/verificar/investor-token',
    });
    expect(JSON.stringify(eventRef.data()?.signingUrlDiagnostics || {})).not.toContain('token');
  });

  it('nao persiste URL maliciosa e registra somente diagnostico sanitizado', async () => {
    await seedOperation();
    const eventRef = await runEvent('ccb-ready-malicious', {
      event: 'ccb_ready_for_signature',
      partnerId: 'partner-1',
      timestamp: paidEvent.timestamp,
      data: {
        proposalId: 'proposal-1',
        borrowerSignUrl: 'https://app.zapsign.com.br.evil.example/verificar/TOKEN-BORROWER?auth=SECRET',
        investorSignUrl: 'https://sandbox.app.zapsign.com.br/verificar/investor-token',
      },
    });
    const operation = (await db.doc('creditOperations/operation-1').get()).data();
    expect(operation?.borrowerSignUrl).toBeUndefined();
    expect(operation?.investorSignUrl).toBe('https://sandbox.app.zapsign.com.br/verificar/investor-token');
    const diagnostic = JSON.stringify(eventRef.data()?.signingUrlDiagnostics);
    expect(diagnostic).toContain('HOST_NOT_ALLOWED');
    expect(diagnostic).not.toContain('TOKEN-BORROWER');
    expect(diagnostic).not.toContain('SECRET');
    expect(diagnostic).not.toContain('/verificar/');
  });

  it('reprocessa somente links de evento CCB validado e permanece idempotente sem efeitos financeiros', async () => {
    await seedOwnInvestorOperation('operation-gr', {
      proposalId: 'proposal-gr',
      status: 'AWAITING_SIGNATURES',
      externalStatus: 'accepted',
      formalizationStatus: 'awaiting_lender_payment',
      testPayStatus: 'SUCCEEDED',
    });
    const event = {
      event: 'ccb_ready_for_signature',
      partnerId: 'partner-1',
      timestamp: paidEvent.timestamp,
      data: {
        proposalId: 'proposal-gr',
        borrowerSignUrl: 'https://sandbox.app.zapsign.com.br/verificar/borrower-token',
        investorSignUrl: 'https://sandbox.app.zapsign.com.br/verificar/investor-token',
      },
    };
    await db.doc('creditWebhookEvents/ccb-event').set({
      eventId: 'ccb-event',
      eventType: 'ccb_ready_for_signature',
      proposalId: 'proposal-gr',
      status: 'PROCESSED',
      hmacValidated: true,
      receivedAt: Timestamp.now(),
      payload: event,
    });

    const first = await recoverCredigrupoCcbSigningLinksFromInbox('operation-gr');
    const second = await recoverCredigrupoCcbSigningLinksFromInbox('operation-gr');
    expect(first).toMatchObject({ recovered: true, alreadyRecovered: false, source: 'EVENT', hmacValidated: true });
    expect(second).toMatchObject({ recovered: true, alreadyRecovered: true });
    expect((await db.doc('creditOperations/operation-gr').get()).data()).toMatchObject({
      status: 'AWAITING_SIGNATURES',
      externalStatus: 'accepted',
      formalizationStatus: 'awaiting_lender_payment',
      testPayStatus: 'SUCCEEDED',
      borrowerSignUrl: 'https://sandbox.app.zapsign.com.br/verificar/borrower-token',
      investorSignUrl: 'https://sandbox.app.zapsign.com.br/verificar/investor-token',
    });
    expect((await db.doc('creditWebhookEvents/ccb-event').get()).data()).toMatchObject({
      status: 'PROCESSED',
      signingLinkRecovery: {
        status: 'PROCESSED',
        borrowerHostname: 'sandbox.app.zapsign.com.br',
        investorHostname: 'sandbox.app.zapsign.com.br',
      },
    });
    expect((await db.collection('creditInvestorLedger').get()).size).toBe(0);
    expect((await db.collection('cashMovement').get()).size).toBe(0);
    expect((await db.collection('loans').get()).size).toBe(0);
  });

  it('bloqueia reprocessamento de evento sem evidencia de HMAC validado', async () => {
    await seedOperation();
    await db.doc('creditWebhookEvents/ccb-unverified').set({
      eventType: 'ccb_ready_for_signature',
      proposalId: 'proposal-1',
      status: 'PROCESSED',
      payload: {
        event: 'ccb_ready_for_signature',
        partnerId: 'partner-1',
        timestamp: paidEvent.timestamp,
        data: {
          proposalId: 'proposal-1',
          borrowerSignUrl: 'https://app.zapsign.com.br/verificar/a',
          investorSignUrl: 'https://app.zapsign.com.br/verificar/b',
        },
      },
    });
    await expect(recoverCredigrupoCcbSigningLinksFromInbox('operation-1')).rejects.toMatchObject({
      code: 'CREDIGRUPO_EVENT_HMAC_NOT_VALIDATED',
    });
    expect((await db.doc('creditOperations/operation-1').get()).data()?.borrowerSignUrl).toBeUndefined();
  });

  it('cria contrato bancarizado uma unica vez ao receber loan.funded', async () => {
    await seedOperation();
    const funded = { event: 'loan.funded', partnerId: 'partner-1', timestamp: paidEvent.timestamp, data: { proposalId: 'proposal-1', amountCents: 10000, borrowerId: 'borrower-1' } };
    await runEvent('loan-funded-1', funded);
    await runEvent('loan-funded-2', funded);
    const [loan, loans] = await Promise.all([
      db.doc('loans/operation-1').get(),
      db.collection('loans').get(),
    ]);
    expect(loan.exists).toBe(true);
    expect(loan.data()?.formalizationType).toBe('BANCARIZED');
    expect(loan.data()?.funding.investorId).toBe('investor-local-1');
    expect(loan.data()?.credigrupo.investorId).toBe('investor-external-1');
    expect(loan.data()?.credigrupo.status).toBe('funded');
    expect((await db.doc('creditOperations/operation-1').get()).data()?.externalStatus).toBe('funded');
    expect(loans.size).toBe(1);
    expect((await db.collection('cashMovement').get()).size).toBe(0);
  });

  it('reduz o caixa uma unica vez no funding com capital GR', async () => {
    await seedOwnInvestorOperation('operation-gr');
    await db.doc('settings/caixa').set({ value: 500 });
    const funded = { event: 'loan.funded', partnerId: 'partner-1', timestamp: paidEvent.timestamp, data: { proposalId: 'proposal-gr', amountCents: 10000, borrowerId: 'borrower-1' } };
    await runEvent('loan-funded-gr-1', funded);
    await runEvent('loan-funded-gr-2', funded);

    const [cash, movements, loans] = await Promise.all([
      db.doc('settings/caixa').get(),
      db.collection('cashMovement').get(),
      db.collection('loans').get(),
    ]);
    expect(cash.data()?.value).toBe(400);
    expect(movements.size).toBe(1);
    expect(movements.docs[0].data()).toMatchObject({ type: 'RETIRADA', amount: 100, loanId: 'operation-gr' });
    expect(loans.size).toBe(1);
    expect(loans.docs[0].data()).toMatchObject({
      fundingSource: 'GR',
      funding: { source: 'GR', investorName: 'GR SOLUTION' },
      credigrupo: { accountMode: 'OWN_INVESTOR_KEY', investorType: 'GR', investorName: 'GR SOLUTION' },
    });
    expect(loans.docs[0].data()?.investorInternalId).toBeUndefined();
    expect(loans.docs[0].data()?.credigrupo.investorId).toBeUndefined();
  });

  it('salva PIX criado sem marcar a parcela como paga', async () => {
    await seedOperation('operation-1', { localLoanId: 'loan-1' });
    await seedLoan();
    await runEvent('pix-created', { event: 'installment.pix_created', partnerId: 'partner-1', timestamp: paidEvent.timestamp, data: { proposalId: 'proposal-1', installmentId: 'installment-1', installmentNumber: 1, amountCents: 11000, totalCents: 12000, dueDate: '2026-09-25', pixBrcode: '000201', pixQrCode: 'https://api.woovi.com/qr.png' } });
    const installment = (await db.doc('loans/loan-1').get()).data()?.installments[0];
    expect(installment.status).toBe('PENDENTE');
    expect(installment.credigrupo.pixBrcode).toBe('000201');
  });

  it('registra installment.investor_repaid uma unica vez sem caixa para capital externo', async () => {
    await seedOperation('operation-1', { localLoanId: 'loan-1' });
    await seedLoan();
    const repaid = { event: 'installment.investor_repaid', partnerId: 'partner-1', timestamp: paidEvent.timestamp, data: { proposalId: 'proposal-1', installmentId: 'installment-1', amountCents: 11000 } };
    await runEvent('repaid-1', repaid);
    await runEvent('repaid-2', repaid);
    expect((await db.collection('creditInvestorLedger').where('type', '==', 'INVESTOR_REPAID').get()).size).toBe(1);
    expect((await db.collection('cashMovement').get()).size).toBe(0);
  });

  it('credita o repasse da GR uma unica vez sem duplicar ledger ou caixa', async () => {
    await seedOwnInvestorOperation('operation-gr', { localLoanId: 'loan-1' });
    await seedLoan();
    await db.doc('settings/caixa').set({ value: 400 });
    const repaid = { event: 'installment.investor_repaid', partnerId: 'partner-1', timestamp: paidEvent.timestamp, data: { proposalId: 'proposal-gr', installmentId: 'installment-1', amountCents: 11000 } };
    await runEvent('repaid-gr-1', repaid);
    await runEvent('repaid-gr-2', repaid);

    expect((await db.doc('settings/caixa').get()).data()?.value).toBe(510);
    expect((await db.collection('creditInvestorLedger').where('type', '==', 'INVESTOR_REPAID').get()).size).toBe(1);
    expect((await db.collection('cashMovement').get()).size).toBe(1);
  });
});
