import type { Transaction } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin.js';
import { ApiError, type AuthorizedActor } from './http.js';
import { parseLoan } from '../../src/utils/domainParsers.js';
import { assessCustomerCreditRisk, type CreditRiskAssessment } from '../../src/utils/creditRisk.js';
import { normalizeDailyLateFeeRate } from '../../src/utils/lateFee.js';

export interface CreditRiskDecisionInput {
  type: 'CONFIRM_EXPOSURE' | 'EXCEPTION';
  justification?: string;
}

const readCustomerLoans = async (customerId: string, transaction?: Transaction) => {
  const query = adminDb.collection('loans').where('customerId', '==', customerId);
  const snapshot = transaction ? await transaction.get(query) : await query.get();
  return snapshot.docs.map((document) => parseLoan(document.id, document.data()));
};

export const getCustomerCreditRisk = async (
  customerId: string,
  transaction?: Transaction,
): Promise<CreditRiskAssessment> => {
  const feesRef = adminDb.doc('settings/fees');
  const [loans, fees] = await Promise.all([
    readCustomerLoans(customerId, transaction),
    transaction ? transaction.get(feesRef) : feesRef.get(),
  ]);
  const rate = normalizeDailyLateFeeRate(fees.exists ? fees.data()?.dailyLateFeeRate : undefined);
  return assessCustomerCreditRisk(customerId, loans, new Date(), rate);
};

export const requireCreditRiskDecision = (
  risk: CreditRiskAssessment,
  decision: CreditRiskDecisionInput | undefined,
  actor: AuthorizedActor,
): void => {
  if (risk.level === 'RED' || risk.historyIncomplete) {
    if (!actor.admin || decision?.type !== 'EXCEPTION') {
      throw new ApiError(409, 'CREDIT_RISK_BLOCKED', risk.historyIncomplete
        ? 'Historico de atraso incompleto. Somente administrador pode liberar apos revisao manual.'
        : 'Novo emprestimo bloqueado por atraso superior a 15 dias.', risk);
    }
    if (!decision.justification?.trim()) {
      throw new ApiError(400, 'EXCEPTION_REASON_REQUIRED', 'Informe o motivo da liberacao excepcional.');
    }
    if (decision.justification.trim().length > 1000) {
      throw new ApiError(400, 'EXCEPTION_REASON_TOO_LONG', 'Motivo da liberacao excede o limite permitido.');
    }
    return;
  }

  if ((risk.level === 'ORANGE' || risk.level === 'YELLOW') && decision?.type !== 'CONFIRM_EXPOSURE') {
    throw new ApiError(409, 'CREDIT_RISK_CONFIRMATION_REQUIRED', 'Confirme a concessao com exposicao existente.', risk);
  }
  if (decision?.type === 'EXCEPTION') {
    throw new ApiError(400, 'INVALID_RISK_DECISION', 'Excecao disponivel somente para risco bloqueado.');
  }
};

export const buildCreditRiskAudit = (
  risk: CreditRiskAssessment,
  decision: CreditRiskDecisionInput | undefined,
  actor: AuthorizedActor,
  operation: 'DIRECT_LOAN' | 'BANCARIZED_PROPOSAL',
  loanId?: string,
) => ({
  action: decision?.type === 'EXCEPTION'
    ? 'EXCEPTIONAL_CREDIT_RELEASE'
    : risk.activeContracts > 0
      ? 'NEW_GRANT_WITH_EXISTING_EXPOSURE'
      : 'NEW_CREDIT_GRANT',
  operation,
  customerId: risk.customerId,
  actorUid: actor.uid,
  actorEmail: actor.email || null,
  actorName: actor.name || null,
  riskLevel: risk.level,
  activeLoanIds: risk.activeLoanIds,
  activeContracts: risk.activeContracts,
  openAmount: risk.openAmount,
  overdueAmount: risk.overdueAmount,
  maxCurrentOverdueDays: risk.maxCurrentOverdueDays,
  maxHistoricalOverdueDays: risk.maxHistoricalOverdueDays,
  historyIncomplete: risk.historyIncomplete,
  justification: decision?.type === 'EXCEPTION' ? decision.justification?.trim() : null,
  loanId: loanId || null,
});
