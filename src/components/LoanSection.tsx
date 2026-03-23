import React, { useState } from 'react';
import { Customer, Loan, Installment } from '../types';
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

interface LoanSectionProps {
  customers: Customer[];
  loans: Loan[];
  onAddLoan: (l: Loan) => Promise<void> | void;
  onUpdateLoan: (loanId: string, newData: Partial<Loan>) => Promise<void>;
  onDeleteLoan: (loanId: string) => Promise<void>;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  initialExpandedLoanId?: string | null;
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

const LoanSection: React.FC<LoanSectionProps> = ({ 
  customers, 
  loans, 
  onAddLoan, 
  onUpdateLoan,
  onDeleteLoan,
  showToast, 
  initialExpandedLoanId,
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
  const [paymentModal, setPaymentModal] = useState<{ isOpen: boolean; loanId: string; installmentIndex: number; amount: string } | null>(null);
  const [settlementModal, setSettlementModal] = useState<EarlySettlementQuote | null>(null);
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
      .map((loan) => Number((loan as any).contractNumber || 0))
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

  const getRemainingInstallmentValue = (inst: Installment | null | undefined) => {
    if (!inst || normalizeInstallmentStatus(inst.status) === 'PAID') return 0;
    const remaining = roundMoney(installmentAmount(inst) - installmentPaidAmount(inst));
    return remaining > 0 ? remaining : 0;
  };

  const buildEarlySettlementQuote = (loan: Loan): EarlySettlementQuote | null => {
    const normalizedInterestType = fromLegacyInterestType((loan as any).interestType);
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
      interestType: fromLegacyInterestType((loan as any).interestType),
      frequency: fromLegacyFrequency((loan as any).frequency),
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
      await onUpdateLoan(loan.id, { status: 'CANCELADO' as any });
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
        allocated = roundMoney(allocated + share);

        (inst as any).paidAmount = installmentAmount(inst);
        (inst as any).partialPaid = 0;
        (inst as any).status = 'PAGO';
        (inst as any).paymentDate = nowIso;
        (inst as any).lastPaidValue = share;
        installments[entry.installmentIndex] = inst;
      });

      const allPaid = installments.filter(Boolean).every((inst) => normalizeInstallmentStatus(inst.status) === 'PAID');
      const discountLabel = settlementModal.discount.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

      await onUpdateLoanAndAddTransaction(
        loan.id,
        {
          installments,
          status: (allPaid ? 'QUITADO' : 'ATIVO') as any,
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
      interestType: toLegacyInterestType(formData.interestType) as any,
      monthlyPaidInterestRate: isSplitContract ? Number(formData.monthlyPaidInterestRate) : undefined,
      monthlyAccruedInterestRate: isSplitContract ? Number(formData.monthlyAccruedInterestRate) : undefined,
      frequency: (isSplitContract ? 'MENSAL' : toLegacyFrequency(formData.frequency)) as any,
      installmentCount: Number(formData.installmentsCount),
      installmentsCount: Number(formData.installmentsCount) as any,
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
          status: normalizeLoanStatus(currentLoan?.status) === 'CANCELLED' ? ('CANCELADO' as any) : ('ATIVO' as any)
        });
        showToast('Contrato atualizado com sucesso!', 'success');
      } else {
        const newLoan: Loan = {
          id: Math.random().toString(36).substr(2, 9),
          contractNumber: getNextContractNumber(),
          customerId: payload.customerId || customer.id,
          customerName: payload.customerName || customer.name,
          customerPhone: customer.phone || '',
          amount: Number(payload.amount || 0),
          interestRate: Number(payload.interestRate || 0),
          interestType: (payload.interestType || 'SIMPLES') as any,
          monthlyPaidInterestRate: payload.monthlyPaidInterestRate,
          monthlyAccruedInterestRate: payload.monthlyAccruedInterestRate,
          frequency: (payload.frequency || 'MENSAL') as any,
          installmentCount: Number((payload as any).installmentCount || payload.installmentsCount || 0),
          installmentsCount: Number(payload.installmentsCount || (payload as any).installmentCount || 0) as any,
          totalToReturn: Number(totalToReturn.toFixed(2)),
          installmentValue: Number(installmentValue.toFixed(2)),
          startDate: payload.startDate || getLocalISODate(),
          dueDate,
          status: 'ATIVO' as any,
          paidAmount: 0,
          notes: '',
          installments: payload.installments || [],
          createdAt: Date.now(),
        };
        await Promise.resolve(onAddLoan(newLoan));
        try {
          generateContractPDF(customer as any, newLoan as any);
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

  const handlePayment = async (amount?: string | React.MouseEvent, directLoanId?: string, directInstIdx?: number) => {
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

    const parsedAmount = Number(overrideAmount || activeModal?.amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      showToast('Valor invalido', 'error');
      return;
    }

    setProcessingPayment(`${loanId}-${instIdx}`);
    try {
      const newInstallments = [...loanInstallments];
      let currentIdx = instIdx;
      let remainingToApply = Number(parsedAmount.toFixed(2));
      const totalPaid = remainingToApply;
      let changedInstallment = false;

      while (remainingToApply > 0 && currentIdx < newInstallments.length) {
        const originalInstallment = newInstallments[currentIdx];
        if (!originalInstallment) {
          currentIdx++;
          continue;
        }

        const inst = { ...originalInstallment };
        const lateFee = calculateLateFee(inst);
        const totalWithFee = Number((installmentAmount(inst) + lateFee).toFixed(2));
        const alreadyPaid = Number(installmentPaidAmount(inst));
        const remaining = Number((totalWithFee - alreadyPaid).toFixed(2));

        if (!Number.isFinite(remaining) || remaining <= 0) {
          currentIdx++;
          continue;
        }

        changedInstallment = true;
        if (remainingToApply + 0.000001 >= remaining) {
          remainingToApply = Number((remainingToApply - remaining).toFixed(2));
          (inst as any).paidAmount = totalWithFee;
          (inst as any).status = 'PAGO';
          (inst as any).paymentDate = new Date().toISOString();
          (inst as any).partialPaid = 0;
          (inst as any).lastPaidValue = totalWithFee;
        } else {
          const partialValue = Number((alreadyPaid + remainingToApply).toFixed(2));
          (inst as any).paidAmount = partialValue;
          (inst as any).partialPaid = partialValue;
          remainingToApply = 0;
          if (normalizeInstallmentStatus(inst.status) !== 'PAID') {
            (inst as any).status = 'PENDENTE';
          }
        }

        newInstallments[currentIdx] = inst;
        currentIdx++;
      }

      if (!changedInstallment) {
        showToast('Nenhuma parcela pendente para quitar', 'error');
        return;
      }

      const allPaid = newInstallments.filter(Boolean).every(i => normalizeInstallmentStatus(i.status) === 'PAID');

      await onUpdateLoanAndAddTransaction(
        loan.id,
        {
          installments: newInstallments,
          status: (allPaid ? 'QUITADO' : 'ATIVO') as any
        },
        'PAGAMENTO',
        totalPaid,
        `PAGAMENTO: ${loan.customerName}`
      );
      showToast('Pagamento processado!', 'success');
      setPaymentModal(null);
    } catch (e) {
      showToast('Erro ao processar pagamento', 'error');
    } finally {
      setProcessingPayment(null);
    }
  };

  const handleReverseInstallment = async (loan: Loan, index: number) => {
    const newInstallments = [...loan.installments];
    const inst = { ...newInstallments[index] };
    const amountToReverse = Number((inst as any).lastPaidValue ?? installmentPaidAmount(inst));

    if (amountToReverse <= 0) return;

    (inst as any).paidAmount = 0;
    (inst as any).partialPaid = 0;
    (inst as any).status = 'PENDENTE';
    (inst as any).paymentDate = undefined;
    (inst as any).lastPaidValue = undefined;
    newInstallments[index] = inst;

    try {
      await onUpdateLoanAndAddTransaction(
        loan.id,
        { 
          installments: newInstallments,
          status: 'ATIVO' as any // Always active if we are reversing a payment
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
          const remainingLoanAmount = Number(
            loanInstallments
              .reduce((sum, inst) => sum + getRemainingInstallmentValue(inst), 0)
              .toFixed(2)
          );
          const showRemainingLoanAmount =
            resolvedLoanStatus === 'ACTIVE' &&
            paidInstallmentsCount > 0 &&
            remainingLoanAmount > 0;
          const isOverdue = resolvedLoanStatus === 'ACTIVE' && loanInstallments.some(inst => {
            if (!inst?.dueDate || normalizeInstallmentStatus(inst.status) === 'PAID') return false;
            const dueDate = new Date(inst.dueDate + 'T00:00:00');
            if (Number.isNaN(dueDate.getTime())) return false;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return dueDate < today;
          });
          const canEarlySettle =
            resolvedLoanStatus === 'ACTIVE' &&
            fromLegacyInterestType((loan as any).interestType) === 'PRICE' &&
            loanInstallments.some((inst) => getRemainingInstallmentValue(inst) > 0);
          const canChargeLoan = resolvedLoanStatus === 'ACTIVE' && remainingLoanAmount > 0;

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
              <div className="flex-1 min-w-[120px]">
                <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-1">Valor Total</p>
                <p className="text-[11px] font-black text-white">R$ {(loan.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                {showRemainingLoanAmount && (
                  <p className="text-[9px] font-black text-emerald-500 mt-1">
                    Restante: R$ {remainingLoanAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                )}
              </div>
              <div className="flex-1 min-w-[100px]">
                <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-1">Parcelas</p>
                <p className="text-[11px] font-black text-white">
                  {paidInstallmentsCount} / {totalInstallmentsCount}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {canEarlySettle && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEarlySettlementModal(loan);
                    }}
                    className="px-3 py-2 bg-emerald-500/10 text-emerald-400 rounded-xl hover:bg-emerald-500 hover:text-black transition-all text-[8px] font-black uppercase tracking-widest"
                    title="Calcular e registrar quitacao antecipada"
                  >
                    Quitar Restante
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleWhatsApp(loan);
                  }}
                  className={`p-3 rounded-xl transition-all ${
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
                  className="p-3 bg-blue-500/10 text-blue-500 rounded-xl hover:bg-blue-500 hover:text-black transition-all"
                  title="Editar contrato"
                >
                  <Pencil size={16} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCancelLoan(loan);
                  }}
                  className={`p-3 rounded-xl transition-all ${
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
                  className="p-3 bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500 hover:text-black transition-all"
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
                                <p className="text-[7px] font-black text-red-500/70 uppercase tracking-widest">Falta</p>
                                <p className="text-[9px] font-black text-red-500">
                                  R$ {remaining.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
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
                                  setPaymentModal({ isOpen: true, loanId: loan.id, installmentIndex: idx, amount: Math.max(remaining, 0).toFixed(2) });
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
                    type="number"
                    step="0.01"
                    className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 pl-10 text-white outline-none focus:border-emerald-500 text-sm font-black"
                    value={paymentModal.amount}
                    onChange={e => setPaymentModal({ ...paymentModal, amount: e.target.value })}
                  />
                </div>
                <p className="text-[8px] text-zinc-600 uppercase italic ml-1">
                  * Valores maiores que a parcela serao aplicados as proximas parcelas.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setPaymentModal(null)}
                  className="flex-1 py-4 bg-zinc-900 text-zinc-500 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-zinc-800 transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handlePayment}
                  className="flex-1 py-4 bg-emerald-500 text-black rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20"
                >
                  Confirmar
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
                    onChange={e => setFormData({ ...formData, frequency: e.target.value as any })}
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












