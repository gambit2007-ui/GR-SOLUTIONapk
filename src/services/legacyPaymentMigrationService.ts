import {
  collection,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Installment, InstallmentPaymentEntry, Loan } from '../types';
import { parseLoan } from '../utils/domainParsers';
import { sanitizeFirestorePayload } from '../utils/firestoreSanitizer';
import {
  buildLegacyPriceBreakdown,
  buildLegacySimpleBreakdown,
  classifyLegacyInstallment,
  type BreakdownMigrationCategory,
} from '../utils/legacyBreakdownMigration';

export interface LegacyMigrationPreviewItem {
  loanId: string;
  customerName: string;
  installmentIndex: number;
  installmentNumber: number;
  category: BreakdownMigrationCategory | 'REVIEW_MISSING_PAYMENT_DATE';
  reasonCodes: string[];
}

export interface LegacyMigrationPreview {
  generatedAt: string;
  scannedLoans: number;
  scannedInstallments: number;
  safeToMigrate: number;
  reviewRequired: number;
  skipped: number;
  items: LegacyMigrationPreviewItem[];
}

export interface LegacyMigrationApplyResult {
  runId: string;
  migratedInstallments: number;
  migratedLoans: number;
  skippedAfterRefresh: number;
}

const getPaymentDate = (installment: Installment): string | undefined =>
  installment.paymentDate || installment.paidAt || installment.lastPaymentDate;

const getLoansWithLinkedReversal = async (): Promise<Set<string>> => {
  const snapshot = await getDocs(collection(db, 'cashMovement'));
  return new Set(
    snapshot.docs
      .map((item) => item.data())
      .filter((movement) => String(movement.type || '').toUpperCase() === 'ESTORNO')
      .map((movement) => String(movement.loanId || '').trim())
      .filter(Boolean),
  );
};

const classifyLoanInstallments = (loan: Loan, loansWithReversal: Set<string>): LegacyMigrationPreviewItem[] =>
  (Array.isArray(loan.installments) ? loan.installments : []).map((installment, installmentIndex) => {
    const classification = classifyLegacyInstallment(
      loan,
      installment,
      installmentIndex,
      loansWithReversal.has(loan.id),
    );
    const isMigratable = classification.category === 'MIGRATABLE_SIMPLE' || classification.category === 'MIGRATABLE_PRICE';
    const paymentDate = getPaymentDate(installment);
    return {
      loanId: loan.id,
      customerName: loan.customerName,
      installmentIndex,
      installmentNumber: installment.number,
      category: isMigratable && !paymentDate ? 'REVIEW_MISSING_PAYMENT_DATE' : classification.category,
      reasonCodes: isMigratable && !paymentDate ? ['missing_payment_date'] : classification.reasonCodes,
    };
  });

export const buildLegacyPaymentMigrationPreview = async (): Promise<LegacyMigrationPreview> => {
  const [loanSnapshot, loansWithReversal] = await Promise.all([
    getDocs(collection(db, 'loans')),
    getLoansWithLinkedReversal(),
  ]);
  const loans = loanSnapshot.docs.map((item) => parseLoan(item.id, item.data()));
  const items = loans.flatMap((loan) => classifyLoanInstallments(loan, loansWithReversal));
  const safeToMigrate = items.filter(
    (item) => item.category === 'MIGRATABLE_SIMPLE' || item.category === 'MIGRATABLE_PRICE',
  ).length;
  const reviewRequired = items.filter(
    (item) => item.category === 'REVIEW_REQUIRED' || item.category === 'REVIEW_MISSING_PAYMENT_DATE',
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    scannedLoans: loans.length,
    scannedInstallments: items.length,
    safeToMigrate,
    reviewRequired,
    skipped: items.length - safeToMigrate - reviewRequired,
    items,
  };
};

const migrateLoan = async (
  loanId: string,
  loansWithReversal: Set<string>,
): Promise<{ migrated: number; changed: boolean }> => runTransaction(db, async (tx) => {
  const loanRef = doc(db, 'loans', loanId);
  const loanSnapshot = await tx.get(loanRef);
  if (!loanSnapshot.exists()) return { migrated: 0, changed: false };
  const loan = parseLoan(loanSnapshot.id, loanSnapshot.data());
  let migrated = 0;

  const installments = loan.installments.map((installment, installmentIndex) => {
    const classification = classifyLegacyInstallment(
      loan,
      installment,
      installmentIndex,
      loansWithReversal.has(loan.id),
    );
    const paymentDate = getPaymentDate(installment);
    if (!paymentDate) return installment;

    const result = classification.category === 'MIGRATABLE_SIMPLE'
      ? buildLegacySimpleBreakdown(loan, installment)
      : classification.category === 'MIGRATABLE_PRICE'
        ? buildLegacyPriceBreakdown(loan, installment, installmentIndex, false)
        : null;
    if (!result) return installment;

    const entry: InstallmentPaymentEntry = {
      id: `legacy-migration-${loan.id}-${installmentIndex}`,
      operationId: `legacy-migration-${loan.id}`,
      installmentNumber: installment.number,
      recordedAt: paymentDate,
      kind: 'PAYMENT',
      ...result.paymentBreakdown,
    };
    migrated += 1;
    return {
      ...installment,
      expectedPrincipal: result.expectedPrincipal ?? installment.expectedPrincipal,
      expectedInterest: result.expectedInterest ?? installment.expectedInterest,
      paymentBreakdown: result.paymentBreakdown,
      paymentEntries: [entry],
      breakdownSource: result.breakdownSource,
      needsFiscalReview: result.needsFiscalReview || undefined,
    };
  });

  if (migrated === 0) return { migrated: 0, changed: false };
  tx.update(loanRef, sanitizeFirestorePayload({
    installments,
    fiscalMigrationVersion: 1,
    version: Math.max(0, Math.trunc(Number(loan.version || 0))) + 1,
    updatedAt: serverTimestamp(),
  }));
  return { migrated, changed: true };
});

export const applySafeLegacyPaymentMigration = async (
  preview: LegacyMigrationPreview,
  performedByUid: string,
): Promise<LegacyMigrationApplyResult> => {
  if (!performedByUid) throw new Error('USUARIO_INVALIDO');
  if (preview.safeToMigrate <= 0) throw new Error('NENHUM_ITEM_SEGURO_PARA_MIGRAR');

  const loansWithReversal = await getLoansWithLinkedReversal();
  const loanIds = Array.from(new Set(
    preview.items
      .filter((item) => item.category === 'MIGRATABLE_SIMPLE' || item.category === 'MIGRATABLE_PRICE')
      .map((item) => item.loanId),
  ));
  let migratedInstallments = 0;
  let migratedLoans = 0;

  for (const loanId of loanIds) {
    const result = await migrateLoan(loanId, loansWithReversal);
    migratedInstallments += result.migrated;
    if (result.changed) migratedLoans += 1;
  }

  const runId = `legacy-breakdown-${Date.now()}`;
  await setDoc(doc(db, 'migrationRuns', runId), sanitizeFirestorePayload({
    type: 'LEGACY_PAYMENT_BREAKDOWN_V1',
    previewGeneratedAt: preview.generatedAt,
    executedAt: serverTimestamp(),
    performedByUid,
    scannedLoans: preview.scannedLoans,
    safeToMigrateAtPreview: preview.safeToMigrate,
    migratedInstallments,
    migratedLoans,
    skippedAfterRefresh: Math.max(preview.safeToMigrate - migratedInstallments, 0),
  }));

  return {
    runId,
    migratedInstallments,
    migratedLoans,
    skippedAfterRefresh: Math.max(preview.safeToMigrate - migratedInstallments, 0),
  };
};
