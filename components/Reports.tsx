
import React, { useMemo, useState, useEffect } from 'react';
import { 
  TrendingUp, 
  ArrowDownCircle, 
  CheckCircle, 
  Clock, 
  AlertTriangle, 
  ChevronDown, 
  ChevronRight, 
  User, 
  MessageCircle, 
  FileText,
  BellRing,
  SendHorizontal,
  Filter,
  Wallet,
  PlusCircle,
  MinusCircle,
  History,
  Trash2,
  Edit3,
  Calendar,
  X
} from 'lucide-react';
import { Loan, PaymentStatus, Installment, CashMovement } from '../types';

interface ReportsProps {
  loans: Loan[];
  onUpdateLoans?: (loans: Loan[]) => void;
}

const Reports: React.FC<ReportsProps> = ({ loans, onUpdateLoans }) => {
  const [expandedLoanId, setExpandedLoanId] = useState<string | null>(null);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(['ATIVOS', 'INADIMPLENTES', 'FINALIZADOS']);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  
  // Gestão de Caixa
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
  const [isAddingMovement, setIsAddingMovement] = useState(false);
  const [editingMovementId, setEditingMovementId] = useState<string | null>(null);
  const [movementForm, setMovementForm] = useState({ type: 'APORTE' as any, amount: '', description: '' });

  // Pagamento Parcial
  const [partialPaymentModal, setPartialPaymentModal] = useState<{ loanId: string, instId: string } | null>(null);
  const [partialAmount, setPartialAmount] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem('gr_solution_cash_movements');
    if (stored) setCashMovements(JSON.parse(stored));
  }, []);

  useEffect(() => {
    localStorage.setItem('gr_solution_cash_movements', JSON.stringify(cashMovements));
  }, [cashMovements]);

  const toggleExpand = (loanId: string) => {
    setExpandedLoanId(prev => (prev === loanId ? null : loanId));
  };

  const calculatePenalty = (inst: Installment) => {
    if (inst.status === 'PAGO') return 0;
    const today = new Date();
    const dueDate = new Date(inst.dueDate + 'T00:00:00');
    if (today > dueDate) {
      const diffTime = Math.abs(today.getTime() - dueDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return inst.value * (0.015 * diffDays);
    }
    return 0;
  };

  const todayStr = new Date().toISOString().split('T')[0];

  const filteredLoans = useMemo(() => {
    return loans.filter(loan => {
      const isLiquidated = loan.installments.every(i => i.status === 'PAGO');
      const hasOverdue = loan.installments.some(i => i.status === 'PENDENTE' && i.dueDate < todayStr);
      
      let status = 'ATIVOS';
      if (isLiquidated) status = 'FINALIZADOS';
      else if (hasOverdue) status = 'INADIMPLENTES';

      const matchesStatus = selectedStatuses.includes(status);
      
      const matchesDate = !dateRange.start && !dateRange.end ? true : loan.installments.some(inst => {
        const startMatch = !dateRange.start || inst.dueDate >= dateRange.start;
        const endMatch = !dateRange.end || inst.dueDate <= dateRange.end;
        return startMatch && endMatch;
      });

      return matchesStatus && matchesDate;
    });
  }, [loans, selectedStatuses, dateRange, todayStr]);

  const treasuryStats = useMemo(() => {
    const totalAportes = cashMovements.filter(m => m.type === 'APORTE').reduce((acc, m) => acc + m.amount, 0);
    const totalRetiradas = cashMovements.filter(m => m.type === 'RETIRADA').reduce((acc, m) => acc + m.amount, 0);
    const totalPrincipalEmprestado = loans.reduce((acc, l) => acc + l.amount, 0);
    
    let totalRecebido = 0;
    loans.forEach(loan => {
      loan.installments.forEach(inst => {
        if (inst.paidValue) {
          totalRecebido += inst.paidValue;
        } else if (inst.status === 'PAGO') {
          totalRecebido += inst.value + (inst.penaltyApplied || 0);
        }
      });
    });

    const balance = (totalAportes + totalRecebido) - (totalRetiradas + totalPrincipalEmprestado);

    return { totalAportes, totalRetiradas, balance, totalRecebido };
  }, [cashMovements, loans]);

  const handleSaveMovement = (e: React.FormEvent) => {
    e.preventDefault();
    if (!movementForm.amount || !movementForm.description) return;
    
    if (editingMovementId) {
      setCashMovements(prev => prev.map(m => m.id === editingMovementId ? {
        ...m,
        type: movementForm.type,
        amount: parseFloat(movementForm.amount),
        description: movementForm.description
      } : m));
    } else {
      const newMovement: CashMovement = {
        id: Math.random().toString(36).substr(2, 9),
        type: movementForm.type,
        amount: parseFloat(movementForm.amount),
        description: movementForm.description,
        date: Date.now()
      };
      setCashMovements(prev => [newMovement, ...prev]);
    }

    closeMovementForm();
  };

  const startEditMovement = (m: CashMovement) => {
    setEditingMovementId(m.id);
    setMovementForm({
      type: m.type,
      amount: m.amount.toString(),
      description: m.description
    });
    setIsAddingMovement(true);
  };

  const closeMovementForm = () => {
    setIsAddingMovement(false);
    setEditingMovementId(null);
    setMovementForm({ type: 'APORTE', amount: '', description: '' });
  };

  const deleteMovement = (id: string) => {
    if (window.confirm('Excluir este registro de movimentação?')) {
      setCashMovements(prev => prev.filter(m => m.id !== id));
    }
  };

  const toggleInstallmentStatus = (loanId: string, instId: string) => {
    if (!onUpdateLoans) return;
    const updatedLoans = loans.map(loan => {
      if (loan.id === loanId) {
        const updatedInstallments = loan.installments.map(inst => {
          if (inst.id === instId) {
            const isPaying = inst.status !== 'PAGO';
            const newStatus: PaymentStatus = isPaying ? 'PAGO' : 'PENDENTE';
            const penalty = calculatePenalty(inst);
            return { 
              ...inst, 
              status: newStatus, 
              paidAt: isPaying ? Date.now() : undefined,
              penaltyApplied: isPaying ? penalty : 0,
              paidValue: isPaying ? (inst.value + penalty) : 0
            };
          }
          return inst;
        });
        return { ...loan, installments: updatedInstallments };
      }
      return loan;
    });
    onUpdateLoans(updatedLoans);
  };

  const handlePartialPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!partialPaymentModal || !partialAmount || !onUpdateLoans) return;
    
    const amount = parseFloat(partialAmount);
    if (isNaN(amount) || amount <= 0) return;

    const updatedLoans = loans.map(loan => {
      if (loan.id === partialPaymentModal.loanId) {
        const updatedInstallments = loan.installments.map(inst => {
          if (inst.id === partialPaymentModal.instId) {
            const currentPaid = inst.paidValue || 0;
            const newPaid = currentPaid + amount;
            const penalty = calculatePenalty(inst);
            const totalDue = inst.value + penalty;
            
            const isFullyPaid = newPaid >= totalDue;
            
            return {
              ...inst,
              paidValue: newPaid,
              status: isFullyPaid ? 'PAGO' : inst.status,
              paidAt: isFullyPaid ? Date.now() : inst.paidAt,
              penaltyApplied: isFullyPaid ? penalty : inst.penaltyApplied
            };
          }
          return inst;
        });
        return { ...loan, installments: updatedInstallments };
      }
      return loan;
    });

    onUpdateLoans(updatedLoans);
    setPartialPaymentModal(null);
    setPartialAmount('');
  };

  const generateWhatsAppURL = (loan: Loan, inst: Installment) => {
    const penalty = calculatePenalty(inst);
    const total = inst.value + penalty;
    const phone = loan.customerPhone?.replace(/\D/g, '');
    const message = `*GR SOLUTION - AVISO DE COBRANÇA*%0A%0AOlá *${loan.customerName}*, identificamos que a parcela nº ${inst.number} do seu contrato *#${loan.contractNumber}* está em atraso.%0A%0A💵 *Valor para Liquidação:* *${total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}*%0A%0ASolicitamos regularização imediata.`;
    return `https://wa.me/55${phone}?text=${message}`;
  };

  const toggleStatus = (status: string) => {
    setSelectedStatuses(prev => 
      prev.includes(status) 
        ? prev.filter(s => s !== status) 
        : [...prev, status]
    );
  };

  const clearDateRange = () => setDateRange({ start: '', end: '' });

  return (
    <div className="space-y-10 animate-in fade-in duration-500">
      
      {/* Seção de Tesouraria e Caixa */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 bg-[#0a0a0a] p-8 rounded-[2.5rem] border border-zinc-800 shadow-2xl flex flex-col justify-between">
           <div>
              <div className="flex items-center gap-3 mb-6">
                <Wallet className="text-[#BF953F]" size={20} />
                <h3 className="text-[10px] font-black gold-text uppercase tracking-widest">Saldo Disponível em Caixa</h3>
              </div>
              <p className="text-4xl font-black text-white tracking-tighter">
                {treasuryStats.balance.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </p>
              <div className="mt-6 flex flex-col gap-2">
                 <div className="flex justify-between text-[9px] font-bold uppercase">
                    <span className="text-zinc-600">Aportes (Capital Giro)</span>
                    <span className="text-emerald-500">+{treasuryStats.totalAportes.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                 </div>
                 <div className="flex justify-between text-[9px] font-bold uppercase">
                    <span className="text-zinc-600">Retiradas</span>
                    <span className="text-red-500">-{treasuryStats.totalRetiradas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                 </div>
              </div>
           </div>
           
           <div className="mt-8 pt-6 border-t border-zinc-900 flex gap-4">
              <button 
                onClick={() => { setMovementForm({...movementForm, type: 'APORTE'}); setIsAddingMovement(true); }}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-emerald-500 hover:text-white transition-all"
              >
                <PlusCircle size={14} /> Aporte
              </button>
              <button 
                onClick={() => { setMovementForm({...movementForm, type: 'RETIRADA'}); setIsAddingMovement(true); }}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-red-500/10 text-red-500 border border-red-500/20 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all"
              >
                <MinusCircle size={14} /> Retirada
              </button>
           </div>
        </div>

        <div className="lg:col-span-2 bg-[#0a0a0a] rounded-[2.5rem] border border-zinc-800 shadow-2xl overflow-hidden flex flex-col">
           <div className="px-8 py-5 border-b border-zinc-900 bg-zinc-900/10 flex justify-between items-center">
              <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                <History size={14} /> Extrato de Movimentação
              </h4>
           </div>
           <div className="flex-1 max-h-[220px] overflow-y-auto custom-scrollbar">
              {cashMovements.length > 0 ? (
                <table className="w-full text-left">
                  <tbody className="divide-y divide-zinc-900">
                    {cashMovements.map(m => (
                      <tr key={m.id} className="hover:bg-zinc-900/30 transition-colors group">
                        <td className="px-8 py-4">
                           <p className="text-[10px] font-black text-zinc-200 uppercase group-hover:text-[#BF953F] transition-colors">{m.description}</p>
                           <p className="text-[8px] text-zinc-600 font-mono">{new Date(m.date).toLocaleString('pt-BR')}</p>
                        </td>
                        <td className={`px-8 py-4 text-right font-black text-[11px] ${m.type === 'APORTE' ? 'text-emerald-500' : 'text-red-500'}`}>
                           {m.type === 'APORTE' ? '+' : '-'} {m.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </td>
                        <td className="px-8 py-4 text-right">
                           <div className="flex items-center justify-end gap-2">
                              <button onClick={() => startEditMovement(m)} title="Editar" className="text-zinc-700 hover:text-[#BF953F] transition-colors"><Edit3 size={14} /></button>
                              <button onClick={() => deleteMovement(m.id)} title="Excluir" className="text-zinc-800 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
                           </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="h-full flex flex-col items-center justify-center opacity-20 py-10">
                   <History size={32} />
                   <p className="text-[9px] font-black uppercase mt-2">Sem movimentações</p>
                </div>
              )}
           </div>
        </div>
      </div>

      {/* Modal Adição/Edição de Movimentação */}
      {isAddingMovement && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
           <div className="bg-[#0a0a0a] border border-zinc-800 w-full max-w-md rounded-[2.5rem] p-10 animate-in zoom-in-95 duration-300 shadow-[0_0_50px_rgba(0,0,0,0.8)]">
              <h3 className="text-sm font-black gold-text uppercase tracking-widest mb-8 flex items-center gap-3">
                {movementForm.type === 'APORTE' ? <PlusCircle className="text-emerald-500" /> : <MinusCircle className="text-red-500" />}
                {editingMovementId ? 'Editar' : 'Registrar'} {movementForm.type === 'APORTE' ? 'Aporte' : 'Retirada'}
              </h3>
              <form onSubmit={handleSaveMovement} className="space-y-6">
                 <div>
                   <label className="text-[10px] font-black text-zinc-600 uppercase mb-2 block">Valor (R$)</label>
                   <input 
                    type="number" 
                    autoFocus
                    value={movementForm.amount} 
                    onChange={e => setMovementForm({...movementForm, amount: e.target.value})}
                    className="w-full bg-black border border-zinc-800 rounded-2xl px-6 py-4 outline-none focus:border-[#BF953F] text-zinc-200 font-bold"
                    placeholder="0.00"
                    step="0.01"
                   />
                 </div>
                 <div>
                   <label className="text-[10px] font-black text-zinc-600 uppercase mb-2 block">Descrição / Finalidade</label>
                   <input 
                    type="text" 
                    value={movementForm.description} 
                    onChange={e => setMovementForm({...movementForm, description: e.target.value})}
                    className="w-full bg-black border border-zinc-800 rounded-2xl px-6 py-4 outline-none focus:border-[#BF953F] text-zinc-200"
                    placeholder="Ex: Ajuste de capital giro"
                   />
                 </div>
                 <div className="flex gap-4 pt-4">
                    <button type="button" onClick={closeMovementForm} className="flex-1 py-4 text-[10px] font-black uppercase bg-zinc-900 text-zinc-500 rounded-2xl">Cancelar</button>
                    <button type="submit" className={`flex-1 py-4 text-[10px] font-black uppercase rounded-2xl ${movementForm.type === 'APORTE' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
                      {editingMovementId ? 'Salvar Alterações' : 'Confirmar'}
                    </button>
                 </div>
              </form>
           </div>
        </div>
      )}

      {/* Modal Pagamento Parcial */}
      {partialPaymentModal && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
           <div className="bg-[#0a0a0a] border border-zinc-800 w-full max-w-md rounded-[2.5rem] p-10 animate-in zoom-in-95 duration-300 shadow-[0_0_50px_rgba(0,0,0,0.8)]">
              <h3 className="text-sm font-black gold-text uppercase tracking-widest mb-8 flex items-center gap-3">
                <PlusCircle className="text-[#BF953F]" />
                Registrar Pagamento Parcial
              </h3>
              <form onSubmit={handlePartialPayment} className="space-y-6">
                 <div>
                   <label className="text-[10px] font-black text-zinc-600 uppercase mb-2 block">Valor do Pagamento (R$)</label>
                   <input 
                    type="number" 
                    autoFocus
                    value={partialAmount} 
                    onChange={e => setPartialAmount(e.target.value)}
                    className="w-full bg-black border border-zinc-800 rounded-2xl px-6 py-4 outline-none focus:border-[#BF953F] text-zinc-200 font-bold"
                    placeholder="0.00"
                    step="0.01"
                   />
                 </div>
                 <div className="flex gap-4 pt-4">
                    <button type="button" onClick={() => setPartialPaymentModal(null)} className="flex-1 py-4 text-[10px] font-black uppercase bg-zinc-900 text-zinc-500 rounded-2xl">Cancelar</button>
                    <button type="submit" className="flex-1 py-4 text-[10px] font-black uppercase rounded-2xl gold-gradient text-black">
                      Confirmar Pagamento
                    </button>
                 </div>
              </form>
           </div>
        </div>
      )}

      {/* Resumo de Operações */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <ReportCard 
          title="Principal Liberado" 
          value={loans.reduce((acc, l) => acc + l.amount, 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          icon={<ArrowDownCircle className="text-zinc-600" />}
          subtitle="Total Emprestado"
        />
        <ReportCard 
          title="Total Recebido" 
          value={treasuryStats.totalRecebido.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          icon={<CheckCircle className="text-emerald-500" />}
          subtitle="Juros + Principal"
          isGold
        />
        <ReportCard 
          title="A Receber" 
          value={loans.reduce((acc, l) => acc + l.installments.filter(i => i.status !== 'PAGO').reduce((sum, i) => sum + (i.value + calculatePenalty(i) - (i.paidValue || 0)), 0), 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          icon={<Clock className="text-[#BF953F]" />}
          subtitle="Previsão Bruta"
        />
        <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-3xl flex flex-col justify-between relative overflow-hidden group">
           <div className="absolute -right-4 -top-4 opacity-5 group-hover:scale-110 transition-transform duration-500">
             <BellRing size={100} className="text-red-500" />
           </div>
           <div className="relative z-10">
             <p className="text-[10px] font-black text-red-500 uppercase tracking-widest mb-1">Alertas Críticos</p>
             <p className="text-3xl font-black text-white">{loans.filter(l => l.installments.some(i => i.status === 'PENDENTE' && i.dueDate < todayStr)).length}</p>
             <p className="text-[9px] text-zinc-600 font-bold uppercase mt-1">Contratos com Atraso</p>
           </div>
           <button 
             onClick={() => { setSelectedStatuses(['INADIMPLENTES']); setDateRange({ start: '', end: '' }); }}
             className="w-full mt-4 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white text-[9px] font-black uppercase py-2.5 rounded-xl transition-all"
           >
             Ver Lista de Cobrança
           </button>
        </div>
      </div>

      <div className="bg-[#0a0a0a] rounded-3xl border border-zinc-800 overflow-hidden shadow-2xl">
        <div className="p-8 border-b border-zinc-800 bg-zinc-900/20 space-y-8">
          <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6">
            <div>
              <h3 className="text-lg font-bold gold-text uppercase tracking-widest">Controle de Carteira</h3>
              <p className="text-[10px] text-zinc-500 font-bold uppercase mt-1">Gestão centralizada de recebíveis e liquidação</p>
            </div>
            
            <div className="flex flex-col md:flex-row items-start md:items-center gap-6 w-full xl:w-auto">
              {/* Filtro de Status */}
              <div className="flex flex-wrap gap-2">
                <FilterButton 
                  active={selectedStatuses.includes('ATIVOS')} 
                  onClick={() => toggleStatus('ATIVOS')} 
                  label="Ativos" 
                  count={loans.filter(l => !l.installments.every(i => i.status === 'PAGO') && !l.installments.some(i => i.status === 'PENDENTE' && i.dueDate < todayStr)).length} 
                />
                <FilterButton 
                  active={selectedStatuses.includes('INADIMPLENTES')} 
                  onClick={() => toggleStatus('INADIMPLENTES')} 
                  label="Atrasados" 
                  count={loans.filter(l => !l.installments.every(i => i.status === 'PAGO') && l.installments.some(i => i.status === 'PENDENTE' && i.dueDate < todayStr)).length} 
                />
                <FilterButton 
                  active={selectedStatuses.includes('FINALIZADOS')} 
                  onClick={() => toggleStatus('FINALIZADOS')} 
                  label="Finalizados" 
                  count={loans.filter(l => l.installments.every(i => i.status === 'PAGO')).length} 
                />
              </div>

              {/* Filtro de Data */}
              <div className="flex items-center gap-3 bg-black border border-zinc-800 p-2 rounded-2xl">
                <div className="flex items-center gap-2 px-2 border-r border-zinc-800">
                  <Calendar size={14} className="text-zinc-600" />
                  <span className="text-[9px] font-black text-zinc-500 uppercase">Vencimento</span>
                </div>
                <div className="flex items-center gap-2">
                  <input 
                    type="date" 
                    value={dateRange.start}
                    onChange={e => setDateRange({...dateRange, start: e.target.value})}
                    className="bg-transparent text-[10px] font-bold text-zinc-300 outline-none w-28"
                  />
                  <span className="text-zinc-700 text-[10px]">até</span>
                  <input 
                    type="date" 
                    value={dateRange.end}
                    onChange={e => setDateRange({...dateRange, end: e.target.value})}
                    className="bg-transparent text-[10px] font-bold text-zinc-300 outline-none w-28"
                  />
                  {(dateRange.start || dateRange.end) && (
                    <button onClick={clearDateRange} className="p-1 hover:bg-zinc-800 rounded-full text-zinc-500 transition-colors">
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="divide-y divide-zinc-900 min-h-[400px]">
          {filteredLoans.length > 0 ? (
            filteredLoans.map((loan) => {
              const isExpanded = expandedLoanId === loan.id;
              const paidInstallments = loan.installments.filter(i => i.status === 'PAGO').length;
              const progress = (paidInstallments / loan.installmentCount) * 100;
              const hasOverdue = loan.installments.some(inst => inst.status === 'PENDENTE' && inst.dueDate < todayStr);
              const allPaid = loan.installments.every(i => i.status === 'PAGO');

              return (
                <div key={loan.id} className="group">
                  <div 
                    onClick={() => toggleExpand(loan.id)}
                    className={`flex flex-col md:flex-row items-center gap-6 px-8 py-6 cursor-pointer transition-all hover:bg-zinc-900/40 ${isExpanded ? 'bg-zinc-900/50' : ''}`}
                  >
                    <div className="flex items-center gap-4 flex-1">
                      <div className={`p-3 rounded-2xl border transition-all ${
                        isExpanded ? 'gold-gradient text-black' : 
                        allPaid ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' :
                        hasOverdue ? 'bg-red-500/10 border-red-500/30 text-red-500' : 'bg-black border-zinc-800 text-zinc-500'
                      }`}>
                        {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-0.5">
                          <User size={14} className={allPaid ? 'text-emerald-500' : hasOverdue ? 'text-red-500' : 'text-[#BF953F]'} />
                          <h4 className="text-sm font-black text-zinc-100 uppercase tracking-tight">{loan.customerName}</h4>
                          {allPaid && <CheckCircle size={14} className="text-emerald-500 ml-1" />}
                        </div>
                        <p className="text-[10px] text-zinc-600 font-mono uppercase">Contrato #{loan.contractNumber}</p>
                      </div>
                    </div>

                    <div className="flex flex-col md:flex-row items-center gap-8 w-full md:w-auto">
                      <div className="text-center md:text-right min-w-[120px]">
                        <p className="text-[9px] text-zinc-600 font-bold uppercase mb-1">Liquidação Projetada</p>
                        <p className="text-xs font-black text-zinc-200">{loan.totalToReturn.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                      </div>

                      <div className="flex-1 md:w-48">
                        <div className="flex justify-between text-[9px] font-bold uppercase mb-2">
                          <span className="text-zinc-600">Amortização</span>
                          <span className="text-[#BF953F]">{paidInstallments}/{loan.installmentCount}</span>
                        </div>
                        <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden border border-zinc-800">
                          <div className={`h-full transition-all duration-500 ${allPaid ? 'bg-emerald-500' : 'gold-gradient'}`} style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="bg-black/40 border-t border-zinc-900 animate-in slide-in-from-top-2 duration-300">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead className="bg-zinc-900/30 text-[9px] font-bold text-zinc-700 uppercase tracking-widest">
                            <tr>
                              <th className="px-12 py-4">Ref.</th>
                              <th className="px-8 py-4">Vencimento</th>
                              <th className="px-8 py-4 text-right">Saldo Devedor</th>
                              <th className="px-8 py-4 text-right text-red-500">Multa</th>
                              <th className="px-8 py-4 text-center">Status</th>
                              <th className="px-12 py-4 text-right">Operações</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-900/50">
                            {loan.installments.map((inst) => {
                              const penalty = calculatePenalty(inst);
                              const totalDue = inst.value + penalty;
                              const paid = inst.paidValue || 0;
                              const remaining = Math.max(0, totalDue - paid);
                              const isOverdue = inst.status === 'PENDENTE' && inst.dueDate < todayStr;
                              
                              return (
                                <tr key={inst.id} className="hover:bg-zinc-800/20 transition-colors">
                                  <td className="px-12 py-4 text-[10px] font-black text-zinc-600">PARCELA {inst.number}</td>
                                  <td className="px-8 py-4 text-xs font-bold text-zinc-400">{inst.dueDate.split('-').reverse().join('/')}</td>
                                  <td className="px-8 py-4 text-right font-bold text-zinc-400 text-xs">
                                    <div className="flex flex-col items-end">
                                      <span className={remaining > 0 && paid > 0 ? "gold-text" : inst.status === 'PAGO' ? "text-emerald-500" : "text-zinc-200"}>
                                        {remaining.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                      </span>
                                      {paid > 0 && (
                                        <div className="flex flex-col items-end">
                                          <span className="text-[8px] text-zinc-600 uppercase">Total: {totalDue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                                          <span className="text-[8px] text-emerald-600 uppercase font-black">Pago: {paid.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-8 py-4 text-right font-black text-red-500/80 text-xs italic">
                                    {penalty > 0 ? `+ ${penalty.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : '—'}
                                  </td>
                                  <td className="px-8 py-4 text-center">
                                    <div className="flex items-center justify-center">
                                      {inst.status === 'PAGO' ? (
                                        <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[8px] font-black bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 uppercase">Liquidado</span>
                                      ) : isOverdue ? (
                                        <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[8px] font-black bg-red-500/10 text-red-500 border border-red-500/20 uppercase">Em Atraso</span>
                                      ) : (
                                        <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[8px] font-black bg-zinc-800 text-zinc-500 border border-zinc-700 uppercase">Pendente</span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-12 py-4 text-right">
                                    <div className="flex justify-end gap-2">
                                      {inst.status !== 'PAGO' && (
                                        <button 
                                          onClick={(e) => { e.stopPropagation(); setPartialPaymentModal({ loanId: loan.id, instId: inst.id }); }}
                                          className="p-2 bg-[#BF953F]/10 text-[#BF953F] hover:bg-[#BF953F] hover:text-black rounded-lg transition-all border border-[#BF953F]/20"
                                          title="Pagamento Parcial"
                                        >
                                          <TrendingUp size={14} />
                                        </button>
                                      )}
                                      {isOverdue && (
                                        <button 
                                          onClick={() => window.open(generateWhatsAppURL(loan, inst), '_blank')}
                                          className="p-2 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white rounded-lg transition-all border border-emerald-500/20" 
                                        >
                                          <MessageCircle size={14} />
                                        </button>
                                      )}
                                      <button 
                                        onClick={(e) => { e.stopPropagation(); toggleInstallmentStatus(loan.id, inst.id); }}
                                        className={`text-[9px] font-black uppercase tracking-tighter px-4 py-2 rounded-lg transition-all ${
                                          inst.status === 'PAGO' ? 'bg-zinc-800 text-zinc-600' : 'gold-gradient text-black'
                                        }`}
                                      >
                                        {inst.status === 'PAGO' ? 'Estornar' : 'Liquidar'}
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="py-32 text-center">
              <div className="w-20 h-20 bg-zinc-900 rounded-full flex items-center justify-center mx-auto mb-6 border border-zinc-800">
                <FileText size={32} className="text-zinc-800" />
              </div>
              <p className="text-zinc-700 font-black uppercase text-[10px] tracking-[0.3em]">Nenhum contrato corresponde ao filtro</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const ReportCard: React.FC<{ title: string; value: string; icon: React.ReactNode; subtitle: string; isGold?: boolean }> = ({ title, value, icon, subtitle, isGold }) => (
  <div className={`p-6 rounded-[2rem] border transition-all ${isGold ? 'bg-zinc-950 border-[#BF953F]/30 shadow-[0_10px_30px_rgba(191,149,63,0.1)]' : 'bg-[#0a0a0a] border-zinc-800'}`}>
    <div className="flex justify-between items-start mb-6">
      <div className="space-y-1">
        <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">{title}</p>
        <p className={`text-xl font-black ${isGold ? 'gold-text' : 'text-zinc-100'}`}>{value}</p>
      </div>
      <div className="p-3 bg-zinc-900 rounded-2xl border border-zinc-800">{icon}</div>
    </div>
    <div className="pt-4 border-t border-zinc-900/50">
      <p className="text-[8px] font-bold text-zinc-600 uppercase tracking-tighter">{subtitle}</p>
    </div>
  </div>
);

const FilterButton: React.FC<{ active: boolean; onClick: () => void; label: string; count: number }> = ({ active, onClick, label, count }) => (
  <button 
    onClick={onClick}
    className={`px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-3 transition-all ${
      active ? 'gold-gradient text-black shadow-lg' : 'bg-black border border-zinc-800 text-zinc-600 hover:text-zinc-200'
    }`}
  >
    {label}
    <span className={`px-2 py-0.5 rounded-full text-[8px] ${active ? 'bg-black/20 text-black' : 'bg-zinc-900 text-zinc-500'}`}>{count}</span>
  </button>
);

export default Reports;
