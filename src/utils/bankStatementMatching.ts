import type { CashMovement, Loan } from '../types';
import type { BankStatementRow } from './c6StatementParser';
import { resolveCashDelta } from './domainParsers';
import { getLocalISODate } from './dateTime';

export type BankMatchResult =
  | 'MATCH'
  | 'AMOUNT_OR_DIRECTION_MISMATCH'
  | 'NOT_PIX_RECEIPT'
  | 'PAYER_UNKNOWN'
  | 'PAYER_MISMATCH';

const normalizedName = (value: string) => value
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/^(?:\d[\d.\-/ ]{4,}\d)\s+/, '')
  .replace(/[^A-Z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const expectedPayerName = (movement: CashMovement, loan?: Pick<Loan, 'customerName'>): string => {
  if (loan?.customerName?.trim()) return loan.customerName.trim();
  if (movement.type !== 'PAGAMENTO') return '';
  return movement.description.match(/:\s*(.+)$/)?.[1]?.trim() || '';
};

export const bankPixCounterpartyName = (description: string, direction: 'IN' | 'OUT'): string => {
  const normalized = description.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const pattern = direction === 'IN' ? /^Pix recebido(?: c6)? de\s+(.+)$/i : /^Pix enviado para\s+(.+)$/i;
  return normalized.match(pattern)?.[1]?.trim() || '';
};

export const bankPixPayerName = (description: string): string => bankPixCounterpartyName(description, 'IN');

export const isBankReceipt = (entry: Pick<BankStatementRow, 'direction'>): boolean => entry.direction === 'IN';

export const isAppReceipt = (movement: CashMovement): boolean => Math.round(resolveCashDelta(movement) * 100) > 0;

type ReviewableReceipt = Pick<BankStatementRow, 'transactionDate' | 'sequence'> & { id: string };

/** Automatically matched receipts first, then unresolved receipts, then manual reviews. */
export const orderBankReceiptsForReview = <T extends ReviewableReceipt>(
  entries: readonly T[],
  linksByEntry: ReadonlyMap<string, { matchMode?: 'AUTO' | 'MANUAL' }>,
  justifiedEntryIds: ReadonlySet<string> = new Set(),
): T[] => {
  const priority = (entry: T): number => {
    const link = linksByEntry.get(entry.id);
    return link?.matchMode === 'AUTO' ? 0 : link || justifiedEntryIds.has(entry.id) ? 2 : 1;
  };
  return [...entries].sort((a, b) => priority(a) - priority(b) ||
    a.transactionDate.localeCompare(b.transactionDate) ||
    a.sequence - b.sequence || a.id.localeCompare(b.id));
};

export const evaluateBankMatch = (
  movement: CashMovement,
  entry: Pick<BankStatementRow, 'direction' | 'amountCents' | 'type' | 'description'>,
  expectedPayer = '',
): BankMatchResult => {
  const signedCents = Math.round(resolveCashDelta(movement) * 100);
  if (Math.abs(signedCents) !== entry.amountCents ||
    (entry.direction === 'IN' ? signedCents <= 0 : signedCents >= 0)) return 'AMOUNT_OR_DIRECTION_MISMATCH';
  const requiresIdentity = movement.type === 'PAGAMENTO' || Boolean(movement.loanId && expectedPayer);
  if (!requiresIdentity) return 'MATCH';
  if (entry.type.toUpperCase() !== 'PIX') return movement.type === 'PAGAMENTO' ? 'NOT_PIX_RECEIPT' : 'MATCH';
  const bankName = bankPixCounterpartyName(entry.description, entry.direction);
  const expectedName = normalizedName(expectedPayer);
  if (!expectedName || !bankName) return 'PAYER_UNKNOWN';
  return normalizedName(bankName) === expectedName ? 'MATCH' : 'PAYER_MISMATCH';
};

export const cashMovementMatchesBankEntry = (
  movement: CashMovement,
  entry: Pick<BankStatementRow, 'direction' | 'amountCents' | 'type' | 'description'>,
  expectedPayer = '',
): boolean => evaluateBankMatch(movement, entry, expectedPayer) === 'MATCH';

export interface AutoBankMatch {
  entryId: string;
  movementId: string;
}

type AutoEntry = BankStatementRow & { id: string };

/** Only unambiguous client payment Pix receipts can be reconciled without review. */
export const planAutomaticBankMatches = (
  entries: AutoEntry[],
  movements: CashMovement[],
  loansById: ReadonlyMap<string, Pick<Loan, 'customerName'>>,
  linkedEntryIds: ReadonlySet<string>,
  linkedMovementIds: ReadonlySet<string>,
  periodStart: string,
  periodEnd: string,
): AutoBankMatch[] => {
  const candidatesByEntry = new Map<string, string[]>();
  const candidatesByMovement = new Map<string, string[]>();
  for (const movement of movements) {
    if (!movement.id || linkedMovementIds.has(movement.id) || movement.type !== 'PAGAMENTO') continue;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(movement.date)
      ? movement.date : getLocalISODate(new Date(movement.date));
    if (!date || date < periodStart || date > periodEnd) continue;
    const payer = expectedPayerName(movement, movement.loanId ? loansById.get(movement.loanId) : undefined);
    if (!payer) continue;
    for (const entry of entries) {
      if (linkedEntryIds.has(entry.id) || entry.type.toUpperCase() !== 'PIX' || entry.direction !== 'IN') continue;
      if (evaluateBankMatch(movement, entry, payer) !== 'MATCH') continue;
      candidatesByEntry.set(entry.id, [...(candidatesByEntry.get(entry.id) || []), movement.id]);
      candidatesByMovement.set(movement.id, [...(candidatesByMovement.get(movement.id) || []), entry.id]);
    }
  }
  return entries.flatMap((entry) => {
    const movementIds = candidatesByEntry.get(entry.id);
    if (movementIds?.length !== 1 || candidatesByMovement.get(movementIds[0])?.length !== 1) return [];
    return [{ entryId: entry.id, movementId: movementIds[0] }];
  });
};
