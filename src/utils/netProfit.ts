const roundMoney = (value: number): number =>
  Number((Number.isFinite(value) ? value : 0).toFixed(2));

export const calculateNetProfit = (
  financialRevenue: number,
  operatingExpenses: number,
  fundingCost: number,
): number => roundMoney(
  Number(financialRevenue || 0) - Number(operatingExpenses || 0) - Number(fundingCost || 0),
);

export const calculateNetRoi = (netProfit: number, lentAmount: number): number | null => {
  const capital = Number(lentAmount || 0);
  if (!Number.isFinite(capital) || capital <= 0) return null;
  return Number(((Number(netProfit || 0) / capital) * 100).toFixed(2));
};
