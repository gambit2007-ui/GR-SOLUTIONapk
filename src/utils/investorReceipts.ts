import { CashMovement, FundingSourceType, Loan } from '../types';

export interface InvestorReceiptGroup {
  groupKey: string;
  investorId: string;
  investorName: string;
  source: FundingSourceType;
  received: number;
}

const GR_INVESTOR = {
  groupKey: 'GR-SOLUTION::GR',
  investorId: 'GR-SOLUTION',
  investorName: 'GR Solutions',
  source: 'GR' as const,
};

const roundMoney = (value: number): number =>
  Number((Number.isFinite(value) ? value : 0).toFixed(2));

const getSignedReceiptAmount = (movement: CashMovement): number => {
  const type = String(movement.type || '').toUpperCase();
  const amount = Number(movement.amount ?? movement.value ?? 0);
  if (!Number.isFinite(amount)) return 0;
  if (type === 'PAGAMENTO') return amount;
  if (type === 'ESTORNO') return -amount;
  return 0;
};

export const resolveLoanInvestor = (loan: Loan): Omit<InvestorReceiptGroup, 'received'> => {
  const source: FundingSourceType = loan.funding?.source === 'EXTERNAL' ? 'EXTERNAL' : 'GR';
  const investorId = String(loan.funding?.investorId || GR_INVESTOR.investorId).trim() || GR_INVESTOR.investorId;
  const investorName = String(loan.funding?.investorName || GR_INVESTOR.investorName).trim() || GR_INVESTOR.investorName;

  return {
    groupKey: `${investorId}::${source}`,
    investorId,
    investorName,
    source,
  };
};

export const calculateNetReceivedFromCashMovements = (cashMovements: CashMovement[]): number =>
  roundMoney(cashMovements.reduce((total, movement) => total + getSignedReceiptAmount(movement), 0));

export const groupReceivedCashByInvestor = (
  loans: Loan[],
  cashMovements: CashMovement[],
): InvestorReceiptGroup[] => {
  const investorByLoanId = new Map<string, Omit<InvestorReceiptGroup, 'received'>>();
  loans.forEach((loan) => {
    const loanId = String(loan.id || '').trim();
    if (loanId) investorByLoanId.set(loanId, resolveLoanInvestor(loan));
  });

  const grouped = new Map<string, InvestorReceiptGroup>();
  cashMovements.forEach((movement) => {
    const signedAmount = getSignedReceiptAmount(movement);
    if (signedAmount === 0) return;

    // Movimentos antigos não possuíam loanId e pertencem à carteira própria da GR.
    const investor = investorByLoanId.get(String(movement.loanId || '').trim()) || GR_INVESTOR;
    const current = grouped.get(investor.groupKey) || { ...investor, received: 0 };
    current.received = roundMoney(current.received + signedAmount);
    grouped.set(investor.groupKey, current);
  });

  return Array.from(grouped.values());
};
