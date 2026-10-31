import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const PROJECT_ID = 'demo-gr-solution-rules';

let testEnvironment: RulesTestEnvironment;

const validLoan = {
  customerId: 'customer-1',
  customerName: 'Cliente Teste',
  amount: 100,
  interestRate: 10,
  frequency: 'MENSAL',
  interestType: 'SIMPLES',
  startDate: '2026-01-01',
  status: 'ATIVO',
  installments: [{ number: 1, amount: 110, dueDate: '2026-02-01', status: 'PENDENTE' }],
  contractNumber: '2026001',
  version: 0,
  hasFinancialHistory: false,
};

beforeAll(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
});

afterAll(async () => {
  await testEnvironment.cleanup();
});

describe('firestore.rules', () => {
  it('registra edicao em trilha imutavel vinculada ao contrato', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'settings', 'accessControl'), { enforced: true });
      await setDoc(doc(db, 'authorizedUsers', 'admin-1'), { role: 'ADMIN' });
      await setDoc(doc(db, 'authorizedUsers', 'user-1'), { role: 'USER' });
      await setDoc(doc(db, 'loans', 'loan-audit'), validLoan);
    });
    const admin = testEnvironment.authenticatedContext('admin-1').firestore();
    const user = testEnvironment.authenticatedContext('user-1').firestore();
    const eventId = 'contract-edit-loan-audit-1';
    await assertSucceeds(runTransaction(admin, async (tx) => {
      const loanRef = doc(admin, 'loans', 'loan-audit');
      await tx.get(loanRef);
      tx.update(loanRef, {
        notes: 'Revisado', version: 1,
        lastOperationId: eventId, lastOperationType: 'CONTRACT_EDIT',
        lastOperationAt: serverTimestamp(), lastOperationByUid: 'admin-1',
      });
      tx.set(doc(admin, 'financialAuditEvents', eventId), {
        id: eventId, type: 'CONTRACT_EDIT', loanId: 'loan-audit',
        actorUid: 'admin-1', previousAmount: 100, newAmount: 100,
        recordedAt: serverTimestamp(),
      });
    }));
    await assertSucceeds(getDoc(doc(admin, 'financialAuditEvents', eventId)));
    await assertFails(getDoc(doc(user, 'financialAuditEvents', eventId)));
    await assertFails(updateDoc(doc(admin, 'financialAuditEvents', eventId), { reason: 'Alterado' }));
    await assertFails(deleteDoc(doc(admin, 'financialAuditEvents', eventId)));
  });

  it('exige evento permanente na conciliacao manual do caixa', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'settings', 'accessControl'), { enforced: true });
      await setDoc(doc(db, 'authorizedUsers', 'admin-1'), { role: 'ADMIN' });
      await setDoc(doc(db, 'settings', 'caixa'), { value: 100 });
    });
    const admin = testEnvironment.authenticatedContext('admin-1').firestore();
    const cashRef = doc(admin, 'settings', 'caixa');
    await assertFails(updateDoc(cashRef, {
      value: 90, reconciledByUid: 'admin-1', reconciledAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(runTransaction(admin, async (tx) => {
      await tx.get(cashRef);
      const eventId = 'cash-reconciliation-1';
      tx.set(cashRef, {
        value: 90, reconciledByUid: 'admin-1', reconciledAuditId: eventId,
        reconciledAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }, { merge: true });
      tx.set(doc(admin, 'financialAuditEvents', eventId), {
        id: eventId, type: 'CASH_RECONCILIATION', actorUid: 'admin-1',
        previousCash: 100, newCash: 90, recordedAt: serverTimestamp(),
      });
    }));
  });

  it('nao permite reduzir o maior atraso historico persistido', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'loans', 'loan-history'), {
        ...validLoan, maxHistoricalOverdueDays: 18,
      });
    });
    const db = testEnvironment.authenticatedContext('admin-1').firestore();
    const loanRef = doc(db, 'loans', 'loan-history');
    await assertFails(updateDoc(loanRef, {
      maxHistoricalOverdueDays: 7,
      version: 1,
      lastOperationId: 'contract-edit-loan-history-1',
      lastOperationType: 'CONTRACT_EDIT',
      lastOperationAt: serverTimestamp(),
      lastOperationByUid: 'admin-1',
    }));
    await assertSucceeds(updateDoc(loanRef, {
      maxHistoricalOverdueDays: 24,
      version: 1,
      lastOperationId: 'contract-edit-loan-history-2',
      lastOperationType: 'CONTRACT_EDIT',
      lastOperationAt: serverTimestamp(),
      lastOperationByUid: 'admin-1',
    }));
  });

  it('restringe auditoria de risco ao administrador e impede writes do navegador', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'settings', 'accessControl'), { enforced: true });
      await setDoc(doc(db, 'authorizedUsers', 'admin-1'), { role: 'ADMIN' });
      await setDoc(doc(db, 'authorizedUsers', 'user-1'), { role: 'USER' });
      await setDoc(doc(db, 'creditRiskDecisions', 'decision-1'), { action: 'NEW_CREDIT_GRANT' });
    });
    const admin = testEnvironment.authenticatedContext('admin-1').firestore();
    const user = testEnvironment.authenticatedContext('user-1').firestore();
    await assertSucceeds(getDoc(doc(admin, 'creditRiskDecisions', 'decision-1')));
    await assertFails(getDoc(doc(user, 'creditRiskDecisions', 'decision-1')));
    await assertFails(setDoc(doc(admin, 'creditRiskDecisions', 'decision-2'), { action: 'EXCEPTIONAL_CREDIT_RELEASE' }));
  });

  it('somente admin pode classificar clientes como dados sandbox', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'settings', 'accessControl'), { enforced: true });
      await setDoc(doc(db, 'authorizedUsers', 'admin-1'), { role: 'ADMIN' });
      await setDoc(doc(db, 'authorizedUsers', 'user-1'), { role: 'USER' });
      await setDoc(doc(db, 'clientes', 'customer-1'), { name: 'Fixture' });
    });
    const user = testEnvironment.authenticatedContext('user-1').firestore();
    const admin = testEnvironment.authenticatedContext('admin-1').firestore();
    await assertFails(updateDoc(doc(user, 'clientes', 'customer-1'), { environment: 'sandbox', testData: true }));
    await assertFails(setDoc(doc(user, 'clientes', 'customer-2'), { name: 'Fixture', environment: 'sandbox', testData: true }));
    await assertSucceeds(updateDoc(doc(admin, 'clientes', 'customer-1'), { environment: 'sandbox', testData: true }));
    await assertSucceeds(updateDoc(doc(user, 'clientes', 'customer-1'), { name: 'Fixture atualizada' }));
  });
  it('bloqueia leitura sem autenticacao', async () => {
    const db = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'loans', 'loan-1')));
  });

  it('bloqueia usuario nao autorizado quando o controle esta ativo', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'settings', 'accessControl'), { enforced: true });
      await setDoc(doc(db, 'authorizedUsers', 'admin-1'), { role: 'ADMIN' });
      await setDoc(doc(db, 'loans', 'loan-1'), validLoan);
    });

    const unauthorizedDb = testEnvironment.authenticatedContext('user-2').firestore();
    const adminDb = testEnvironment.authenticatedContext('admin-1').firestore();
    await assertFails(getDoc(doc(unauthorizedDb, 'loans', 'loan-1')));
    await assertSucceeds(getDoc(doc(adminDb, 'loans', 'loan-1')));
  });

  it('bloqueia concessao direta pelo cliente mesmo com movimento e caixa vinculados', async () => {
    const db = testEnvironment.authenticatedContext('admin-1').firestore();
    await assertFails(runTransaction(db, async (tx) => {
      const loanRef = doc(db, 'loans', 'loan-1');
      const movementRef = doc(db, 'cashMovement', 'loan-created-loan-1');
      tx.set(movementRef, {
        type: 'RETIRADA',
        amount: 100,
        value: 100,
        description: 'EMPRESTIMO: CLIENTE TESTE',
        date: '2026-01-01T12:00:00.000Z',
        loanId: loanRef.id,
        operationId: movementRef.id,
        createdByUid: 'admin-1',
        recordedAt: serverTimestamp(),
      });
      tx.set(loanRef, {
        ...validLoan,
        lastOperationId: movementRef.id,
        lastOperationType: 'LOAN_CREATED',
        lastOperationAt: serverTimestamp(),
        lastOperationByUid: 'admin-1',
      });
      tx.set(doc(db, 'settings', 'caixa'), {
        value: -100,
        lastMovementId: movementRef.id,
        updatedByUid: 'admin-1',
        updatedAt: serverTimestamp(),
      });
      tx.set(doc(db, 'settings', 'contractCounter'), {
        lastNumber: 2026001,
        lastContractNumber: '2026001',
        lastLoanId: loanRef.id,
        updatedByUid: 'admin-1',
        updatedAt: serverTimestamp(),
      });
    }));
  });

  it('permite excluir somente o contrato direto sem historico e recompoe o caixa na mesma transacao', async () => {
    const db = testEnvironment.authenticatedContext('admin-1').firestore();
    const loanRef = doc(db, 'loans', 'loan-unpaid');
    const movementRef = doc(db, 'cashMovement', 'loan-created-loan-unpaid');
    const cashRef = doc(db, 'settings', 'caixa');

    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const fixtureDb = context.firestore();
      await setDoc(doc(fixtureDb, 'cashMovement', movementRef.id), {
        type: 'RETIRADA', amount: 100, value: 100,
        description: 'EMPRESTIMO: CLIENTE TESTE', date: '2026-01-01T12:00:00.000Z',
        loanId: loanRef.id, operationId: movementRef.id, createdByUid: 'admin-1', recordedAt: serverTimestamp(),
      });
      await setDoc(doc(fixtureDb, 'loans', loanRef.id), {
        ...validLoan, contractNumber: '2026002',
        lastOperationId: movementRef.id, lastOperationType: 'LOAN_CREATED',
        lastOperationAt: serverTimestamp(), lastOperationByUid: 'admin-1',
      });
      await setDoc(doc(fixtureDb, 'settings', 'caixa'), {
        value: -100, lastMovementId: movementRef.id, updatedByUid: 'admin-1', updatedAt: serverTimestamp(),
      });
    });

    await assertSucceeds(runTransaction(db, async (tx) => {
      await tx.get(loanRef);
      await tx.get(movementRef);
      await tx.get(cashRef);
      tx.delete(movementRef);
      tx.delete(loanRef);
      tx.set(cashRef, {
        value: 0,
        lastMovementId: movementRef.id,
        lastOperationType: 'LOAN_DELETED',
        lastLoanId: loanRef.id,
        updatedByUid: 'admin-1',
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }));
  });

  it('permite excluir contrato cancelado imediatamente, sem recebimento, e recompoe o caixa', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'loans', 'loan-cancelled-unpaid'), {
        ...validLoan,
        contractNumber: '2026003',
        status: 'CANCELADO',
        version: 1,
        cancellationReason: 'Desistencia antes de qualquer recebimento',
        lastOperationId: 'cancellation-loan-cancelled-unpaid',
        lastOperationType: 'CANCELLATION',
      });
      await setDoc(doc(db, 'cashMovement', 'loan-created-loan-cancelled-unpaid'), {
        type: 'RETIRADA', amount: 100, value: 100,
        description: 'EMPRESTIMO: CLIENTE TESTE', date: '2026-01-01T12:00:00.000Z',
        loanId: 'loan-cancelled-unpaid', operationId: 'loan-created-loan-cancelled-unpaid',
        createdByUid: 'admin-1',
      });
      await setDoc(doc(db, 'settings', 'caixa'), { value: -100 });
    });

    const db = testEnvironment.authenticatedContext('admin-1').firestore();
    const loanRef = doc(db, 'loans', 'loan-cancelled-unpaid');
    const movementRef = doc(db, 'cashMovement', 'loan-created-loan-cancelled-unpaid');
    const cashRef = doc(db, 'settings', 'caixa');
    await assertSucceeds(runTransaction(db, async (tx) => {
      await tx.get(loanRef);
      await tx.get(movementRef);
      await tx.get(cashRef);
      tx.delete(movementRef);
      tx.delete(loanRef);
      tx.set(cashRef, {
        value: 0,
        lastMovementId: movementRef.id,
        lastOperationType: 'LOAN_DELETED',
        lastLoanId: loanRef.id,
        updatedByUid: 'admin-1',
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }));
  });

  it('bloqueia exclusao fisica quando o contrato possui historico financeiro', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'loans', 'loan-paid'), {
        ...validLoan,
        version: 1,
        hasFinancialHistory: true,
        lastOperationId: 'payment-loan-paid',
        lastOperationType: 'PAYMENT',
      });
      await setDoc(doc(db, 'cashMovement', 'loan-created-loan-paid'), {
        type: 'RETIRADA', amount: 100, loanId: 'loan-paid', operationId: 'loan-created-loan-paid',
      });
      await setDoc(doc(db, 'settings', 'caixa'), { value: -100 });
    });
    const db = testEnvironment.authenticatedContext('admin-1').firestore();
    await assertFails(deleteDoc(doc(db, 'loans', 'loan-paid')));
  });

  it('recusa alteracao financeira sem movimento correspondente', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'loans', 'loan-1'), validLoan);
    });
    const db = testEnvironment.authenticatedContext('admin-1').firestore();
    await assertFails(updateDoc(doc(db, 'loans', 'loan-1'), {
      version: 1,
      hasFinancialHistory: true,
      lastOperationId: 'payment-without-ledger',
      lastOperationType: 'PAYMENT',
      lastOperationAt: serverTimestamp(),
      lastOperationByUid: 'admin-1',
    }));
  });

  it('permite alterar o principal sem pagamentos e compensa o caixa com movimento auditavel', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'loans', 'loan-editable'), {
        ...validLoan,
        lastOperationId: 'loan-created-loan-editable',
        lastOperationType: 'LOAN_CREATED',
      });
      await setDoc(doc(db, 'cashMovement', 'loan-created-loan-editable'), {
        type: 'RETIRADA', amount: 100, value: 100,
        description: 'EMPRESTIMO: CLIENTE TESTE', date: '2026-01-01T12:00:00.000Z',
        loanId: 'loan-editable', operationId: 'loan-created-loan-editable', createdByUid: 'admin-1',
      });
      await setDoc(doc(db, 'settings', 'caixa'), { value: -100 });
    });

    const db = testEnvironment.authenticatedContext('admin-1').firestore();
    await assertSucceeds(runTransaction(db, async (tx) => {
      const loanRef = doc(db, 'loans', 'loan-editable');
      const adjustmentRef = doc(db, 'cashMovement', 'contract-edit-loan-editable-1');
      const cashRef = doc(db, 'settings', 'caixa');
      await tx.get(loanRef);
      await tx.get(cashRef);
      tx.set(adjustmentRef, {
        type: 'ENTRADA', amount: 40, value: 40,
        description: 'AJUSTE DE VALOR DO EMPRESTIMO: CLIENTE TESTE', date: '2026-01-02T12:00:00.000Z',
        loanId: loanRef.id, operationId: adjustmentRef.id, createdByUid: 'admin-1', recordedAt: serverTimestamp(),
      });
      tx.update(loanRef, {
        amount: 60,
        totalToReturn: 66,
        installmentValue: 66,
        installments: [{ number: 1, amount: 66, dueDate: '2026-02-01', status: 'PENDENTE' }],
        version: 1,
        lastOperationId: adjustmentRef.id,
        lastOperationType: 'CONTRACT_EDIT',
        lastOperationAt: serverTimestamp(),
        lastOperationByUid: 'admin-1',
      });
      tx.set(cashRef, {
        value: -60,
        lastMovementId: adjustmentRef.id,
        updatedByUid: 'admin-1',
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }));
  });

  it('bloqueia alterar o principal sem a compensacao correta no caixa', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'loans', 'loan-edit-without-ledger'), {
        ...validLoan,
        lastOperationId: 'loan-created-loan-edit-without-ledger',
        lastOperationType: 'LOAN_CREATED',
      });
    });
    const db = testEnvironment.authenticatedContext('admin-1').firestore();
    await assertFails(updateDoc(doc(db, 'loans', 'loan-edit-without-ledger'), {
      amount: 60,
      version: 1,
      lastOperationId: 'contract-edit-loan-edit-without-ledger-1',
      lastOperationType: 'CONTRACT_EDIT',
      lastOperationAt: serverTimestamp(),
      lastOperationByUid: 'admin-1',
    }));
  });

  it('aceita pagamento atomico em contrato legado sem versao', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const { version: _version, ...legacyLoan } = validLoan;
      await setDoc(doc(db, 'loans', 'loan-1'), legacyLoan);
      await setDoc(doc(db, 'settings', 'caixa'), { value: 562.5 });
      await setDoc(doc(db, 'settings', 'accessControl'), { enforced: true });
      await setDoc(doc(db, 'authorizedUsers', 'admin-1'), { role: 'ADMIN' });
    });

    const db = testEnvironment.authenticatedContext('admin-1').firestore();
    await assertSucceeds(runTransaction(db, async (tx) => {
      const loanRef = doc(db, 'loans', 'loan-1');
      const movementRef = doc(db, 'cashMovement', 'payment-loan-1');
      const cashRef = doc(db, 'settings', 'caixa');
      const feesRef = doc(db, 'settings', 'fees');
      await tx.get(loanRef);
      await tx.get(movementRef);
      await tx.get(feesRef);
      await tx.get(cashRef);

      tx.set(movementRef, {
        type: 'PAGAMENTO',
        amount: 520,
        value: 520,
        description: 'PAGAMENTO: CLIENTE TESTE',
        date: '2026-08-20T17:18:40.000Z',
        loanId: loanRef.id,
        operationId: movementRef.id,
        createdByUid: 'admin-1',
        recordedAt: serverTimestamp(),
      });
      tx.set(cashRef, {
        value: 1082.5,
        lastMovementId: movementRef.id,
        updatedByUid: 'admin-1',
        updatedAt: serverTimestamp(),
      }, { merge: true });
      tx.update(loanRef, {
        installments: [{
          number: 1,
          amount: 520,
          dueDate: '2026-08-29',
          status: 'PAGO',
          paidAmount: 520,
        }],
        installmentsCount: 1,
        installmentCount: 1,
        totalToReturn: 520,
        status: 'QUITADO',
        version: 1,
        hasFinancialHistory: true,
        lastOperationId: movementRef.id,
        lastOperationType: 'PAYMENT',
        lastOperationAt: serverTimestamp(),
        lastOperationByUid: 'admin-1',
      });
    }));
  });

  it('impede exclusao fisica de clientes e movimentos', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'clientes', 'customer-1'), { name: 'Cliente Teste' });
      await setDoc(doc(db, 'cashMovement', 'movement-1'), { type: 'APORTE', amount: 10 });
    });
    const db = testEnvironment.authenticatedContext('admin-1').firestore();
    await assertFails(deleteDoc(doc(db, 'clientes', 'customer-1')));
    await assertFails(deleteDoc(doc(db, 'cashMovement', 'movement-1')));
  });

  it('impede que o navegador crie um contrato bancarizado', async () => {
    const db = testEnvironment.authenticatedContext('admin-1').firestore();
    await assertFails(runTransaction(db, async (tx) => {
      const loanRef = doc(db, 'loans', 'loan-bancarized');
      const movementRef = doc(db, 'cashMovement', 'loan-created-bancarized');
      tx.set(movementRef, {
        type: 'RETIRADA',
        amount: 100,
        description: 'EMPRESTIMO BANCARIZADO: CLIENTE TESTE',
        date: '2026-01-01T12:00:00.000Z',
        loanId: loanRef.id,
        operationId: movementRef.id,
        createdByUid: 'admin-1',
        recordedAt: serverTimestamp(),
      });
      tx.set(loanRef, {
        ...validLoan,
        formalizationType: 'BANCARIZED',
        provider: 'CREDIGRUPO',
        lastOperationId: movementRef.id,
        lastOperationType: 'LOAN_CREATED',
        lastOperationAt: serverTimestamp(),
        lastOperationByUid: 'admin-1',
      });
    }));
  });

  it('impede que o navegador altere um contrato bancarizado existente', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'loans', 'loan-bancarized'), {
        ...validLoan,
        formalizationType: 'BANCARIZED',
        provider: 'CREDIGRUPO',
        funding: { source: 'GR', investorId: 'investor-1', investorName: 'GR Solutions' },
      });
    });

    const db = testEnvironment.authenticatedContext('admin-1').firestore();
    await assertFails(updateDoc(doc(db, 'loans', 'loan-bancarized'), {
      status: 'QUITADO',
      version: 1,
      lastOperationId: 'client-forged-operation',
      lastOperationType: 'PAYMENT',
      lastOperationAt: serverTimestamp(),
      lastOperationByUid: 'admin-1',
    }));
  });

  it('mantem as colecoes Credigrupo acessiveis somente pelo backend', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'creditOperations', 'operation-1'), { status: 'FUNDED' });
      await setDoc(doc(context.firestore(), 'creditInvestors', 'investor-1'), { active: true });
      await setDoc(doc(context.firestore(), 'creditProviderSettings', 'credigrupo'), { grInvestorConfigured: true });
    });

    const db = testEnvironment.authenticatedContext('admin-1').firestore();
    await assertFails(getDoc(doc(db, 'creditOperations', 'operation-1')));
    await assertFails(getDoc(doc(db, 'creditInvestors', 'investor-1')));
    await assertFails(getDoc(doc(db, 'creditProviderSettings', 'credigrupo')));
    await assertFails(setDoc(doc(db, 'creditInvestors', 'investor-2'), { active: true }));
    await assertFails(setDoc(doc(db, 'creditProviderSettings', 'credigrupo'), { grInvestorConfigured: false }));
    await assertFails(setDoc(doc(db, 'creditInvestorLedger', 'ledger-1'), { amount: 100 }));
  });

  it('isola extrato e vinculos de conferencia do caixa e de usuarios nao administradores', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'settings', 'accessControl'), { enforced: true });
      await setDoc(doc(db, 'authorizedUsers', 'admin-1'), { role: 'ADMIN' });
      await setDoc(doc(db, 'authorizedUsers', 'user-1'), { role: 'USER' });
      await setDoc(doc(db, 'settings', 'caixa'), { value: 123 });
      await setDoc(doc(db, 'cashMovement', 'payment-1'), {
        type: 'PAGAMENTO', amount: 50, description: 'PAGAMENTO: Cliente Teste', date: '2026-09-03T12:00:00.000Z',
      });
    });
    const admin = testEnvironment.authenticatedContext('admin-1').firestore();
    const user = testEnvironment.authenticatedContext('user-1').firestore();
    const statementRef = doc(admin, 'bankStatementImports', 'statement-1');
    const entryRef = doc(admin, 'bankStatementEntries', 'statement-1_00001');
    const batch = writeBatch(admin);
    batch.set(statementRef, {
      bank: 'C6 Bank', sha256: 'a'.repeat(64), periodStart: '2026-09-01', periodEnd: '2026-09-24',
      closingBalanceCents: 5000, incomeCents: 5000, expenseCents: 0, transactionCount: 1,
      status: 'ACTIVE', createdByUid: 'admin-1', createdAt: serverTimestamp(),
    });
    batch.set(entryRef, {
      statementId: 'statement-1', sequence: 1, transactionDate: '2026-09-03',
      accountingDate: '2026-09-03', direction: 'IN', type: 'PIX', description: 'Pix recebido de Cliente Teste', amountCents: 5000,
    });
    batch.set(doc(admin, 'bankStatementAuditEvents', 'import-1'), {
      statementId: statementRef.id, action: 'IMPORTED', actorUid: 'admin-1', createdAt: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
    await assertFails(getDoc(doc(user, 'bankStatementEntries', entryRef.id)));
    await assertFails(setDoc(doc(user, 'bankStatementImports', 'forged'), { status: 'ACTIVE' }));
    await assertSucceeds(runTransaction(admin, async (tx) => {
      tx.set(doc(admin, 'bankStatementLinks', entryRef.id), {
        statementId: statementRef.id, entryId: entryRef.id, movementId: 'payment-1',
        actorUid: 'admin-1', matchBasis: 'NAME_AMOUNT_DIRECTION', matchMode: 'AUTO', expectedPayer: 'Cliente Teste',
        bankPayer: 'Cliente Teste', exceptionNote: '', createdAt: serverTimestamp(),
      });
      tx.set(doc(admin, 'bankMovementLinks', 'payment-1'), {
        statementId: statementRef.id, entryId: entryRef.id, movementId: 'payment-1',
        actorUid: 'admin-1', matchBasis: 'NAME_AMOUNT_DIRECTION', matchMode: 'AUTO', expectedPayer: 'Cliente Teste',
        bankPayer: 'Cliente Teste', exceptionNote: '', createdAt: serverTimestamp(),
      });
      tx.set(doc(admin, 'bankStatementAuditEvents', 'link-1'), {
        statementId: statementRef.id, action: 'AUTO_LINKED', entryId: entryRef.id,
        movementId: 'payment-1', actorUid: 'admin-1', createdAt: serverTimestamp(),
      });
    }));
    await assertFails(updateDoc(entryRef, { amountCents: 6000 }));
    const cash = await getDoc(doc(admin, 'settings', 'caixa'));
    const movement = await getDoc(doc(admin, 'cashMovement', 'payment-1'));
    if (cash.data()?.value !== 123 || movement.data()?.amount !== 50) throw new Error('CONFERENCIA_ALTEROU_FINANCEIRO');
  });

  it('exige observacao na vinculacao manual e permite justificar entrada bancaria sem alterar o caixa', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'settings', 'accessControl'), { enforced: true });
      await setDoc(doc(db, 'authorizedUsers', 'admin-1'), { role: 'ADMIN' });
      await setDoc(doc(db, 'authorizedUsers', 'user-1'), { role: 'USER' });
      await setDoc(doc(db, 'settings', 'caixa'), { value: 1433.89 });
      await setDoc(doc(db, 'cashMovement', 'payment-1'), {
        type: 'PAGAMENTO', amount: 50, description: 'PAGAMENTO: Cliente Teste', date: '2026-09-03',
      });
      await setDoc(doc(db, 'bankStatementImports', 'statement-1'), { status: 'ACTIVE' });
      await setDoc(doc(db, 'bankStatementEntries', 'bank-only'), {
        statementId: 'statement-1', direction: 'IN', amountCents: 1000000,
      });
      await setDoc(doc(db, 'bankStatementEntries', 'matchable'), {
        statementId: 'statement-1', direction: 'IN', amountCents: 5000,
      });
    });
    const admin = testEnvironment.authenticatedContext('admin-1').firestore();
    const user = testEnvironment.authenticatedContext('user-1').firestore();
    const bankOnlyReview = {
      statementId: 'statement-1', entryId: 'bank-only', note: 'Pagamento de outro servico, fora da GR',
      actorUid: 'admin-1', createdAt: serverTimestamp(),
    };
    await assertFails(setDoc(doc(user, 'bankEntryJustifications', 'forged'), bankOnlyReview));
    await assertFails(setDoc(doc(admin, 'bankEntryJustifications', 'too-short'), { ...bankOnlyReview, note: 'curta' }));
    await assertSucceeds(setDoc(doc(admin, 'bankEntryJustifications', 'review-1'), bankOnlyReview));
    await assertFails(updateDoc(doc(admin, 'bankEntryJustifications', 'review-1'), { note: 'Mudanca' }));

    const manualLink = (note: string) => ({
      statementId: 'statement-1', entryId: 'matchable', movementId: 'payment-1', actorUid: 'admin-1',
      matchBasis: 'NAME_AMOUNT_DIRECTION', expectedPayer: 'Cliente Teste', bankPayer: 'Cliente Teste',
      exceptionNote: note, createdAt: serverTimestamp(),
    });
    const shortNoteBatch = writeBatch(admin);
    shortNoteBatch.set(doc(admin, 'bankStatementLinks', 'matchable'), manualLink(''));
    shortNoteBatch.set(doc(admin, 'bankMovementLinks', 'payment-1'), manualLink(''));
    await assertFails(shortNoteBatch.commit());
    const validBatch = writeBatch(admin);
    validBatch.set(doc(admin, 'bankStatementLinks', 'matchable'), manualLink('Pagamento identificado manualmente'));
    validBatch.set(doc(admin, 'bankMovementLinks', 'payment-1'), manualLink('Pagamento identificado manualmente'));
    await assertSucceeds(validBatch.commit());
    const cash = await getDoc(doc(admin, 'settings', 'caixa'));
    const movement = await getDoc(doc(admin, 'cashMovement', 'payment-1'));
    if (cash.data()?.value !== 1433.89 || movement.data()?.amount !== 50) throw new Error('CONFERENCIA_ALTEROU_FINANCEIRO');
  });
});
