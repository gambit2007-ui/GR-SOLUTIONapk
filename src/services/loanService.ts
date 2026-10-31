import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { Installment, Loan, LoanDraft, LoanType, MovementType } from '../types';
import type {
  CreatedLoanResult,
  LoanPaymentRequest,
  LoanPaymentResult,
  LoanPaymentReversalRequest,
  LoanPaymentReversalResult,
} from '../types';
import { appendCashMovementInTransaction, MovementActor, readCashBalanceInTransaction } from './cashService';
import { sanitizeFirestorePayload } from '../utils/firestoreSanitizer';
import { parseLoan, parseMovementType } from '../utils/domainParsers';
import { applyLoanPaymentToCurrentLoan, reverseLatestInstallmentPayment } from '../utils/financialEngine';
import { parseFeeSettings } from './settingsService';
import { normalizeLoanStatus } from '../utils/loanCompat';
import { createDirectLoanWithRisk, type CreditRiskDecisionInput } from './creditRiskService';
import { nextMaxHistoricalOverdueDays } from '../utils/creditRisk';
import { appendFinancialAuditEventInTransaction } from './financialAuditEventService';

export interface LoanMovementPayload {
  type: MovementType;
  amount: number;
  description: string;
  actor?: MovementActor;
  operationId?: string;
  expectedVersion?: number;
}

const round2 = (value: number): number => Number((Number.isFinite(value) ? value : 0).toFixed(2));

const hasLoanFinancialHistory = (loan: Loan): boolean => (
  loan.hasFinancialHistory === true ||
  Number(loan.paidAmount || 0) > 0 ||
  (Array.isArray(loan.fiscalPaymentEntries) && loan.fiscalPaymentEntries.length > 0) ||
  (Array.isArray(loan.renewalHistory) && loan.renewalHistory.length > 0) ||
  Number(loan.renewCount || 0) > 0 ||
  loan.installments.some((installment) => (
    Number(installment.paidAmount || installment.partialPaid || 0) > 0 ||
    Boolean(installment.paymentBreakdown) ||
    (Array.isArray(installment.paymentEntries) && installment.paymentEntries.length > 0)
  ))
);

type LoanOperationType = NonNullable<Loan['lastOperationType']>;

const buildLoanOperationAudit = (
  operationId: string,
  operationType: LoanOperationType,
  actor?: MovementActor,
) => sanitizeFirestorePayload({
  lastOperationId: operationId,
  lastOperationType: operationType,
  lastOperationAt: serverTimestamp(),
  lastOperationByUid: actor?.uid || undefined,
  lastOperationByEmail: actor?.email?.toLowerCase() || undefined,
  lastOperationByName: actor?.displayName || undefined,
});

const toLoanType = (value: unknown): LoanType => {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'PRICE' ? 'PRICE' : 'SIMPLE';
};

const toInstallmentAmount = (installment: Installment, fallback = 0): number => {
  const value = Number(installment.amount ?? installment.value ?? fallback);
  return Number.isFinite(value) ? round2(value) : round2(fallback);
};

const calculatePricePayment = (principal: number, rate: number, installments: number): number => {
  if (installments <= 0) return 0;
  if (rate <= 0) return round2(principal / installments);
  const factor = Math.pow(1 + rate, installments);
  if (!Number.isFinite(factor) || factor <= 1) return round2(principal / installments);
  return round2(principal * ((rate * factor) / (factor - 1)));
};

const enrichPriceInstallments = (loanDraft: LoanDraft): LoanDraft => {
  if (toLoanType(loanDraft.interestType) !== 'PRICE') {
    return loanDraft;
  }

  const installments = Array.isArray(loanDraft.installments)
    ? loanDraft.installments.map((installment) => ({ ...installment }))
    : [];
  if (installments.length === 0) {
    return loanDraft;
  }

  const principalTotal = Math.max(round2(Number(loanDraft.amount || 0)), 0);
  if (principalTotal <= 0) {
    return loanDraft;
  }

  const rate = Math.max(Number(loanDraft.interestRate || 0) / 100, 0);
  const fallbackInstallmentAmount = calculatePricePayment(principalTotal, rate, installments.length);

  let saldoPrincipal = principalTotal;
  const lastIndex = installments.length - 1;

  const enrichedInstallments = installments.map((installment, index) => {
    const baseAmount = toInstallmentAmount(installment, fallbackInstallmentAmount);
    const hasExpectedValues =
      Number.isFinite(Number(installment.expectedPrincipal)) &&
      Number.isFinite(Number(installment.expectedInterest));

    if (hasExpectedValues) {
      const expectedPrincipal = Math.max(round2(Number(installment.expectedPrincipal || 0)), 0);
      const expectedInterest = Math.max(round2(Number(installment.expectedInterest || 0)), 0);
      saldoPrincipal = Math.max(round2(saldoPrincipal - expectedPrincipal), 0);
      return {
        ...installment,
        expectedPrincipal,
        expectedInterest,
      };
    }

    let expectedInterest = rate > 0 ? round2(saldoPrincipal * rate) : 0;
    let expectedPrincipal = round2(baseAmount - expectedInterest);

    if (index === lastIndex) {
      expectedPrincipal = round2(saldoPrincipal);
      expectedInterest = round2(Math.max(baseAmount - expectedPrincipal, 0));
    } else {
      expectedPrincipal = round2(Math.max(expectedPrincipal, 0));
      if (expectedPrincipal > saldoPrincipal) {
        expectedPrincipal = round2(saldoPrincipal);
        expectedInterest = round2(Math.max(baseAmount - expectedPrincipal, 0));
      }
    }

    saldoPrincipal = Math.max(round2(saldoPrincipal - expectedPrincipal), 0);

    return {
      ...installment,
      expectedPrincipal,
      expectedInterest,
    };
  });

  return {
    ...loanDraft,
    installments: enrichedInstallments,
  };
};

export const createLoan = async (
  loanDraft: LoanDraft,
  _actor?: MovementActor,
  decision?: CreditRiskDecisionInput,
  requestId: string = crypto.randomUUID(),
): Promise<CreatedLoanResult> => {
  const normalizedLoanDraft = enrichPriceInstallments(loanDraft);
  return createDirectLoanWithRisk(normalizedLoanDraft, requestId, decision);
};

export const updateLoan = async (loanId: string, payload: Partial<Loan>, actor?: MovementActor) => {
  await runTransaction(db, async (tx) => {
    const loanRef = doc(db, 'loans', loanId);
    const currentSnapshot = await tx.get(loanRef);
    if (!currentSnapshot.exists()) throw new Error('CONTRATO_NAO_ENCONTRADO');
    const currentLoan = parseLoan(currentSnapshot.id, currentSnapshot.data());
    const currentStatus = normalizeLoanStatus(currentLoan.status);
    const requestedStatus = payload.status === undefined ? currentStatus : normalizeLoanStatus(payload.status);
    if (currentStatus === 'CANCELLED' && requestedStatus !== 'CANCELLED') {
      throw new Error('CONTRATO_CANCELADO_NAO_PODE_SER_REATIVADO');
    }
    if (currentStatus !== 'CANCELLED' && requestedStatus === 'CANCELLED') {
      throw new Error('USE_CANCELAMENTO_AUDITAVEL');
    }
    const hasFinancialHistory = hasLoanFinancialHistory(currentLoan);
    if (hasFinancialHistory && payload.installments !== undefined) {
      throw new Error('CRONOGRAMA_COM_PAGAMENTOS_IMUTAVEL');
    }
    const currentAmount = round2(Number(currentSnapshot.data().amount || 0));
    const requestedAmount = payload.amount === undefined ? currentAmount : round2(Number(payload.amount || 0));
    const principalChanged = requestedAmount !== currentAmount;
    if (principalChanged && hasFinancialHistory) throw new Error('VALOR_PRINCIPAL_COM_HISTORICO_IMUTAVEL');
    if (principalChanged && currentStatus !== 'ACTIVE') throw new Error('VALOR_PRINCIPAL_APENAS_CONTRATO_ATIVO');
    if (principalChanged && requestedAmount <= 0) throw new Error('VALOR_PRINCIPAL_INVALIDO');
    const currentVersion = Math.max(0, Math.trunc(Number(currentSnapshot.data().version || 0)));
    const operationId = `contract-edit-${loanId}-${Date.now()}`;
    // The editor calculates a complete loan preview. Preserve identity, funding
    // and historical fields from the stored contract, especially for legacy
    // loans which do not have the newer funding metadata yet.
    const {
      amount: _amount,
      customerId: _customerId,
      customerName: _customerName,
      contractNumber: _contractNumber,
      createdAt: _createdAt,
      formalizationType: _formalizationType,
      provider: _provider,
      fundingSource: _fundingSource,
      investorInternalId: _investorInternalId,
      funding: _funding,
      credigrupo: _credigrupo,
      paidAmount: _paidAmount,
      maxHistoricalOverdueDays: _maxHistoricalOverdueDays,
      hasFinancialHistory: _hasFinancialHistory,
      fiscalPaymentEntries: _fiscalPaymentEntries,
      renewalHistory: _renewalHistory,
      renewCount: _renewCount,
      lastRenewAt: _lastRenewAt,
      version: _version,
      updatedAt: _updatedAt,
      lastOperationId: _lastOperationId,
      lastOperationType: _lastOperationType,
      lastOperationAt: _lastOperationAt,
      lastOperationByUid: _lastOperationByUid,
      lastOperationByEmail: _lastOperationByEmail,
      lastOperationByName: _lastOperationByName,
      ...editablePayload
    } = payload;
    if (principalChanged) {
      const originalMovementId = `loan-created-${loanId}`;
      const originalMovementSnapshot = await tx.get(doc(db, 'cashMovement', originalMovementId));
      const originalMovement = originalMovementSnapshot.data();
      const isOriginalWithdrawal = originalMovementSnapshot.exists() &&
        String(originalMovement?.loanId || '') === loanId &&
        String(originalMovement?.operationId || '') === originalMovementId &&
        String(originalMovement?.type || '').toUpperCase() === 'RETIRADA' &&
        round2(Number(originalMovement?.amount || originalMovement?.value || 0)) === currentAmount;
      if (!isOriginalWithdrawal) throw new Error('SAIDA_ORIGINAL_DO_EMPRESTIMO_NAO_ENCONTRADA');

      const adjustmentAmount = round2(Math.abs(requestedAmount - currentAmount));
      const adjustmentType: MovementType = requestedAmount < currentAmount ? 'ENTRADA' : 'RETIRADA';
      const currentCashBalance = await readCashBalanceInTransaction(tx);
      await appendCashMovementInTransaction(tx, {
        type: adjustmentType,
        amount: adjustmentAmount,
        description: `AJUSTE DE VALOR DO EMPRESTIMO: ${currentLoan.customerName}`,
        loanId,
        operationId,
        actor,
      }, { currentCashBalance, movementId: operationId });
    }
    tx.update(loanRef, sanitizeFirestorePayload({
      ...editablePayload,
      amount: requestedAmount,
      maxHistoricalOverdueDays: nextMaxHistoricalOverdueDays(
        currentLoan, { ...currentLoan, ...editablePayload, amount: requestedAmount }, new Date(),
      ),
      version: currentVersion + 1,
      updatedAt: serverTimestamp(),
      ...buildLoanOperationAudit(operationId, 'CONTRACT_EDIT', actor),
    }));
    appendFinancialAuditEventInTransaction(tx, {
      id: operationId,
      type: 'CONTRACT_EDIT',
      loanId,
      previousAmount: currentAmount,
      newAmount: requestedAmount,
    }, actor);
  });
};

export const cancelLoan = async (
  loanId: string,
  actor?: MovementActor,
  reason = 'Cancelado pelo usuario',
): Promise<void> => {
  const cancellationReason = String(reason || '').trim();
  if (!cancellationReason) throw new Error('MOTIVO_CANCELAMENTO_OBRIGATORIO');

  await runTransaction(db, async (tx) => {
    const loanRef = doc(db, 'loans', loanId);
    const loanSnapshot = await tx.get(loanRef);
    if (!loanSnapshot.exists()) throw new Error('CONTRATO_NAO_ENCONTRADO');
    const currentLoan = parseLoan(loanSnapshot.id, loanSnapshot.data());
    const currentStatus = normalizeLoanStatus(currentLoan.status);
    if (currentStatus === 'CANCELLED') return;
    if (currentStatus === 'COMPLETED') throw new Error('CONTRATO_QUITADO_NAO_PODE_SER_CANCELADO');

    const operationId = `cancellation-${loanId}-${Date.now()}`;
    tx.update(loanRef, sanitizeFirestorePayload({
      status: 'CANCELADO',
      maxHistoricalOverdueDays: nextMaxHistoricalOverdueDays(
        currentLoan, { ...currentLoan, status: 'CANCELADO' }, new Date(),
      ),
      cancellationReason,
      canceledAt: serverTimestamp(),
      canceledByUid: actor?.uid || undefined,
      canceledByEmail: actor?.email?.toLowerCase() || undefined,
      canceledByName: actor?.displayName || undefined,
      version: Math.max(0, Math.trunc(Number(currentLoan.version || 0))) + 1,
      updatedAt: serverTimestamp(),
      ...buildLoanOperationAudit(operationId, 'CANCELLATION', actor),
    }));
    appendFinancialAuditEventInTransaction(tx, {
      id: operationId,
      type: 'CANCELLATION',
      loanId,
      previousAmount: round2(Number(currentLoan.amount || 0)),
      reason: cancellationReason,
    }, actor);
  });
};

/**
 * Removes only a just-created direct loan which has no financial history.
 * The loan and its deterministic original withdrawal are deleted together,
 * while the cash balance is restored in the same Firestore transaction.
 */
export const deleteUnpaidLoan = async (loanId: string, actor?: MovementActor): Promise<void> => {
  const safeLoanId = String(loanId || '').trim();
  if (!safeLoanId) throw new Error('CONTRATO_NAO_ENCONTRADO');
  const originalMovementId = `loan-created-${safeLoanId}`;
  const linkedMovementsSnapshot = await getDocs(
    query(collection(db, 'cashMovement'), where('loanId', '==', safeLoanId)),
  );

  await runTransaction(db, async (tx) => {
    const loanRef = doc(db, 'loans', safeLoanId);
    const originalMovementRef = doc(db, 'cashMovement', originalMovementId);
    const [loanSnapshot, originalMovementSnapshot, cashBalance] = await Promise.all([
      tx.get(loanRef),
      tx.get(originalMovementRef),
      readCashBalanceInTransaction(tx),
    ]);

    if (!loanSnapshot.exists()) throw new Error('CONTRATO_NAO_ENCONTRADO');
    const loan = parseLoan(loanSnapshot.id, loanSnapshot.data());
    if (loan.formalizationType === 'BANCARIZED' || loan.provider === 'CREDIGRUPO') {
      throw new Error('CONTRATO_BANCARIZADO_NAO_PODE_SER_EXCLUIDO');
    }
    if (hasLoanFinancialHistory(loan)) {
      throw new Error('CONTRATO_POSSUI_HISTORICO_FINANCEIRO');
    }
    if (Number(nextMaxHistoricalOverdueDays(loan, loan, new Date()) || 0) > 0) {
      throw new Error('CONTRATO_POSSUI_HISTORICO_DE_ATRASO');
    }
    const normalizedStatus = normalizeLoanStatus(loan.status);
    const isPristineActiveLoan =
      normalizedStatus === 'ACTIVE' &&
      Number(loan.version || 0) === 0 &&
      loan.lastOperationType === 'LOAN_CREATED' &&
      loan.lastOperationId === originalMovementId;
    const isImmediatelyCancelledLoan =
      normalizedStatus === 'CANCELLED' &&
      Number(loan.version || 0) === 1 &&
      loan.lastOperationType === 'CANCELLATION' &&
      Boolean(String(loan.cancellationReason || '').trim());
    if (!isPristineActiveLoan && !isImmediatelyCancelledLoan) {
      throw new Error('CONTRATO_NAO_ELEGIVEL_PARA_EXCLUSAO_SEGURA');
    }
    if (!originalMovementSnapshot.exists()) throw new Error('MOVIMENTO_ORIGINAL_NAO_ENCONTRADO');
    const originalMovement = parseMovementType(originalMovementSnapshot.data().type);
    const originalAmount = round2(Number(originalMovementSnapshot.data().amount || originalMovementSnapshot.data().value || 0));
    if (
      originalMovement !== 'RETIRADA' ||
      originalAmount <= 0 ||
      String(originalMovementSnapshot.data().loanId || '') !== safeLoanId ||
      String(originalMovementSnapshot.data().operationId || '') !== originalMovementId
    ) {
      throw new Error('MOVIMENTO_ORIGINAL_INVALIDO');
    }
    if (
      linkedMovementsSnapshot.size !== 1 ||
      linkedMovementsSnapshot.docs[0]?.id !== originalMovementId
    ) {
      throw new Error('CONTRATO_POSSUI_HISTORICO_FINANCEIRO');
    }

    tx.delete(originalMovementRef);
    tx.delete(loanRef);
    tx.set(doc(db, 'settings', 'caixa'), {
      value: round2(cashBalance + originalAmount),
      lastMovementId: originalMovementId,
      lastOperationType: 'LOAN_DELETED',
      lastLoanId: safeLoanId,
      updatedByUid: actor?.uid || undefined,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    appendFinancialAuditEventInTransaction(tx, {
      id: `loan-deleted-${safeLoanId}-${Date.now()}`,
      type: 'LOAN_DELETION',
      loanId: safeLoanId,
      previousAmount: originalAmount,
      previousCash: cashBalance,
      newCash: round2(cashBalance + originalAmount),
      reason: normalizedStatus === 'CANCELLED' ? loan.cancellationReason : 'Desistencia sem recebimentos',
    }, actor);
  });
};

export const updateLoanAndAddMovement = async (
  loanId: string,
  payload: Partial<Loan>,
  movement: LoanMovementPayload,
) => {
  const movementType = parseMovementType(movement.type);
  const operationId = movement.operationId ? normalizeOperationId(movement.operationId) : undefined;

  await runTransaction(db, async (tx) => {
    const loanRef = doc(db, 'loans', loanId);
    const movementRef = operationId ? doc(db, 'cashMovement', operationId) : null;
    if (movementRef) {
      const existingMovement = await tx.get(movementRef);
      if (existingMovement.exists()) {
        if (String(existingMovement.data().loanId || '') !== loanId) throw new Error('OPERACAO_ID_CONFLITANTE');
        return;
      }
    }
    const loanSnap = await tx.get(loanRef);
    if (!loanSnap.exists()) throw new Error('CONTRATO_NAO_ENCONTRADO');
    const currentLoan = parseLoan(loanSnap.id, loanSnap.data());
    const currentVersion = Math.max(0, Math.trunc(Number(loanSnap.data().version || 0)));
    if (
      Number.isInteger(movement.expectedVersion) &&
      Number(movement.expectedVersion) !== currentVersion
    ) {
      throw new Error('CONTRATO_ATUALIZADO_POR_OUTRA_OPERACAO');
    }
    const saldoAtual = await readCashBalanceInTransaction(tx);

    await appendCashMovementInTransaction(tx, {
      type: movementType,
      amount: movement.amount,
      description: movement.description,
      loanId,
      operationId,
      actor: movement.actor,
    }, { currentCashBalance: saldoAtual, movementId: operationId });

    tx.update(loanRef, sanitizeFirestorePayload({
      ...payload,
      maxHistoricalOverdueDays: nextMaxHistoricalOverdueDays(
        currentLoan, { ...currentLoan, ...payload }, new Date(),
      ),
      version: currentVersion + 1,
      updatedAt: serverTimestamp(),
      ...buildLoanOperationAudit(
        operationId || `loan-operation-${loanId}-${Date.now()}`,
        movementType === 'PAGAMENTO' ? 'INTEREST_RENEWAL' : 'PAYMENT_REVERSAL',
        movement.actor,
      ),
      hasFinancialHistory: true,
    }));
  });
};

const normalizeOperationId = (value: string): string => {
  const operationId = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(operationId)) {
    throw new Error('OPERACAO_INVALIDA');
  }
  return operationId;
};

export const applyLoanPayment = async (
  loanId: string,
  request: LoanPaymentRequest,
  actor?: MovementActor,
): Promise<LoanPaymentResult> => {
  const operationId = normalizeOperationId(request.operationId);

  return runTransaction(db, async (tx) => {
    const loanRef = doc(db, 'loans', loanId);
    const movementRef = doc(db, 'cashMovement', operationId);
    const feeSettingsRef = doc(db, 'settings', 'fees');
    const existingMovement = await tx.get(movementRef);

    if (existingMovement.exists()) {
      const existing = existingMovement.data();
      if (String(existing.loanId || '') !== loanId || String(existing.operationId || '') !== operationId) {
        throw new Error('OPERACAO_ID_CONFLITANTE');
      }
      return {
        operationId,
        appliedAmount: round2(Number(existing.amount || existing.value || 0)),
        unappliedAmount: 0,
        discountApplied: round2(Number(existing.discountApplied || 0)),
        duplicate: true,
      };
    }

    const loanSnap = await tx.get(loanRef);
    if (!loanSnap.exists()) throw new Error('CONTRATO_NAO_ENCONTRADO');
    const feeSettingsSnap = await tx.get(feeSettingsRef);
    const saldoAtual = await readCashBalanceInTransaction(tx);
    const currentLoan = parseLoan(loanSnap.id, loanSnap.data());
    if (currentLoan.formalizationType === 'BANCARIZED' || currentLoan.provider === 'CREDIGRUPO') {
      throw new Error('PAGAMENTO_MANUAL_NAO_PERMITIDO_PARA_CONTRATO_BANCARIZADO');
    }
    const feeSettings = feeSettingsSnap.exists() ? parseFeeSettings(feeSettingsSnap.data()) : parseFeeSettings({});
    const processedAt = new Date().toISOString();
    const output = applyLoanPaymentToCurrentLoan(currentLoan, {
      ...request,
      operationId,
      processedAt,
    }, feeSettings.dailyLateFeeRate);
    const paymentLabel = output.discountApplied > 0 && request.applyMode !== 'EARLY_SETTLEMENT'
      ? `PAGAMENTO COM DESCONTO: ${currentLoan.customerName}`
      : request.applyMode === 'EARLY_SETTLEMENT'
      ? `QUITACAO ANTECIPADA: ${currentLoan.customerName}`
      : request.applyMode === 'TOTAL_BALANCE'
        ? `PAGAMENTO (ABATIMENTO SALDO): ${currentLoan.customerName}`
        : request.applyMode === 'REDISTRIBUTE_BALANCE'
          ? `PAGAMENTO (ABATE + REDIVISAO): ${currentLoan.customerName}`
          : `PAGAMENTO (ABATIMENTO PARCELAS): ${currentLoan.customerName}`;

    await appendCashMovementInTransaction(tx, {
      type: 'PAGAMENTO',
      amount: output.appliedAmount,
      description: paymentLabel,
      loanId,
      operationId,
      discountApplied: output.discountApplied,
      actor,
    }, { currentCashBalance: saldoAtual, movementId: operationId });

    tx.update(loanRef, sanitizeFirestorePayload({
      installments: output.loan.installments,
      installmentsCount: output.loan.installmentsCount,
      installmentCount: output.loan.installmentCount,
      totalToReturn: output.loan.totalToReturn,
      status: output.loan.status,
      maxHistoricalOverdueDays: nextMaxHistoricalOverdueDays(currentLoan, output.loan, new Date(processedAt)),
      fiscalPaymentEntries: output.loan.fiscalPaymentEntries,
      version: output.loan.version,
      hasFinancialHistory: true,
      updatedAt: serverTimestamp(),
      ...buildLoanOperationAudit(operationId, 'PAYMENT', actor),
    }));

    return {
      operationId,
      appliedAmount: output.appliedAmount,
      unappliedAmount: output.unappliedAmount,
      discountApplied: output.discountApplied,
      duplicate: false,
    };
  });
};

export const reverseLoanPayment = async (
  loanId: string,
  request: LoanPaymentReversalRequest,
  actor?: MovementActor,
): Promise<LoanPaymentReversalResult> => {
  const operationId = normalizeOperationId(request.operationId);

  return runTransaction(db, async (tx) => {
    const loanRef = doc(db, 'loans', loanId);
    const movementRef = doc(db, 'cashMovement', operationId);
    const feeSettingsRef = doc(db, 'settings', 'fees');
    const existingMovement = await tx.get(movementRef);
    if (existingMovement.exists()) {
      const existing = existingMovement.data();
      if (String(existing.loanId || '') !== loanId || String(existing.operationId || '') !== operationId) {
        throw new Error('OPERACAO_ID_CONFLITANTE');
      }
      return {
        operationId,
        reversedAmount: round2(Number(existing.amount || existing.value || 0)),
        duplicate: true,
      };
    }

    const loanSnapshot = await tx.get(loanRef);
    if (!loanSnapshot.exists()) throw new Error('CONTRATO_NAO_ENCONTRADO');
    const feeSettingsSnapshot = await tx.get(feeSettingsRef);
    const currentCashBalance = await readCashBalanceInTransaction(tx);
    const currentLoan = parseLoan(loanSnapshot.id, loanSnapshot.data());
    const feeSettings = feeSettingsSnapshot.exists()
      ? parseFeeSettings(feeSettingsSnapshot.data())
      : parseFeeSettings({});
    const processedAt = new Date().toISOString();
    const output = reverseLatestInstallmentPayment(
      currentLoan,
      request.installmentIndex,
      operationId,
      processedAt,
      feeSettings.dailyLateFeeRate,
    );

    await appendCashMovementInTransaction(tx, {
      type: 'ESTORNO',
      amount: output.reversedAmount,
      description: `ESTORNO PARCELA ${currentLoan.installments[request.installmentIndex]?.number || request.installmentIndex + 1}: ${currentLoan.customerName}`,
      loanId,
      operationId,
      actor,
    }, { currentCashBalance, movementId: operationId });

    tx.update(loanRef, sanitizeFirestorePayload({
      installments: output.loan.installments,
      status: output.loan.status,
      maxHistoricalOverdueDays: nextMaxHistoricalOverdueDays(currentLoan, output.loan, new Date(processedAt)),
      version: output.loan.version,
      hasFinancialHistory: true,
      updatedAt: serverTimestamp(),
      ...buildLoanOperationAudit(operationId, 'PAYMENT_REVERSAL', actor),
    }));

    return {
      operationId,
      reversedAmount: output.reversedAmount,
      duplicate: false,
    };
  });
};
