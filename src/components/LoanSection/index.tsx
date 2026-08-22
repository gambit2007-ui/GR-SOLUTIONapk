import React, { useState } from 'react';
import {
  CreatedLoanResult,
  Customer,
  Loan,
  LoanDraft,
  Installment,
  LoanPaymentRequest,
  LoanPaymentResult,
  LoanPaymentReversalRequest,
  LoanPaymentReversalResult,
  PaymentApplyMode,
  DataLoadStatus,
} from '../../types';
import { Plus, Calculator, Calendar, User, Percent, MessageCircle, CheckCircle, RotateCcw, XCircle, DollarSign, Loader2, Search, Pencil, Ban, FileDown } from 'lucide-react';
import {
  effectiveLoanStatus,
  installmentAmount,
  installmentPaidAmount,
  loanInstallmentsCount,
  normalizeInstallmentStatus,
  normalizeLoanStatus,
} from '../../utils/loanCompat';
import { buildInstallmentDueDate, getLocalISODate } from '../../utils/dateTime';
import { calculateInstallmentLateFee } from '../../utils/lateFee';
import {
  buildEarlySettlementQuote,
  EarlySettlementQuote,
  getInstallmentBaseRemaining as calculateInstallmentBaseRemaining,
  getInstallmentOutstanding,
} from '../../utils/financialEngine';
import {
  calculateInterestOnlyRenewalAmount,
  getCurrentContractDueDate,
  getNextMonthlyDueDate,
  shiftPendingInstallmentsToNewDueDate,
} from '../../utils/interestOnlyRenewal';

interface LoanSectionProps {
  customers: Customer[];
  loans: Loan[];
  isLoadingCustomers?: boolean;
  loansLoadStatus?: DataLoadStatus;
  isLoadingMoreLoans?: boolean;
  totalLoans?: number;
  hasMoreLoans?: boolean;
  onLoadMoreLoans?: () => void;
  onAddLoan: (draft: LoanDraft) => Promise<CreatedLoanResult>;
  onUpdateLoan: (loanId: string, newData: Partial<Loan>) => Promise<void>;
  onCancelLoan: (loanId: string, reason: string) => Promise<void>;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  initialExpandedLoanId?: string | null;
  currentActor?: {
    uid?: string | null;
    email?: string | null;
    displayName?: string | null;
  };
  dailyLateFeeRate?: number;
  onUpdateLoanAndAddTransaction: (
    loanId: string,
    newData: Partial<Loan>,
    type: 'PAGAMENTO' | 'ESTORNO',
    amount: number,
    description: string
  ) => Promise<void>;
  onApplyLoanPayment: (loanId: string, request: LoanPaymentRequest) => Promise<LoanPaymentResult>;
  onReverseLoanPayment: (
    loanId: string,
    request: LoanPaymentReversalRequest,
  ) => Promise<LoanPaymentReversalResult>;
}

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
  lateFeeAmount: number;
  payLateFee: boolean;
  previousDueDate: string;
  newDueDate: string;
  notes: string;
}

const LoanSection: React.FC<LoanSectionProps> = ({ 
  customers, 
  loans, 
  isLoadingCustomers = false,
  loansLoadStatus = 'ready',
  isLoadingMoreLoans = false,
  totalLoans,
  hasMoreLoans = false,
  onLoadMoreLoans,
  onAddLoan, 
  onUpdateLoan,
  onCancelLoan,
  showToast, 
  initialExpandedLoanId,
  currentActor,
  dailyLateFeeRate,
  onUpdateLoanAndAddTransaction,
  onApplyLoanPayment,
  onReverseLoanPayment,
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
  const pendingPaymentOperationIdsRef = React.useRef<Record<string, string>>({});
  const [paymentModal, setPaymentModal] = useState<PaymentModalState | null>(null);
  const [settlementModal, setSettlementModal] = useState<EarlySettlementQuote | null>(null);
  const [renewalModal, setRenewalModal] = useState<InterestOnlyRenewalModalState | null>(null);
  const [processingRenewal, setProcessingRenewal] = useState<string | null>(null);
  const [generatingContractPdfId, setGeneratingContractPdfId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'COMPLETED' | 'OVERDUE' | 'CANCELLED'>('ALL');
  const [currentPage, setCurrentPage] = useState(1);

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

  const calculateLateFee = (installment: Installment | null | undefined) =>
    calculateInstallmentLateFee(installment, new Date(), dailyLateFeeRate);

  const roundMoney = (value: number) => Number((Number.isFinite(value) ? value : 0).toFixed(2));

  const getPaymentOperationId = (fingerprint: string): string => {
    const existing = pendingPaymentOperationIdsRef.current[fingerprint];
    if (existing) return existing;
    const generated = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `payment-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    pendingPaymentOperationIdsRef.current[fingerprint] = generated;
    return generated;
  };

  const clearPaymentOperationId = (fingerprint: string) => {
    delete pendingPaymentOperationIdsRef.current[fingerprint];
  };

  const buildDueDateFromOffset = (
    baseDate: Date,
    offset: number,
    frequency: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY',
  ): string => {
    return buildInstallmentDueDate(baseDate, offset, frequency) || getLocalISODate(baseDate);
  };

  const getInstallmentBaseRemaining = (inst: Installment | null | undefined): number => {
    return calculateInstallmentBaseRemaining(inst);
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
    return getInstallmentOutstanding(inst, new Date(), dailyLateFeeRate).total;
  };

  const resolveLoanTotalReceivable = (loan: Loan): number => {
    const installmentsTotal = (Array.isArray(loan.installments) ? loan.installments : [])
      .reduce((sum, installment) => sum + installmentAmount(installment), 0);
    return roundMoney(
      installmentsTotal || Number(loan.totalToReturn || 0) || Number(loan.amount || 0),
    );
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

  const LOANS_PER_PAGE = 10;
  const totalPages = Math.max(1, Math.ceil(filteredLoans.length / LOANS_PER_PAGE));
  const currentPageSafe = Math.min(currentPage, totalPages);
  const paginatedLoans = filteredLoans.slice(
    (currentPageSafe - 1) * LOANS_PER_PAGE,
    currentPageSafe * LOANS_PER_PAGE,
  );

  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter]);

  React.useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paymentModalLoan = paymentModal ? loans.find((loan) => loan.id === paymentModal.loanId) : null;
  const paymentModalOutstandingTotal = paymentModalLoan
    ? getOutstandingFromInstallmentIndex(
        Array.isArray(paymentModalLoan.installments) ? paymentModalLoan.installments : [],
        paymentModal?.installmentIndex ?? 0,
        true,
      )
    : 0;

  React.useEffect(() => {
    if (initialExpandedLoanId) {
      setStatusFilter('ALL');
      setSearchTerm(initialExpandedLoanId);
      setCurrentPage(1);
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
      return buildInstallmentDueDate(baseDate, index, effectiveFrequency) || getLocalISODate(baseDate);
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
          expectedPrincipal: i === count ? Number(amount.toFixed(2)) : 0,
          expectedInterest: Number((installmentAmount - (i === count ? amount : 0)).toFixed(2)),
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

  const handleDownloadContract = async (loan: Loan) => {
    if (generatingContractPdfId) return;

    const customer = customers.find((item) => item.id === loan.customerId);
    if (!customer) {
      showToast('Cliente nao encontrado para gerar o contrato', 'error');
      return;
    }

    setGeneratingContractPdfId(loan.id);
    try {
      const { generateContractPDF } = await import('../../utils/contractGenerator');
      generateContractPDF(customer, loan, { dailyLateFeeRate });
      showToast('Contrato atualizado gerado em PDF!', 'success');
    } catch (error) {
      console.error('Falha ao gerar o contrato em PDF:', error);
      showToast('Nao foi possivel gerar o contrato em PDF.', 'error');
    } finally {
      setGeneratingContractPdfId(null);
    }
  };

  const handleCancelLoan = async (loan: Loan) => {
    if (normalizeLoanStatus(loan.status) === 'CANCELLED') {
      showToast('Contrato ja esta cancelado', 'error');
      return;
    }
    if (effectiveLoanStatus(loan) === 'COMPLETED') {
      showToast('Contrato quitado nao pode ser cancelado', 'error');
      return;
    }
    const reason = window.prompt(
      `Informe o motivo do cancelamento do contrato ${loan.contractNumber || loan.id}:`,
      'Cancelamento solicitado pelo usuario',
    );
    if (reason === null) return;
    if (!reason.trim()) {
      showToast('Informe o motivo do cancelamento', 'error');
      return;
    }
    if (!window.confirm('Confirmar cancelamento? O historico financeiro sera preservado.')) return;

    try {
      await onCancelLoan(loan.id, reason.trim());
    } catch (error) {
      showToast('Erro ao cancelar contrato', 'error');
    }
  };

  const openEarlySettlementModal = (loan: Loan) => {
    const quote = buildEarlySettlementQuote(loan, new Date(), dailyLateFeeRate);
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
    const currentInstallment = (Array.isArray(loan.installments) ? loan.installments : []).find(
      (installment) => normalizeInstallmentStatus(installment.status) !== 'PAID',
    );

    if (!previousDueDate) {
      showToast('Contrato sem vencimento valido para renovacao', 'error');
      return;
    }

    if (principalAmount <= 0 || interestAmount <= 0) {
      showToast('Nao foi possivel calcular os juros da renovacao', 'error');
      return;
    }

    const newDueDate = getNextMonthlyDueDate(previousDueDate);
    if (!newDueDate) {
      showToast('Nao foi possivel calcular o vencimento do mes seguinte', 'error');
      return;
    }

    const lateFeeAmount = roundMoney(
      Math.max(
        calculateLateFee(currentInstallment),
        0,
      ),
    );

    setRenewalModal({
      isOpen: true,
      loanId: loan.id,
      principalAmount,
      interestAmount,
      lateFeeAmount,
      payLateFee: lateFeeAmount > 0,
      previousDueDate,
      newDueDate,
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

    if (!Array.isArray(loan.installments) || loan.installments.length === 0 || settlementModal.entries.length === 0) {
      showToast('Nao ha parcelas pendentes para quitacao', 'error');
      return;
    }

    const fingerprint = `settlement:${loan.id}:${settlementModal.payoffAmount}`;
    setProcessingPayment(`${loan.id}-early`);
    try {
      const result = await onApplyLoanPayment(loan.id, {
        operationId: getPaymentOperationId(fingerprint),
        installmentIndex: settlementModal.entries[0].installmentIndex,
        applyMode: 'EARLY_SETTLEMENT',
        processedAt: new Date().toISOString(),
      });
      clearPaymentOperationId(fingerprint);
      const discountLabel = result.discountApplied.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

      showToast(
        `${result.duplicate ? 'Quitacao ja registrada.' : 'Quitacao registrada!'} Desconto: R$ ${discountLabel} | Total pago: R$ ${result.appliedAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
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

    const pendingInstallmentIndex = (Array.isArray(loan.installments) ? loan.installments : []).findIndex(
      (installment) => normalizeInstallmentStatus(installment.status) !== 'PAID',
    );
    if (pendingInstallmentIndex < 0) {
      showToast('Contrato sem parcela pendente para renovacao', 'error');
      return;
    }

    const currentInstallment = loan.installments[pendingInstallmentIndex];
    const calculatedLateFee = roundMoney(
      Math.max(
        calculateLateFee(currentInstallment),
        0,
      ),
    );
    if (Math.abs(renewalModal.lateFeeAmount - calculatedLateFee) > 0.01) {
      showToast('Valor da multa desatualizado. Reabra a renovacao.', 'error');
      return;
    }

    const lateFeePaid = renewalModal.payLateFee ? calculatedLateFee : 0;
    const lateFeeCarried = renewalModal.payLateFee ? 0 : calculatedLateFee;
    const totalPayment = roundMoney(calculatedInterest + lateFeePaid);
    const renewedInstallments = dueDateShift.installments.map((installment, index) =>
      index === pendingInstallmentIndex
        ? {
            ...installment,
            carriedLateFee: lateFeeCarried > 0 ? lateFeeCarried : undefined,
          }
        : installment,
    );

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
        interestPaid: calculatedInterest,
        lateFeePaid: lateFeePaid > 0 ? lateFeePaid : undefined,
        lateFeeCarried: lateFeeCarried > 0 ? lateFeeCarried : undefined,
        totalPaid: totalPayment,
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
          installments: renewedInstallments,
          dueDate: dueDateShift.contractDueDate,
          status: 'ATIVO',
          renewCount: nextRenewCount,
          lastRenewAt: renewalNow,
          renewalHistory,
        },
        'PAGAMENTO',
        totalPayment,
        lateFeePaid > 0
          ? `RENOVACAO JUROS + MULTA (SEM AMORTIZACAO): ${loan.customerName}`
          : `RENOVACAO JUROS (SEM AMORTIZACAO): ${loan.customerName}`
      );

      showToast(
        lateFeePaid > 0
          ? `Renovacao registrada: juros e multa pagos. Total R$ ${totalPayment.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`
          : lateFeeCarried > 0
            ? 'Renovacao registrada. A multa foi mantida em aberto para o proximo ciclo.'
            : 'Renovacao registrada com pagamento de juros!',
        'success',
      );
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
        if (!currentLoan) {
          showToast('Contrato nao encontrado para atualizacao', 'error');
          return;
        }
        const hasFinancialHistory = currentLoan.installments.some((installment) => (
          installmentPaidAmount(installment) > 0 ||
          Boolean(installment.paymentBreakdown) ||
          (Array.isArray(installment.paymentEntries) && installment.paymentEntries.length > 0)
        ));
        if (hasFinancialHistory) {
          showToast(
            'Contrato com pagamentos nao pode ter as condicoes financeiras alteradas. Gere o PDF atualizado sem editar o cronograma.',
            'error',
          );
          return;
        }

        const updatedPayload: Partial<Loan> = {
          ...payload,
          status: normalizeLoanStatus(currentLoan?.status) === 'CANCELLED' ? 'CANCELADO' : 'ATIVO'
        };
        await onUpdateLoan(editingLoanId, updatedPayload);

        try {
          const updatedLoan: Loan = {
            ...currentLoan,
            ...updatedPayload,
            id: editingLoanId,
            installments: updatedPayload.installments || currentLoan.installments,
          };
          const { generateContractPDF } = await import('../../utils/contractGenerator');
          generateContractPDF(customer, updatedLoan, { dailyLateFeeRate });
          showToast('Contrato atualizado e novo PDF gerado!', 'success');
        } catch (pdfError) {
          console.error('Contrato atualizado, mas falhou ao gerar o novo PDF:', pdfError);
          showToast('Contrato atualizado, mas falhou ao gerar o novo PDF.', 'error');
        }
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
        const createdLoan = await onAddLoan(newLoan);
        try {
          const loanForPdf: Loan = {
            ...newLoan,
            id: createdLoan?.id || String(newLoan.contractNumber || Date.now()),
            contractNumber: createdLoan?.contractNumber || newLoan.contractNumber,
            createdAt: Date.now(),
          };
          const { generateContractPDF } = await import('../../utils/contractGenerator');
          generateContractPDF(customer, loanForPdf, { dailyLateFeeRate });
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
    const installmentIndex = directInstIdx !== undefined ? directInstIdx : activeModal?.installmentIndex;
    if (!loanId || installmentIndex === undefined) return;

    const loan = loans.find((item) => item.id === loanId);
    if (!loan || !loan.installments[installmentIndex]) {
      showToast('Parcela invalida para pagamento', 'error');
      return;
    }

    const parsedAmount = parseMoneyInput(overrideAmount ?? activeModal?.amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      showToast('Valor invalido', 'error');
      return;
    }

    const applyMode: PaymentApplyMode = directApplyMode || activeModal?.applyMode || 'INSTALLMENTS';
    const redistributionInstallmentsCount = applyMode === 'REDISTRIBUTE_BALANCE'
      ? Number.parseInt(String(activeModal?.redistributionInstallmentsCount || ''), 10)
      : undefined;
    const redistributionStartDate = applyMode === 'REDISTRIBUTE_BALANCE'
      ? String(activeModal?.redistributionStartDate || '').trim()
      : undefined;

    if (
      applyMode === 'REDISTRIBUTE_BALANCE' &&
      (!Number.isInteger(redistributionInstallmentsCount) || Number(redistributionInstallmentsCount) <= 0)
    ) {
      showToast('Informe um numero valido de parcelas para redividir', 'error');
      return;
    }
    if (applyMode === 'REDISTRIBUTE_BALANCE' && (!redistributionStartDate || redistributionStartDate < getLocalISODate())) {
      showToast('Data de inicio da cobranca deve ser hoje ou futura', 'error');
      return;
    }

    const processingKey = `${loanId}-${installmentIndex}`;
    if (processingPaymentGuardRef.current) return;
    processingPaymentGuardRef.current = processingKey;
    const fingerprint = [
      loanId,
      installmentIndex,
      applyMode,
      roundMoney(parsedAmount),
      redistributionStartDate || '',
      redistributionInstallmentsCount || '',
    ].join(':');

    setProcessingPayment(processingKey);
    try {
      const result = await onApplyLoanPayment(loanId, {
        operationId: getPaymentOperationId(fingerprint),
        amount: roundMoney(parsedAmount),
        installmentIndex,
        applyMode,
        processedAt: new Date().toISOString(),
        redistributionStartDate,
        redistributionInstallmentsCount,
      });
      clearPaymentOperationId(fingerprint);

      if (result.unappliedAmount > 0.000001) {
        showToast(
          `Pagamento aplicado: R$ ${result.appliedAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}. Excedente nao aplicado: R$ ${result.unappliedAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`,
          'success',
        );
      } else {
        showToast(result.duplicate ? 'Pagamento ja estava processado.' : 'Pagamento processado!', 'success');
      }
      setPaymentModal(null);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '';
      const safeDetail = message && message !== 'Error' ? ` (${message})` : '';
      showToast(`Erro ao processar pagamento${safeDetail}`, 'error');
      console.error('Falha ao processar pagamento:', error);
    } finally {
      if (processingPaymentGuardRef.current === processingKey) {
        processingPaymentGuardRef.current = null;
      }
      setProcessingPayment(null);
    }
  };

  const handleReverseInstallment = async (loan: Loan, index: number) => {
    const installment = loan.installments[index];
    const amountToReverse = Number(installment?.lastPaidValue ?? installmentPaidAmount(installment));
    if (amountToReverse <= 0) return;
    if (!window.confirm(
      `Estornar somente o ultimo pagamento de R$ ${amountToReverse.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} desta parcela?`,
    )) return;

    const operationId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `reversal-${crypto.randomUUID()}`
      : `reversal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const processingKey = `${loan.id}-${index}`;
    setProcessingPayment(processingKey);

    try {
      const result = await onReverseLoanPayment(loan.id, { operationId, installmentIndex: index });
      showToast(
        result.duplicate ? 'Estorno ja estava processado.' : 'Ultimo pagamento estornado!',
        'success',
      );
    } catch (error) {
      showToast('Erro ao estornar pagamento', 'error');
    } finally {
      setProcessingPayment(null);
    }
  };

  const handleWhatsApp = (loan: Loan) => {
    if (effectiveLoanStatus(loan) !== 'ACTIVE') {
      showToast('Contrato concluido/cancelado. Cobranca indisponivel.', 'error');
      return;
    }
    const fallbackPhone = String(loan.customerPhone || '').trim();
    const customer = customers.find(c => c.id === loan.customerId);
    const phoneValue = customer?.phone || fallbackPhone;
    const customerName = customer?.name || loan.customerName;
    if (!phoneValue) {
      return showToast('Cliente sem telefone cadastrado', 'error');
    }
    const targetInstallment = (Array.isArray(loan.installments) ? loan.installments : []).find(
      (installment) => getRemainingInstallmentValue(installment) > 0,
    );
    if (!targetInstallment) {
      return showToast('Contrato sem parcela pendente para cobranca', 'error');
    }

    const installmentValue = getRemainingInstallmentValue(targetInstallment);
    const dueDate = targetInstallment.dueDate
      ? new Date(`${targetInstallment.dueDate}T12:00:00`).toLocaleDateString('pt-BR')
      : 'Nao informada';
    const phone = phoneValue.replace(/\D/g, '');
    const text = encodeURIComponent(
      `Ol\u00e1, ${customerName}. Tudo bem?\n\n` +
      `Aqui \u00e9 da GR SOLUTION.\n\n` +
      `Estou entrando em contato para lembrar sobre sua parcela no valor de R$ ${installmentValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}, com vencimento em ${dueDate}.\n\n` +
      `Caso j\u00e1 tenha realizado o pagamento, por favor envie o comprovante para darmos baixa em nosso sistema.\n\n` +
      `Qualquer d\u00favida, estou \u00e0 disposi\u00e7\u00e3o.\n\n` +
      `Atenciosamente,\n` +
      `GR SOLUTION`
    );
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

      {isLoadingCustomers && (
        <div className="bg-[#050505] border border-zinc-900 rounded-2xl px-4 py-3 flex items-center gap-3">
          <div className="h-4 w-4 rounded-full border-2 border-zinc-800 border-t-[#BF953F] animate-spin" />
          <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">
            Carregando clientes para novos contratos...
          </span>
        </div>
      )}

      <div className="space-y-4">
        {(loansLoadStatus === 'idle' || loansLoadStatus === 'loading') && loans.length === 0 ? (
          <div role="status" aria-live="polite" className="bg-[#050505] border border-zinc-900 rounded-[2rem] p-8 flex items-center justify-center gap-3">
            <Loader2 size={16} className="animate-spin text-[#BF953F]" />
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
              Carregando contratos...
            </p>
          </div>
        ) : loansLoadStatus === 'error' && loans.length === 0 ? (
          <div role="alert" className="bg-[#050505] border border-red-500/30 rounded-[2rem] p-8 text-center">
            <p className="text-[10px] font-black text-red-500 uppercase tracking-widest">
              Nao foi possivel carregar os contratos
            </p>
          </div>
        ) : filteredLoans.length === 0 ? (
          <div className="bg-[#050505] border border-zinc-900 rounded-[2rem] p-8 text-center">
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
              Nenhum contrato encontrado
            </p>
          </div>
        ) : paginatedLoans.map(loan => {
          const loanInstallments = Array.isArray(loan.installments) ? loan.installments : [];
          const resolvedLoanStatus = effectiveLoanStatus(loan);
          const paidInstallmentsCount = loanInstallments.filter((inst) => normalizeInstallmentStatus(inst.status) === 'PAID').length;
          const hasFinancialHistory = loanInstallments.some((installment) => (
            installmentPaidAmount(installment) > 0 ||
            Boolean(installment.paymentBreakdown) ||
            (Array.isArray(installment.paymentEntries) && installment.paymentEntries.length > 0)
          ));
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
                    void handleDownloadContract(loan);
                  }}
                  disabled={generatingContractPdfId !== null}
                  className="h-[42px] w-[42px] shrink-0 bg-[#BF953F]/10 text-[#BF953F] rounded-xl hover:bg-[#BF953F] hover:text-black transition-all flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Baixar contrato atualizado em PDF"
                  aria-label="Baixar contrato atualizado em PDF"
                >
                  {generatingContractPdfId === loan.id ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <FileDown size={16} />
                  )}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openEditLoanModal(loan);
                  }}
                  disabled={hasFinancialHistory}
                  className="h-[42px] w-[42px] shrink-0 bg-blue-500/10 text-blue-500 rounded-xl hover:bg-blue-500 hover:text-black transition-all flex items-center justify-center disabled:bg-zinc-900 disabled:text-zinc-700 disabled:cursor-not-allowed"
                  title={hasFinancialHistory ? 'Condicoes financeiras bloqueadas apos o primeiro pagamento' : 'Editar contrato'}
                >
                  <Pencil size={16} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCancelLoan(loan);
                  }}
                  className={`h-[42px] w-[42px] shrink-0 rounded-xl transition-all flex items-center justify-center ${
                    resolvedLoanStatus !== 'ACTIVE'
                      ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                      : 'bg-amber-500/10 text-amber-500 hover:bg-amber-500 hover:text-black'
                  }`}
                  title={resolvedLoanStatus === 'COMPLETED' ? 'Contrato quitado nao pode ser cancelado' : 'Cancelar contrato'}
                  disabled={resolvedLoanStatus !== 'ACTIVE'}
                >
                  <Ban size={16} />
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
                {resolvedLoanStatus === 'CANCELLED' && loan.cancellationReason && (
                  <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                    <p className="text-[8px] font-black uppercase tracking-widest text-amber-500">Cancelamento auditado</p>
                    <p className="mt-1 text-[9px] text-zinc-400">
                      {loan.cancellationReason}{loan.canceledByName ? ` - ${loan.canceledByName}` : ''}
                    </p>
                  </div>
                )}
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

        {filteredLoans.length > 0 && (totalPages > 1 || hasMoreLoans) && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#050505] border border-zinc-900 rounded-2xl px-4 py-3">
            <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">
              Pagina {currentPageSafe} de {totalPages}  •  {filteredLoans.length} de {totalLoans ?? filteredLoans.length} contratos
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((previous) => Math.max(previous - 1, 1))}
                disabled={currentPageSafe === 1}
                className="px-4 py-2 bg-zinc-900 text-zinc-400 rounded-xl text-[9px] font-black uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-800"
              >
                Anterior
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage((previous) => Math.min(previous + 1, totalPages))}
                disabled={currentPageSafe === totalPages}
                className="px-4 py-2 bg-zinc-900 text-zinc-400 rounded-xl text-[9px] font-black uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-800"
              >
                Proxima
              </button>
            </div>
            {hasMoreLoans && onLoadMoreLoans && (
              <button
                type="button"
                onClick={onLoadMoreLoans}
                disabled={isLoadingMoreLoans}
                className="px-4 py-2 border border-[#BF953F]/30 text-[#BF953F] rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-[#BF953F]/10 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isLoadingMoreLoans && <Loader2 size={12} className="animate-spin" />}
                {isLoadingMoreLoans ? 'Carregando...' : 'Carregar mais'}
              </button>
            )}
          </div>
        )}
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

                  {renewalModal.lateFeeAmount > 0 && (
                    <button
                      type="button"
                      aria-pressed={renewalModal.payLateFee}
                      onClick={() =>
                        setRenewalModal((previous) =>
                          previous
                            ? {
                                ...previous,
                                payLateFee: !previous.payLateFee,
                              }
                            : previous,
                        )
                      }
                      disabled={processingRenewal === renewalModal.loanId}
                      className={`w-full rounded-2xl border p-4 flex items-center justify-between gap-4 text-left transition-colors disabled:opacity-60 ${
                        renewalModal.payLateFee
                          ? 'bg-red-500/10 border-red-500/40'
                          : 'bg-[#000000] border-zinc-800'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 ${
                            renewalModal.payLateFee
                              ? 'bg-red-500 border-red-400 text-black'
                              : 'border-zinc-700 text-transparent'
                          }`}
                        >
                          <CheckCircle size={15} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[9px] font-black text-white uppercase tracking-widest">
                            Pagar multa junto
                          </p>
                          <p className="text-[8px] text-zinc-500 uppercase tracking-widest mt-1 leading-relaxed">
                            {renewalModal.payLateFee
                              ? 'A multa sera quitada nesta renovacao'
                              : 'A multa permanecera separada e em aberto'}
                          </p>
                        </div>
                      </div>
                      <p className="text-sm font-black text-red-400 shrink-0">
                        R$ {renewalModal.lateFeeAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </button>
                  )}

                  <div className="bg-[#000000] border border-emerald-500/30 rounded-2xl p-4 flex items-center justify-between gap-4">
                    <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">
                      Total a pagar agora
                    </p>
                    <p className="text-lg font-black text-emerald-400">
                      R$ {roundMoney(
                        renewalModal.interestAmount +
                        (renewalModal.payLateFee ? renewalModal.lateFeeAmount : 0),
                      ).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
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
                        Novo Vencimento (mes seguinte)
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
                  <option value="">
                    {isLoadingCustomers ? 'CARREGANDO CLIENTES...' : 'SELECIONE O CLIENTE'}
                  </option>
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
                    disabled={Boolean(editingLoanId)}
                    className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                    value={formData.amount}
                    onChange={e => setFormData({ ...formData, amount: e.target.value })}
                  />
                  {editingLoanId && (
                    <p className="text-[8px] text-zinc-600 uppercase mt-1">O principal e imutavel para preservar o caixa.</p>
                  )}
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
                        R$ {(calculateInstallments().reduce((acc, curr) => acc + installmentAmount(curr), 0) - Number(formData.amount)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                  <div className="pt-3 border-t border-zinc-800">
                    <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Total a Pagar</p>
                    <p className="text-lg font-black text-emerald-500">
                      R$ {calculateInstallments().reduce((acc, curr) => acc + installmentAmount(curr), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
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












