import type { CashMovement, Loan } from '../types';
import { resolveCashDelta } from './domainParsers';
import {
  effectiveLoanStatus,
  installmentAmount,
  installmentPaidAmount,
  normalizeInstallmentStatus,
} from './loanCompat';

export type FinancialAuditSeverity = 'ERROR' | 'WARNING';

export interface FinancialAuditIssue {
  code: string;
  severity: FinancialAuditSeverity;
  message: string;
  entityId?: string;
}

export interface FinancialAuditResult {
  generatedAt: string;
  expectedCashBalance: number;
  recordedCashBalance: number;
  cashDifference: number;
  errors: number;
  warnings: number;
  issues: FinancialAuditIssue[];
  isConsistent: boolean;
}

interface FinancialAuditInput {
  loans: Loan[];
  cashMovements: CashMovement[];
  recordedCashBalance: number;
}

const roundMoney = (value: number): number =>
  Number((Number.isFinite(value) ? value : 0).toFixed(2));

const getRecordedBaseRemaining = (loan: Loan, installmentIndex: number): number => {
  const installment = loan.installments[installmentIndex];
  if (!installment) return 0;
  const amount = roundMoney(installmentAmount(installment));
  const entries = Array.isArray(installment.paymentEntries) ? installment.paymentEntries : [];

  if (entries.length > 0) {
    const allocated = entries.reduce(
      (total, entry) => total + Number(entry.principalPaid || 0) + Number(entry.interestPaid || 0) + Number(entry.discountApplied || 0),
      0,
    );
    return roundMoney(Math.max(amount - allocated, 0));
  }

  if (installment.paymentBreakdown) {
    const allocated = Number(installment.paymentBreakdown.principalPaid || 0)
      + Number(installment.paymentBreakdown.interestPaid || 0)
      + Number(installment.paymentBreakdown.discountApplied || 0);
    return roundMoney(Math.max(amount - allocated, 0));
  }

  return roundMoney(Math.max(amount - installmentPaidAmount(installment), 0));
};

const addIssue = (
  issues: FinancialAuditIssue[],
  severity: FinancialAuditSeverity,
  code: string,
  message: string,
  entityId?: string,
) => {
  issues.push({ severity, code, message, entityId });
};

export const buildFinancialAudit = ({
  loans,
  cashMovements,
  recordedCashBalance,
}: FinancialAuditInput): FinancialAuditResult => {
  const issues: FinancialAuditIssue[] = [];
  const loanIds = new Set(loans.map((loan) => loan.id));
  const operationOwners = new Map<string, string>();
  const movementsByLoan = new Map<string, CashMovement[]>();

  const expectedCashBalance = roundMoney(
    cashMovements.reduce((total, movement) => total + resolveCashDelta(movement), 0),
  );
  const normalizedRecordedBalance = roundMoney(recordedCashBalance);
  const cashDifference = roundMoney(normalizedRecordedBalance - expectedCashBalance);

  if (Math.abs(cashDifference) > 0.01) {
    addIssue(
      issues,
      'ERROR',
      'CASH_BALANCE_MISMATCH',
      `Saldo informado difere do livro caixa em R$ ${Math.abs(cashDifference).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`,
    );
  }

  cashMovements.forEach((movement) => {
    const movementId = String(movement.id || 'sem-id');
    const amount = Number(movement.amount || movement.value || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      addIssue(issues, 'ERROR', 'INVALID_MOVEMENT_AMOUNT', 'Movimentacao com valor invalido.', movementId);
    }

    if (!movement.recordedAt) {
      addIssue(issues, 'WARNING', 'MISSING_SERVER_TIMESTAMP', 'Movimentacao antiga sem horario confirmado pelo servidor.', movementId);
    }
    if (!movement.createdByUid) {
      addIssue(issues, 'WARNING', 'MISSING_MOVEMENT_ACTOR', 'Movimentacao antiga sem usuario responsavel.', movementId);
    }

    if (movement.operationId) {
      const previousOwner = operationOwners.get(movement.operationId);
      if (previousOwner && previousOwner !== movementId) {
        addIssue(
          issues,
          'ERROR',
          'DUPLICATE_OPERATION_ID',
          `Operacao ${movement.operationId} aparece em mais de um lancamento.`,
          movementId,
        );
      } else {
        operationOwners.set(movement.operationId, movementId);
      }
    }

    if (movement.loanId) {
      const linkedMovements = movementsByLoan.get(movement.loanId) || [];
      linkedMovements.push(movement);
      movementsByLoan.set(movement.loanId, linkedMovements);

      if (!loanIds.has(movement.loanId)) {
        addIssue(issues, 'ERROR', 'ORPHAN_LOAN_MOVEMENT', 'Lancamento referencia um contrato inexistente.', movementId);
      }
      if (!movement.operationId) {
        addIssue(issues, 'WARNING', 'MISSING_OPERATION_ID', 'Lancamento vinculado sem identificador idempotente.', movementId);
      }
    } else if (movement.type === 'PAGAMENTO' || movement.type === 'ESTORNO') {
      addIssue(issues, 'WARNING', 'UNLINKED_LOAN_PAYMENT', 'Pagamento ou estorno sem contrato vinculado.', movementId);
    }
  });

  loans.forEach((loan) => {
    const linkedMovements = movementsByLoan.get(loan.id) || [];
    const disbursements = linkedMovements.filter((movement) => (
      movement.type === 'RETIRADA' && /EMPRESTIMO/i.test(movement.description || '')
    ));
    if (disbursements.length === 0) {
      addIssue(issues, 'WARNING', 'MISSING_LOAN_DISBURSEMENT', 'Contrato sem retirada de concessao vinculada.', loan.id);
    } else if (disbursements.length > 1) {
      addIssue(issues, 'ERROR', 'DUPLICATE_LOAN_DISBURSEMENT', 'Contrato possui mais de uma retirada de concessao.', loan.id);
    }

    const installmentOperationIds = new Set<string>();
    let recordedRemaining = 0;
    loan.installments.forEach((installment, installmentIndex) => {
      const installmentId = `${loan.id}:${installment.number || installmentIndex + 1}`;
      const remaining = getRecordedBaseRemaining(loan, installmentIndex);
      recordedRemaining = roundMoney(recordedRemaining + remaining);

      if (normalizeInstallmentStatus(installment.status) === 'PAID' && remaining > 0.01) {
        addIssue(issues, 'ERROR', 'PAID_INSTALLMENT_WITH_BALANCE', 'Parcela marcada como paga ainda possui saldo base.', installmentId);
      }

      (installment.paymentEntries || []).forEach((entry) => {
        if (!entry.operationId) return;
        if (installmentOperationIds.has(entry.operationId)) {
          addIssue(issues, 'ERROR', 'DUPLICATE_PAYMENT_ENTRY', 'Operacao repetida no historico de parcelas.', installmentId);
        }
        installmentOperationIds.add(entry.operationId);
      });

      if (
        String(loan.interestType || '').toUpperCase() === 'SPLIT' &&
        normalizeInstallmentStatus(installment.status) === 'PAID' &&
        !installment.paymentBreakdown &&
        (!installment.paymentEntries || installment.paymentEntries.length === 0)
      ) {
        addIssue(issues, 'WARNING', 'LEGACY_SPLIT_WITHOUT_BREAKDOWN', 'Parcela SPLIT paga sem composicao fiscal registrada.', installmentId);
      }
    });

    const status = effectiveLoanStatus(loan);
    if (status === 'COMPLETED' && recordedRemaining > 0.01) {
      addIssue(issues, 'ERROR', 'COMPLETED_LOAN_WITH_BALANCE', 'Contrato quitado possui saldo base registrado.', loan.id);
    }

    const fiscalEntries = Array.isArray(loan.fiscalPaymentEntries) ? loan.fiscalPaymentEntries : [];
    if (fiscalEntries.length > 0) {
      const comparableEntries = fiscalEntries.filter((entry) => Boolean(entry.operationId));
      const fiscalOperationIds = new Set(comparableEntries.map((entry) => entry.operationId as string));
      const fiscalNetPaid = roundMoney(comparableEntries.reduce((sum, entry) => sum + Number(entry.totalPaid || 0), 0));
      const movementNetPaid = roundMoney(linkedMovements.reduce((sum, movement) => {
        if (!movement.operationId || !fiscalOperationIds.has(movement.operationId)) return sum;
        if (movement.type === 'PAGAMENTO') return sum + Number(movement.amount || 0);
        if (movement.type === 'ESTORNO') return sum - Number(movement.amount || 0);
        return sum;
      }, 0));
      if (comparableEntries.length > 0 && Math.abs(fiscalNetPaid - movementNetPaid) > 0.02) {
        addIssue(
          issues,
          'WARNING',
          'FISCAL_CASH_MISMATCH',
          `Historico fiscal e caixa diferem em R$ ${Math.abs(fiscalNetPaid - movementNetPaid).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`,
          loan.id,
        );
      }
    }
  });

  const errors = issues.filter((issue) => issue.severity === 'ERROR').length;
  const warnings = issues.filter((issue) => issue.severity === 'WARNING').length;

  return {
    generatedAt: new Date().toISOString(),
    expectedCashBalance,
    recordedCashBalance: normalizedRecordedBalance,
    cashDifference,
    errors,
    warnings,
    issues,
    isConsistent: errors === 0 && Math.abs(cashDifference) <= 0.01,
  };
};
