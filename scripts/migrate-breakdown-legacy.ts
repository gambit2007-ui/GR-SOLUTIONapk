import fs from 'node:fs/promises';
import path from 'node:path';
import { doc, writeBatch } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import {
  buildLegacyPriceBreakdown,
  buildLegacySimpleBreakdown,
  classifyLegacyInstallment,
  resolveInstallmentNumber,
} from '../src/utils/legacyBreakdownMigration.ts';
import type {
  BreakdownMigrationCategory,
  BreakdownMigrationReasonCode,
} from '../src/utils/legacyBreakdownMigration.ts';
import { sanitizeFirestorePayload } from '../src/utils/firestoreSanitizer.ts';
import { createFirebaseScriptSession } from './shared/firebaseClient.ts';
import {
  isLinkedToEstorno,
  loadInstallmentEstornoIndex,
  loadLegacyLoanDocuments,
} from './shared/breakdownMigrationDataset.ts';
import type { LegacyLoanDocument } from './shared/breakdownMigrationDataset.ts';

interface InstallmentMigrationResult {
  loanId: string;
  contractNumber: string;
  customerName: string;
  installmentIndex: number;
  installmentNumber: number | null;
  category: BreakdownMigrationCategory;
  reasonCodes: BreakdownMigrationReasonCode[];
  breakdownSource?: string;
  needsFiscalReview?: boolean;
}

interface LoanPendingUpdate {
  loanId: string;
  updatedInstallments: unknown[];
  installmentsUpdated: number;
}

interface MigrationSummary {
  generatedAt: string;
  mode: 'dry-run' | 'apply';
  allowEstimatedPriceFallback: boolean;
  projectId: string;
  executedBy: string;
  totals: {
    contractsAnalyzed: number;
    installmentsAnalyzed: number;
    migratedInstallments: number;
    migratedSimple: number;
    migratedPrice: number;
    reviewRequired: number;
    skippedAlreadyHasBreakdown: number;
    skippedNoPayment: number;
    skippedInsufficientData: number;
  };
  warnings: string[];
  sampleResults: InstallmentMigrationResult[];
}

const MAX_SAMPLES = 30;
const MAX_BATCH_SIZE = 300;

const args = new Set(process.argv.slice(2));
const applyMode = args.has('--apply');
const dryRunMode = !applyMode || args.has('--dry-run');
const allowEstimatedPriceFallback = args.has('--allow-estimated-price-fallback');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const contractLimit = limitArg ? Math.max(0, Math.trunc(Number(limitArg.slice('--limit='.length)))) : 0;

const reportArg = process.argv.find((arg) => arg.startsWith('--out='));
const defaultReportName = dryRunMode
  ? 'breakdown-migration-dry-run-report.json'
  : 'breakdown-migration-apply-report.json';
const reportPath = reportArg
  ? path.resolve(reportArg.slice('--out='.length))
  : path.resolve('diagnostics', defaultReportName);

const pushSample = (target: InstallmentMigrationResult[], item: InstallmentMigrationResult) => {
  if (target.length < MAX_SAMPLES) {
    target.push(item);
  }
};

const cloneInstallments = (loanDoc: LegacyLoanDocument): unknown[] => {
  const rawInstallments = Array.isArray(loanDoc.raw.installments) ? loanDoc.raw.installments : [];
  return rawInstallments.map((item) => {
    if (typeof item === 'object' && item !== null) return { ...(item as Record<string, unknown>) };
    return {};
  });
};

const updateInstallmentPayload = (
  original: unknown,
  update: {
    paymentBreakdown: unknown;
    breakdownSource: string;
    needsFiscalReview: boolean;
    expectedPrincipal?: number;
    expectedInterest?: number;
  },
): Record<string, unknown> => {
  const base = typeof original === 'object' && original !== null ? { ...(original as Record<string, unknown>) } : {};

  base.paymentBreakdown = update.paymentBreakdown;
  base.breakdownSource = update.breakdownSource;
  base.needsFiscalReview = update.needsFiscalReview;

  if (update.expectedPrincipal !== undefined && (base.expectedPrincipal === undefined || base.expectedPrincipal === null)) {
    base.expectedPrincipal = update.expectedPrincipal;
  }
  if (update.expectedInterest !== undefined && (base.expectedInterest === undefined || base.expectedInterest === null)) {
    base.expectedInterest = update.expectedInterest;
  }

  return base;
};

const commitLoanUpdates = async (db: Firestore, pendingUpdates: LoanPendingUpdate[]): Promise<void> => {
  for (let index = 0; index < pendingUpdates.length; index += MAX_BATCH_SIZE) {
    const batchSlice = pendingUpdates.slice(index, index + MAX_BATCH_SIZE);
    const batch = writeBatch(db);

    batchSlice.forEach((update) => {
      const ref = doc(db, 'loans', update.loanId);
      batch.update(ref, {
        installments: sanitizeFirestorePayload(update.updatedInstallments),
      });
    });

    await batch.commit();
  }
};

const run = async (): Promise<void> => {
  const session = await createFirebaseScriptSession();
  const [allLoanDocs, estornoIndex] = await Promise.all([
    loadLegacyLoanDocuments(session.db),
    loadInstallmentEstornoIndex(session.db),
  ]);

  const loanDocs = contractLimit > 0 ? allLoanDocs.slice(0, contractLimit) : allLoanDocs;
  const warnings: string[] = [];
  if (contractLimit > 0) {
    warnings.push(`Execucao limitada aos primeiros ${contractLimit} contratos (--limit).`);
  }
  if (allowEstimatedPriceFallback) {
    warnings.push('Fallback estimado para PRICE habilitado (needsFiscalReview=true).');
  }

  const summary: MigrationSummary = {
    generatedAt: new Date().toISOString(),
    mode: dryRunMode ? 'dry-run' : 'apply',
    allowEstimatedPriceFallback,
    projectId: session.projectId,
    executedBy: session.email,
    totals: {
      contractsAnalyzed: loanDocs.length,
      installmentsAnalyzed: 0,
      migratedInstallments: 0,
      migratedSimple: 0,
      migratedPrice: 0,
      reviewRequired: 0,
      skippedAlreadyHasBreakdown: 0,
      skippedNoPayment: 0,
      skippedInsufficientData: 0,
    },
    warnings,
    sampleResults: [],
  };

  const pendingUpdates: LoanPendingUpdate[] = [];

  loanDocs.forEach((loanDoc) => {
    const contractNumber = String(loanDoc.raw.contractNumber ?? loanDoc.id);
    const customerName = String(loanDoc.raw.customerName ?? 'SEM_NOME');

    const normalizedInstallments = Array.isArray(loanDoc.normalized.installments) ? loanDoc.normalized.installments : [];
    const mutableInstallments = cloneInstallments(loanDoc);

    let loanInstallmentsUpdated = 0;

    normalizedInstallments.forEach((installment, installmentIndex) => {
      summary.totals.installmentsAnalyzed += 1;

      const installmentNumber = resolveInstallmentNumber(installment, installmentIndex);
      const linkedToEstorno = isLinkedToEstorno(estornoIndex, loanDoc.id, installmentNumber);

      const classification = classifyLegacyInstallment(
        loanDoc.normalized,
        installment,
        installmentIndex,
        linkedToEstorno,
      );

      if (classification.category === 'SKIP_ALREADY_HAS_BREAKDOWN') {
        summary.totals.skippedAlreadyHasBreakdown += 1;
        return;
      }

      if (classification.category === 'SKIP_NO_PAYMENT') {
        summary.totals.skippedNoPayment += 1;
        return;
      }

      let breakdownResult = null;

      if (classification.category === 'MIGRATABLE_SIMPLE') {
        breakdownResult = buildLegacySimpleBreakdown(loanDoc.normalized, installment);
      } else if (classification.category === 'MIGRATABLE_PRICE') {
        breakdownResult = buildLegacyPriceBreakdown(
          loanDoc.normalized,
          installment,
          installmentIndex,
          allowEstimatedPriceFallback,
        );
      } else if (
        allowEstimatedPriceFallback &&
        classification.loanType === 'PRICE' &&
        !classification.reasonCodes.includes('linked_estorno_detected')
      ) {
        breakdownResult = buildLegacyPriceBreakdown(
          loanDoc.normalized,
          installment,
          installmentIndex,
          true,
        );
      }

      if (!breakdownResult) {
        if (classification.category === 'SKIP_INSUFFICIENT_DATA') {
          summary.totals.skippedInsufficientData += 1;
        } else {
          summary.totals.reviewRequired += 1;
        }

        pushSample(summary.sampleResults, {
          loanId: loanDoc.id,
          contractNumber,
          customerName,
          installmentIndex,
          installmentNumber,
          category: classification.category,
          reasonCodes:
            classification.reasonCodes.length > 0
              ? classification.reasonCodes
              : ['price_requires_manual_review'],
        });
        return;
      }

      const existingRawInstallment = mutableInstallments[installmentIndex];
      mutableInstallments[installmentIndex] = updateInstallmentPayload(existingRawInstallment, {
        paymentBreakdown: breakdownResult.paymentBreakdown,
        breakdownSource: breakdownResult.breakdownSource,
        needsFiscalReview: breakdownResult.needsFiscalReview,
        expectedPrincipal: breakdownResult.expectedPrincipal,
        expectedInterest: breakdownResult.expectedInterest,
      });

      loanInstallmentsUpdated += 1;
      summary.totals.migratedInstallments += 1;

      if (breakdownResult.breakdownSource === 'migrated_simple_ratio') {
        summary.totals.migratedSimple += 1;
      } else {
        summary.totals.migratedPrice += 1;
      }

      pushSample(summary.sampleResults, {
        loanId: loanDoc.id,
        contractNumber,
        customerName,
        installmentIndex,
        installmentNumber,
        category: classification.category,
        reasonCodes: breakdownResult.reasonCodes,
        breakdownSource: breakdownResult.breakdownSource,
        needsFiscalReview: breakdownResult.needsFiscalReview,
      });
    });

    if (loanInstallmentsUpdated > 0) {
      pendingUpdates.push({
        loanId: loanDoc.id,
        updatedInstallments: mutableInstallments,
        installmentsUpdated: loanInstallmentsUpdated,
      });
    }
  });

  if (!dryRunMode) {
    await commitLoanUpdates(session.db, pendingUpdates);
  }

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log('=== MIGRACAO BREAKDOWN LEGADO ===');
  console.log(`Projeto: ${summary.projectId}`);
  console.log(`Modo: ${summary.mode}`);
  console.log(`Contratos analisados: ${summary.totals.contractsAnalyzed}`);
  console.log(`Parcelas analisadas: ${summary.totals.installmentsAnalyzed}`);
  console.log(`Parcelas migradas: ${summary.totals.migratedInstallments}`);
  console.log(`- SIMPLE: ${summary.totals.migratedSimple}`);
  console.log(`- PRICE: ${summary.totals.migratedPrice}`);
  console.log(`Review manual: ${summary.totals.reviewRequired}`);
  console.log(`Skip (ja com breakdown): ${summary.totals.skippedAlreadyHasBreakdown}`);
  console.log(`Skip (sem pagamento): ${summary.totals.skippedNoPayment}`);
  console.log(`Skip (dados insuficientes): ${summary.totals.skippedInsufficientData}`);
  console.log(`Relatorio salvo em: ${reportPath}`);

  if (dryRunMode) {
    console.log('Dry-run ativo: nenhuma alteracao foi gravada no Firestore.');
  } else {
    console.log(`Apply concluido: ${pendingUpdates.length} contrato(s) atualizado(s).`);
  }
};

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Falha na migracao: ${message}`);
  process.exit(1);
});
