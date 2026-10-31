import { describe, expect, it, vi } from 'vitest';
import type { CreditRiskAssessment } from '../creditRisk';

vi.mock('../../../api/_lib/firebaseAdmin.js', () => ({ adminDb: {} }));

import { requireCreditRiskDecision } from '../../../api/_lib/creditRisk';

const assessment = (level: CreditRiskAssessment['level'], historyIncomplete = false): CreditRiskAssessment => ({
  level, historyIncomplete, customerId: 'customer-1', totalContracts: 1,
  completedContracts: 0, activeContracts: 1, overdueContracts: 0,
  activeLoanIds: ['loan-1'], openAmount: 100, overdueAmount: 0,
  maxCurrentOverdueDays: 0, maxHistoricalOverdueDays: 0, realProfit: 0,
});
const user = { uid: 'user-1', admin: false };
const admin = { uid: 'admin-1', admin: true };

describe('server credit risk decision', () => {
  it('allows green and requires explicit confirmation for yellow and orange', () => {
    expect(() => requireCreditRiskDecision(assessment('GREEN'), undefined, user)).not.toThrow();
    expect(() => requireCreditRiskDecision(assessment('YELLOW'), undefined, user)).toThrow();
    expect(() => requireCreditRiskDecision(assessment('ORANGE'), undefined, user)).toThrow();
    expect(() => requireCreditRiskDecision(assessment('YELLOW'), { type: 'CONFIRM_EXPOSURE' }, user)).not.toThrow();
    expect(() => requireCreditRiskDecision(assessment('ORANGE'), { type: 'CONFIRM_EXPOSURE' }, user)).not.toThrow();
  });

  it('blocks red for ordinary users and requires admin justification', () => {
    expect(() => requireCreditRiskDecision(assessment('RED'), { type: 'CONFIRM_EXPOSURE' }, user)).toThrow();
    expect(() => requireCreditRiskDecision(assessment('RED'), { type: 'EXCEPTION', justification: 'garantia' }, user)).toThrow();
    expect(() => requireCreditRiskDecision(assessment('RED'), { type: 'EXCEPTION', justification: '  ' }, admin)).toThrow();
    expect(() => requireCreditRiskDecision(assessment('RED'), { type: 'EXCEPTION', justification: 'Nova garantia verificada' }, admin)).not.toThrow();
  });

  it('requires admin manual review when legacy history lacks dates', () => {
    const risk = assessment('GREEN', true);
    expect(() => requireCreditRiskDecision(risk, undefined, user)).toThrow();
    expect(() => requireCreditRiskDecision(risk, { type: 'EXCEPTION', justification: 'Historico revisado manualmente' }, admin)).not.toThrow();
  });
});
