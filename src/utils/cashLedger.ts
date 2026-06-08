import type { CashMovement, CashMovementSourceType } from '../types';
import { formatDateTimeBR } from './dateTime';
import { resolveCashDelta } from './domainParsers';

export type CashLedgerMovementCategory = 'ENTRADA' | 'SAIDA' | 'ESTORNO' | 'AJUSTE';

export interface CashLedgerMovementRow {
  id: string;
  date: string;
  type: CashMovement['type'];
  category: CashLedgerMovementCategory;
  amount: number;
  signedAmount: number;
  description: string;
  loanId?: string;
  sourceId?: string;
  sourceType?: CashMovementSourceType;
  customerId?: string;
  customerName?: string;
  installmentId?: string;
  installmentNumber?: number;
  status?: string;
  actorName: string;
  balanceBefore: number;
  balanceAfter: number;
}

export interface MonthlyCashLedgerSummary {
  monthKey: string;
  monthLabel: string;
  openingBalance: number;
  totalEntries: number;
  totalExits: number;
  totalReversals: number;
  totalAdjustments: number;
  netMovement: number;
  closingBalance: number;
  movements: CashLedgerMovementRow[];
}

const monthNamesUpper = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

const roundMoney = (value: number): number => Number((Number.isFinite(value) ? value : 0).toFixed(2));

const getMonthLabel = (monthIndex: number, year: number): string =>
  `${monthNamesUpper[monthIndex]}/${String(year).slice(2)}`;

const getMovementActorLabel = (movement: CashMovement): string => {
  if (movement.createdByName && movement.createdByName.trim()) return movement.createdByName.trim();
  if (movement.createdByEmail && movement.createdByEmail.trim()) return movement.createdByEmail.trim();
  if (movement.createdByUid && movement.createdByUid.trim()) return movement.createdByUid.trim();
  return 'Sistema';
};

const getMovementCategory = (movement: CashMovement): CashLedgerMovementCategory => {
  const normalizedType = String(movement.type || '').trim().toUpperCase();
  const normalizedSourceType = String(movement.sourceType || '').trim().toUpperCase();
  const normalizedDescription = String(movement.description || '').trim().toUpperCase();

  if (
    normalizedSourceType === 'ADJUSTMENT' ||
    normalizedDescription.startsWith('AJUSTE') ||
    normalizedDescription.includes('CORRECAO') ||
    normalizedDescription.includes('CORREÇÃO')
  ) {
    return 'AJUSTE';
  }

  if (normalizedType === 'ESTORNO' || normalizedSourceType === 'REVERSAL') {
    return 'ESTORNO';
  }

  if (normalizedType === 'RETIRADA' || normalizedType === 'SAIDA' || normalizedSourceType === 'MANUAL_EXIT' || normalizedSourceType === 'LOAN_DISBURSEMENT') {
    return 'SAIDA';
  }

  return 'ENTRADA';
};

const parseMovementDate = (value: string): Date | null => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const buildMonthlyCashLedger = (
  cashMovements: CashMovement[],
  year: number,
): MonthlyCashLedgerSummary[] => {
  const sortedMovements = [...cashMovements].sort((left, right) => {
    const leftTime = new Date(left.date || '').getTime();
    const rightTime = new Date(right.date || '').getTime();
    if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return String(left.id || '').localeCompare(String(right.id || ''));
    if (Number.isNaN(leftTime)) return 1;
    if (Number.isNaN(rightTime)) return -1;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return String(left.id || '').localeCompare(String(right.id || ''));
  });

  const targetYearMovements = sortedMovements.filter((movement) => {
    const parsedDate = parseMovementDate(movement.date);
    return parsedDate ? parsedDate.getFullYear() === year : false;
  });

  let runningBalance = roundMoney(
    sortedMovements.reduce((acc, movement) => {
      const parsedDate = parseMovementDate(movement.date);
      if (!parsedDate || parsedDate.getFullYear() >= year) return acc;
      return roundMoney(acc + resolveCashDelta(movement));
    }, 0),
  );

  const summaries: MonthlyCashLedgerSummary[] = Array.from({ length: 12 }, (_, monthIndex) => ({
    monthKey: `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
    monthLabel: getMonthLabel(monthIndex, year),
    openingBalance: 0,
    totalEntries: 0,
    totalExits: 0,
    totalReversals: 0,
    totalAdjustments: 0,
    netMovement: 0,
    closingBalance: 0,
    movements: [],
  }));

  for (let monthIndex = 0; monthIndex < summaries.length; monthIndex += 1) {
    const summary = summaries[monthIndex];
    summary.openingBalance = roundMoney(runningBalance);

    const monthMovements = targetYearMovements.filter((movement) => {
      const parsedDate = parseMovementDate(movement.date);
      return parsedDate ? parsedDate.getMonth() === monthIndex : false;
    });

    monthMovements.forEach((movement) => {
      const signedAmount = roundMoney(resolveCashDelta(movement));
      const amount = roundMoney(Math.abs(Number(movement.amount ?? movement.value ?? 0)));
      const category = getMovementCategory(movement);
      const balanceBefore = Number.isFinite(Number(movement.balanceBefore))
        ? roundMoney(Number(movement.balanceBefore))
        : roundMoney(runningBalance);
      const balanceAfter = Number.isFinite(Number(movement.balanceAfter))
        ? roundMoney(Number(movement.balanceAfter))
        : roundMoney(balanceBefore + signedAmount);
      const parsedDate = parseMovementDate(movement.date);

      summary.movements.push({
        id: String(movement.id || `${movement.date}-${movement.description}`),
        date: formatDateTimeBR(movement.date),
        type: movement.type,
        category,
        amount,
        signedAmount,
        description: movement.description,
        loanId: movement.loanId,
        sourceId: movement.sourceId,
        sourceType: movement.sourceType,
        customerId: movement.customerId,
        customerName: movement.customerName,
        installmentId: movement.installmentId,
        installmentNumber: movement.installmentNumber,
        status: movement.status,
        actorName: getMovementActorLabel(movement),
        balanceBefore,
        balanceAfter,
      });

      if (category === 'ENTRADA') {
        summary.totalEntries = roundMoney(summary.totalEntries + amount);
      } else if (category === 'SAIDA') {
        summary.totalExits = roundMoney(summary.totalExits + amount);
      } else if (category === 'ESTORNO') {
        summary.totalReversals = roundMoney(summary.totalReversals + amount);
      } else {
        summary.totalAdjustments = roundMoney(summary.totalAdjustments + signedAmount);
      }

      runningBalance = balanceAfter;
      if (parsedDate) {
        summary.closingBalance = roundMoney(runningBalance);
      }
    });

    if (monthMovements.length === 0) {
      summary.closingBalance = roundMoney(runningBalance);
    }

    summary.netMovement = roundMoney(summary.closingBalance - summary.openingBalance);
  }

  return summaries;
};
