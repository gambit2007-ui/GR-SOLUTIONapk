/*
 * Financial integrity audit — Firestore READ ONLY.
 *
 * Safety contract:
 * - requires AUDIT_READ_ONLY=true;
 * - uses only Firestore's read-only runQuery/get endpoints;
 * - has no Firebase Admin SDK write API and no Firestore write endpoint;
 * - writes only a local JSON report under audit-output/.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ID = 'grsolution-8e6cb';
const READ_ONLY_MODE = process.env.AUDIT_READ_ONLY === 'true';
const REPORT_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'audit-output');
const REPORT_PATH = path.join(REPORT_DIRECTORY, 'financial-integrity-read-only.json');
const MARKDOWN_REPORT_PATH = path.join(REPORT_DIRECTORY, 'financial-integrity-read-only.md');
const PRIORITY = new Map([
  ['2026039', 'P0'], ['2026022', 'P0'], ['2026122', 'P0'],
  ['2026066', 'P1'], ['2026034', 'P1'], ['2026133', 'P1'], ['2026114', 'P1'], ['2026021', 'P1'],
  ['2026127', 'P2'], ['2026100', 'P2'], ['2026040', 'P2'], ['2026123', 'P2'], ['2026013', 'P2'],
  ['2026109', 'P2'], ['2026111', 'P2'], ['2026029', 'P2'], ['2026085', 'P2'], ['2026126', 'P2'],
  ['2026145', 'P2'], ['2026075', 'P2'], ['2026012', 'P2'], ['2026014', 'P2'], ['2026037', 'P2'],
  ['2026018', 'P2'], ['2026016', 'P2'], ['2026006', 'P2'], ['2026116', 'P2'],
]);
const INCOME_TYPES = new Set(['APORTE', 'PAGAMENTO', 'ENTRADA']);
const OUTGOING_TYPES = new Set(['RETIRADA', 'SAIDA', 'ESTORNO']);
const WRITE_OPERATION_NAMES = Object.freeze([
  'createDocument', 'patchDocument', 'deleteDocument', 'commit', 'batchWrite', 'runTransaction',
  'set', 'update', 'delete', 'add', 'writeBatch',
]);

if (!READ_ONLY_MODE) {
  throw new Error('AUDIT_READ_ONLY=true e obrigatorio. Nenhuma consulta foi executada.');
}

const round = (value) => Number((Number.isFinite(Number(value)) ? Number(value) : 0).toFixed(2));
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const string = (value) => String(value ?? '').trim();
const upper = (value) => string(value).toUpperCase();
const array = (value) => Array.isArray(value) ? value : [];
const map = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const moneyEqual = (left, right, tolerance = 0.02) => Math.abs(round(left) - round(right)) <= tolerance;

const dateValue = (value) => {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const toIso = (value) => {
  const parsed = dateValue(value);
  return parsed ? parsed.toISOString() : null;
};
const monthOf = (value) => {
  const parsed = dateValue(value);
  return parsed ? `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}` : null;
};
const timestampOf = (value) => dateValue(value)?.getTime() ?? 0;

const decodeFirestoreValue = (value) => {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('stringValue' in value) return value.stringValue;
  if ('bytesValue' in value) return '[BYTES OMITIDOS]';
  if ('referenceValue' in value) return value.referenceValue;
  if ('geoPointValue' in value) return value.geoPointValue;
  if ('arrayValue' in value) return array(value.arrayValue.values).map(decodeFirestoreValue);
  if ('mapValue' in value) return Object.fromEntries(
    Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decodeFirestoreValue(item)]),
  );
  return null;
};

const decodeDocument = (document) => {
  const fields = Object.fromEntries(
    Object.entries(document.fields || {}).map(([key, value]) => [key, decodeFirestoreValue(value)]),
  );
  return { id: String(document.name || '').split('/').pop(), ...fields };
};

const tokenConfigPaths = [
  path.join(process.env.USERPROFILE || '', '.config', 'configstore', 'firebase-tools.json'),
  path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json'),
].filter(Boolean);

const loadFirebaseCliAccessToken = async () => {
  for (const configPath of tokenConfigPaths) {
    try {
      const payload = JSON.parse(await readFile(configPath, 'utf8'));
      const accessToken = string(payload?.tokens?.access_token);
      if (accessToken) return accessToken;
    } catch {
      // Try the next supported Firebase CLI configuration path without exposing credentials.
    }
  }
  throw new Error('FIREBASE_CLI_ACCESS_TOKEN_AUSENTE: execute firebase login e tente novamente.');
};

const assertReadOnlyEndpoint = (method, url) => {
  const allowedPrefix = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  if (!READ_ONLY_MODE || !url.startsWith(allowedPrefix)) throw new Error('BLOQUEIO_READ_ONLY_ENDPOINT');
  if (method === 'GET') return;
  if (method === 'POST' && url.endsWith(':runQuery')) return;
  throw new Error(`BLOQUEIO_READ_ONLY_METODO_${method}`);
};

const requestJson = async (token, method, url, body) => {
  assertReadOnlyEndpoint(method, url);
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    throw new Error(`FIRESTORE_READ_FAILED_${response.status}`);
  }
  return response.json();
};

const readCollection = async (token, collectionId) => {
  const endpoint = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`;
  const response = await requestJson(token, 'POST', endpoint, {
    structuredQuery: { from: [{ collectionId }] },
  });
  return array(response).filter((item) => item.document).map((item) => decodeDocument(item.document));
};

const readDocument = async (token, documentPath) => {
  const endpoint = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${documentPath}`;
  const response = await requestJson(token, 'GET', endpoint);
  return decodeDocument(response);
};

const movementDate = (movement) => toIso(movement.recordedAt) || toIso(movement.date);
const movementAmount = (movement) => Math.abs(number(movement.amount ?? movement.value));
const movementType = (movement) => upper(movement.type);
const movementDelta = (movement) => {
  const amount = movementAmount(movement);
  if (amount === 0) return 0;
  return INCOME_TYPES.has(movementType(movement)) ? amount : -amount;
};
// Espelha src/utils/cashCategories.ts. Um saque vinculado a loanId tambem e
// emprestimo, mesmo se a descricao legada nao contem a palavra "EMPRESTIMO".
const isLoanDisbursement = (movement) => movementType(movement) === 'RETIRADA'
  && (Boolean(string(movement.loanId)) || /EMPRESTIMO/i.test(string(movement.description)));
const resolveOutflowCategory = (movement) => {
  if (isLoanDisbursement(movement)) return 'EMPRESTIMO';
  const category = upper(movement.category);
  if (['DEVOLUCAO_APORTE', 'PAGAMENTO_EMPRESTIMO_EXTERNO', 'REPASSE_INVESTIDOR_PARCEIRO', 'PRO_LABORE', 'DESPESA_OPERACIONAL', 'IMPOSTO_MEI', 'MARKETING', 'COMISSAO', 'REINVESTIMENTO'].includes(category)) return category;
  return ['SAIDA', 'RETIRADA'].includes(movementType(movement)) ? 'DESPESA_OPERACIONAL' : 'SEM_CATEGORIA';
};
const isRenewalMovement = (movement) => movementType(movement) === 'PAGAMENTO' && /RENOVACAO|RENOVAÇÃO|SEM AMORTIZACAO|SEM AMORTIZAÇÃO/i.test(string(movement.description));

const breakdownTotals = (entry) => ({
  principal: round(number(entry.principalPaid)),
  interest: round(number(entry.interestPaid)),
  lateFee: round(number(entry.lateFeePaid)),
  serviceFee: round(number(entry.serviceFeePaid)),
  discount: round(number(entry.discountApplied)),
  total: round(number(entry.totalPaid)),
});
const addBreakdown = (target, entry) => {
  const source = breakdownTotals(entry);
  for (const key of Object.keys(target)) target[key] = round(target[key] + source[key]);
  return target;
};
const emptyBreakdown = () => ({ principal: 0, interest: 0, lateFee: 0, serviceFee: 0, discount: 0, total: 0 });

// Estornos atuais sao gravados com valores negativos. Registros legados podem
// marcar apenas kind=REVERSAL e manter valor positivo; somente estes precisam
// de inversao para a comparacao historica.
const entrySign = (entry) => number(entry.totalPaid) < 0 ? 1 : upper(entry.kind) === 'REVERSAL' ? -1 : 1;
const netEntries = (entries) => array(entries).reduce((total, entry) => round(total + entrySign(entry) * number(entry.totalPaid)), 0);
const entriesBreakdown = (entries) => array(entries).reduce((total, entry) => {
  const sign = entrySign(entry);
  const source = breakdownTotals(entry);
  for (const key of Object.keys(total)) total[key] = round(total[key] + sign * source[key]);
  return total;
}, emptyBreakdown());
const installmentPaid = (installment) => {
  const paid = number(installment.paidAmount);
  return paid > 0 ? paid : number(installment.partialPaid);
};
const installmentNominal = (installment) => number(installment.amount ?? installment.value);
const normalizedStatus = (loan) => {
  const value = upper(loan.status);
  return ['QUITADO', 'COMPLETED', 'CONCLUIDO', 'LIQUIDADO'].includes(value)
    ? 'QUITADO'
    : ['CANCELADO', 'CANCELLED'].includes(value) ? 'CANCELADO' : 'ATIVO';
};

const detectDuplicateCashCandidates = (movements) => {
  const groups = new Map();
  for (const movement of movements.filter((item) => ['PAGAMENTO', 'ESTORNO'].includes(movementType(item)))) {
    const key = [movementType(movement), movementAmount(movement), upper(movement.description)].join('|');
    const bucket = groups.get(key) || [];
    bucket.push(movement);
    groups.set(key, bucket);
  }
  const candidates = [];
  for (const bucket of groups.values()) {
    const ordered = bucket.sort((left, right) => timestampOf(movementDate(left)) - timestampOf(movementDate(right)));
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      const elapsedSeconds = Math.abs(timestampOf(movementDate(current)) - timestampOf(movementDate(previous))) / 1000;
      if (elapsedSeconds <= 120) {
        candidates.push({
          type: movementType(current), amount: movementAmount(current), elapsedSeconds: round(elapsedSeconds),
          firstMovementId: previous.id, secondMovementId: current.id, description: string(current.description),
        });
      }
    }
  }
  return candidates;
};

const classifyLoan = (loan, movements) => {
  const installments = array(loan.installments);
  const renewalHistory = array(loan.renewalHistory);
  const cashPayments = movements.filter((movement) => ['PAGAMENTO', 'ESTORNO'].includes(movementType(movement)));
  const cashPaymentNet = round(cashPayments.reduce((sum, movement) => sum + movementDelta(movement), 0));
  const cashAllNet = round(movements.reduce((sum, movement) => sum + movementDelta(movement), 0));
  const disbursement = round(movements.filter(isLoanDisbursement).reduce((sum, movement) => sum + movementAmount(movement), 0));
  const cashRenewal = round(movements.filter(isRenewalMovement).reduce((sum, movement) => sum + movementAmount(movement), 0));
  const allocatedEntries = round(installments.reduce((sum, installment) => sum + netEntries(installment.paymentEntries), 0));
  const allocatedBreakdown = round(installments.reduce((sum, installment) => sum + number(map(installment.paymentBreakdown).totalPaid), 0));
  const allocatedPaidAmount = round(installments.reduce((sum, installment) => sum + installmentPaid(installment), 0));
  const fiscalEntries = round(netEntries(loan.fiscalPaymentEntries));
  const renewalTotal = round(renewalHistory.reduce((sum, renewal) => sum + number(renewal.totalPaid ?? renewal.amount), 0));
  const nominalSchedule = round(installments.reduce((sum, installment) => sum + installmentNominal(installment), 0));
  const totalToReturn = round(number(loan.totalToReturn));
  const allocationTruth = allocatedEntries !== 0
    ? allocatedEntries
    : allocatedBreakdown !== 0 ? allocatedBreakdown : allocatedPaidAmount;
  const difference = round(cashPaymentNet - allocationTruth - fiscalEntries);
  const scheduleDifference = round(totalToReturn - nominalSchedule);
  const duplicateCashCandidates = detectDuplicateCashCandidates(movements);
  const evidence = [];
  const flags = [];
  let classification = 'OK';
  let cause = 'Estruturas de recebimento e caixa conciliadas dentro da tolerancia.';

  if (Math.abs(difference) <= 0.02 && Math.abs(scheduleDifference) <= 0.02) {
    classification = 'OK';
  } else if (Math.abs(difference) <= 0.1 || Math.abs(scheduleDifference) <= 0.1) {
    classification = 'ARREDONDAMENTO';
    cause = 'Diferenca inferior ou proxima de alguns centavos.';
  }
  if (renewalHistory.length > 0 && (moneyEqual(Math.abs(difference), renewalTotal) || moneyEqual(cashRenewal, renewalTotal))) {
    classification = 'RENOVACAO LEGITIMA';
    cause = 'Pagamento de renovacao/juros identificado; o codigo registra PAGAMENTO no caixa sem amortizar principal.';
    evidence.push('renewalHistory', 'descricao de renovacao no cashMovement');
  } else if (duplicateCashCandidates.length > 0) {
    classification = 'CRITICO';
    cause = 'Ha cashMovement(s) de mesmo tipo, valor e descricao em intervalo de ate dois minutos; exige revisao humana antes de qualquer baixa.';
    flags.push('POSSIVEL_DUPLICIDADE_CASHMOVEMENT');
  } else if (cashPayments.length > 0 && allocationTruth === 0 && cashRenewal === 0) {
    classification = 'PAGAMENTO NAO ALOCADO';
    cause = 'Ha recebimento/estorno no cashMovement vinculado ao contrato sem alocacao equivalente em parcelas.';
  } else if (cashPaymentNet === 0 && allocationTruth + fiscalEntries > 0.02) {
    classification = 'PAGAMENTO SEM CASHMOVEMENT';
    cause = 'Parcelas ou historico fiscal registram recebimento sem cashMovement vinculado encontrado.';
  } else if (Math.abs(scheduleDifference) > 0.1) {
    classification = 'PARCELAMENTO INCONSISTENTE';
    cause = 'totalToReturn difere da soma nominal das parcelas atuais; pode resultar de redistribuicao, renegociacao ou legado.';
  } else if (Math.abs(difference) > 0.02) {
    classification = Math.abs(difference) >= 100 ? 'CRITICO' : 'VALIDAR MANUALMENTE';
    cause = 'Diferenca sem vinculo deterministico entre caixa e a estrutura atual de parcelas.';
  }
  if (normalizedStatus(loan) === 'QUITADO' && number(loan.paidAmount) === 0 && allocationTruth > 0) {
    flags.push('CAMPO_DERIVADO_DESATUALIZADO');
  }
  if (Math.abs(scheduleDifference) > 0.1) flags.push('PARCELAMENTO_INCONSISTENTE');

  return {
    contractNumber: string(loan.contractNumber) || loan.id,
    loanId: loan.id,
    customer: string(loan.customerName),
    priority: PRIORITY.get(string(loan.contractNumber)) || null,
    status: normalizedStatus(loan),
    amount: round(number(loan.amount)),
    interestRate: round(number(loan.interestRate)),
    interestType: string(loan.interestType),
    formalizationType: string(loan.formalizationType || 'DIRECT'),
    installmentCount: installments.length,
    totalToReturn,
    nominalSchedule,
    scheduleDifference,
    loanPaidAmount: round(number(loan.paidAmount)),
    cash: {
      allNet: cashAllNet,
      disbursement,
      paymentNet: cashPaymentNet,
      renewals: cashRenewal,
      reversals: round(cashPayments.filter((movement) => movementType(movement) === 'ESTORNO').reduce((sum, movement) => sum + movementAmount(movement), 0)),
      movementCount: movements.length,
    },
    allocations: {
      paymentEntriesNet: allocatedEntries,
      paymentBreakdownTotal: allocatedBreakdown,
      installmentsPaidAmount: allocatedPaidAmount,
      fiscalPaymentEntriesNet: fiscalEntries,
      selectedHistoricalAllocation: allocationTruth,
    },
    renewals: { count: renewalHistory.length, renewCount: number(loan.renewCount), total: renewalTotal, records: renewalHistory },
    difference,
    classification,
    cause,
    evidence,
    flags,
    duplicateCashCandidates,
    movementRefs: movements.map((movement) => ({
      id: movement.id, date: movementDate(movement), type: movementType(movement), amount: movementAmount(movement),
      signedAmount: movementDelta(movement), description: string(movement.description), operationId: string(movement.operationId) || null,
      actor: string(movement.createdByName || movement.createdByEmail || movement.createdByUid) || null,
    })),
  };
};

const reconstructSnapshots = (movements, loans, snapshots) => {
  const movementsByMonth = new Map();
  for (const movement of movements) {
    const month = monthOf(movementDate(movement));
    if (!month) continue;
    const bucket = movementsByMonth.get(month) || [];
    bucket.push(movement);
    movementsByMonth.set(month, bucket);
  }
  const movementDateByOperation = new Map(movements.map((movement) => [string(movement.operationId || movement.id), movementDate(movement)]));
  const fiscalByMonth = new Map();
  const addFiscal = (date, entry) => {
    const month = monthOf(date);
    if (!month) return;
    const bucket = fiscalByMonth.get(month) || emptyBreakdown();
    addBreakdown(bucket, entry);
    fiscalByMonth.set(month, bucket);
  };
  for (const loan of loans) {
    for (const installment of array(loan.installments)) {
      const entries = array(installment.paymentEntries);
      if (entries.length > 0) {
        for (const entry of entries) addFiscal(movementDateByOperation.get(string(entry.operationId)) || entry.recordedAt, entry);
      } else if (upper(installment.status) === 'PAGO' && map(installment.paymentBreakdown).totalPaid) {
        addFiscal(installment.paidAt || installment.paymentDate || installment.lastPaymentDate, installment.paymentBreakdown);
      }
    }
    for (const entry of array(loan.fiscalPaymentEntries)) addFiscal(movementDateByOperation.get(string(entry.operationId)) || entry.recordedAt, entry);
    for (const renewal of array(loan.renewalHistory)) {
      addFiscal(renewal.paymentDate, {
        principalPaid: 0,
        interestPaid: number(renewal.interestPaid ?? renewal.amount),
        lateFeePaid: number(renewal.lateFeePaid),
        serviceFeePaid: 0,
        discountApplied: 0,
        totalPaid: number(renewal.totalPaid ?? renewal.amount),
      });
    }
  }
  const monthKeys = [...new Set([...movementsByMonth.keys(), ...snapshots.map((snapshot) => string(snapshot.month || snapshot.id))])].sort();
  let runningCash = 0;
  const result = [];
  for (const month of monthKeys) {
    const monthMovements = array(movementsByMonth.get(month)).sort((a, b) => timestampOf(movementDate(a)) - timestampOf(movementDate(b)));
    const openingCash = runningCash;
    const totalIncome = round(monthMovements.filter((movement) => movementDelta(movement) > 0).reduce((sum, movement) => sum + movementDelta(movement), 0));
    const totalExpense = round(monthMovements.filter((movement) => movementDelta(movement) < 0).reduce((sum, movement) => sum + Math.abs(movementDelta(movement)), 0));
    runningCash = round(runningCash + totalIncome - totalExpense);
    const fiscal = fiscalByMonth.get(month) || emptyBreakdown();
    const outflowCategoryTotals = {};
    for (const movement of monthMovements.filter((movement) => ['SAIDA', 'RETIRADA'].includes(movementType(movement)))) {
      const category = resolveOutflowCategory(movement);
      outflowCategoryTotals[category] = round(number(outflowCategoryTotals[category]) + movementAmount(movement));
    }
    const lentAmount = round(monthMovements.filter(isLoanDisbursement).reduce((sum, movement) => sum + movementAmount(movement), 0));
    const realProfit = round(fiscal.interest + fiscal.lateFee + fiscal.serviceFee);
    const reconstructed = {
      openingCash, closingCash: runningCash, totalIncome, totalExpense,
      // Reports.tsx registra recebimentos liquidos: PAGAMENTO menos ESTORNO.
      totalReceived: round(monthMovements.filter((movement) => ['PAGAMENTO', 'ESTORNO'].includes(movementType(movement))).reduce((sum, movement) => sum + movementDelta(movement), 0)),
      lentAmount,
      principalReceived: fiscal.principal, interestReceived: fiscal.interest, lateFeesReceived: fiscal.lateFee,
      serviceFeesReceived: fiscal.serviceFee, realProfit,
      roi: lentAmount > 0 ? round((realProfit / lentAmount) * 100) : 0,
      // Estes dois campos congelam o estado da carteira na data de fechamento.
      // O ledger atual nao preserva a carteira historica para os recomputar.
      overdueAmount: null, projectedReceipts: null, movementCount: monthMovements.length,
      manualWithdrawals: round(monthMovements.filter((movement) => movementType(movement) === 'SAIDA').reduce((sum, movement) => sum + movementAmount(movement), 0)),
      loanOutflows: round(monthMovements.filter(isLoanDisbursement).reduce((sum, movement) => sum + movementAmount(movement), 0)),
      reversals: round(monthMovements.filter((movement) => movementType(movement) === 'ESTORNO').reduce((sum, movement) => sum + movementAmount(movement), 0)),
      outflowCategoryTotals,
    };
    const snapshot = snapshots.find((item) => string(item.month || item.id) === month) || null;
    const fields = ['openingCash', 'closingCash', 'totalIncome', 'totalExpense', 'totalReceived', 'lentAmount', 'principalReceived', 'interestReceived', 'lateFeesReceived', 'manualWithdrawals', 'movementCount', 'realProfit', 'roi', 'overdueAmount', 'projectedReceipts'];
    const differences = snapshot ? Object.fromEntries(fields.map((field) => [field,
      snapshot[field] === undefined || reconstructed[field] === null ? null : round(number(snapshot[field]) - number(reconstructed[field])),
    ])) : null;
    result.push({ month, snapshotSaved: snapshot, ledgerReconstructed: reconstructed, difference: differences });
  }
  return result;
};

const buildCodeMap = () => ({
  cash: 'src/utils/domainParsers.ts#resolveCashDelta -> src/services/cashService.ts#appendCashMovementInTransaction -> cashMovement + settings/caixa',
  overdue: 'src/components/Dashboard.tsx#getRemainingInstallmentValue/isInstallmentOverdue -> src/utils/financialEngine.ts#getInstallmentOutstanding -> installments + paymentEntries/paymentBreakdown',
  reports: 'src/components/Reports.tsx -> cashMovement, loans.installments, fiscalPaymentEntries, renewalHistory, monthlySnapshots',
  payment: 'src/services/loanService.ts#applyLoanPayment/reverseLoanPayment -> src/utils/financialEngine.ts -> paymentEntries/paymentBreakdown/installments',
  renewal: 'src/components/LoanSection/index.tsx#interest-only renewal -> updateLoanAndAddMovement -> PAGAMENTO cashMovement + renewalHistory without principal amortization',
  paidAmount: 'loan.paidAmount is read only in legacy parsing/display paths; current payment handler updates installments, paymentBreakdown, paymentEntries and fiscalPaymentEntries, but does not update loan.paidAmount.',
});

const markdownMoney = (value) => `R$ ${round(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const markdownText = (value) => string(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const markdownDifference = (value) => `${round(value) >= 0 ? '+' : ''}${markdownMoney(value)}`;
const buildMarkdownReport = (report) => {
  const lines = [
    '# Auditoria financeira - somente leitura',
    '',
    `Gerado em: ${report.generatedAt}. Projeto: ${report.projectId}. Firestore writes: ${report.firestoreWrites}.`,
    '',
    '## Resumo executivo',
    '',
    `- Inventário lido: ${report.inventory.customers} clientes, ${report.inventory.loans} contratos, ${report.inventory.cashMovements} movimentos e ${report.inventory.monthlySnapshots} snapshots.`,
    `- Contratos prioritários auditados: ${report.executiveSummary.priorityContractsAudited}.`,
    `- Caixa salvo: ${markdownMoney(report.executiveSummary.cash.stored)}; ledger reconstruído: ${markdownMoney(report.executiveSummary.cash.ledgerReconstructed)}; diferença: ${markdownMoney(report.executiveSummary.cash.difference)}; ${report.executiveSummary.cash.reconciled ? 'CAIXA RECONCILIADO' : 'CAIXA NÃO RECONCILIADO'}.`,
    `- Contratos quitados com loan.paidAmount = 0: ${report.executiveSummary.completedWithLoanPaidAmountZero}.`,
    `- Movimentos órfãos: ${report.executiveSummary.orphanMovements.count}, impacto líquido atual: ${markdownMoney(report.executiveSummary.orphanMovements.netImpact)}.`,
    '',
    '> "CRITICO" e "POSSIVEL_DUPLICIDADE_CASHMOVEMENT" são sinais para revisão humana; este relatório não confirma exclusão, não altera dados e não autoriza baixa automática.',
    '',
    '## Contratos prioritários',
    '',
    '| Prioridade | Contrato | Cliente | Status | Emprestado | TotalToReturn | Caixa líquido | Alocado atual | Renovações | Diferença | Classificação |',
    '|---|---|---|---|---:|---:|---:|---:|---:|---:|---|',
    ...report.priorityContracts.map((item) => [
      item.priority, item.contractNumber, markdownText(item.customer), item.status,
      markdownMoney(item.amount), markdownMoney(item.totalToReturn), markdownMoney(item.cash.paymentNet),
      markdownMoney(item.allocations.selectedHistoricalAllocation), markdownMoney(item.renewals.total),
      markdownDifference(item.difference), markdownText(item.classification),
    ].join('|').replace(/^/, '|').replace(/$/, '|')),
    '',
    '## Evidências prioritárias',
    '',
    ...report.priorityContracts.filter((item) => item.classification !== 'OK').flatMap((item) => [
      `### ${item.contractNumber} - ${markdownText(item.customer)}`,
      '',
      `- Causa: ${markdownText(item.cause)}`,
      `- Soma das parcelas: ${markdownMoney(item.nominalSchedule)}; diferença para totalToReturn: ${markdownDifference(item.scheduleDifference)}.`,
      `- paymentEntries: ${markdownMoney(item.allocations.paymentEntriesNet)}; paymentBreakdown: ${markdownMoney(item.allocations.paymentBreakdownTotal)}; installments[].paidAmount: ${markdownMoney(item.allocations.installmentsPaidAmount)}; loan.paidAmount: ${markdownMoney(item.loanPaidAmount)}.`,
      item.flags.length ? `- Sinais: ${item.flags.join(', ')}.` : '',
      item.duplicateCashCandidates.length ? `- Candidatos de duplicidade: ${item.duplicateCashCandidates.map((candidate) => `${candidate.type} ${markdownMoney(candidate.amount)} (${candidate.elapsedSeconds}s; ${candidate.firstMovementId} / ${candidate.secondMovementId})`).join('; ')}.` : '',
      '',
    ]),
    '## Movimentos órfãos',
    '',
    '| Movimento | loanId | Data | Tipo | Valor | Cliente provável | Impacto se removido |',
    '|---|---|---|---|---:|---|---:|',
    ...report.orphanMovements.map((item) => `|${item.movementId}|${item.loanId}|${item.date || ''}|${item.type}|${markdownMoney(item.amount)}|${markdownText(item.possibleCustomer)}|${markdownDifference(item.removalImpact)}|`),
    '',
    '## Snapshots mensais',
    '',
    '| Mês | Fechamento salvo | Ledger atual | Diferença | Recebido salvo | Recebido reconstruído | Movimentos salvo/atual |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...report.monthlySnapshots.map((item) => `|${item.month}|${markdownMoney(item.snapshotSaved?.closingCash)}|${markdownMoney(item.ledgerReconstructed.closingCash)}|${markdownDifference(item.difference?.closingCash)}|${item.snapshotSaved?.totalReceived === undefined ? 'N/D (schema legado)' : markdownMoney(item.snapshotSaved.totalReceived)}|${markdownMoney(item.ledgerReconstructed.totalReceived)}|${item.snapshotSaved?.movementCount ?? 'N/D'} / ${item.ledgerReconstructed.movementCount}|`),
    '',
    '## Saídas sem categoria gravada',
    '',
    `Quantidade: ${report.uncategorizedOutflows.count}. Total: ${markdownMoney(report.uncategorizedOutflows.total)}. Por mês: ${Object.entries(report.uncategorizedOutflows.byMonth).map(([month, total]) => `${month} ${markdownMoney(total)}`).join('; ')}.`,
    '',
    '## Fonte de verdade recomendada',
    '',
    '- Caixa: cashMovement assinado por resolveCashDelta, conciliado com settings/caixa.',
    '- Saldo e inadimplência: installments + paymentEntries (quando existirem), com paymentBreakdown/paidAmount apenas como compatibilidade; nunca loan.paidAmount.',
    '- Receita/lucro: composições de paymentEntries, paymentBreakdown legado, fiscalPaymentEntries e renewalHistory, com estornos líquidos.',
    '- Snapshot: documento monthlySnapshots permanece a fonte congelada do mês; o ledger é a reconstrução atual e não substitui o snapshot.',
    '',
  ].filter((line) => line !== '');
  return `${lines.join('\n')}\n`;
};

try {
  const accessToken = await loadFirebaseCliAccessToken();
  const [customers, loans, cashMovements, monthlySnapshots, cashSettings] = await Promise.all([
    readCollection(accessToken, 'clientes'),
    readCollection(accessToken, 'loans'),
    readCollection(accessToken, 'cashMovement'),
    readCollection(accessToken, 'monthlySnapshots'),
    readDocument(accessToken, 'settings/caixa'),
  ]);
  const movementsByLoan = new Map();
  for (const movement of cashMovements) {
    const loanId = string(movement.loanId);
    if (!loanId) continue;
    const bucket = movementsByLoan.get(loanId) || [];
    bucket.push(movement);
    movementsByLoan.set(loanId, bucket);
  }
  const loansById = new Map(loans.map((loan) => [loan.id, loan]));
  const contractAudits = loans.map((loan) => classifyLoan(loan, movementsByLoan.get(loan.id) || []));
  const priorityAudits = contractAudits.filter((audit) => audit.priority).sort((left, right) => (
    ({ P0: 0, P1: 1, P2: 2 }[left.priority] - { P0: 0, P1: 1, P2: 2 }[right.priority]) || left.contractNumber.localeCompare(right.contractNumber)
  ));
  const orphanMovements = cashMovements.filter((movement) => string(movement.loanId) && !loansById.has(string(movement.loanId))).map((movement) => ({
    classification: 'ORFAO HISTORICO', movementId: movement.id, loanId: string(movement.loanId), date: movementDate(movement),
    amount: movementAmount(movement), signedAmount: movementDelta(movement), type: movementType(movement), description: string(movement.description),
    actor: string(movement.createdByName || movement.createdByEmail || movement.createdByUid) || null,
    possibleCustomer: customers.find((customer) => upper(movement.description).includes(upper(customer.name)))?.name || null,
    participatesInCurrentCash: true, removalImpact: round(-movementDelta(movement)),
  }));
  const uncategorizedOutflows = cashMovements.filter((movement) => movementType(movement) === 'SAIDA' && !string(movement.category)).map((movement) => ({
    id: movement.id, date: movementDate(movement), month: monthOf(movementDate(movement)), amount: movementAmount(movement),
    description: string(movement.description), actor: string(movement.createdByName || movement.createdByEmail || movement.createdByUid) || null,
    inferredCategory: /PRO.?LABORE/i.test(string(movement.description)) ? 'PRO_LABORE' : /IMPOST|DAS|MEI/i.test(string(movement.description)) ? 'IMPOSTO_MEI' : 'DESPESA_OPERACIONAL',
  }));
  const ledgerCash = round(cashMovements.reduce((sum, movement) => sum + movementDelta(movement), 0));
  const storedCash = round(number(cashSettings.value));
  const completedPaidAmountZero = loans.filter((loan) => normalizedStatus(loan) === 'QUITADO' && number(loan.paidAmount) === 0);
  const futureLoan = loans.find((loan) => string(loan.contractNumber) === '2026116') || null;
  const snapshots = reconstructSnapshots(cashMovements, loans, monthlySnapshots).filter((snapshot) => /^2026-(03|04|05|06|07|08)$/.test(snapshot.month));
  const classifications = contractAudits.reduce((totals, audit) => {
    totals[audit.classification] = (totals[audit.classification] || 0) + 1;
    return totals;
  }, {});
  const report = {
    mode: 'READ_ONLY', projectId: PROJECT_ID, generatedAt: new Date().toISOString(), firestoreWrites: 0,
    readOnlyGuard: { requiredEnvironment: 'AUDIT_READ_ONLY=true', prohibitedOperations: WRITE_OPERATION_NAMES, endpoints: ['GET document', 'POST documents:runQuery'] },
    inventory: { customers: customers.length, loans: loans.length, cashMovements: cashMovements.length, monthlySnapshots: monthlySnapshots.length },
    executiveSummary: {
      priorityContractsAudited: priorityAudits.length, classifications,
      cash: { stored: storedCash, ledgerReconstructed: ledgerCash, difference: round(storedCash - ledgerCash), reconciled: moneyEqual(storedCash, ledgerCash) },
      completedWithLoanPaidAmountZero: completedPaidAmountZero.length,
      orphanMovements: { count: orphanMovements.length, netImpact: round(orphanMovements.reduce((sum, movement) => sum + movement.signedAmount, 0)) },
      snapshotsCompared: snapshots.length,
    },
    priorityContracts: priorityAudits,
    scheduleReferenceContracts: contractAudits.filter((audit) => ['2026022', '2026021', '2026037', '2026018', '2026016', '2026006'].includes(audit.contractNumber)),
    orphanMovements,
    uncategorizedOutflows: {
      count: uncategorizedOutflows.length, total: round(uncategorizedOutflows.reduce((sum, movement) => sum + movement.amount, 0)),
      byMonth: uncategorizedOutflows.reduce((totals, movement) => { totals[movement.month || 'SEM_DATA'] = round(number(totals[movement.month || 'SEM_DATA']) + movement.amount); return totals; }, {}),
      rows: uncategorizedOutflows,
    },
    monthlySnapshots: snapshots,
    paidAmountAudit: {
      completedPaidAmountZeroCount: completedPaidAmountZero.length,
      contracts: completedPaidAmountZero.map((loan) => ({ contractNumber: string(loan.contractNumber) || loan.id, loanId: loan.id, customer: string(loan.customerName), installmentsPaid: array(loan.installments).filter((installment) => upper(installment.status) === 'PAGO').length })),
      conclusion: 'O fluxo atual de pagamento nao atualiza loan.paidAmount; o campo e legado e nao deve ser fonte de verdade para saldo, inadimplencia ou lucro.',
    },
    futureContract2026116: futureLoan ? {
      contractNumber: string(futureLoan.contractNumber), customer: string(futureLoan.customerName), startDate: futureLoan.startDate || null, dueDate: futureLoan.dueDate || null,
      createdAt: toIso(futureLoan.createdAt), updatedAt: toIso(futureLoan.updatedAt), lastOperationAt: toIso(futureLoan.lastOperationAt),
      classification: 'VALIDAR MANUALMENTE', reason: 'Datas de inicio/vencimento estao no futuro em relacao ao ano do contrato; os documentos atuais nao preservam o input original.',
    } : null,
    codeMap: buildCodeMap(),
    allContractsClassification: contractAudits.map(({ movementRefs, renewals, ...summary }) => summary),
  };
  await mkdir(REPORT_DIRECTORY, { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(MARKDOWN_REPORT_PATH, buildMarkdownReport(report), 'utf8');
  console.log(JSON.stringify({ mode: 'READ_ONLY', firestoreWrites: 0, reportPath: REPORT_PATH, markdownReportPath: MARKDOWN_REPORT_PATH, inventory: report.inventory, executiveSummary: report.executiveSummary }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ mode: 'READ_ONLY', firestoreWrites: 0, status: 'AUDIT_FAILED', error: error instanceof Error ? error.message : 'UNKNOWN' }, null, 2));
  process.exitCode = 1;
}
