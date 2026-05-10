import React, { useState } from 'react';
import { Customer, Loan, LoanDraft, Installment, InstallmentPaymentEntry, LoanType, PaymentBreakdown } from '../types';
import { Plus, Calculator, Calendar, User, Percent, MessageCircle, CheckCircle, RotateCcw, XCircle, DollarSign, Loader2, Search, Pencil, Trash2, Ban } from 'lucide-react';
import { generateContractPDF } from '../utils/contractGenerator';
import {
  effectiveLoanStatus,
  installmentAmount,
  installmentPaidAmount,
  loanInstallmentsCount,
  normalizeInstallmentStatus,
  normalizeLoanStatus,
} from '../utils/loanCompat';
import { getLocalISODate } from '../utils/dateTime';
import { buildPaymentBreakdown } from '../utils/paymentBreakdown';
import {
  calculateInterestOnlyRenewalAmount,
  getCurrentContractDueDate,
  shiftPendingInstallmentsToNewDueDate,
} from '../utils/interestOnlyRenewal';

interface LoanSectionProps {
  customers: Customer[];
  loans: Loan[];
  onAddLoan: (draft: LoanDraft) => Promise<string | void> | void;
  onUpdateLoan: (loanId: string, newData: Partial<Loan>) => Promise<void>;
  onDeleteLoan: (loanId: string) => Promise<void>;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  initialExpandedLoanId?: string | null;
  currentActor?: {
    uid?: string | null;
    email?: string | null;
    displayName?: string | null;
  };
  onUpdateLoanAndAddTransaction: (
    loanId: string,
    newData: Partial<Loan>,
    type: 'PAGAMENTO' | 'ESTORNO',
    amount: number,
    description: string
  ) => Promise<void>;
}

interface EarlySettlementEntry {
  installmentIndex: number;
  remaining: number;
}

interface EarlySettlementQuote {
  loanId: string;
  totalOutstanding: number;
  discount: number;
  payoffAmount: number;
  entries: EarlySettlementEntry[];
}

type PaymentApplyMode = 'INSTALLMENTS' | 'TOTAL_BALANCE' | 'REDISTRIBUTE_BALANCE';

interface PaymentModalState {
  isOpen: boolean;
  loanId: string;
  installmentIndex: number;
  amount: string;
  applyMode: PaymentApplyMode;
  redistributionStartDate: string;
  redistributionInstallmentsCount: string;
}

interface InterestOnlyRenewalModalState {
  isOpen: boolean;
  loanId: string;
  principalAmount: number;
  interestAmount: number;
  previousDueDate: string;
  newDueDate: string;
  notes: string;
}

const LoanSection: React.FC<LoanSectionProps> = ({ 
  customers, 
  loans, 
  onAddLoan, 
  onUpdateLoan,
  onDeleteLoan,
  showToast, 
  initialExpandedLoanId,
  currentActor,
  onUpdateLoanAndAddTransaction
}) => {
  const buildDefaultFormData = () => ({
    customerId: '',
    amount: '',
    interestRate: '',
    monthlyPaidInterestRate: '',
    monthlyAccruedInterestRate: '',
    interestType: 'SIMPLE' as 'SIMPLE' | 'PRICE' | 'SPLIT',
    frequency: 'MONTHLY' as 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY',
    installmentsCount: '',
    startDate: getLocalISODate()
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLoanId, setEditingLoanId] = useState<string | null>(null);
  const [expandedLoanId, setExpandedLoanId] = useState<string | null>(initialExpandedLoanId || null);
  const [processingPayment, setProcessingPayment] = useState<string | null>(null);
  const processingPaymentGuardRef = React.useRef<string | null>(null);
  const [paymentModal, setPaymentModal] = useState<PaymentModalState | null>(null);
  const [settlementModal, setSettlementModal] = useState<EarlySettlementQuote | null>(null);
  const [renewalModal, setRenewalModal] = useState<InterestOnlyRenewalModalState | null>(null);
  const [processingRenewal, setProcessingRenewal] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'COMPLETED' | 'OVERDUE' | 'CANCELLED'>('ALL');

  const fromLegacyInterestType = (value: unknown): 'SIMPLE' | 'PRICE' | 'SPLIT' => {
    const normalized = String(value || '').toUpperCase();
    if (normalized === 'PRICE') return 'PRICE';
    if (normalized === 'SPLIT') return 'SPLIT';
    return 'SIMPLE';
  };

  const toLegacyInterestType = (value: 'SIMPLE' | 'PRICE' | 'SPLIT'): 'SIMPLES' | 'PRICE' | 'SPLIT' => {
    if (value === 'PRICE') return 'PRICE';
    if (value === 'SPLIT') return 'SPLIT';
    return 'SIMPLES';
  };

  const fromLegacyFrequency = (value: unknown): 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' => {
    const normalized = String(value || '').toUpperCase();
    if (normalized === 'DAILY' || normalized === 'DIARIO') return 'DAILY';
    if (normalized === 'WEEKLY' || normalized === 'SEMANAL') return 'WEEKLY';
    if (normalized === 'BIWEEKLY' || normalized === 'QUINZENAL') return 'BIWEEKLY';
    return 'MONTHLY';
  };

  const toLegacyFrequency = (value: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'): 'DIARIO' | 'SEMANAL' | 'QUINZENAL' | 'MENSAL' => {
    if (value === 'DAILY') return 'DIARIO';
    if (value === 'WEEKLY') return 'SEMANAL';
    if (value === 'BIWEEKLY') return 'QUINZENAL';
    return 'MENSAL';
  };

  const getNextContractNumber = () => {
    const base = 2026001;
    if (!Array.isArray(loans) || loans.length === 0) return String(base);
    const values = loans
      .map((loan) => Number(loan.contractNumber || 0))
      .filter((value) => Number.isFinite(value) && value > 0);
    const max = values.length > 0 ? Math.max(...values) : base;
    return String(max + 1);
  };

  const calculateLateFee = (inst: Installment | null | undefined) => {
    if (!inst || normalizeInstallmentStatus(inst.status) === 'PAID') return 0;
    const baseInstallmentAmount = installmentAmount(inst);
    if (!Number.isFinite(baseInstallmentAmount) || baseInstallmentAmount <= 0 || !inst.dueDate) {
      return 0;
    }

    const dueDate = new Date(inst.dueDate + 'T00:00:00');
    if (Number.isNaN(dueDate.getTime())) {
      return 0;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (dueDate < today) {
      const diffTime = today.getTime() - dueDate.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays <= 0) return 0;
      return Number((baseInstallmentAmount * 0.015 * diffDays).toFixed(2));
    }
    return 0;
  };

  const roundMoney = (value: number) => Number((Number.isFinite(value) ? value : 0).toFixed(2));

  const buildDueDateFromOffset = (
    baseDate: Date,
    offset: number,
    frequency: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY',
  ): string => {
    const dueDate = new Date(baseDate);
    if (frequency === 'DAILY') {
      dueDate.setDate(baseDate.getDate() + offset);
    } else if (frequency === 'WEEKLY') {
      dueDate.setDate(baseDate.getDate() + (offset * 7));
    } else if (frequency === 'BIWEEKLY') {
      dueDate.setDate(baseDate.getDate() + (offset * 15));
    } else {
      dueDate.setMonth(baseDate.getMonth() + offset);
    }
    return dueDate.toISOString().split('T')[0];
  };

  const getInstallmentBaseRemaining = (inst: Installment | null | undefined): number => {
    if (!inst || normalizeInstallmentStatus(inst.status) === 'PAID') return 0;
    const baseAmount = roundMoney(installmentAmount(inst));
    const paidAmount = roundMoney(installmentPaidAmount(inst));
    const paidCappedToBase = roundMoney(Math.min(Math.max(paidAmount, 0), baseAmount));
    const remaining = roundMoney(baseAmount - paidCappedToBase);
    return remaining > 0 ? remaining : 0;
  };

  const getOutstandingFromInstallmentIndex = (
    installments: Installment[],
    startIndex: number,
    includeLateFee: boolean,
  ): number =>
    roundMoney(
      installments.reduce((sum, installment, index) => {
        if (index < startIndex) return sum;
        const installmentOutstanding = includeLateFee
          ? getRemainingInstallmentValue(installment)
          : getInstallmentBaseRemaining(installment);
        return sum + installmentOutstanding;
      }, 0),
    );

  const getPendingInstallmentIndexes = (installments: Installment[], startIndex: number): number[] =>
    installments.reduce<number[]>((acc, installment, index) => {
      if (index < startIndex) return acc;
      if (getRemainingInstallmentValue(installment) > 0) {
        acc.push(index);
      }
      return acc;
    }, []);

  const parseMoneyInput = (value: string | number | undefined): number => {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : Number.NaN;
    }

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
      if (lastComma > lastDot) {
        // Ex.: 1.234,56 (pt-BR)
        normalized = normalized.replace(/\./g, '').replace(',', '.');
      } else {
        // Ex.: 1,234.56 (en-US)
        normalized = normalized.replace(/,/g, '');
      }
    } else if (hasComma) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  };

  const splitAmountEvenly = (total: number, count: number) => {
    const safeCount = Math.max(0, Math.trunc(count));
    if (safeCount === 0) return [] as number[];

    const totalCents = Math.max(0, Math.round(roundMoney(total) * 100));
    const baseCents = Math.floor(totalCents / safeCount);
    let remainder = totalCents - baseCents * safeCount;

    return Array.from({ length: safeCount }, () => {
      const valueCents = baseCents + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
      return Number((valueCents / 100).toFixed(2));
    });
  };

  const getRemainingInstallmentValue = (inst: Installment | null | undefined) => {
    if (!inst || normalizeInstallmentStatus(inst.status) === 'PAID') return 0;
    const lateFee = calculateLateFee(inst);
    const totalWithFee = roundMoney(installmentAmount(inst) + lateFee);
    const remaining = roundMoney(totalWithFee - installmentPaidAmount(inst));
    return remaining > 0 ? remaining : 0;
  };

  const resolveLoanTypeForFiscal = (loan: Loan): LoanType =>
    fromLegacyInterestType(loan.interestType) === 'PRICE' ? 'PRICE' : 'SIMPLE';

  const resolveLoanTotalReceivable = (loan: Loan): number => {
    const installmentsTotal = (Array.isArray(loan.installments) ? loan.installments : []).reduce(
      (sum, installment) => sum + installmentAmount(installment),
      0,
    );

    if (installmentsTotal > 0) {
      return roundMoney(installmentsTotal);
    }

    const fallbackTotal = Number(loan.totalToReturn || 0);
    if (Number.isFinite(fallbackTotal) && fallbackTotal > 0) {
      return roundMoney(fallbackTotal);
    }

    return roundMoney(Number(loan.amount || 0));
  };

  const mergeInstallmentBreakdown = (
    previous: PaymentBreakdown | undefined,
    current: PaymentBreakdown,
  ): PaymentBreakdown => ({
    principalPaid: roundMoney(Number(previous?.principalPaid || 0) + Number(current.principalPaid || 0)),
    interestPaid: roundMoney(Number(previous?.interestPaid || 0) + Number(current.interestPaid || 0)),
    lateFeePaid: roundMoney(Number(previous?.lateFeePaid || 0) + Number(current.lateFeePaid || 0)),
    serviceFeePaid: roundMoney(Number(previous?.serviceFeePaid || 0) + Number(current.serviceFeePaid || 0)),
    discountApplied: roundMoney(Number(previous?.discountApplied || 0) + Number(current.discountApplied || 0)),
    totalPaid: roundMoney(Number(previous?.totalPaid || 0) + Number(current.totalPaid || 0)),
  });

  const buildInstallmentPaymentEntry = (
    kind: 'PAYMENT' | 'REVERSAL',
    recordedAt: string,
    breakdown: PaymentBreakdown,
  ): InstallmentPaymentEntry => ({
    id: `ipe-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
    recordedAt,
    kind,
    principalPaid: roundMoney(Number(breakdown.principalPaid || 0)),
    interestPaid: roundMoney(Number(breakdown.interestPaid || 0)),
    lateFeePaid: roundMoney(Number(breakdown.lateFeePaid || 0)),
    serviceFeePaid: roundMoney(Number(breakdown.serviceFeePaid || 0)),
    discountApplied: roundMoney(Number(breakdown.discountApplied || 0)),
    totalPaid: roundMoney(Number(breakdown.totalPaid || 0)),
  });

  const appendInstallmentPaymentEntry = (
    installment: Installment,
    entry: InstallmentPaymentEntry,
  ): Installment => ({
    ...installment,
    paymentEntries: [...(Array.isArray(installment.paymentEntries) ? installment.paymentEntries : []), entry],
  });

  const negatePaymentBreakdown = (breakdown: PaymentBreakdown): PaymentBreakdown => ({
    principalPaid: roundMoney(-Number(breakdown.principalPaid || 0)),
    interestPaid: roundMoney(-Number(breakdown.interestPaid || 0)),
    lateFeePaid: roundMoney(-Number(breakdown.lateFeePaid || 0)),
    serviceFeePaid: roundMoney(-Number(breakdown.serviceFeePaid || 0)),
    discountApplied: roundMoney(-Number(breakdown.discountApplied || 0)),
    totalPaid: roundMoney(-Number(breakdown.totalPaid || 0)),
  });

  const applyInstallmentFiscalBreakdown = (
    loan: Loan,
    installment: Installment,
    paymentAmount: number,
    lateFeePaid = 0,
    serviceFeePaid = 0,
    discountApplied = 0,
  ) => {
    const paymentValue = roundMoney(paymentAmount);
    if (!Number.isFinite(paymentValue) || paymentValue <= 0) {
      return {
        installment,
        breakdownResult: null,
      };
    }

    const breakdownResult = buildPaymentBreakdown({
      loan: {
        id: loan.id,
        type: resolveLoanTypeForFiscal(loan),
        totalAmount: Number(loan.amount || 0),
        totalReceivable: resolveLoanTotalReceivable(loan),
      },
      installment: {
        id: installment.id,
        amount: installmentAmount(installment),
        expectedPrincipal: installment.expectedPrincipal,
        expectedInterest: installment.expectedInterest,
      },
      paidAmount: paymentValue,
      lateFeePaid,
      serviceFeePaid,
      discountApplied,
    });

    const mergedBreakdown = mergeInstallmentBreakdown(installment.paymentBreakdown, breakdownResult);
    return {
      installment: {
        ...installment,
        paymentBreakdown: mergedBreakdown,
        needsFiscalReview: installment.needsFiscalReview || breakdownResult.needsFiscalReview || undefined,
      },
      breakdownResult,
    };
  };

  const buildEarlySettlementQuote = (loan: Loan): EarlySettlementQuote | null => {
    const normalizedInterestType = fromLegacyInterestType(loan.interestType);
    if (normalizedInterestType !== 'PRICE') {
      return null;
    }

    const installments = Array.isArray(loan.installments) ? loan.installments : [];
    const entries = installments.reduce<EarlySettlementEntry[]>((acc, inst, idx) => {
      const remaining = getRemainingInstallmentValue(inst);
      if (remaining > 0) {
        acc.push({ installmentIndex: idx, remaining });
      }
      return acc;
    }, []);

    if (entries.length === 0) {
      return null;
    }

    const totalOutstanding = roundMoney(entries.reduce((sum, entry) => sum + entry.remaining, 0));
    const periodicRate = Number(loan.interestRate || 0) / 100;

    let payoffAmount = totalOutstanding;
    if (periodicRate > 0) {
      payoffAmount = roundMoney(
        entries.reduce((sum, entry, index) => {
          const periodsAhead = index + 1;
          return sum + (entry.remaining / Math.pow(1 + periodicRate, periodsAhead));
        }, 0)
      );
    }

    if (!Number.isFinite(payoffAmount) || payoffAmount <= 0) {
      payoffAmount = totalOutstanding;
    }

    const discount = roundMoney(Math.max(totalOutstanding - payoffAmount, 0));
    return {
      loanId: loan.id,
      totalOutstanding,
      discount,
      payoffAmount: roundMoney(totalOutstanding - discount),
      entries,
    };
  };

  const filteredLoans = loans.filter(loan => {
    const matchesSearch = loan.customerName.toLowerCase().includes(searchTerm.toLowerCase()) || loan.id.toLowerCase().includes(searchTerm.toLowerCase());
    const installments = Array.isArray(loan.installments) ? loan.installments : [];
    const loanStatus = effectiveLoanStatus(loan);
    
    const isOverdue = loanStatus === 'ACTIVE' && installments.some(inst => {
      if (!inst?.dueDate || normalizeInstallmentStatus(inst.status) === 'PAID') return false;
      const dueDate = new Date(inst.dueDate + 'T00:00:00');
      if (Number.isNaN(dueDate.getTime())) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return dueDate < today;
    });

    if (statusFilter === 'ALL') return matchesSearch;
    if (statusFilter === 'ACTIVE') return matchesSearch && loanStatus === 'ACTIVE' && !isOverdue;
    if (statusFilter === 'COMPLETED') return matchesSearch && loanStatus === 'COMPLETED';
    if (statusFilter === 'CANCELLED') return matchesSearch && loanStatus === 'CANCELLED';
    if (statusFilter === 'OVERDUE') return matchesSearch && isOverdue;
    return matchesSearch;
  });

  const paymentModalLoan = paymentModal ? loans.find((loan) => loan.id === paymentModal.loanId) : null;
  const paymentModalOutstandingTotal = paymentModalLoan
    ? getOutstandingFromInstallmentIndex(
        Array.isArray(paymentModalLoan.installments) ? paymentModalLoan.installments : [],
        paymentModal.installmentIndex,
        true,
      )
    : 0;

  React.useEffect(() => {
    if (initialExpandedLoanId) {
      setExpandedLoanId(initialExpandedLoanId);
      // Scroll to the element if needed
      setTimeout(() => {
        const element = document.getElementById(`loan-${initialExpandedLoanId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  }, [initialExpandedLoanId]);
  const [formData, setFormData] = useState(buildDefaultFormData);

  const calculateInstallments = () => {
    const amount = Number(formData.amount);
    const rate = Number(formData.interestRate) / 100;
    const monthlyPaidRate = Number(formData.monthlyPaidInterestRate) / 100;
    const monthlyAccruedRate = Number(formData.monthlyAccruedInterestRate) / 100;
    const count = Number(formData.installmentsCount);
    if (!amount || !count) return [];

    const installments: Installment[] = [];
    const baseDate = new Date(formData.startDate + 'T12:00:00'); // Use noon to avoid timezone shifts
    const effectiveFrequency = formData.interestType === 'SPLIT' ? 'MONTHLY' : formData.frequency;

    const buildDueDate = (index: number) => {
      const dueDate = new Date(baseDate);
      if (effectiveFrequency === 'DAILY') {
        dueDate.setDate(baseDate.getDate() + index);
      } else if (effectiveFrequency === 'WEEKLY') {
        dueDate.setDate(baseDate.getDate() + (index * 7));
      } else if (effectiveFrequency === 'BIWEEKLY') {
        dueDate.setDate(baseDate.getDate() + (index * 15));
      } else {
        dueDate.setMonth(baseDate.getMonth() + index);
      }
      return dueDate.toISOString().split('T')[0];
    };

    if (formData.interestType === 'SPLIT') {
      if (!Number.isFinite(monthlyPaidRate) || !Number.isFinite(monthlyAccruedRate) || monthlyPaidRate < 0 || monthlyAccruedRate < 0) {
        return [];
      }

      const monthlyPaidAmount = amount * monthlyPaidRate;
      const accruedTotalAmount = amount * monthlyAccruedRate * count;

      for (let i = 1; i <= count; i++) {
        let installmentAmount = monthlyPaidAmount;
        if (i === count) {
          installmentAmount += amount + accruedTotalAmount;
        }

        installments.push({
          number: i,
          dueDate: buildDueDate(i),
          amount: Number(installmentAmount.toFixed(2)),
          paidAmount: 0,
          status: 'PENDENTE'
        });
      }

      return installments;
    }

    let installmentValue = 0;
    if (formData.interestType === 'SIMPLE') {
      // Juros simples sobre o total
      const totalWithInterest = amount * (1 + rate);
      installmentValue = totalWithInterest / count;
    } else {
      // Tabela Price
      // PMT = P * [i(1+i)^n] / [(1+i)^n - 1]
      if (rate === 0) {
        installmentValue = amount / count;
      } else {
        installmentValue = amount * (rate * Math.pow(1 + rate, count)) / (Math.pow(1 + rate, count) - 1);
      }
    }

    for (let i = 1; i <= count; i++) {
      installments.push({
        number: i,
        dueDate: buildDueDate(i),
        amount: Number(installmentValue.toFixed(2)),
        paidAmount: 0,
        status: 'PENDENTE'
      });
    }
    return installments;
  };

  const resetLoanForm = () => {
    setFormData(buildDefaultFormData());
    setEditingLoanId(null);
  };

  const openNewLoanModal = () => {
    resetLoanForm();
    setIsModalOpen(true);
  };

  const openEditLoanModal = (loan: Loan) => {
    const hasPaidInstallment = (Array.isArray(loan.installments) ? loan.installments : [])
      .some(inst => installmentPaidAmount(inst) > 0 || normalizeInstallmentStatus(inst?.status) === 'PAID');

    if (hasPaidInstallment) {
      showToast('Nao e possivel editar contrato com parcelas pagas', 'error');
      return;
    }

    setEditingLoanId(loan.id);
    setFormData({
      customerId: loan.customerId,
      amount: String(loan.amount ?? ''),
      interestRate: String(loan.interestRate ?? ''),
      monthlyPaidInterestRate: String(loan.monthlyPaidInterestRate ?? ''),
      monthlyAccruedInterestRate: String(loan.monthlyAccruedInterestRate ?? ''),
      interestType: fromLegacyInterestType(loan.interestType),
      frequency: fromLegacyFrequency(loan.frequency),
      installmentsCount: String(loanInstallmentsCount(loan)),
      startDate: loan.startDate || getLocalISODate()
    });
    setIsModalOpen(true);
  };

  const handleCancelLoan = async (loan: Loan) => {
    if (normalizeLoanStatus(loan.status) === 'CANCELLED') {
      showToast('Contrato ja esta cancelado', 'error');
      return;
    }
    if (!window.confirm(`Deseja cancelar o contrato ${loan.id}?`)) return;

    try {
      await onUpdateLoan(loan.id, { status: 'CANCELADO' });
      showToast('Contrato cancelado com sucesso!', 'success');
    } catch (e) {
      showToast('Erro ao cancelar contrato', 'error');
    }
  };

  const handleDeleteLoan = async (loan: Loan) => {
    if (!window.confirm(`Deseja excluir o contrato ${loan.id}? Esta acao nao pode ser desfeita.`)) return;

    try {
      await onDeleteLoan(loan.id);
      if (expandedLoanId === loan.id) {
        setExpandedLoanId(null);
      }
    } catch (e) {
      showToast('Erro ao excluir contrato', 'error');
    }
  };

  const openEarlySettlementModal = (loan: Loan) => {
    const quote = buildEarlySettlementQuote(loan);
    if (!quote) {
      showToast('Quitacao antecipada disponivel somente para contratos PRICE com saldo pendente', 'error');
      return;
    }
    setSettlementModal(quote);
  };

  const canLoanRenewWithInterestOnly = (loan: Loan): boolean => {
    if (loan.allowInterestOnlyRenewal === false) return false;
    if (normalizeLoanStatus(loan.status) === 'CANCELLED') return false;
    if (effectiveLoanStatus(loan) !== 'ACTIVE') return false;
    return calculateInterestOnlyRenewalAmount(loan) > 0;
  };

  const openInterestOnlyRenewalModal = (loan: Loan) => {
    if (!canLoanRenewWithInterestOnly(loan)) {
      showToast('Contrato nao elegivel para renovacao por juros', 'error');
      return;
    }

    const principalAmount = roundMoney(Number(loan.amount || 0));
    const interestAmount = roundMoney(calculateInterestOnlyRenewalAmount(loan));
    const previousDueDate = getCurrentContractDueDate(loan);

    if (!previousDueDate) {
      showToast('Contrato sem vencimento valido para renovacao', 'error');
      return;
    }

    if (principalAmount <= 0 || interestAmount <= 0) {
      showToast('Nao foi possivel calcular os juros da renovacao', 'error');
      return;
    }

    setRenewalModal({
      isOpen: true,
      loanId: loan.id,
      principalAmount,
      interestAmount,
      previousDueDate,
      newDueDate: previousDueDate,
      notes: '',
    });
  };

  const closeInterestOnlyRenewalModal = () => {
    if (processingRenewal) return;
    setRenewalModal(null);
  };

  const handleConfirmEarlySettlement = async () => {
    if (!settlementModal) return;

    const loan = loans.find((item) => item.id === settlementModal.loanId);
    if (!loan) {
      showToast('Contrato nao encontrado para quitacao', 'error');
      return;
    }

    const installments = Array.isArray(loan.installments) ? [...loan.installments] : [];
    if (installments.length === 0 || settlementModal.entries.length === 0) {
      showToast('Nao ha parcelas pendentes para quitacao', 'error');
      return;
    }

    setProcessingPayment(`${loan.id}-early`);
    try {
      const nowIso = new Date().toISOString();
      const totalOutstanding = settlementModal.totalOutstanding;
      let allocated = 0;
      const lastEntryIndex = settlementModal.entries.length - 1;

      settlementModal.entries.forEach((entry, idx) => {
        const originalInstallment = installments[entry.installmentIndex];
        if (!originalInstallment) return;

        const inst = { ...originalInstallment };
        const proportionalShare =
          idx === lastEntryIndex
            ? roundMoney(settlementModal.payoffAmount - allocated)
            : roundMoney(settlementModal.payoffAmount * (entry.remaining / totalOutstanding));
        const share = roundMoney(Math.max(proportionalShare, 0));
        const discountShare = roundMoney(Math.max(entry.remaining - share, 0));
        allocated = roundMoney(allocated + share);

        const { installment: installmentWithFiscalBase, breakdownResult } = applyInstallmentFiscalBreakdown(
          loan,
          inst,
          share,
          0,
          0,
          discountShare,
        );
        const installmentWithFiscal = breakdownResult
          ? appendInstallmentPaymentEntry(
              installmentWithFiscalBase,
              buildInstallmentPaymentEntry('PAYMENT', nowIso, breakdownResult),
            )
          : installmentWithFiscalBase;

        installmentWithFiscal.paidAmount = installmentAmount(installmentWithFiscal);
        installmentWithFiscal.partialPaid = 0;
        installmentWithFiscal.status = 'PAGO';
        installmentWithFiscal.paymentDate = nowIso;
        installmentWithFiscal.lastPaymentDate = nowIso;
        installmentWithFiscal.lastPaidValue = share;
        installments[entry.installmentIndex] = installmentWithFiscal;
      });

      const allPaid = installments.filter(Boolean).every((inst) => normalizeInstallmentStatus(inst.status) === 'PAID');
      const discountLabel = settlementModal.discount.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

      await onUpdateLoanAndAddTransaction(
        loan.id,
        {
          installments,
          status: allPaid ? 'QUITADO' : 'ATIVO',
        },
        'PAGAMENTO',
        settlementModal.payoffAmount,
        `QUITACAO ANTECIPADA: ${loan.customerName} (DESCONTO R$ ${discountLabel})`
      );

      showToast(
        `Quitacao registrada! Desconto: R$ ${discountLabel} | Total pago: R$ ${settlementModal.payoffAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        'success'
      );
      setSettlementModal(null);
    } catch (error) {
      showToast('Erro ao processar quitacao antecipada', 'error');
    } finally {
      setProcessingPayment(null);
    }
  };

  const handleConfirmInterestOnlyRenewal = async () => {
    if (!renewalModal) return;

    const loan = loans.find((item) => item.id === renewalModal.loanId);
    if (!loan) {
      showToast('Contrato nao encontrado para renovacao', 'error');
      return;
    }

    if (!canLoanRenewWithInterestOnly(loan)) {
      showToast('Contrato nao elegivel para renovacao por juros', 'error');
      return;
    }

    const newDueDate = String(renewalModal.newDueDate || '').trim();
    if (!newDueDate) {
      showToast('Informe a nova data de vencimento', 'error');
      return;
    }

    const dueDateShift = shiftPendingInstallmentsToNewDueDate(loan, newDueDate);
    if (!dueDateShift) {
      showToast('Nova data de vencimento invalida para renovacao', 'error');
      return;
    }

    const calculatedInterest = roundMoney(calculateInterestOnlyRenewalAmount(loan));
    if (!Number.isFinite(calculatedInterest) || calculatedInterest <= 0) {
      showToast('Juros de renovacao invalido', 'error');
      return;
    }

    const expectedInterest = roundMoney(renewalModal.interestAmount);
    if (Math.abs(expectedInterest - calculatedInterest) > 0.01) {
      showToast('Valor de juros desatualizado. Reabra a renovacao.', 'error');
      return;
    }

    setProcessingRenewal(loan.id);
    try {
      const renewalNow = new Date().toISOString();
      const nextRenewCount = Math.max(0, Math.trunc(Number(loan.renewCount || 0))) + 1;
      const renewalRecordId = `ior-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
      const renewalHistory = Array.isArray(loan.renewalHistory) ? [...loan.renewalHistory] : [];
      renewalHistory.push({
        id: renewalRecordId,
        type: 'interest_only_renewal',
        amount: calculatedInterest,
        paymentDate: renewalNow,
        previousDueDate: dueDateShift.previousDueDate,
        newDueDate: dueDateShift.newDueDate,
        notes: renewalModal.notes?.trim() || undefined,
        principalUnchanged: roundMoney(Number(loan.amount || 0)),
        performedByUid: currentActor?.uid || undefined,
        performedByEmail: currentActor?.email || undefined,
        performedByName: currentActor?.displayName || undefined,
      });

      await onUpdateLoanAndAddTransaction(
        loan.id,
        {
          installments: dueDateShift.installments,
          dueDate: dueDateShift.contractDueDate,
          status: 'ATIVO',
          renewCount: nextRenewCount,
          lastRenewAt: renewalNow,
          renewalHistory,
        },
        'PAGAMENTO',
        calculatedInterest,
        `RENOVACAO JUROS (SEM AMORTIZACAO): ${loan.customerName}`
      );

      showToast('Renovacao registrada com pagamento de juros!', 'success');
      setRenewalModal(null);
    } catch (error) {
      showToast('Erro ao renovar contrato por juros', 'error');
    } finally {
      setProcessingRenewal(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const customer = customers.find(c => c.id === formData.customerId);
    if (!customer) return showToast('Selecione um cliente', 'error');

    if (formData.interestType === 'SPLIT') {
      const totalMonthlyRate = Number(formData.interestRate);
      const paidMonthlyRate = Number(formData.monthlyPaidInterestRate);
      const accruedMonthlyRate = Number(formData.monthlyAccruedInterestRate);

      if (!Number.isFinite(totalMonthlyRate) || totalMonthlyRate < 0 || !Number.isFinite(paidMonthlyRate) || paidMonthlyRate < 0 || !Number.isFinite(accruedMonthlyRate) || accruedMonthlyRate < 0) {
        showToast('Preencha os percentuais do contrato de juros divididos', 'error');
        return;
      }

      const expectedTotal = Number((paidMonthlyRate + accruedMonthlyRate).toFixed(4));
      const informedTotal = Number(totalMonthlyRate.toFixed(4));
      if (Math.abs(expectedTotal - informedTotal) > 0.0001) {
        showToast('A soma de % pago mensal + % acumulado deve ser igual ao juros total mensal', 'error');
        return;
      }
    }

    const installments = calculateInstallments();
    if (!installments.length) {
      showToast('Nao foi possivel calcular as parcelas. Revise os dados.', 'error');
      return;
    }

    const isSplitContract = formData.interestType === 'SPLIT';
    const totalToReturn = installments.reduce((acc, curr) => acc + installmentAmount(curr), 0);
    const installmentValue = installmentAmount(installments[0]);
    const dueDate = installments[installments.length - 1]?.dueDate || formData.startDate;
    const payload: Partial<Loan> = {
      customerId: customer.id,
      customerName: customer.name,
      amount: Number(formData.amount),
      interestRate: Number(formData.interestRate),
      customerPhone: customer.phone || '',
      interestType: toLegacyInterestType(formData.interestType),
      monthlyPaidInterestRate: isSplitContract ? Number(formData.monthlyPaidInterestRate) : undefined,
      monthlyAccruedInterestRate: isSplitContract ? Number(formData.monthlyAccruedInterestRate) : undefined,
      frequency: isSplitContract ? 'MENSAL' : toLegacyFrequency(formData.frequency),
      installmentCount: Number(formData.installmentsCount),
      installmentsCount: Number(formData.installmentsCount),
      totalToReturn,
      installmentValue,
      dueDate,
      startDate: formData.startDate,
      paidAmount: 0,
      installments
    };

    try {
      if (editingLoanId) {
        const currentLoan = loans.find(l => l.id === editingLoanId);
        await onUpdateLoan(editingLoanId, {
          ...payload,
          status: normalizeLoanStatus(currentLoan?.status) === 'CANCELLED' ? 'CANCELADO' : 'ATIVO'
        });
        showToast('Contrato atualizado com sucesso!', 'success');
      } else {
        const newLoan: LoanDraft = {
          contractNumber: getNextContractNumber(),
          customerId: payload.customerId || customer.id,
          customerName: payload.customerName || customer.name,
          customerPhone: customer.phone || '',
          amount: Number(payload.amount || 0),
          interestRate: Number(payload.interestRate || 0),
          interestType: payload.interestType || 'SIMPLES',
          monthlyPaidInterestRate: payload.monthlyPaidInterestRate,
          monthlyAccruedInterestRate: payload.monthlyAccruedInterestRate,
          frequency: payload.frequency || 'MENSAL',
          installmentCount: Number(payload.installmentCount || payload.installmentsCount || 0),
          installmentsCount: Number(payload.installmentsCount || payload.installmentCount || 0),
          totalToReturn: Number(totalToReturn.toFixed(2)),
          installmentValue: Number(installmentValue.toFixed(2)),
          startDate: payload.startDate || getLocalISODate(),
          dueDate,
          status: 'ATIVO',
          paidAmount: 0,
          notes: '',
          installments: payload.installments || [],
        };
        const createdLoanId = await Promise.resolve(onAddLoan(newLoan));
        try {
          const loanForPdf: Loan = {
            ...newLoan,
            id: createdLoanId || String(newLoan.contractNumber || Date.now()),
            createdAt: Date.now(),
          };
          generateContractPDF(customer, loanForPdf);
          showToast('Contrato efetivado e PDF gerado!', 'success');
        } catch (pdfError) {
          console.error('Contrato salvo, mas falhou ao gerar PDF:', pdfError);
          showToast('Contrato salvo, mas falhou ao gerar PDF.', 'error');
        }
      }

      setIsModalOpen(false);
      resetLoanForm();
    } catch (error) {
      if (editingLoanId) {
        showToast('Erro ao atualizar contrato', 'error');
      }
    }
  };

  const handlePayment = async (
    amount?: string | React.MouseEvent,
    directLoanId?: string,
    directInstIdx?: number,
    directApplyMode?: PaymentApplyMode,
  ) => {
    const overrideAmount = typeof amount === 'string' ? amount : undefined;
    const activeModal = paymentModal;
    if (!activeModal && !overrideAmount) return;

    const loanId = directLoanId || activeModal?.loanId;
    const instIdx = directInstIdx !== undefined ? directInstIdx : activeModal?.installmentIndex;

    if (!loanId || instIdx === undefined) return;

    const loan = loans.find(l => l.id === loanId);
    if (!loan) return;

    const loanInstallments = Array.isArray(loan.installments) ? [...loan.installments] : [];
    if (!loanInstallments[instIdx]) {
      showToast('Parcela invalida para pagamento', 'error');
      return;
    }

    const parsedAmount = parseMoneyInput(overrideAmount ?? activeModal?.amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      showToast('Valor invalido', 'error');
      return;
    }

    const applyMode: PaymentApplyMode = directApplyMode || activeModal?.applyMode || 'INSTALLMENTS';
    const processingKey = `${loanId}-${instIdx}`;
    if (processingPaymentGuardRef.current) {
      return;
    }
    processingPaymentGuardRef.current = processingKey;

    setProcessingPayment(processingKey);
    try {
      let newInstallments = [...loanInstallments];
      let remainingToApply = Number(parsedAmount.toFixed(2));
      const requestedAmount = remainingToApply;
      const processedAt = new Date().toISOString();
      let changedInstallment = false;
      const shouldRedistribute = applyMode === 'REDISTRIBUTE_BALANCE';

      if (shouldRedistribute) {
        const redistributionStartIndex = instIdx;
        const pendingIndexes = getPendingInstallmentIndexes(newInstallments, redistributionStartIndex);

        if (pendingIndexes.length === 0) {
          showToast('Nenhuma parcela pendente para redividir', 'error');
          return;
        }

        const desiredInstallmentsCount = Number.parseInt(
          String(activeModal?.redistributionInstallmentsCount ?? ''),
          10,
        );
        if (!Number.isInteger(desiredInstallmentsCount) || desiredInstallmentsCount <= 0) {
          showToast('Informe um numero valido de parcelas para redividir', 'error');
          return;
        }

        const hasSettledInstallmentAfterStart = newInstallments
          .slice(redistributionStartIndex)
          .some((installment) => getRemainingInstallmentValue(installment) <= 0);
        if (hasSettledInstallmentAfterStart) {
          showToast('Nao e possivel redividir: existe parcela quitada no intervalo selecionado', 'error');
          return;
        }

        const hasPartialPaymentAfterStart = newInstallments
          .slice(redistributionStartIndex)
          .some((installment) => installmentPaidAmount(installment) > 0);
        if (hasPartialPaymentAfterStart) {
          showToast('Nao e possivel redividir: existe parcela com pagamento parcial no intervalo selecionado', 'error');
          return;
        }

        const outstandingTotal = roundMoney(
          pendingIndexes.reduce((sum, index) => {
            const installment = newInstallments[index];
            const remainingValue = getRemainingInstallmentValue(installment);
            return sum + remainingValue;
          }, 0),
        );
        if (outstandingTotal <= 0) {
          showToast('Nenhum saldo pendente para redividir', 'error');
          return;
        }

        const appliedInRedistribution = roundMoney(Math.min(remainingToApply, outstandingTotal));
        const remainingOutstanding = roundMoney(Math.max(outstandingTotal - appliedInRedistribution, 0));
        const redistributedValues = splitAmountEvenly(remainingOutstanding, desiredInstallmentsCount);

        const redistributionFrequency = fromLegacyFrequency(loan.frequency);
        const requestedStartDateIso = String(activeModal?.redistributionStartDate || '').trim() || getLocalISODate();
        const todayIso = getLocalISODate();
        if (requestedStartDateIso < todayIso) {
          showToast('Data de inicio da cobranca deve ser hoje ou futura', 'error');
          return;
        }
        const redistributionBaseDate = new Date(`${requestedStartDateIso}T12:00:00`);
        if (Number.isNaN(redistributionBaseDate.getTime())) {
          showToast('Data inicial de redivisao invalida', 'error');
          return;
        }

        const preservedInstallments = newInstallments.slice(0, redistributionStartIndex);
        const baseNumber = Number(newInstallments[redistributionStartIndex]?.number || redistributionStartIndex + 1);
        const redistributedInstallments: Installment[] = redistributedValues.map((newInstallmentValue, position) => {
          const existingInstallment = newInstallments[redistributionStartIndex + position];
          const rebuilt: Installment = existingInstallment
            ? { ...existingInstallment }
            : {
                number: baseNumber + position,
                dueDate: buildDueDateFromOffset(redistributionBaseDate, position, redistributionFrequency),
                amount: newInstallmentValue,
                paidAmount: 0,
                status: 'PENDENTE',
              };

          rebuilt.number = baseNumber + position;
          rebuilt.dueDate = buildDueDateFromOffset(redistributionBaseDate, position, redistributionFrequency);
          rebuilt.amount = newInstallmentValue;
          rebuilt.value = newInstallmentValue;
          rebuilt.paidAmount = 0;
          rebuilt.partialPaid = 0;
          rebuilt.lastPaidValue = undefined;
          rebuilt.paymentDate = undefined;
          rebuilt.paidAt = undefined;
          rebuilt.lastPaymentDate = undefined;
          rebuilt.paymentAmount = undefined;
          rebuilt.paymentBreakdown = undefined;
          rebuilt.paymentEntries = undefined;
          rebuilt.needsFiscalReview = undefined;
          rebuilt.status = 'PENDENTE';

          return rebuilt;
        });

        newInstallments = [...preservedInstallments, ...redistributedInstallments];

        remainingToApply = roundMoney(remainingToApply - appliedInRedistribution);
        changedInstallment = appliedInRedistribution > 0;
      } else {
        const installmentIndexes =
          applyMode === 'TOTAL_BALANCE'
            ? newInstallments.map((_, index) => index).reverse()
            : Array.from({ length: Math.max(newInstallments.length - instIdx, 0) }, (_, offset) => instIdx + offset);

        for (const currentIdx of installmentIndexes) {
          if (remainingToApply <= 0) break;
          const originalInstallment = newInstallments[currentIdx];
          if (!originalInstallment) continue;

          let inst = { ...originalInstallment };
          const lateFee = calculateLateFee(inst);
          const totalWithFee = Number((installmentAmount(inst) + lateFee).toFixed(2));
          const alreadyPaid = Number(installmentPaidAmount(inst));
          const remaining = Number((totalWithFee - alreadyPaid).toFixed(2));

          if (!Number.isFinite(remaining) || remaining <= 0) {
            continue;
          }

          const appliedNow = roundMoney(Math.min(remainingToApply, remaining));
          if (!Number.isFinite(appliedNow) || appliedNow <= 0) {
            continue;
          }

          const alreadyAllocatedLateFee = Number(inst.paymentBreakdown?.lateFeePaid || 0);
          const remainingLateFee = roundMoney(Math.max(lateFee - alreadyAllocatedLateFee, 0));
          const lateFeePaidNow = roundMoney(Math.min(appliedNow, remainingLateFee));

          const { installment: installmentWithFiscalBase, breakdownResult } = applyInstallmentFiscalBreakdown(
            loan,
            inst,
            appliedNow,
            lateFeePaidNow,
          );
          inst = breakdownResult
            ? appendInstallmentPaymentEntry(
                installmentWithFiscalBase,
                buildInstallmentPaymentEntry('PAYMENT', processedAt, breakdownResult),
              )
            : installmentWithFiscalBase;

          changedInstallment = true;
          if (remainingToApply + 0.000001 >= remaining) {
            remainingToApply = Number((remainingToApply - remaining).toFixed(2));
            inst.paidAmount = totalWithFee;
            inst.status = 'PAGO';
            inst.paymentDate = processedAt;
            inst.lastPaymentDate = processedAt;
            inst.partialPaid = 0;
            inst.lastPaidValue = totalWithFee;
          } else {
            const partialValue = Number((alreadyPaid + remainingToApply).toFixed(2));
            inst.paidAmount = partialValue;
            inst.partialPaid = partialValue;
            inst.lastPaymentDate = processedAt;
            remainingToApply = 0;
            if (normalizeInstallmentStatus(inst.status) !== 'PAID') {
              inst.status = 'PENDENTE';
            }
          }

          newInstallments[currentIdx] = inst;
        }
      }

      if (!changedInstallment) {
        showToast('Nenhuma parcela pendente para quitar', 'error');
        return;
      }

      const appliedAmount = Number((requestedAmount - remainingToApply).toFixed(2));
      if (!Number.isFinite(appliedAmount) || appliedAmount <= 0) {
        showToast('Nenhum valor foi aplicado nas parcelas', 'error');
        return;
      }

      const allPaid = newInstallments.filter(Boolean).every(i => normalizeInstallmentStatus(i.status) === 'PAID');
      const paymentLabel =
        applyMode === 'TOTAL_BALANCE'
          ? `PAGAMENTO (ABATIMENTO SALDO): ${loan.customerName}`
          : applyMode === 'REDISTRIBUTE_BALANCE'
            ? `PAGAMENTO (ABATE + REDIVISAO): ${loan.customerName}`
            : `PAGAMENTO (ABATIMENTO PARCELAS): ${loan.customerName}`;

      await onUpdateLoanAndAddTransaction(
        loan.id,
        {
          installments: newInstallments,
          status: allPaid ? 'QUITADO' : 'ATIVO'
        },
        'PAGAMENTO',
        appliedAmount,
        paymentLabel
      );

      if (remainingToApply > 0.000001) {
        showToast(
          `Pagamento aplicado: R$ ${appliedAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}. Excedente nao aplicado: R$ ${remainingToApply.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`,
          'success'
        );
      } else {
        showToast('Pagamento processado!', 'success');
      }
      setPaymentModal(null);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '';
      const safeDetail = message && message !== 'Error' ? ` (${message})` : '';
      showToast(`Erro ao processar pagamento${safeDetail}`, 'error');
      console.error('Falha ao processar pagamento:', e);
    } finally {
      if (processingPaymentGuardRef.current === processingKey) {
        processingPaymentGuardRef.current = null;
      }
      setProcessingPayment(null);
    }
  };

  const handleReverseInstallment = async (loan: Loan, index: number) => {
    const newInstallments = [...loan.installments];
    const inst = { ...newInstallments[index] };
    const amountToReverse = Number(inst.lastPaidValue ?? installmentPaidAmount(inst));

    if (amountToReverse <= 0) return;

    const reversalTimestamp = new Date().toISOString();
    const legacyPaymentTimestamp = inst.paidAt || inst.paymentDate || inst.lastPaymentDate;
    const seededLegacyEntries =
      !Array.isArray(inst.paymentEntries) || inst.paymentEntries.length === 0
        ? (
            inst.paymentBreakdown && legacyPaymentTimestamp
              ? [buildInstallmentPaymentEntry('PAYMENT', legacyPaymentTimestamp, inst.paymentBreakdown)]
              : []
          )
        : inst.paymentEntries;
    const reversalEntry = inst.paymentBreakdown
      ? buildInstallmentPaymentEntry('REVERSAL', reversalTimestamp, negatePaymentBreakdown(inst.paymentBreakdown))
      : null;

    inst.paidAmount = 0;
    inst.partialPaid = 0;
    inst.status = 'PENDENTE';
    inst.paymentDate = undefined;
    inst.lastPaymentDate = undefined;
    inst.lastPaidValue = undefined;
    inst.paymentBreakdown = undefined;
    inst.paymentEntries = reversalEntry
      ? [...seededLegacyEntries, reversalEntry]
      : seededLegacyEntries.length > 0
        ? seededLegacyEntries
        : undefined;
    inst.needsFiscalReview = undefined;
    newInstallments[index] = inst;

    try {
      await onUpdateLoanAndAddTransaction(
        loan.id,
        { 
          installments: newInstallments,
          status: 'ATIVO' // Always active if we are reversing a payment
        },
        'ESTORNO',
        amountToReverse,
        `ESTORNO PARCELA ${inst.number}: ${loan.customerName}`
      );
      showToast('Pagamento estornado!', 'success');
    } catch (e) {
      showToast('Erro ao estornar pagamento', 'error');
    }
  };

  const handleWhatsApp = (loan: Loan) => {
    if (effectiveLoanStatus(loan) !== 'ACTIVE') {
      showToast('Contrato concluido/cancelado. Cobranca indisponivel.', 'error');
      return;
    }
    const customer = customers.find(c => c.id === loan.customerId);
    if (!customer?.phone) {
      return showToast('Cliente sem telefone cadastrado', 'error');
    }
    const phone = customer.phone.replace(/\D/g, '');
    const text = encodeURIComponent(`Ola ${customer.name}, estou entrando em contato sobre o seu contrato ${loan.id}.`);
    window.open(`https://wa.me/55${phone}?text=${text}`, '_blank');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <h2 className="text-xs font-black gold-text uppercase tracking-[0.2em]">Gestao de Contratos</h2>
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
          <div className="relative flex-1 lg:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
            <input
              type="text"
              placeholder="BUSCAR CONTRATO..."
              className="w-full bg-[#050505] border border-zinc-900 rounded-xl py-3 pl-10 pr-4 text-[10px] text-white outline-none focus:border-[#BF953F] transition-all"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex bg-[#050505] border border-zinc-900 rounded-xl p-1 overflow-x-auto max-w-full">
            {(['ALL', 'ACTIVE', 'OVERDUE', 'COMPLETED', 'CANCELLED'] as const).map(f => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={`px-4 py-2 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
                  statusFilter === f ? 'gold-gradient text-black' : 'text-zinc-500 hover:text-white'
                }`}
              >
                {f === 'ALL' ? 'Todos' : f === 'ACTIVE' ? 'Ativos' : f === 'OVERDUE' ? 'Atrasados' : f === 'COMPLETED' ? 'Concluidos' : 'Cancelados'}
              </button>
            ))}
          </div>
          <button
            onClick={openNewLoanModal}
            className="px-6 py-3 gold-gradient text-black rounded-xl font-black text-[10px] tracking-widest uppercase flex items-center gap-2 whitespace-nowrap"
          >
            <Plus size={16} /> Novo Contrato
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {filteredLoans.map(loan => {
          const loanInstallments = Array.isArray(loan.installments) ? loan.installments : [];
          const resolvedLoanStatus = effectiveLoanStatus(loan);
          const paidInstallmentsCount = loanInstallments.filter((inst) => normalizeInstallmentStatus(inst.status) === 'PAID').length;
          const totalInstallmentsCount = loanInstallmentsCount(loan);
          const totalReceivableAmount = resolveLoanTotalReceivable(loan);
          const totalRemainingLoanAmount = Number(
            loanInstallments
              .reduce((sum, inst) => sum + getRemainingInstallmentValue(inst), 0)
              .toFixed(2)
          );
          const todayIso = getLocalISODate();
          const overdueInstallments = loanInstallments.filter((inst) => (
            !!inst?.dueDate &&
            normalizeInstallmentStatus(inst.status) !== 'PAID' &&
            inst.dueDate < todayIso &&
            getRemainingInstallmentValue(inst) > 0
          ));
          const overdueLoanAmount = Number(
            overdueInstallments
              .reduce((sum, inst) => sum + getRemainingInstallmentValue(inst), 0)
              .toFixed(2)
          );
          const isOverdue = resolvedLoanStatus === 'ACTIVE' && overdueInstallments.length > 0;
          const showOverdueLoanAmount = isOverdue && overdueLoanAmount > 0;
          const showRemainingLoanAmount =
            resolvedLoanStatus === 'ACTIVE' &&
            paidInstallmentsCount > 0 &&
            totalRemainingLoanAmount > 0 &&
            !showOverdueLoanAmount;
          const showTotalRemainingLoanAmount =
            showOverdueLoanAmount &&
            totalRemainingLoanAmount > overdueLoanAmount + 0.009;
          const canEarlySettle =
            resolvedLoanStatus === 'ACTIVE' &&
            fromLegacyInterestType(loan.interestType) === 'PRICE' &&
            loanInstallments.some((inst) => getRemainingInstallmentValue(inst) > 0);
          const canInterestOnlyRenew = canLoanRenewWithInterestOnly(loan);
          const canChargeLoan = resolvedLoanStatus === 'ACTIVE' && totalRemainingLoanAmount > 0;

          return (
            <div key={loan.id} id={`loan-${loan.id}`} className={`bg-[#050505] border rounded-[2rem] overflow-hidden transition-all ${
              isOverdue ? 'border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.05)]' : 'border-zinc-900'
            }`}>
              <div
                onClick={() => setExpandedLoanId(expandedLoanId === loan.id ? null : loan.id)}
                className="w-full p-4 sm:p-6 flex flex-wrap items-center justify-between gap-3 sm:gap-4 hover:bg-zinc-900/30 transition-colors text-left cursor-pointer"
              >
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] font-black text-white uppercase break-words">{loan.customerName}</p>
                  </div>
                  <p className="text-[9px] text-zinc-500 uppercase tracking-widest break-all">Contrato: {loan.id}</p>
                </div>
              <div className="flex-1 min-w-[160px]">
                <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-1">Valor Emprestado</p>
                <p className="text-[11px] font-black text-white">R$ {(loan.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                <p className="text-[8px] font-black text-[#BF953F] mt-1 uppercase tracking-widest">
                  Total a pagar: R$ {totalReceivableAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
                {showOverdueLoanAmount && (
                  <p className="text-[9px] font-black text-red-500 mt-1">
                    Em atraso: R$ {overdueLoanAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                )}
                {showTotalRemainingLoanAmount && (
                  <p className="text-[8px] font-black text-emerald-500 mt-1">
                    Saldo total: R$ {totalRemainingLoanAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                )}
                {showRemainingLoanAmount && (
                  <p className="text-[9px] font-black text-emerald-500 mt-1">
                    Restante: R$ {totalRemainingLoanAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                )}
              </div>
              <div className="flex-1 min-w-[100px]">
                <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-1">Parcelas</p>
                <p className="text-[11px] font-black text-white">
                  {paidInstallmentsCount} / {totalInstallmentsCount}
                </p>
              </div>
              <div className="w-full sm:w-auto flex flex-wrap items-center justify-start sm:justify-end gap-2 sm:ml-auto">
                {canEarlySettle && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEarlySettlementModal(loan);
                    }}
                    className="min-h-[42px] px-3 py-2 bg-emerald-500/10 text-emerald-400 rounded-xl hover:bg-emerald-500 hover:text-black transition-all text-[8px] font-black uppercase tracking-widest whitespace-nowrap"
                    title="Calcular e registrar quitacao antecipada"
                  >
                    Quitar Restante
                  </button>
                )}
                {canInterestOnlyRenew && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openInterestOnlyRenewalModal(loan);
                    }}
                    className="min-h-[42px] px-3 py-2 bg-[#BF953F]/10 text-[#BF953F] rounded-xl hover:bg-[#BF953F] hover:text-black transition-all text-[8px] font-black uppercase tracking-widest whitespace-nowrap"
                    title="Renovar pagando apenas os juros"
                  >
                    Renovar Juros
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleWhatsApp(loan);
                  }}
                  className={`h-[42px] w-[42px] shrink-0 rounded-xl transition-all flex items-center justify-center ${
                    canChargeLoan
                      ? 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-black'
                      : 'bg-zinc-900 text-zinc-700 cursor-not-allowed'
                  }`}
                  title={canChargeLoan ? 'WhatsApp' : 'Contrato sem cobranca pendente'}
                  disabled={!canChargeLoan}
                >
                  <MessageCircle size={18} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openEditLoanModal(loan);
                  }}
                  className="h-[42px] w-[42px] shrink-0 bg-blue-500/10 text-blue-500 rounded-xl hover:bg-blue-500 hover:text-black transition-all flex items-center justify-center"
                  title="Editar contrato"
                >
                  <Pencil size={16} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCancelLoan(loan);
                  }}
                  className={`h-[42px] w-[42px] shrink-0 rounded-xl transition-all flex items-center justify-center ${
                    normalizeLoanStatus(loan.status) === 'CANCELLED'
                      ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                      : 'bg-amber-500/10 text-amber-500 hover:bg-amber-500 hover:text-black'
                  }`}
                  title="Cancelar contrato"
                  disabled={normalizeLoanStatus(loan.status) === 'CANCELLED'}
                >
                  <Ban size={16} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteLoan(loan);
                  }}
                  className="h-[42px] w-[42px] shrink-0 bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500 hover:text-black transition-all flex items-center justify-center"
                  title="Excluir contrato"
                >
                  <Trash2 size={16} />
                </button>
                <span className={`text-[8px] font-black px-3 py-1 rounded-full uppercase ${
                  resolvedLoanStatus === 'ACTIVE' 
                    ? (isOverdue ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-500') 
                    : resolvedLoanStatus === 'COMPLETED' 
                      ? 'bg-blue-500/10 text-blue-500' 
                      : 'bg-zinc-800 text-zinc-500'
                }`}>
                  {resolvedLoanStatus === 'ACTIVE' && isOverdue ? 'Atrasado' : 
                   resolvedLoanStatus === 'ACTIVE' ? 'Ativo' : 
                   resolvedLoanStatus === 'COMPLETED' ? 'Concluido' : 'Cancelado'}
                </span>
                <Plus size={16} className={`text-[#BF953F] transition-transform ${expandedLoanId === loan.id ? 'rotate-45' : ''}`} />
              </div>
            </div>

            {expandedLoanId === loan.id && Array.isArray(loan.installments) && (
              <div className="px-6 pb-6 border-t border-zinc-900 animate-in slide-in-from-top duration-300">
                <div className="pt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {loan.installments.map((inst, idx) => {
                    if (!inst) return null;
                    const isLocked =
                      idx > 0 &&
                      normalizeInstallmentStatus(loan.installments[idx - 1]?.status) !== 'PAID';
                    const lateFee = calculateLateFee(inst);
                    const totalWithFee = installmentAmount(inst) + lateFee;
                    const remaining = totalWithFee - installmentPaidAmount(inst);
                    const isPartialPending =
                      normalizeInstallmentStatus(inst.status) !== 'PAID' &&
                      installmentPaidAmount(inst) > 0 &&
                      remaining > 0;
                    const totalOutstandingFromCurrent = getOutstandingFromInstallmentIndex(loanInstallments, idx, true);
                    const overdueDisplayAmount = isPartialPending ? totalOutstandingFromCurrent : remaining;
                    const dueDate = inst.dueDate ? new Date(inst.dueDate + 'T12:00:00') : null;
                    
                    return (
                      <div key={idx} className={`bg-[#000000] border border-zinc-900 p-4 rounded-2xl flex flex-col gap-4 ${isLocked ? 'opacity-50' : ''} ${lateFee > 0 ? 'border-red-500/30' : ''}`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Parcela {inst.number}</p>
                            <div className="flex flex-col">
                              <p className="text-[10px] font-black text-white">R$ {installmentAmount(inst).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                              {lateFee > 0 && (
                                <p className="text-[8px] font-black text-red-500">
                                  + R$ {lateFee.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (Multa)
                                </p>
                              )}
                            </div>
                            <p className="text-[8px] text-zinc-600 uppercase mt-1">
                              Venc: {dueDate && !isNaN(dueDate.getTime()) ? dueDate.toLocaleDateString('pt-BR') : '---'}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Pago</p>
                            <p className={`text-[10px] font-black ${installmentPaidAmount(inst) > 0 ? 'text-emerald-500' : 'text-zinc-700'}`}>
                              R$ {installmentPaidAmount(inst).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </p>
                            {remaining > 0 && (
                              <div className="mt-1 pt-1 border-t border-zinc-900/50">
                                <p className="text-[7px] font-black text-red-500/70 uppercase tracking-widest">
                                  {isPartialPending ? 'Em atraso' : 'Falta'}
                                </p>
                                <p className="text-[9px] font-black text-red-500">
                                  R$ {overdueDisplayAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-col gap-2">
                          {normalizeInstallmentStatus(inst.status) !== 'PAID' && (
                            <div className="flex gap-2">
                              <button
                                disabled={isLocked || !!processingPayment}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Direct full payment including late fee
                                  handlePayment(Math.max(remaining, 0).toFixed(2), loan.id, idx);
                                }}
                                className={`flex-1 py-2 rounded-xl text-[7px] font-black uppercase tracking-widest flex items-center justify-center gap-1 transition-all ${
                                  isLocked || !!processingPayment
                                    ? 'bg-zinc-900 text-zinc-700 cursor-not-allowed' 
                                    : 'bg-emerald-500 text-black hover:bg-emerald-400 shadow-lg shadow-emerald-500/10'
                                }`}
                                title="Pagar valor total da parcela agora (incluindo multa se houver)"
                              >
                                {processingPayment === `${loan.id}-${idx}` ? (
                                  <Loader2 size={10} className="animate-spin" />
                                ) : (
                                  <CheckCircle size={10} />
                                )}
                                {processingPayment === `${loan.id}-${idx}` ? 'Processando' : 'Quitar'}
                              </button>
                              
                              <button
                                disabled={isLocked || !!processingPayment}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const pendingCountFromCurrent = getPendingInstallmentIndexes(loanInstallments, idx).length;
                                  setPaymentModal({
                                    isOpen: true,
                                    loanId: loan.id,
                                    installmentIndex: idx,
                                    amount: Math.max(remaining, 0).toFixed(2),
                                    applyMode: 'INSTALLMENTS',
                                    redistributionStartDate: getLocalISODate(),
                                    redistributionInstallmentsCount: String(Math.max(pendingCountFromCurrent, 1)),
                                  });
                                }}
                                className={`flex-1 py-2 rounded-xl text-[7px] font-black uppercase tracking-widest flex items-center justify-center gap-1 transition-all ${
                                  isLocked || !!processingPayment
                                    ? 'bg-zinc-900 text-zinc-700 cursor-not-allowed' 
                                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                                }`}
                                title="Pagar valor parcial"
                              >
                                <DollarSign size={10} /> Parcial
                              </button>
                            </div>
                          )}
                          
                          {installmentPaidAmount(inst) > 0 && (
                            <button
                              disabled={!!processingPayment}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReverseInstallment(loan, idx);
                              }}
                              className="w-full py-2 rounded-xl text-[7px] font-black uppercase tracking-widest flex items-center justify-center gap-1 border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-all disabled:opacity-50"
                            >
                              <RotateCcw size={10} /> Estornar
                            </button>
                          )}
                        </div>
                        
                        {isLocked && (
                          <p className="text-[7px] text-zinc-600 uppercase text-center italic">Aguardando parcela anterior</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          );
        })}
      </div>

      {/* MODAL DE RENOVACAO POR JUROS */}
      {renewalModal?.isOpen && (
        <div className="fixed inset-0 z-[300] flex items-start sm:items-center justify-center p-3 sm:p-4 bg-[#000000]/90 backdrop-blur-md overflow-y-auto">
          <div className="bg-[#050505] border border-zinc-900 w-full max-w-xl rounded-[2rem] sm:rounded-[2.5rem] p-5 sm:p-8 relative shadow-2xl max-h-[calc(100vh-1.5rem)] sm:max-h-[calc(100vh-2rem)] overflow-y-auto">
            <button
              onClick={closeInterestOnlyRenewalModal}
              className="absolute top-4 right-4 sm:top-6 sm:right-6 text-zinc-500 hover:text-white disabled:opacity-50"
              disabled={processingRenewal === renewalModal.loanId}
            >
              <XCircle size={22} />
            </button>

            <div className="flex items-start sm:items-center gap-3 mb-5 sm:mb-6 pr-10 sm:pr-12">
              <div className="p-3 bg-[#BF953F]/10 rounded-2xl shrink-0">
                <Percent size={24} className="text-[#BF953F]" />
              </div>
              <div className="min-w-0">
                <h2 className="text-[11px] sm:text-sm font-black text-white uppercase tracking-[0.22em] leading-snug">
                  Renovar Pagando Apenas Juros
                </h2>
                <p className="text-[9px] text-zinc-500 uppercase tracking-[0.18em] mt-1 leading-relaxed">
                  Principal permanece em aberto
                </p>
              </div>
            </div>

            {(() => {
              const loan = loans.find((item) => item.id === renewalModal.loanId);
              if (!loan) {
                return (
                  <div className="rounded-2xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-red-400">
                    Contrato nao encontrado para renovacao.
                  </div>
                );
              }

              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="bg-[#000000] border border-zinc-900 rounded-2xl p-4">
                      <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Cliente</p>
                      <p className="text-[11px] sm:text-xs font-black text-white break-words leading-relaxed">{loan.customerName}</p>
                    </div>
                    <div className="bg-[#000000] border border-zinc-900 rounded-2xl p-4">
                      <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Contrato</p>
                      <p className="text-[11px] sm:text-xs font-black text-white break-all leading-relaxed">{loan.id}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-[#000000] border border-zinc-900 rounded-2xl p-4">
                      <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Principal Atual</p>
                      <p className="text-[11px] font-black text-white">
                        R$ {renewalModal.principalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="bg-[#000000] border border-zinc-900 rounded-2xl p-4">
                      <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Taxa de Juros</p>
                      <p className="text-[11px] font-black text-white">{Number(loan.interestRate || 0).toFixed(2)}%</p>
                    </div>
                    <div className="bg-[#000000] border border-zinc-900 rounded-2xl p-4">
                      <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Tipo de Juros</p>
                      <p className="text-[11px] font-black text-white">{String(loan.interestType || 'SIMPLES')}</p>
                    </div>
                  </div>

                  <div className="bg-[#000000] border border-[#BF953F]/20 rounded-2xl p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Juros da Renovacao</p>
                      <p className="text-[8px] text-zinc-600 uppercase tracking-widest leading-relaxed">
                        Sem amortizacao do principal
                      </p>
                    </div>
                    <p className="text-base sm:text-lg font-black text-[#BF953F] break-words">
                      R$ {renewalModal.interestAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest ml-1">
                        Vencimento Atual
                      </label>
                      <input
                        type="date"
                        className="w-full min-h-[52px] bg-[#000000] border border-zinc-800 rounded-2xl px-4 py-3 text-white outline-none text-xs"
                        value={renewalModal.previousDueDate}
                        disabled
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest ml-1">
                        Novo Vencimento
                      </label>
                      <input
                        type="date"
                        className="w-full min-h-[52px] bg-[#000000] border border-zinc-800 rounded-2xl px-4 py-3 text-white outline-none focus:border-[#BF953F] text-xs"
                        value={renewalModal.newDueDate}
                        onChange={(event) =>
                          setRenewalModal((previous) =>
                            previous
                              ? {
                                  ...previous,
                                  newDueDate: event.target.value,
                                }
                              : previous,
                          )
                        }
                        disabled={processingRenewal === renewalModal.loanId}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest ml-1">
                      Observacao (opcional)
                    </label>
                    <textarea
                      className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs min-h-[110px] resize-none"
                      value={renewalModal.notes}
                      onChange={(event) =>
                        setRenewalModal((previous) =>
                          previous
                            ? {
                                ...previous,
                                notes: event.target.value,
                              }
                            : previous,
                        )
                      }
                      disabled={processingRenewal === renewalModal.loanId}
                      placeholder="Motivo ou observacao adicional"
                    />
                  </div>

                  <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
                    <button
                      onClick={closeInterestOnlyRenewalModal}
                      disabled={processingRenewal === renewalModal.loanId}
                      className="w-full sm:flex-1 min-h-[52px] py-4 bg-zinc-900 text-zinc-500 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-zinc-800 transition-all disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleConfirmInterestOnlyRenewal}
                      disabled={processingRenewal === renewalModal.loanId}
                      className="w-full sm:flex-1 min-h-[52px] py-4 gold-gradient text-black rounded-2xl font-black uppercase text-[10px] tracking-widest hover:opacity-90 transition-all disabled:opacity-70 flex items-center justify-center gap-2"
                    >
                      {processingRenewal === renewalModal.loanId ? (
                        <>
                          <Loader2 size={12} className="animate-spin" /> Processando
                        </>
                      ) : (
                        'Confirmar Renovacao'
                      )}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* MODAL DE PAGAMENTO */}
      {paymentModal?.isOpen && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-[#000000]/90 backdrop-blur-md">
          <div className="bg-[#050505] border border-zinc-900 w-full max-w-sm rounded-[2.5rem] p-8 relative shadow-2xl">
            <button onClick={() => setPaymentModal(null)} className="absolute top-6 right-6 text-zinc-500 hover:text-white">
              <XCircle size={24} />
            </button>
            
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-emerald-500/10 rounded-2xl">
                <DollarSign size={24} className="text-emerald-500" />
              </div>
              <div>
                <h2 className="text-sm font-black text-white uppercase tracking-widest">Registrar Pagamento</h2>
                <p className="text-[9px] text-zinc-500 uppercase tracking-widest mt-1">Informe o valor recebido</p>
              </div>
            </div>

            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Valor do Pagamento</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 font-black text-xs">R$</span>
                  <input
                    autoFocus
                    type="text"
                    inputMode="decimal"
                    placeholder="0,00"
                    className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 pl-10 text-white outline-none focus:border-emerald-500 text-sm font-black"
                    value={paymentModal.amount}
                    onChange={e => setPaymentModal({ ...paymentModal, amount: e.target.value.replace(/[^\d,.-]/g, '') })}
                  />
                </div>
                <p className="text-[8px] text-zinc-600 uppercase italic ml-1">
                  * Valores maiores que a parcela podem ser distribuidos em outras parcelas.
                </p>
                <p className="text-[8px] text-red-500/80 uppercase ml-1">
                  Valor em atraso (total faltante): R$ {paymentModalOutstandingTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Forma de Abatimento</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentModal({ ...paymentModal, applyMode: 'INSTALLMENTS' })}
                    className={`py-3 rounded-xl text-[8px] font-black uppercase tracking-widest border transition-all ${
                      paymentModal.applyMode === 'INSTALLMENTS'
                        ? 'bg-emerald-500 text-black border-emerald-400'
                        : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    Em Parcelas
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentModal({ ...paymentModal, applyMode: 'TOTAL_BALANCE' })}
                    className={`py-3 rounded-xl text-[8px] font-black uppercase tracking-widest border transition-all ${
                      paymentModal.applyMode === 'TOTAL_BALANCE'
                        ? 'bg-[#BF953F] text-black border-[#BF953F]'
                        : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    No Saldo Total
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const pendingCountFromCurrent = paymentModalLoan
                        ? getPendingInstallmentIndexes(
                            Array.isArray(paymentModalLoan.installments) ? paymentModalLoan.installments : [],
                            paymentModal.installmentIndex,
                          ).length
                        : 0;
                      setPaymentModal({
                        ...paymentModal,
                        applyMode: 'REDISTRIBUTE_BALANCE',
                        redistributionStartDate: paymentModal.redistributionStartDate || getLocalISODate(),
                        redistributionInstallmentsCount:
                          paymentModal.redistributionInstallmentsCount || String(Math.max(pendingCountFromCurrent, 1)),
                      });
                    }}
                    className={`py-3 rounded-xl text-[8px] font-black uppercase tracking-widest border transition-all ${
                      paymentModal.applyMode === 'REDISTRIBUTE_BALANCE'
                        ? 'bg-blue-500 text-black border-blue-400'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    Redividir
                  </button>
                </div>
                {paymentModal.applyMode === 'REDISTRIBUTE_BALANCE' && (
                  <div className="space-y-2 pt-1">
                    <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest ml-1">
                      Início da nova cobrança
                    </label>
                    <input
                      type="date"
                      className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-blue-400 text-xs"
                      value={paymentModal.redistributionStartDate}
                      min={getLocalISODate()}
                      onChange={(event) =>
                        setPaymentModal({
                          ...paymentModal,
                          redistributionStartDate: event.target.value,
                        })
                      }
                    />
                    <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest ml-1 pt-1 block">
                      Novo número de parcelas
                    </label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-blue-400 text-xs"
                      value={paymentModal.redistributionInstallmentsCount}
                      onChange={(event) =>
                        setPaymentModal({
                          ...paymentModal,
                          redistributionInstallmentsCount: event.target.value.replace(/[^\d]/g, ''),
                        })
                      }
                    />
                  </div>
                )}
                <p className="text-[8px] text-zinc-600 uppercase italic ml-1">
                  {paymentModal.applyMode === 'TOTAL_BALANCE'
                    ? '* Abate do fim para o inicio das parcelas pendentes.'
                    : paymentModal.applyMode === 'REDISTRIBUTE_BALANCE'
                      ? '* Abate, soma saldo+multas, redefine quantidade de parcelas e novos vencimentos.'
                      : '* Abate em sequencia: parcela atual e, se sobrar, parcelas seguintes.'}
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  disabled={!!processingPayment}
                  onClick={() => setPaymentModal(null)}
                  className="flex-1 py-4 bg-zinc-900 text-zinc-500 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-zinc-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancelar
                </button>
                <button
                  disabled={!!processingPayment}
                  onClick={handlePayment}
                  className="flex-1 py-4 bg-emerald-500 text-black rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {processingPayment ? 'Processando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE QUITACAO ANTECIPADA */}
      {settlementModal && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-[#000000]/90 backdrop-blur-md">
          <div className="bg-[#050505] border border-zinc-900 w-full max-w-md rounded-[2.5rem] p-8 relative shadow-2xl">
            <button
              onClick={() => setSettlementModal(null)}
              className="absolute top-6 right-6 text-zinc-500 hover:text-white"
              disabled={processingPayment === `${settlementModal.loanId}-early`}
            >
              <XCircle size={24} />
            </button>

            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-emerald-500/10 rounded-2xl">
                <Calculator size={24} className="text-emerald-500" />
              </div>
              <div>
                <h2 className="text-sm font-black text-white uppercase tracking-widest">Quitacao Antecipada</h2>
                <p className="text-[9px] text-zinc-500 uppercase tracking-widest mt-1">Calculo de desconto para contrato PRICE</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="bg-[#000000] border border-zinc-900 rounded-2xl p-4 flex items-center justify-between">
                <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Saldo em aberto</span>
                <span className="text-sm font-black text-white">
                  R$ {settlementModal.totalOutstanding.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </div>

              <div className="bg-[#000000] border border-emerald-500/20 rounded-2xl p-4 flex items-center justify-between">
                <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Desconto calculado</span>
                <span className="text-sm font-black text-emerald-500">
                  R$ {settlementModal.discount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </div>

              <div className="bg-[#000000] border border-[#BF953F]/30 rounded-2xl p-4 flex items-center justify-between">
                <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Total para quitar hoje</span>
                <span className="text-lg font-black text-[#BF953F]">
                  R$ {settlementModal.payoffAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            <p className="mt-4 text-[8px] text-zinc-600 uppercase tracking-widest">
              O valor considera desconto de juros futuros nas parcelas pendentes.
            </p>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setSettlementModal(null)}
                disabled={processingPayment === `${settlementModal.loanId}-early`}
                className="flex-1 py-4 bg-zinc-900 text-zinc-500 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-zinc-800 transition-all disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmEarlySettlement}
                disabled={processingPayment === `${settlementModal.loanId}-early`}
                className="flex-1 py-4 bg-emerald-500 text-black rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-70 flex items-center justify-center gap-2"
              >
                {processingPayment === `${settlementModal.loanId}-early` ? (
                  <>
                    <Loader2 size={12} className="animate-spin" /> Processando
                  </>
                ) : (
                  'Confirmar Quitacao'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-[#000000]/80 backdrop-blur-sm overflow-y-auto">
          <div className="bg-[#050505] border border-zinc-900 w-full max-w-lg rounded-[2.5rem] p-5 sm:p-8 relative max-h-[92dvh] overflow-y-auto">
            <button
              onClick={() => {
                setIsModalOpen(false);
                resetLoanForm();
              }}
              className="absolute top-6 right-6 text-zinc-500 hover:text-white"
            >
              <Plus className="rotate-45" size={24} />
            </button>
            <h2 className="text-xl font-black gold-text uppercase tracking-tighter mb-8">{editingLoanId ? 'Editar Contrato' : 'Novo Emprestimo'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Cliente</label>
                <select
                  required
                  className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs appearance-none"
                  value={formData.customerId}
                  onChange={e => setFormData({ ...formData, customerId: e.target.value })}
                >
                  <option value="">SELECIONE O CLIENTE</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name.toUpperCase()}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Tipo de Juros</label>
                  <select
                    className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs appearance-none"
                    value={formData.interestType}
                    onChange={e => {
                      const nextInterestType = e.target.value as 'SIMPLE' | 'PRICE' | 'SPLIT';
                      setFormData({
                        ...formData,
                        interestType: nextInterestType,
                        frequency: nextInterestType === 'SPLIT' ? 'MONTHLY' : formData.frequency
                      });
                    }}
                  >
                    <option value="SIMPLE">JUROS SIMPLES (TOTAL)</option>
                    <option value="PRICE">TABELA PRICE (MENSAL)</option>
                    <option value="SPLIT">JUROS DIVIDIDOS (PAGO + ACUMULADO)</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Frequencia</label>
                  <select
                    className={`w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs appearance-none ${formData.interestType === 'SPLIT' ? 'opacity-60 cursor-not-allowed' : ''}`}
                    value={formData.frequency}
                    onChange={e => setFormData({ ...formData, frequency: e.target.value as 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' })}
                    disabled={formData.interestType === 'SPLIT'}
                  >
                    <option value="DAILY">DIARIO</option>
                    <option value="WEEKLY">SEMANAL</option>
                    <option value="BIWEEKLY">QUINZENAL</option>
                    <option value="MONTHLY">MENSAL</option>
                  </select>
                  {formData.interestType === 'SPLIT' && (
                    <p className="text-[8px] text-zinc-600 uppercase mt-1">No contrato dividido, a frequencia e mensal.</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Valor</label>
                  <input
                    type="number" placeholder="0.00" required
                    className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs"
                    value={formData.amount}
                    onChange={e => setFormData({ ...formData, amount: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">
                    {formData.interestType === 'SPLIT' ? 'Juros Total Mensal (%)' : 'Taxa (%)'}
                  </label>
                  <input
                    type="number" placeholder="0" required
                    className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs"
                    value={formData.interestRate}
                    onChange={e => setFormData({ ...formData, interestRate: e.target.value })}
                  />
                </div>
              </div>
              {formData.interestType === 'SPLIT' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">% Pago Mensal</label>
                    <input
                      type="number"
                      placeholder="0"
                      required
                      className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs"
                      value={formData.monthlyPaidInterestRate}
                      onChange={e => setFormData({ ...formData, monthlyPaidInterestRate: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">% Acumulado para Final</label>
                    <input
                      type="number"
                      placeholder="0"
                      required
                      className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs"
                      value={formData.monthlyAccruedInterestRate}
                      onChange={e => setFormData({ ...formData, monthlyAccruedInterestRate: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-2 rounded-2xl border border-zinc-800 bg-[#000000]/60 px-4 py-3">
                    <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">
                      Soma configurada: {(Number(formData.monthlyPaidInterestRate || 0) + Number(formData.monthlyAccruedInterestRate || 0)).toFixed(2)}%
                    </p>
                    <p className="text-[8px] text-zinc-600 uppercase mt-1">
                      Regra: % pago mensal + % acumulado = juros total mensal.
                    </p>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Parcelas</label>
                  <input
                    type="number" placeholder="1" required
                    className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs"
                    value={formData.installmentsCount}
                    onChange={e => setFormData({ ...formData, installmentsCount: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Data Inicio</label>
                  <input
                    type="date" required
                    className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs"
                    value={formData.startDate}
                    onChange={e => setFormData({ ...formData, startDate: e.target.value })}
                  />
                </div>
              </div>

              {/* RESUMO DO CALCULO */}
              {formData.amount && formData.installmentsCount && (
                <div className="space-y-3 p-6 bg-zinc-900/50 border border-zinc-800 rounded-2xl">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Valor da Parcela</p>
                      <p className="text-sm font-black text-white">
                        R$ {(calculateInstallments()[0]?.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                      {formData.interestType === 'SPLIT' && (
                        <p className="text-[8px] text-zinc-500 mt-2 uppercase">
                          Parcela Final: R$ {(calculateInstallments()[Math.max(calculateInstallments().length - 1, 0)]?.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Total de Juros</p>
                      <p className="text-sm font-black text-[#BF953F]">
                        R$ {(calculateInstallments().reduce((acc, curr) => acc + curr.amount, 0) - Number(formData.amount)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                  <div className="pt-3 border-t border-zinc-800">
                    <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Total a Pagar</p>
                    <p className="text-lg font-black text-emerald-500">
                      R$ {calculateInstallments().reduce((acc, curr) => acc + curr.amount, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
              )}

              <button className="w-full py-5 gold-gradient text-black rounded-2xl font-black uppercase text-[10px] tracking-widest mt-4">
                {editingLoanId ? 'Salvar Alteracoes' : 'Efetivar Contrato'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoanSection;












