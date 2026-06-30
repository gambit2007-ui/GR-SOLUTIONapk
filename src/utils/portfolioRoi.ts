export const calculatePortfolioRoi = (realProfit: number, borrowedCapital: number): number => {
  const profit = Number(realProfit);
  const capital = Number(borrowedCapital);

  if (!Number.isFinite(profit) || !Number.isFinite(capital) || capital <= 0) {
    return 0;
  }

  return Number(((profit / capital) * 100).toFixed(2));
};
