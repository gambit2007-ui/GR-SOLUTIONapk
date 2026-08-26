import { getApps, deleteApp } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CredigrupoWebhookEvent } from '../../api/_lib/credit-providers/credigrupo/webhook';

const PROJECT_ID = 'demo-gr-solution-credigrupo';
let db: Firestore;
let processStoredCredigrupoEvent: typeof import('../../api/_lib/credit-providers/credigrupo/webhookProcessor').processStoredCredigrupoEvent;
let registerCredigrupoWebhookEvent: typeof import('../../api/_lib/credit-providers/credigrupo/webhookProcessor').registerCredigrupoWebhookEvent;

beforeAll(async () => {
  await Promise.all(getApps().map((app) => deleteApp(app)));
  process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
  const firebase = await import('../../api/_lib/firebaseAdmin');
  const processor = await import('../../api/_lib/credit-providers/credigrupo/webhookProcessor');
  db = firebase.adminDb;
  processStoredCredigrupoEvent = processor.processStoredCredigrupoEvent;
  registerCredigrupoWebhookEvent = processor.registerCredigrupoWebhookEvent;
});

beforeEach(async () => {
  const collections = await db.listCollections();
  await Promise.all(collections.map(async (collection) => {
    const documents = await collection.listDocuments();
    await Promise.all(documents.map((document) => document.delete()));
  }));
});

afterAll(async () => {
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
    paidAt: '2026-08-25T12:00:00.000Z',
  },
};

const seedOperation = async (id = 'operation-1', overrides: Record<string, unknown> = {}) => {
  await db.doc(`creditOperations/${id}`).set({
    formalizationType: 'BANCARIZED', provider: 'CREDIGRUPO', proposalId: 'proposal-1',
    customerId: 'customer-1', customerName: 'Cliente', customerPhone: '21999999999',
    borrowerId: 'borrower-1', investorId: 'investor-1', investorName: 'Investidor',
    fundingSource: 'EXTERNAL', amountCents: 10000, installments: 1, interestRate: 10,
    firstPaymentDate: '2026-09-25', frequency: 'monthly', interestType: 'simple',
    simulation: {
      netAmount: 10000, grossAmount: 11000, totalAmount: 11000, totalInterest: 1000, totalIof: 0, totalFee: 0,
      installments: [{ installmentNumber: 1, amount: 11000, dueDate: '2026-09-25', interest: 1000, principal: 10000, outstandingBalance: 0 }],
    },
    simulationExternalId: 'simulation-1', status: 'AWAITING_SIGNATURES', createdByUid: 'admin-1',
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
  it('registra entrega na inbox e ignora evento ja processado', async () => {
    const first = await registerCredigrupoWebhookEvent('incoming-event', paidEvent);
    expect(first.shouldProcess).toBe(true);
    expect((await first.eventRef.get()).data()).toMatchObject({
      eventId: 'incoming-event',
      eventType: 'installment.paid',
      status: 'RECEIVED',
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
    await db.doc('clientes/customer-1').set({ name: 'Cliente' });
    const approved = { event: 'kyc.approved', partnerId: 'partner-1', timestamp: paidEvent.timestamp, data: { userId: 'borrower-1', role: 'borrower', reason: null } };
    const rejected = { event: 'kyc.rejected', partnerId: 'partner-1', timestamp: paidEvent.timestamp, data: { userId: 'borrower-1', role: 'borrower', reason: 'Documento ilegivel' } };
    await runEvent('kyc-approved', approved);
    expect((await db.doc('creditBorrowers/link-1').get()).data()?.kycStatus).toBe('approved');
    await runEvent('kyc-rejected', rejected);
    expect((await db.doc('creditBorrowers/link-1').get()).data()?.kycStatus).toBe('rejected');
  });

  it('processa CCB, assinatura e cancelamento no estado externo da operacao', async () => {
    await seedOperation();
    await runEvent('ccb-ready', { event: 'ccb_ready_for_signature', partnerId: 'partner-1', timestamp: paidEvent.timestamp, data: { proposalId: 'proposal-1', borrowerSignUrl: 'https://app.zapsign.com.br/a', investorSignUrl: 'https://app.zapsign.com.br/b' } });
    expect((await db.doc('creditOperations/operation-1').get()).data()?.status).toBe('AWAITING_SIGNATURES');
    await runEvent('loan-signed', { event: 'loan.signed', partnerId: 'partner-1', timestamp: paidEvent.timestamp, data: { proposalId: 'proposal-1', requestId: 'request-1', signedAt: paidEvent.timestamp } });
    expect((await db.doc('creditOperations/operation-1').get()).data()?.status).toBe('SIGNED');
    await runEvent('loan-cancelled', { event: 'loan.cancelled', partnerId: 'partner-1', timestamp: paidEvent.timestamp, data: { proposalId: 'proposal-1', requestId: 'request-1', cancelledAt: paidEvent.timestamp } });
    expect((await db.doc('creditOperations/operation-1').get()).data()?.status).toBe('CANCELLED');
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
    expect(loans.size).toBe(1);
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
});
