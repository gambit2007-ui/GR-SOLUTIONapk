export type CredigrupoLifecycleEventType =
  | 'ccb_ready_for_signature'
  | 'loan.signed'
  | 'loan.funded'
  | 'loan.cancelled';

export type CredigrupoLifecycleTransitionOutcome = 'ADVANCE' | 'DUPLICATE' | 'STALE';

export interface CredigrupoLifecycleTransition {
  outcome: CredigrupoLifecycleTransitionOutcome;
  targetStatus: 'AWAITING_SIGNATURES' | 'SIGNED' | 'FUNDED' | 'CANCELLED';
  externalStatus?: string;
  formalizationStatus?: string;
}

const lifecycleStateOrder: Record<string, number> = {
  AWAITING_SIGNATURES: 10,
  SIGNED: 20,
  FUNDED: 30,
};

const terminalStates = new Set(['CANCELLED', 'CREATE_FAILED']);

const transitions: Record<CredigrupoLifecycleEventType, Omit<CredigrupoLifecycleTransition, 'outcome'>> = {
  ccb_ready_for_signature: {
    targetStatus: 'AWAITING_SIGNATURES',
  },
  'loan.signed': {
    targetStatus: 'SIGNED',
    formalizationStatus: 'completed',
  },
  'loan.funded': {
    targetStatus: 'FUNDED',
    externalStatus: 'funded',
    formalizationStatus: 'funded',
  },
  'loan.cancelled': {
    targetStatus: 'CANCELLED',
  },
};

export const resolveCredigrupoLifecycleTransition = (
  currentStatus: unknown,
  eventType: CredigrupoLifecycleEventType,
): CredigrupoLifecycleTransition => {
  const current = String(currentStatus || '').trim().toUpperCase();
  const transition = transitions[eventType];

  if (current === transition.targetStatus) {
    return { ...transition, outcome: 'DUPLICATE' };
  }

  if (terminalStates.has(current)) {
    return { ...transition, outcome: 'STALE' };
  }

  if (eventType === 'loan.cancelled') {
    const fundedRank = lifecycleStateOrder.FUNDED;
    return {
      ...transition,
      outcome: (lifecycleStateOrder[current] || 0) >= fundedRank ? 'STALE' : 'ADVANCE',
    };
  }

  const currentRank = lifecycleStateOrder[current] || 0;
  const targetRank = lifecycleStateOrder[transition.targetStatus] || 0;
  return {
    ...transition,
    outcome: currentRank > targetRank ? 'STALE' : 'ADVANCE',
  };
};
