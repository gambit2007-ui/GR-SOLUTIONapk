import React, { useState } from 'react';
import {
  Loan,
  Customer,
  CashMovement,
  CashOutflowCategory,
  MovementType,
  PaymentBreakdown,
  MonthlySnapshot,
} from '../types';
import { useMemo } from 'react';
import { Wallet, ArrowUpCircle, ArrowDownCircle, RefreshCcw, Plus, TrendingUp, BarChart3, ChevronDown, Info, Download } from 'lucide-react';
import {
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend,
  ResponsiveContainer, 
  Cell,
  LabelList,
  LineChart,
  Line,
  AreaChart,
  Area
} from 'recharts';
import {
  effectiveLoanStatus,
  installmentAmount,
  installmentPaidAmount,
  loanInstallmentsCount,
  normalizeInstallmentStatus,
} from '../utils/loanCompat';
import { calculateInstallmentLateFee } from '../utils/lateFee';
import { calculatePortfolioRoi } from '../utils/portfolioRoi';
import { resolveCashDelta } from '../utils/domainParsers';
import { generateMonthlySnapshot, saveMonthlySnapshot } from '../services/monthlySnapshotService';
import {
  CASH_OUTFLOW_CATEGORY_LABELS,
  CASH_OUTFLOW_CATEGORY_OPTIONS,
  CASH_OUTFLOW_REPORT_CATEGORY_OPTIONS,
  CashOutflowReportCategory,
  resolveCashOutflowCategory,
} from '../utils/cashCategories';

interface ReportsProps {
  loans: Loan[];
  customers: Customer[];
  cashMovements: CashMovement[];
  monthlySnapshots: MonthlySnapshot[];
  caixa: number;
  currentUserUid?: string;
  dailyLateFeeRate?: number;
  onAddTransaction: (
    type: MovementType,
    amount: number,
    description: string,
    category?: CashOutflowCategory,
  ) => Promise<void>;
  onUpdateLoan: (loanId: string, newData: Partial<Loan>) => Promise<void>;
  onUpdateLoanAndAddTransaction: (loanId: string, newData: Partial<Loan>, type: MovementType, amount: number, description: string) => Promise<void>;
  onRecalculateCash: () => Promise<void>;
  onDownloadBackup: () => Promise<void>;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

interface FiscalMonthMetrics {
  principalRecovered: number;
  interestReceived: number;
  lateFeesReceived: number;
  serviceFeesReceived: number;
  taxableRevenue: number;
  totalPaid: number;
}

type OutflowCategoryTotals = Record<CashOutflowReportCategory, number>;

interface MonthlyData {
  key: string;
  month: string;
  lucro: number;
  recebido: number;
  recebimentosPrevistos: number;
  emprestado: number;
  entradas: number;
  saidas: number;
  saidasPorCategoria: OutflowCategoryTotals;
  roi: number;
  openingCash: number;
  closingCash: number;
  movementCount: number;
  createdLoansCount: number;
}

const Reports: React.FC<ReportsProps> = ({
  loans,
  customers,
  cashMovements,
  monthlySnapshots,
  caixa,
  currentUserUid,
  dailyLateFeeRate,
  onAddTransaction,
  onRecalculateCash,
  onDownloadBackup,
  showToast,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDownloadingBackup, setIsDownloadingBackup] = useState(false);
  const [isGeneratingAnnualReport, setIsGeneratingAnnualReport] = useState(false);
  const [reportYear, setReportYear] = useState(() => new Date().getFullYear());
  const [closingMonth, setClosingMonth] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    type: 'ENTRADA' as MovementType,
    amount: '',
    description: '',
    category: 'DESPESA_OPERACIONAL' as CashOutflowCategory,
  });

  const roundMoney = (value: number) => Number((Number.isFinite(value) ? value : 0).toFixed(2));
  const monthNamesUpper = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  const createEmptyOutflowCategoryTotals = (): OutflowCategoryTotals =>
    CASH_OUTFLOW_REPORT_CATEGORY_OPTIONS.reduce((totals, option) => {
      totals[option.value] = 0;
      return totals;
    }, {} as OutflowCategoryTotals);
  const formatPercentage = (value: number) =>
    Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
  const getRoiColorClass = (roi: number) => {
    if (roi >= 15) return 'text-emerald-500';
    if (roi >= 8) return 'text-[#BF953F]';
    return 'text-red-500';
  };

  const getRemainingInstallmentValue = (installment: Loan['installments'][number]) => {
    if (!installment || normalizeInstallmentStatus(installment.status) === 'PAID') return 0;
    const lateFee = calculateInstallmentLateFee(installment, new Date(), dailyLateFeeRate);
    const totalWithFee = roundMoney(installmentAmount(installment) + lateFee);
    const remaining = roundMoney(totalWithFee - installmentPaidAmount(installment));
    return remaining > 0 ? remaining : 0;
  };

  const getInstallmentPrincipalRecovered = (loan: Loan, installment: Loan['installments'][number]) => {
    const paymentEntries = Array.isArray(installment.paymentEntries) ? installment.paymentEntries : [];
    if (paymentEntries.length > 0) {
      return roundMoney(paymentEntries.reduce((sum, entry) => sum + Number(entry.principalPaid || 0), 0));
    }

    if (installment.paymentBreakdown) {
      return roundMoney(Number(installment.paymentBreakdown.principalPaid || 0));
    }

    if (normalizeInstallmentStatus(installment.status) === 'PAID') {
      if (Number.isFinite(Number(installment.expectedPrincipal)) && Number(installment.expectedPrincipal) > 0) {
        return roundMoney(Number(installment.expectedPrincipal));
      }

      const installmentsCount = loanInstallmentsCount(loan) || 1;
      return roundMoney(Number(loan.amount || 0) / installmentsCount);
    }

    return 0;
  };

  const parseAmountInput = (value: string): number => {
    const raw = String(value ?? '').trim();
    if (!raw) return Number.NaN;

    let normalized = raw
      .replace(/\s/g, '')
      .replace(/R\$/gi, '')
      .replace(/[^\d,.-]/g, '');

    if (!normalized) return Number.NaN;

    const hasComma = normalized.includes(',');
    const hasDot = normalized.includes('.');

    if (hasComma && hasDot) {
      const lastComma = normalized.lastIndexOf(',');
      const lastDot = normalized.lastIndexOf('.');
      const decimalSeparator = lastComma > lastDot ? ',' : '.';

      if (decimalSeparator === ',') {
        normalized = normalized.replace(/\./g, '').replace(',', '.');
      } else {
        normalized = normalized.replace(/,/g, '');
      }
    } else if (hasComma) {
      normalized = normalized.replace(',', '.');
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  };

  const makeMonthKey = (dateValue: string) => {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return null;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  };

  const makeDueDateMonthKey = (dateValue: string | undefined) => {
    const normalized = String(dateValue || '').trim();
    const isoMonth = normalized.match(/^(\d{4})-(\d{2})/);
    if (isoMonth) return `${isoMonth[1]}-${isoMonth[2]}`;
    return normalized ? makeMonthKey(normalized) : null;
  };

  const getMonthShortLabel = (monthIndex: number, year: number) =>
    `${monthNamesUpper[monthIndex]}/${String(year).slice(2)}`;

  const getDateFromUnknown = (value: unknown): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
      const date = (value as { toDate: () => Date }).toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const getLoanCreatedDate = (loan: Loan): Date | null => (
    getDateFromUnknown(loan.createdAt) || getDateFromUnknown(`${loan.startDate}T12:00:00`)
  );

  const getMonthRange = (monthKey: string) => {
    const [yearRaw, monthRaw] = monthKey.split('-');
    const year = Number(yearRaw);
    const monthIndex = Number(monthRaw) - 1;
    if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
      return null;
    }
    return {
      start: new Date(year, monthIndex, 1).getTime(),
      end: new Date(year, monthIndex + 1, 1).getTime(),
    };
  };

  const getMovementTime = (movement: CashMovement) => {
    const timestamp = new Date(movement.date).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  };

  const isCategorizedOutflowMovement = (movement: CashMovement) => {
    const movementType = String(movement.type || '').toUpperCase();
    if (movementType === 'SAIDA') return true;

    const description = String(movement.description || '').toUpperCase();
    return (
      movementType === 'RETIRADA' &&
      (description.startsWith('RETIRADA:') || description.includes('RETIRADA VIA CAIXA') || Boolean(movement.category))
    );
  };

  const isMonthClosed = (monthKey: string) =>
    monthlySnapshots.some((snapshot) => snapshot.month === monthKey);

  const getProjectedInstallmentReceivable = (installment: Loan['installments'][number]) => {
    const paymentEntries = Array.isArray(installment.paymentEntries) ? installment.paymentEntries : [];
    const entriesPaid = paymentEntries.length > 0
      ? roundMoney(paymentEntries.reduce((sum, entry) => sum + Number(entry.totalPaid || 0), 0))
      : 0;
    const paidAmount = Math.max(
      entriesPaid,
      roundMoney(installmentPaidAmount(installment)),
      roundMoney(Number(installment.paymentBreakdown?.totalPaid || 0)),
    );

    if (normalizeInstallmentStatus(installment.status) === 'PAID') {
      return paidAmount > 0 ? paidAmount : roundMoney(installmentAmount(installment));
    }

    return roundMoney(paidAmount + getRemainingInstallmentValue(installment));
  };

  const fiscalData = useMemo(() => {
    const monthly: Record<string, FiscalMonthMetrics> = {};

    const totals = {
      principalRecovered: 0,
      interestReceived: 0,
      lateFeesReceived: 0,
      serviceFeesReceived: 0,
      taxableRevenue: 0,
      totalPaid: 0,
    };

    const registerMetrics = (monthKey: string, breakdown: PaymentBreakdown) => {
      if (!monthly[monthKey]) {
        monthly[monthKey] = {
          principalRecovered: 0,
          interestReceived: 0,
          lateFeesReceived: 0,
          serviceFeesReceived: 0,
          taxableRevenue: 0,
          totalPaid: 0,
        };
      }

      const principalPaid = roundMoney(Number(breakdown.principalPaid || 0));
      const interestPaid = roundMoney(Number(breakdown.interestPaid || 0));
      const lateFeePaid = roundMoney(Number(breakdown.lateFeePaid || 0));
      const serviceFeePaid = roundMoney(Number(breakdown.serviceFeePaid || 0));
      const totalPaid = roundMoney(Number(breakdown.totalPaid || 0));
      const taxableRevenue = roundMoney(interestPaid + lateFeePaid + serviceFeePaid);

      monthly[monthKey].principalRecovered = roundMoney(monthly[monthKey].principalRecovered + principalPaid);
      monthly[monthKey].interestReceived = roundMoney(monthly[monthKey].interestReceived + interestPaid);
      monthly[monthKey].lateFeesReceived = roundMoney(monthly[monthKey].lateFeesReceived + lateFeePaid);
      monthly[monthKey].serviceFeesReceived = roundMoney(monthly[monthKey].serviceFeesReceived + serviceFeePaid);
      monthly[monthKey].taxableRevenue = roundMoney(monthly[monthKey].taxableRevenue + taxableRevenue);
      monthly[monthKey].totalPaid = roundMoney(monthly[monthKey].totalPaid + totalPaid);

      totals.principalRecovered = roundMoney(totals.principalRecovered + principalPaid);
      totals.interestReceived = roundMoney(totals.interestReceived + interestPaid);
      totals.lateFeesReceived = roundMoney(totals.lateFeesReceived + lateFeePaid);
      totals.serviceFeesReceived = roundMoney(totals.serviceFeesReceived + serviceFeePaid);
      totals.taxableRevenue = roundMoney(totals.taxableRevenue + taxableRevenue);
      totals.totalPaid = roundMoney(totals.totalPaid + totalPaid);
    };

    loans.forEach((loan) => {
      const installments = Array.isArray(loan.installments) ? loan.installments : [];
      installments.forEach((installment) => {
        const paymentEntries = Array.isArray(installment.paymentEntries) ? installment.paymentEntries : [];
        if (paymentEntries.length > 0) {
          paymentEntries.forEach((entry) => {
            const monthKey = makeMonthKey(entry.recordedAt);
            if (!monthKey) return;
            registerMetrics(monthKey, {
              principalPaid: Number(entry.principalPaid || 0),
              interestPaid: Number(entry.interestPaid || 0),
              lateFeePaid: Number(entry.lateFeePaid || 0),
              serviceFeePaid: Number(entry.serviceFeePaid || 0),
              discountApplied: Number(entry.discountApplied || 0),
              totalPaid: Number(entry.totalPaid || 0),
            });
          });
          return;
        }

        if (normalizeInstallmentStatus(installment.status) !== 'PAID') return;
        const breakdown = installment.paymentBreakdown;
        if (!breakdown) return;

        const paymentDate = installment.paidAt || installment.paymentDate || installment.lastPaymentDate;
        if (!paymentDate) return;

        const monthKey = makeMonthKey(paymentDate);
        if (!monthKey) return;
        registerMetrics(monthKey, breakdown);
      });

      const renewalHistory = Array.isArray(loan.renewalHistory) ? loan.renewalHistory : [];
      renewalHistory.forEach((renewal) => {
        const monthKey = makeMonthKey(renewal.paymentDate);
        if (!monthKey) return;

        const interestPaid = roundMoney(Number(renewal.interestPaid ?? renewal.amount ?? 0));
        const lateFeePaid = roundMoney(Number(renewal.lateFeePaid || 0));
        const totalPaid = roundMoney(Number(renewal.totalPaid ?? interestPaid + lateFeePaid));

        registerMetrics(monthKey, {
          principalPaid: 0,
          interestPaid,
          lateFeePaid,
          serviceFeePaid: 0,
          discountApplied: 0,
          totalPaid,
        });
      });
    });

    return { monthly, totals };
  }, [loans]);

  // Calculos Financeiros
  const totalAportes = cashMovements
    .filter((m) => ['APORTE', 'ENTRADA'].includes(String(m.type || '').toUpperCase()))
    .reduce((acc, m) => acc + Number(m.amount || 0), 0);

  const totalRetiradas = cashMovements
    .filter((m) => {
      const type = String(m.type || '').toUpperCase();
      const desc = String(m.description || '').toUpperCase();
      const isManualWithdrawal = type === 'RETIRADA' && (desc.startsWith('RETIRADA:') || desc.includes('RETIRADA VIA CAIXA'));
      return isManualWithdrawal || type === 'SAIDA';
    })
    .reduce((acc, m) => acc + Number(m.amount || 0), 0);

  const totalEmprestado = loans.reduce((acc, l) => acc + Number(l.amount || 0), 0);

  const totalRecebido = cashMovements
    .reduce((acc, m) => {
      if (m.type === 'PAGAMENTO') return acc + m.amount;
      if (m.type === 'ESTORNO') return acc - m.amount;
      return acc;
    }, 0);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthIndex = now.getMonth();
  const currentMonthLabel = getMonthShortLabel(currentMonthIndex, currentYear);
  const reportYearOptions = useMemo(() => {
    const years = new Set<number>([currentYear, reportYear]);

    loans.forEach((loan) => {
      const createdDate = getLoanCreatedDate(loan);
      if (createdDate) years.add(createdDate.getFullYear());
    });

    cashMovements.forEach((movement) => {
      const movementDate = new Date(movement.date);
      if (!Number.isNaN(movementDate.getTime())) years.add(movementDate.getFullYear());
    });

    return Array.from(years).sort((a, b) => b - a);
  }, [cashMovements, currentYear, loans, reportYear]);

  const faturamentoAno = useMemo(() => {
    return roundMoney(
      (Object.entries(fiscalData.monthly) as Array<[string, FiscalMonthMetrics]>).reduce((sum, [monthKey, metrics]) => {
        const [yearRaw] = monthKey.split('-');
        if (Number(yearRaw) !== currentYear) return sum;
        return sum + Number(metrics.taxableRevenue || 0);
      }, 0),
    );
  }, [currentYear, fiscalData.monthly]);

  const yearlyOutflowCategoryTotals = cashMovements.reduce((totals, movement) => {
    const date = new Date(movement.date);
    if (
      Number.isNaN(date.getTime()) ||
      date.getFullYear() !== currentYear ||
      !isCategorizedOutflowMovement(movement)
    ) {
      return totals;
    }

    const category = resolveCashOutflowCategory(movement);
    totals[category] = roundMoney(totals[category] + Number(movement.amount || 0));
    return totals;
  }, createEmptyOutflowCategoryTotals());

  const totalAReceber = loans.reduce((acc, loan) => {
    if (effectiveLoanStatus(loan) !== 'ACTIVE') return acc;
    const unpaid = loan.installments
      .reduce((sum, installment) => sum + getRemainingInstallmentValue(installment), 0);
    return acc + unpaid;
  }, 0);

  const getLoanExpectedTotal = (loan: Loan) => {
    const installmentsTotal = (Array.isArray(loan.installments) ? loan.installments : [])
      .reduce((acc, inst) => acc + Number(inst?.amount || 0), 0);

    if (installmentsTotal > 0) {
      return installmentsTotal;
    }

    return loan.amount * (1 + (loan.interestRate / 100));
  };

  // Valor em Rua (Principal Pendente)
  const valorEmRua = loans.reduce((acc, loan) => {
    if (effectiveLoanStatus(loan) !== 'ACTIVE') return acc;
    const principalRecovered = roundMoney(
      loan.installments.reduce((sum, installment) => sum + getInstallmentPrincipalRecovered(loan, installment), 0),
    );
    return acc + Math.max(roundMoney(Number(loan.amount || 0) - principalRecovered), 0);
  }, 0);

  const lucroEstimado = loans.reduce((acc, loan) => {
    const totalExpected = getLoanExpectedTotal(loan);
    const profit = Math.max(totalExpected - loan.amount, 0);
    return acc + profit;
  }, 0);

  // Agrupamento mensal para o grafico e gavetas
  const getMonthlyData = (): MonthlyData[] => {
    const months: Record<string, MonthlyData> = {};

    for (let monthIndex = 0; monthIndex <= currentMonthIndex; monthIndex += 1) {
      const key = `${currentYear}-${String(monthIndex + 1).padStart(2, '0')}`;
      months[key] = {
        key,
        month: getMonthShortLabel(monthIndex, currentYear),
        lucro: roundMoney(Number(fiscalData.monthly[key]?.taxableRevenue || 0)),
        recebido: 0,
        recebimentosPrevistos: 0,
        emprestado: 0,
        entradas: 0,
        saidas: 0,
        saidasPorCategoria: createEmptyOutflowCategoryTotals(),
        roi: 0,
        openingCash: 0,
        closingCash: 0,
        movementCount: 0,
        createdLoansCount: 0,
      };
    }

    cashMovements.forEach((movement) => {
      const date = new Date(movement.date);
      if (Number.isNaN(date.getTime()) || date.getFullYear() !== currentYear) return;

      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!months[key]) return;

      const movementType = String(movement.type || '').toUpperCase();
      const amount = Number(movement.amount || 0);
      months[key].movementCount += 1;
      const isEntrada = ['APORTE', 'PAGAMENTO', 'ENTRADA'].includes(movementType);
      if (isEntrada) {
        months[key].entradas = roundMoney(months[key].entradas + amount);
      } else {
        months[key].saidas = roundMoney(months[key].saidas + amount);
      }

      if (movementType === 'PAGAMENTO' || movementType === 'ESTORNO') {
        const signedAmount = movementType === 'ESTORNO' ? -amount : amount;
        months[key].recebido = roundMoney(months[key].recebido + signedAmount);
      }

      if (movementType === 'RETIRADA' && String(movement.description || '').toUpperCase().includes('EMPRESTIMO')) {
        months[key].emprestado = roundMoney(months[key].emprestado + amount);
      }

      if (isCategorizedOutflowMovement(movement)) {
        const category = resolveCashOutflowCategory(movement);
        months[key].saidasPorCategoria[category] = roundMoney(months[key].saidasPorCategoria[category] + amount);
      }
    });

    loans.forEach((loan) => {
      if (effectiveLoanStatus(loan) === 'CANCELLED') return;
      const installments = Array.isArray(loan.installments) ? loan.installments : [];

      installments.forEach((installment) => {
        const key = makeDueDateMonthKey(installment.dueDate);
        if (!key || !months[key]) return;

        months[key].recebimentosPrevistos = roundMoney(
          months[key].recebimentosPrevistos + getProjectedInstallmentReceivable(installment),
        );
      });
    });

    Object.keys(months).forEach((key) => {
      const range = getMonthRange(key);
      if (!range) return;

      months[key].openingCash = roundMoney(
        cashMovements.reduce((total, movement) => (
          getMovementTime(movement) < range.start ? total + resolveCashDelta(movement) : total
        ), 0),
      );
      months[key].closingCash = roundMoney(
        cashMovements.reduce((total, movement) => (
          getMovementTime(movement) < range.end ? total + resolveCashDelta(movement) : total
        ), 0),
      );
      months[key].createdLoansCount = loans.filter((loan) => {
        const createdDate = getLoanCreatedDate(loan);
        if (!createdDate) return false;
        const timestamp = createdDate.getTime();
        return timestamp >= range.start && timestamp < range.end;
      }).length;
    });

    return Object.keys(months)
      .sort()
      .map((key) => ({
        ...months[key],
        roi: calculatePortfolioRoi(months[key].lucro, months[key].emprestado),
      }));
  };

  const monthlyData = getMonthlyData();
  const chartData = monthlyData;
  const [expandedMonth, setExpandedMonth] = useState<string | null>(currentMonthLabel);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const amountValue = parseAmountInput(formData.amount);
    if (Number.isNaN(amountValue) || amountValue <= 0) {
      showToast('Valor invalido para movimentacao', 'error');
      return;
    }

    if (formData.type === 'SAIDA' && !formData.category) {
      showToast('Selecione a categoria da saida', 'error');
      return;
    }

    try {
      await onAddTransaction(
        formData.type,
        Number(amountValue.toFixed(2)),
        formData.description,
        formData.type === 'SAIDA' ? formData.category : undefined,
      );
      setIsModalOpen(false);
      setFormData({
        type: 'ENTRADA',
        amount: '',
        description: '',
        category: 'DESPESA_OPERACIONAL',
      });
    } catch (e) {
      // Erro tratado no App.tsx
    }
  };

  const handleBackupDownload = async () => {
    setIsDownloadingBackup(true);
    try {
      await onDownloadBackup();
    } catch {
      // Erro tratado no App.tsx.
    } finally {
      setIsDownloadingBackup(false);
    }
  };

  const handleAnnualReportDownload = async () => {
    setIsGeneratingAnnualReport(true);
    try {
      const { generateAnnualCashReportPdf } = await import('../utils/annualCashReportPdf');
      await generateAnnualCashReportPdf({
        year: reportYear,
        caixa,
        loans,
        cashMovements,
        customers,
        dailyLateFeeRate,
      });
      showToast('Relatorio anual gerado com sucesso', 'success');
    } catch (error) {
      console.error('Falha ao gerar relatorio anual do caixa:', error);
      showToast('Erro ao gerar relatorio anual', 'error');
    } finally {
      setIsGeneratingAnnualReport(false);
    }
  };

  const handleCloseMonth = async (data: MonthlyData) => {
    setClosingMonth(data.key);
    try {
      const fiscalMetrics = fiscalData.monthly[data.key] || {
        principalRecovered: 0,
        interestReceived: 0,
        lateFeesReceived: 0,
        serviceFeesReceived: 0,
        taxableRevenue: 0,
        totalPaid: 0,
      };

      const snapshot = generateMonthlySnapshot({
        month: data.key,
        openingCash: data.openingCash,
        closingCash: data.closingCash,
        totalIncome: data.entradas,
        totalExpense: data.saidas,
        principalReceived: fiscalMetrics.principalRecovered,
        interestReceived: fiscalMetrics.interestReceived,
        lateFeesReceived: fiscalMetrics.lateFeesReceived,
        serviceFeesReceived: fiscalMetrics.serviceFeesReceived,
        realProfit: data.lucro,
        lentAmount: data.emprestado,
        roi: data.roi,
        movementCount: data.movementCount,
        createdLoansCount: data.createdLoansCount,
        closedByUid: currentUserUid,
      });

      await saveMonthlySnapshot(snapshot);
      showToast(`Mes ${data.month} fechado com sucesso`, 'success');
    } catch (error) {
      console.error('Falha ao fechar mes:', error);
      showToast('Erro ao fechar o mes', 'error');
    } finally {
      setClosingMonth(null);
    }
  };

  const renderOutflowCategoryTotals = (totals: OutflowCategoryTotals) => {
    const items = CASH_OUTFLOW_REPORT_CATEGORY_OPTIONS
      .map((option) => ({
        category: option.value,
        label: CASH_OUTFLOW_CATEGORY_LABELS[option.value],
        total: roundMoney(totals[option.value] || 0),
      }))
      .filter((item) => item.total > 0);

    if (items.length === 0) {
      return (
        <p className="py-4 text-center text-[9px] text-zinc-700 italic">
          Nenhuma saída registrada
        </p>
      );
    }

    return (
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.category} className="flex items-center justify-between gap-3 border-b border-zinc-900 pb-2 last:border-b-0">
            <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest break-words">
              {item.label}
            </span>
            <span className="text-[10px] font-black text-red-500 whitespace-nowrap">
              R$ {item.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </span>
          </div>
        ))}
      </div>
    );
  };

  const financialCards = [
    { label: 'Total a Receber', value: totalAReceber, color: 'text-[#BF953F]' },
    { label: 'Valor em Rua', value: valorEmRua, color: 'text-blue-500' },
    { label: 'Lucro Projetado', value: lucroEstimado, color: 'text-purple-500' },
    { label: 'Total Emprestado', value: totalEmprestado, color: 'text-zinc-400' },
    { label: 'Total Recebido', value: totalRecebido, color: 'text-emerald-500' },
    { label: 'Total Aportes', value: totalAportes, color: 'text-cyan-500' },
    { label: 'Total Retiradas', value: totalRetiradas, color: 'text-red-500' },
  ];

  return (
    <div className="space-y-8">
      {/* Cartao principal de caixa */}
      <div className="bg-[#050505] border border-zinc-900 p-6 sm:p-8 md:p-12 rounded-[3rem] relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-8">
        <div className="absolute top-0 right-0 p-8 opacity-5">
          <Wallet size={160} className="text-[#BF953F]" />
        </div>
        <div className="relative z-10">
          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em] mb-4">Saldo Consolidado em Caixa</p>
          <h2 className="text-3xl sm:text-4xl md:text-6xl font-black gold-text tracking-tighter break-words">
            R$ {caixa.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </h2>
          <div className="flex items-center gap-6 mt-6">
            <button 
              onClick={onRecalculateCash}
              className="flex items-center gap-2 text-[9px] font-black text-zinc-500 uppercase tracking-widest hover:text-[#BF953F] transition-colors"
            >
              <RefreshCcw size={12} /> Sincronizar Saldo
            </button>
            <div className="h-4 w-[1px] bg-zinc-800" />
            <div className="flex items-center gap-2">
              <TrendingUp size={12} className="text-emerald-500" />
              <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">Operacao Ativa</span>
            </div>
          </div>
          <div className="mt-4 inline-flex items-center gap-3 px-4 py-2.5 bg-zinc-900/40 border border-zinc-800 rounded-2xl">
            <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Faturamento do Ano</span>
            <span className="text-[11px] font-black text-[#BF953F]">
              R$ {faturamentoAno.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>
        
        <div className="relative z-10 shrink-0 flex flex-col sm:flex-row sm:flex-wrap sm:items-end sm:justify-end gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest ml-1">
              Ano do relatorio
            </span>
            <select
              value={reportYear}
              onChange={(event) => setReportYear(Number(event.target.value))}
              className="min-h-[42px] px-3 bg-zinc-950/80 border border-zinc-800 text-white rounded-xl font-black uppercase text-[9px] tracking-widest outline-none focus:border-[#BF953F]"
            >
              {reportYearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
          <button 
            onClick={() => { setFormData({ ...formData, type: 'ENTRADA' }); setIsModalOpen(true); }}
            className="min-h-[42px] px-4 bg-[#BF953F]/15 border border-[#BF953F]/30 text-[#F5D77B] rounded-xl font-black uppercase text-[9px] tracking-[0.16em] hover:bg-[#BF953F]/20 transition-colors flex items-center justify-center gap-2"
          >
            <Plus size={14} /> Novo Lancamento
          </button>
          <button
            onClick={handleBackupDownload}
            disabled={isDownloadingBackup}
            className="min-h-[42px] px-4 bg-zinc-950/80 border border-zinc-800 text-zinc-300 rounded-xl font-black uppercase text-[9px] tracking-[0.14em] hover:border-[#BF953F]/40 hover:text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Download size={14} /> {isDownloadingBackup ? 'Gerando...' : 'Backup'}
          </button>
          <button
            onClick={() => { void handleAnnualReportDownload(); }}
            disabled={isGeneratingAnnualReport}
            className="min-h-[42px] px-4 bg-[#BF953F]/5 border border-[#BF953F]/25 text-[#BF953F] rounded-xl font-black uppercase text-[9px] tracking-[0.14em] hover:bg-[#BF953F]/10 transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Download size={14} /> {isGeneratingAnnualReport ? 'Gerando...' : 'Relatorio Anual'}
          </button>
        </div>
      </div>

      {/* Grade de indicadores financeiros */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {financialCards.map((card, i) => (
          <div key={i} className="bg-[#050505] border border-zinc-900 p-5 rounded-2xl hover:border-[#BF953F]/30 transition-all group">
            <p className="text-[8px] font-black text-zinc-600 uppercase tracking-widest mb-2 group-hover:text-zinc-400 transition-colors break-words">{card.label}</p>
            <p className={`text-sm font-black ${card.color}`}>
              R$ {card.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
          </div>
        ))}
      </div>

      {/* Resumo de lucratividade */}
      <div className="bg-[#050505] border border-zinc-900 rounded-[2.5rem] p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-12">
          <div className="shrink-0">
            <h3 className="text-xs font-black gold-text uppercase tracking-[0.2em]">Resumo de Lucratividade</h3>
            <p className="text-[9px] text-zinc-500 uppercase tracking-widest mt-1">Indicadores de desempenho real</p>
          </div>
          
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="p-5 border-l-2 border-[#BF953F] bg-zinc-900/10 relative group cursor-help rounded-r-2xl">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Media Mensal de Lucro Real</p>
                <Info size={10} className="text-zinc-700" />
              </div>
              <p className="text-xl font-black text-white">
                R$ {(chartData.reduce((acc, curr) => acc + curr.lucro, 0) / (chartData.length || 1)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </p>
              
              {/* Tooltip */}
              <div className="absolute bottom-full left-0 mb-2 w-56 p-4 bg-[#0a0a0a] border border-zinc-800 rounded-2xl opacity-0 group-hover:opacity-100 transition-all pointer-events-none z-50 shadow-2xl transform translate-y-2 group-hover:translate-y-0">
                <p className="text-[8px] font-black text-[#BF953F] uppercase tracking-widest mb-2">Analise de Media</p>
                <p className="text-[10px] text-zinc-500 leading-relaxed">
                  Media aritmetica do lucro real (juros recebidos) nos ultimos {chartData.length} meses.
                </p>
              </div>
            </div>

            <div className="p-5 border-l-2 border-emerald-500 bg-zinc-900/10 relative group cursor-help rounded-r-2xl">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Recorde de Lucro Real</p>
                <Info size={10} className="text-zinc-700" />
              </div>
              <p className="text-xl font-black text-white">
                {chartData.length > 0 ? chartData.reduce((prev, current) => (prev.lucro > current.lucro) ? prev : current).month : '---'}
              </p>

              {/* Tooltip */}
              <div className="absolute bottom-full left-0 mb-2 w-56 p-4 bg-[#0a0a0a] border border-zinc-800 rounded-2xl opacity-0 group-hover:opacity-100 transition-all pointer-events-none z-50 shadow-2xl transform translate-y-2 group-hover:translate-y-0">
                <p className="text-[8px] font-black text-emerald-500 uppercase tracking-widest mb-2">Pico de Desempenho</p>
                {chartData.length > 0 ? (
                  <p className="text-[10px] text-zinc-500 leading-relaxed">
                    Mes com maior volume de juros recebidos: {chartData.reduce((prev, current) => (prev.lucro > current.lucro) ? prev : current).month} (R$ {chartData.reduce((prev, current) => (prev.lucro > current.lucro) ? prev : current).lucro.toLocaleString('pt-BR')})
                  </p>
                ) : (
                  <p className="text-[10px] text-zinc-500">Dados insuficientes para analise.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Desempenho mensal */}
      <div className="bg-[#050505] border border-zinc-900 rounded-[3rem] p-6 sm:p-8 md:p-10">
        <div className="flex items-center justify-between mb-12">
          <div>
            <h3 className="text-sm font-black gold-text uppercase tracking-[0.3em]">Desempenho Mensal</h3>
            <p className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] mt-2">Historico detalhado de fluxo e rentabilidade</p>
          </div>
          <div className="p-4 bg-zinc-900/50 rounded-2xl border border-zinc-800">
            <BarChart3 size={24} className="text-[#BF953F]" />
          </div>
        </div>
        
        <div className="space-y-6">
            {monthlyData.map((data) => (
              <div key={data.key} className="border border-zinc-900 rounded-3xl overflow-hidden bg-[#000000]/20">
                <button 
                  onClick={() => setExpandedMonth(expandedMonth === data.month ? null : data.month)}
                  className="w-full p-6 flex items-center justify-between hover:bg-zinc-900/30 transition-colors"
                >
                  <div className="flex items-center gap-6">
                    <span className="text-xs font-black text-white uppercase tracking-widest w-20">{data.month}</span>
                    <div className="hidden sm:flex items-center gap-4">
                      <div className="flex flex-col items-start">
                        <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest">Entradas</span>
                        <span className="text-[10px] font-black text-emerald-500">R$ {data.entradas.toLocaleString('pt-BR')}</span>
                      </div>
                      <div className="flex flex-col items-start">
                        <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest">Saidas</span>
                        <span className="text-[10px] font-black text-red-500">R$ {data.saidas.toLocaleString('pt-BR')}</span>
                      </div>
                    </div>
                  </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest block">Lucro Real</span>
                        <span className={`text-xs font-black ${data.lucro >= 0 ? 'text-[#BF953F]' : 'text-red-500'}`}>
                          R$ {data.lucro.toLocaleString('pt-BR')}
                        </span>
                    </div>
                    <ChevronDown size={16} className={`text-zinc-500 transition-transform ${expandedMonth === data.month ? 'rotate-180' : ''}`} />
                  </div>
                </button>
                
                {expandedMonth === data.month && (
                  <div className="p-6 border-t border-zinc-900 bg-zinc-950/30 animate-in slide-in-from-top duration-200">
                    <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className={`px-3 py-2 rounded-xl text-[8px] font-black uppercase tracking-widest border ${
                          isMonthClosed(data.key)
                            ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                            : 'bg-[#BF953F]/10 text-[#BF953F] border-[#BF953F]/20'
                        }`}>
                          {isMonthClosed(data.key) ? 'Fechado' : 'Em aberto / tempo real'}
                        </span>
                        <span className="text-[8px] text-zinc-600 uppercase tracking-widest">
                          Competencia {data.key}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => { void handleCloseMonth(data); }}
                        disabled={closingMonth === data.key}
                        className="px-5 py-3 bg-zinc-900 border border-zinc-800 text-[#BF953F] rounded-2xl font-black uppercase text-[9px] tracking-widest hover:border-[#BF953F]/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                      >
                        {closingMonth === data.key ? 'Fechando...' : 'Fechar Mês'}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
                          <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Total de Entradas</span>
                          <span className="text-xs font-black text-emerald-500">R$ {data.entradas.toLocaleString('pt-BR')}</span>
                        </div>
                        <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
                          <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Total de Saidas</span>
                          <span className="text-xs font-black text-red-500">R$ {data.saidas.toLocaleString('pt-BR')}</span>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
                          <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Total Recebido</span>
                          <span className="text-xs font-black text-zinc-300">R$ {data.recebido.toLocaleString('pt-BR')}</span>
                        </div>
                        <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
                          <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Previsão de Recebimentos</span>
                          <span className="text-xs font-black text-[#BF953F]">R$ {data.recebimentosPrevistos.toLocaleString('pt-BR')}</span>
                        </div>
                        <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
                          <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Capital Emprestado</span>
                          <span className="text-xs font-black text-zinc-300">R$ {data.emprestado.toLocaleString('pt-BR')}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="p-4 bg-[#000000]/40 border border-zinc-900 rounded-2xl">
                        <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-4">
                          Saídas por categoria no mês
                        </p>
                        {renderOutflowCategoryTotals(data.saidasPorCategoria)}
                      </div>
                      <div className="p-4 bg-[#000000]/40 border border-zinc-900 rounded-2xl">
                        <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-4">
                          Saídas por categoria no ano
                        </p>
                        {renderOutflowCategoryTotals(yearlyOutflowCategoryTotals)}
                      </div>
                    </div>

                    <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="p-4 bg-[#000000]/50 border border-zinc-900 rounded-2xl">
                        <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2">Lucro Real do Mes</p>
                        <p className={`text-2xl font-black ${data.lucro >= 0 ? 'text-[#BF953F]' : 'text-red-500'}`}>
                          R$ {data.lucro.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </p>
                        <p className="text-[9px] text-zinc-600 uppercase tracking-widest mt-3">
                          Baseado em juros, multas e taxas
                        </p>
                      </div>

                      <div className="p-4 bg-[#000000]/50 border border-zinc-900 rounded-2xl relative group cursor-help">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">ROI da Carteira</p>
                          <Info size={12} className="text-zinc-700" />
                        </div>
                        <p className={`text-2xl font-black ${getRoiColorClass(data.roi)}`}>
                          {formatPercentage(data.roi)}
                        </p>
                        <p className="text-[9px] text-zinc-600 uppercase tracking-widest mt-3">
                          Retorno sobre capital emprestado
                        </p>

                        <div className="absolute bottom-full left-0 mb-2 w-64 p-4 bg-[#0a0a0a] border border-zinc-800 rounded-2xl opacity-0 group-hover:opacity-100 transition-all pointer-events-none z-50 shadow-2xl transform translate-y-2 group-hover:translate-y-0">
                          <p className="text-[8px] font-black text-[#BF953F] uppercase tracking-widest mb-2">ROI da Carteira</p>
                          <p className="text-[10px] text-zinc-500 leading-relaxed">
                            Retorno percentual obtido sobre o capital emprestado no período selecionado.
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="mt-8 h-[350px] w-full bg-[#000000]/40 p-6 rounded-[2rem] border border-zinc-900/50">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={[data]} margin={{ top: 30, right: 30, left: 20, bottom: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} opacity={0.5} />
                          <XAxis 
                            dataKey="month" 
                            axisLine={false} 
                            tickLine={false}
                            tick={{ fill: '#52525b', fontSize: 10, fontWeight: 900 }}
                          />
                          <YAxis 
                            axisLine={false} 
                            tickLine={false}
                            tick={{ fill: '#52525b', fontSize: 10, fontWeight: 900 }}
                            tickFormatter={(value) => `R$ ${value >= 1000 ? (value/1000).toFixed(0) + 'k' : value}`}
                          />
                          <Tooltip 
                            cursor={{ fill: 'transparent' }}
                            contentStyle={{ 
                              backgroundColor: '#050505', 
                              border: '1px solid #27272a', 
                              borderRadius: '1.5rem',
                              padding: '12px 16px',
                              boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)'
                            }}
                            itemStyle={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', padding: '2px 0' }}
                            formatter={(value: number) => [`R$ ${value.toLocaleString('pt-BR')}`, '']}
                          />
                          <Legend 
                            verticalAlign="top" 
                            align="right"
                            iconType="circle"
                            iconSize={8}
                            wrapperStyle={{ paddingBottom: '20px', fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em' }}
                          />
                          <Bar dataKey="entradas" name="Entradas" fill="#10b981" radius={[6, 6, 0, 0]} barSize={45}>
                            <LabelList 
                              dataKey="entradas" 
                              position="top" 
                              formatter={(v: number) => v > 0 ? `R$ ${v.toLocaleString('pt-BR')}` : ''}
                              style={{ fill: '#10b981', fontSize: '9px', fontWeight: 900 }}
                            />
                          </Bar>
                          <Bar dataKey="recebimentosPrevistos" name="Previsao Receb." fill="#38bdf8" radius={[6, 6, 0, 0]} barSize={45}>
                            <LabelList
                              dataKey="recebimentosPrevistos"
                              position="top"
                              formatter={(v: number) => v > 0 ? `R$ ${v.toLocaleString('pt-BR')}` : ''}
                              style={{ fill: '#38bdf8', fontSize: '9px', fontWeight: 900 }}
                            />
                          </Bar>
                          <Bar dataKey="saidas" name="Saidas" fill="#ef4444" radius={[6, 6, 0, 0]} barSize={45}>
                            <LabelList 
                              dataKey="saidas" 
                              position="top" 
                              formatter={(v: number) => v > 0 ? `R$ ${v.toLocaleString('pt-BR')}` : ''}
                              style={{ fill: '#ef4444', fontSize: '9px', fontWeight: 900 }}
                            />
                          </Bar>
                          <Bar dataKey="lucro" name="Lucro Real" fill="#BF953F" radius={[6, 6, 0, 0]} barSize={45}>
                            <LabelList 
                              dataKey="lucro" 
                              position="top" 
                              formatter={(v: number) => v > 0 ? `R$ ${v.toLocaleString('pt-BR')}` : ''}
                              style={{ fill: '#BF953F', fontSize: '9px', fontWeight: 900 }}
                            />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-[#000000]/80 backdrop-blur-sm overflow-y-auto">
          <div className="bg-[#050505] border border-zinc-900 w-full max-w-lg rounded-[2.5rem] p-5 sm:p-8 relative max-h-[92dvh] overflow-y-auto">
            <button onClick={() => setIsModalOpen(false)} className="absolute top-6 right-6 text-zinc-500 hover:text-white">
              <Plus className="rotate-45" size={24} />
            </button>
            <h2 className="text-xl font-black gold-text uppercase tracking-tighter mb-8">Movimentacao de Caixa</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Tipo</label>
                <select
                  required
                  className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs appearance-none"
                  value={formData.type}
                  onChange={e => {
                    const nextType = e.target.value as MovementType;
                    setFormData({
                      ...formData,
                      type: nextType,
                      category: nextType === 'SAIDA' ? formData.category : 'DESPESA_OPERACIONAL',
                    });
                  }}
                >
                  <option value="ENTRADA">ENTRADA / APORTE</option>
                  <option value="SAIDA">SAIDA / RETIRADA</option>
                </select>
              </div>
              {formData.type === 'SAIDA' && (
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Categoria da Saida</label>
                  <select
                    required
                    className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs appearance-none"
                    value={formData.category}
                    onChange={e => setFormData({ ...formData, category: e.target.value as CashOutflowCategory })}
                  >
                    {CASH_OUTFLOW_CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-1">
                <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Valor</label>
                <input
                  type="text" inputMode="decimal" placeholder="0,00" required
                  className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs"
                  value={formData.amount}
                  onChange={e => setFormData({ ...formData, amount: e.target.value.replace(/[^\d,.-]/g, '') })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Descricao / Motivo</label>
                <input
                  type="text" placeholder="EX: APORTE INICIAL" required
                  className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs"
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="py-5 bg-zinc-900 border border-zinc-800 text-zinc-500 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:text-white transition-all"
                >
                  Cancelar
                </button>
                <button className="py-5 gold-gradient text-black rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-[0_0_20px_rgba(191,149,63,0.1)]">
                  Confirmar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Reports;







