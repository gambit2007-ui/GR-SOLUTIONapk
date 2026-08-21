export const calculateDelinquencyRate = (overdueActiveLoans: number, activeLoans: number): number => {
  const total = Number.isFinite(activeLoans) ? Math.max(0, activeLoans) : 0;
  if (total === 0) return 0;

  const overdue = Number.isFinite(overdueActiveLoans)
    ? Math.min(Math.max(0, overdueActiveLoans), total)
    : 0;

  return Number(((overdue / total) * 100).toFixed(2));
};
