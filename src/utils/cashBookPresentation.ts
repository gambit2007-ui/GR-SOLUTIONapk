import type { CashMovement } from '../types';

const cashEntryTypes = new Set(['APORTE', 'PAGAMENTO', 'ENTRADA']);

export const getReversedCashMovementIds = (movements: CashMovement[]): Set<string> =>
  new Set(movements
    .filter((movement) => movement.reversalOfMovementId)
    .map((movement) => movement.reversalOfMovementId!));

export const groupCashBookMonthMovements = (
  monthMovements: CashMovement[],
  reversedMovementIds: Set<string>,
) => ({
  entryMovements: monthMovements.filter((movement) =>
    cashEntryTypes.has(movement.type) && !movement.reversalOfMovementId &&
    !reversedMovementIds.has(movement.id || '')),
  exitMovements: monthMovements.filter((movement) =>
    !cashEntryTypes.has(movement.type) && movement.type !== 'ESTORNO' && !movement.reversalOfMovementId &&
    !reversedMovementIds.has(movement.id || '')),
  reversalMovements: monthMovements.filter((movement) =>
    movement.type === 'ESTORNO' || Boolean(movement.reversalOfMovementId) ||
    reversedMovementIds.has(movement.id || '')),
});
