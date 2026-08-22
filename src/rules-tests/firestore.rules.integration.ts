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

  it('aceita concessao somente com contrato, caixa, contador e movimento vinculados', async () => {
    const db = testEnvironment.authenticatedContext('admin-1').firestore();
    await assertSucceeds(runTransaction(db, async (tx) => {
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
    });

    const db = testEnvironment.authenticatedContext('admin-1').firestore();
    await assertFails(getDoc(doc(db, 'creditOperations', 'operation-1')));
    await assertFails(setDoc(doc(db, 'creditInvestorLedger', 'ledger-1'), { amount: 100 }));
  });
});
