export const MINIMUM_CASH_RESERVE = 3000;

export const assessLiquidityReserve = (cashBalance: number, loanAmount: number) => {
  const projectedCash = Number((cashBalance - loanAmount).toFixed(2));
  return {
    projectedCash,
    availableToLend: Number(Math.max(0, cashBalance - MINIMUM_CASH_RESERVE).toFixed(2)),
    shouldWarn: projectedCash <= MINIMUM_CASH_RESERVE,
  };
};
