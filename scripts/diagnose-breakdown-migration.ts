import fs from 'node:fs/promises';
import path from 'node:path';
import {
  classifyLegacyInstallment,
  resolveInstallmentAmount,
  resolveInstallmentPaidAmount,
  resolveInstallmentNumber,
} from '../src/utils/legacyBreakdownMigration.ts';
import type {
  BreakdownMigrationCategory,
  BreakdownMigrationReasonCode,
} from '../src/utils/legacyBreakdownMigration.ts';
import { createFirebaseScriptSession } from './shared/firebaseClient.ts';
import {
  isLinkedToEstorno,
  loadInstallmentEstornoIndex,
  loadLegacyLoanDocuments,
} from './shared/breakdownMigrationDataset.ts';

interface CategoryBucket {
  count: number;
  examples: DiagnosticExample[];
}

interface DiagnosticExample {
  loanId: string;
  contractNumber: string;
  customerName: string;
  interestType: string;
  installmentIndex: number;
  installmentNumber: number | null;
  installmentStatus: string;
  installmentAmount: number;
  paidAmount: number;
  reasonCodes: BreakdownMigrationReasonCode[];
}

interface DiagnosticReport {
  generatedAt: string;
  projectId: string;
  executedBy: string;
  outputVersion: number;
  totals: {
    contractsAnalyzed: number;
    installmentsAnalyzed: number;
    paidInstallmentsWithoutBreakdown: number;
    potentiallyMigratableSimple: number;
    potentiallyMigratablePrice: number;
    reviewRequired: number;
  };
  categories: Record<BreakdownMigrationCategory, CategoryBucket>;
  reasonSummary: Array<{ code: BreakdownMigrationReasonCode; count: number }>;
}

const CATEGORY_ORDER: BreakdownMigrationCategory[] = [
  'MIGRATABLE_SIMPLE',
  'MIGRATABLE_PRICE',
  'REVIEW_REQUIRED',
  'SKIP_NO_PAYMENT',
  'SKIP_ALREADY_HAS_BREAKDOWN',
  'SKIP_INSUFFICIENT_DATA',
];

const DEFAULT_OUTPUT = path.resolve('diagnostics', 'breakdown-migration-report.json');
const MAX_EXAMPLES_PER_CATEGORY = 8;

const outputArg = process.argv.find((arg) => arg.startsWith('--out='));
const outputPath = outputArg ? path.resolve(outputArg.slice('--out='.length)) : DEFAULT_OUTPUT;

const createEmptyCategories = (): Record<BreakdownMigrationCategory, CategoryBucket> => {
  return CATEGORY_ORDER.reduce((accumulator, category) => {
    accumulator[category] = { count: 0, examples: [] };
    return accumulator;
  }, {} as Record<BreakdownMigrationCategory, CategoryBucket>);
};

const incrementReasonCount = (
  reasonCounter: Map<BreakdownMigrationReasonCode, number>,
  reasonCodes: BreakdownMigrationReasonCode[],
): void => {
  reasonCodes.forEach((reasonCode) => {
    reasonCounter.set(reasonCode, (reasonCounter.get(reasonCode) ?? 0) + 1);
  });
};

const run = async (): Promise<void> => {
  const session = await createFirebaseScriptSession();
  const [loanDocs, estornoIndex] = await Promise.all([
    loadLegacyLoanDocuments(session.db),
    loadInstallmentEstornoIndex(session.db),
  ]);

  const categories = createEmptyCategories();
  const reasonCounter = new Map<BreakdownMigrationReasonCode, number>();

  let installmentsAnalyzed = 0;
  let paidInstallmentsWithoutBreakdown = 0;

  loanDocs.forEach((loanDoc) => {
    const loanId = loanDoc.id;
    const contractNumber = String(loanDoc.raw.contractNumber ?? loanDoc.id ?? 'N/A');
    const customerName = String(loanDoc.raw.customerName ?? 'SEM_NOME');
    const interestType = String(loanDoc.raw.interestType ?? 'SEM_TIPO');

    const installments = Array.isArray(loanDoc.normalized.installments) ? loanDoc.normalized.installments : [];

    installments.forEach((installment, installmentIndex) => {
      installmentsAnalyzed += 1;

      const installmentNumber = resolveInstallmentNumber(installment, installmentIndex);
      const linkedToEstorno = isLinkedToEstorno(estornoIndex, loanId, installmentNumber);

      const classification = classifyLegacyInstallment(
        loanDoc.normalized,
        installment,
        installmentIndex,
        linkedToEstorno,
      );

      if (!classification.hasPaymentBreakdown && classification.paidAmount > 0) {
        paidInstallmentsWithoutBreakdown += 1;
      }

      categories[classification.category].count += 1;
      incrementReasonCount(reasonCounter, classification.reasonCodes);

      if (categories[classification.category].examples.length < MAX_EXAMPLES_PER_CATEGORY) {
        categories[classification.category].examples.push({
          loanId,
          contractNumber,
          customerName,
          interestType,
          installmentIndex,
          installmentNumber,
          installmentStatus: String(installment.status ?? 'SEM_STATUS'),
          installmentAmount: resolveInstallmentAmount(installment),
          paidAmount: resolveInstallmentPaidAmount(installment),
          reasonCodes: classification.reasonCodes,
        });
      }
    });
  });

  const report: DiagnosticReport = {
    generatedAt: new Date().toISOString(),
    projectId: session.projectId,
    executedBy: session.email,
    outputVersion: 1,
    totals: {
      contractsAnalyzed: loanDocs.length,
      installmentsAnalyzed,
      paidInstallmentsWithoutBreakdown,
      potentiallyMigratableSimple: categories.MIGRATABLE_SIMPLE.count,
      potentiallyMigratablePrice: categories.MIGRATABLE_PRICE.count,
      reviewRequired: categories.REVIEW_REQUIRED.count,
    },
    categories,
    reasonSummary: Array.from(reasonCounter.entries())
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count),
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('=== DIAGNOSTICO BREAKDOWN LEGADO ===');
  console.log(`Projeto: ${report.projectId}`);
  console.log(`Executado por: ${report.executedBy}`);
  console.log(`Contratos analisados: ${report.totals.contractsAnalyzed}`);
  console.log(`Parcelas analisadas: ${report.totals.installmentsAnalyzed}`);
  console.log(`Parcelas pagas sem breakdown: ${report.totals.paidInstallmentsWithoutBreakdown}`);
  console.log(`Migraveis SIMPLE: ${report.totals.potentiallyMigratableSimple}`);
  console.log(`Migraveis PRICE: ${report.totals.potentiallyMigratablePrice}`);
  console.log(`Revisao manual: ${report.totals.reviewRequired}`);
  console.log('--- Categorias ---');
  CATEGORY_ORDER.forEach((category) => {
    console.log(`${category}: ${report.categories[category].count}`);
  });
  console.log(`Relatorio salvo em: ${outputPath}`);
};

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Falha no diagnostico: ${message}`);
  process.exit(1);
});


