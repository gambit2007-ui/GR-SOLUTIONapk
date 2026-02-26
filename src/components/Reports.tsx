import React, { useMemo, useState } from 'react';
import {
  Wallet, TrendingUp, CheckCircle, 
  History, HandCoins, ArrowUpRight, 
  Receipt, ChevronDown, RotateCcw, 
  Calendar, Search, MessageCircle
} from 'lucide-react';
import { Loan, Customer, Installment } from '../types';

interface ReportsProps {
  loans: Loan[];
  customers: Customer[];
  cashMovements: any[];
  caixa: number;
  onAddTransaction: (type: 'APORTE' | 'RETIRADA' | 'PAGAMENTO' | 'ESTORNO', amount: number, description: string) => void;
  onUpdateLoan: (loanId: string, newData: any) => Promise<void>;
  showToast: (message: string, type: 'success' | 'info' | 'error') => void;
}

const Reports: React.FC<ReportsProps> = ({ 
  loans = [], 
  cashMovements = [], 
  caixa = 0, 
  onAddTransaction, 
  onUpdateLoan, 
  showToast 
}) => {
  const [filterStatus, setFilterStatus] = useState<'ATIVOS' | 'FINALIZADOS'>('ATIVOS');
  const [searchTerm, setSearchTerm] = useState('');
  const [transFilter, setTransFilter] = useState('TODOS');
  const [expandedLoan, setExpandedLoan] = useState<string | null>(null);
  const [isAddingMovement, setIsAddingMovement] = useState(false);
  const [movementForm, setMovementForm] = useState({ type: 'APORTE' as 'APORTE' | 'RETIRADA', amount: '', description: '' });

  // --- 1. EXTRATO UNIFICADO ---
  const filteredTransactions = useMemo(() => {
    const list = Array.isArray(cashMovements) ? cashMovements : [];
    const sorted = [...list].sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA;
    });
    return transFilter === 'TODOS' ? sorted : sorted.filter(t => t.type === transFilter);
  }, [cashMovements, transFilter]);

  // --- 2. FILTRO DE CONTRATOS ---
  const filteredLoans = useMemo(() => {
    return loans.filter(l => {
      const isLiq = (l.paidAmount || 0) >= (l.totalToReturn - 0.1);
      const matchesSearch = l.customerName?.toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchesSearch) return false;
      return filterStatus === 'FINALIZADOS' ? isLiq : !isLiq;
    });
  }, [loans, filterStatus, searchTerm]);

  // --- 3. CÁLCULOS FINANCEIROS ---
  const stats = useMemo(() => {
    return loans.reduce((acc, l) => {
      acc.totalEmprestado += (l.amount || 0);
      acc.totalRecebido += (l.paidAmount || 0);
      acc.totalAReceber += Math.max(0, (l.totalToReturn || 0) - (l.paidAmount || 0));
      const prop = (l.paidAmount || 0) / (l.totalToReturn || 1);
      acc.valorEmRua += Math.max(0, (l.amount || 0) - ((l.amount || 0) * prop));
      return acc;
    }, { valorEmRua: 0, totalRecebido: 0, totalAReceber: 0, totalEmprestado: 0 });
  }, [loans]);

  // --- 4. AÇÕES FINANCEIRAS REFORÇADAS ---
  const handleAction = async (loan: Loan, type: 'TOTAL' | 'PARCIAL' | 'ESTORNO', idx?: number) => {
    let installments = JSON.parse(JSON.stringify(loan.installments || [])); // Deep copy
    
    if (type === 'TOTAL' && idx !== undefined) {
      const val = Number(installments[idx].amount || installments[idx].value || 0);
      installments[idx].status = 'PAGO';
      installments[idx].lastPaidValue = val;
      
      const newPaidAmount = Number(((loan.paidAmount || 0) + val).toFixed(2));
      await onUpdateLoan(loan.id, { installments, paidAmount: newPaidAmount });
      onAddTransaction('PAGAMENTO', val, `PAG: ${loan.customerName} (P${installments[idx].number})`);
      showToast("Pagamento recebido!", "success");
    } 

    else if (type === 'PARCIAL') {
      const valInput = prompt("Valor pago pelo cliente:");
      if (!valInput) return;
      const valTotalPago = parseFloat(valInput.replace(',', '.'));
      if (isNaN(valTotalPago) || valTotalPago <= 0) return showToast("Valor inválido", "error");
      
      let saldoRestante = valTotalPago;
      for (let i = 0; i < installments.length; i++) {
        if (saldoRestante <= 0 || installments[i].status === 'PAGO') continue;
        
        const valorDevidoNaParcela = Number(installments[i].amount || installments[i].value || 0);
        
        if (saldoRestante >= valorDevidoNaParcela - 0.01) {
          saldoRestante -= valorDevidoNaParcela;
          installments[i].status = 'PAGO';
          installments[i].lastPaidValue = valorDevidoNaParcela;
        } else {
          // Abatimento parcial da parcela
          const novoValor = Number((valorDevidoNaParcela - saldoRestante).toFixed(2));
          installments[i].amount = novoValor;
          installments[i].value = novoValor;
          installments[i].lastPaidValue = (installments[i].lastPaidValue || 0) + saldoRestante;
          saldoRestante = 0;
        }
      }

      const newPaidAmount = Number(((loan.paidAmount || 0) + valTotalPago).toFixed(2));
      await onUpdateLoan(loan.id, { installments, paidAmount: newPaidAmount });
      onAddTransaction('PAGAMENTO', valTotalPago, `ABATIMENTO: ${loan.customerName}`);
      showToast(`R$ ${valTotalPago} abatidos com sucesso!`, "success");
    }

    else if (type === 'ESTORNO') {
      const lastIdx = installments.slice().reverse().findIndex((i: any) => i.status === 'PAGO' || (i.lastPaidValue > 0));
      const actualIdx = lastIdx !== -1 ? (installments.length - 1 - lastIdx) : -1;
      
      if (actualIdx === -1) return showToast("Sem pagamentos para estornar", "info");
      
      const valorEstorno = installments[actualIdx].lastPaidValue || 0;
      if (!confirm(`Deseja estornar o último pagamento de R$ ${valorEstorno}?`)) return;
      
      // Restaura a parcela
      installments[actualIdx].status = 'PENDENTE';
      installments[actualIdx].amount = (installments[actualIdx].amount || 0) + valorEstorno;
      installments[actualIdx].value = installments[actualIdx].amount;
      installments[actualIdx].lastPaidValue = 0;

      const newPaidAmount = Number(((loan.paidAmount || 0) - valorEstorno).toFixed(2));
      await onUpdateLoan(loan.id, { installments, paidAmount: newPaidAmount });
      onAddTransaction('ESTORNO', valorEstorno, `ESTORNO: ${loan.customerName}`);
      showToast("Estorno realizado no contrato e no caixa!", "info");
    }
  };

  const handleSaveMovement = () => {
    const amt = parseFloat(movementForm.amount.replace(',', '.'));
    if (isNaN(amt) || amt <= 0) return showToast("Valor inválido", "error");
    onAddTransaction(movementForm.type, amt, movementForm.description.toUpperCase() || `${movementForm.type} MANUAL`);
    setIsAddingMovement(false);
    setMovementForm({ type: 'APORTE', amount: '', description: '' });
  };

  return (
    <div className="space-y-8 pb-20 animate-in fade-in duration-500">
      {/* CARDS DE ESTATÍSTICAS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard title="Caixa Geral" value={caixa} color="text-emerald-500" icon={<Wallet/>}/>
        <StatCard title="Valor em Rua" value={stats.valorEmRua} color="text-[#BF953F]" icon={<TrendingUp/>}/>
        <StatCard title="Total Recebido" value={stats.totalRecebido} color="text-blue-400" icon={<CheckCircle/>}/>
        <StatCard title="Total a Receber" value={stats.totalAReceber} color="text-red-500" icon={<History/>}/>
        <StatCard title="Total Emprestado" value={stats.totalEmprestado} color="text-zinc-500" icon={<HandCoins/>}/>
        <StatCard title="Lucro Estimado" value={stats.totalRecebido + stats.totalAReceber - stats.totalEmprestado} color="text-emerald-400" icon={<ArrowUpRight/>}/>
      </div>

      {/* SEÇÃO DE CAIXA E EXTRATO */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 bg-[#0a0a0a] border border-white/5 rounded-3xl p-6 flex flex-col justify-center gap-4">
          <h4 className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-2 flex items-center gap-2">Gestão de Saldo</h4>
          <button onClick={() => { setMovementForm({type:'APORTE', amount:'', description:''}); setIsAddingMovement(true); }} className="w-full py-4 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-2xl font-black text-[10px] uppercase hover:bg-emerald-500 hover:text-white transition-all">Efetuar Aporte</button>
          <button onClick={() => { setMovementForm({type:'RETIRADA', amount:'', description:''}); setIsAddingMovement(true); }} className="w-full py-4 bg-red-500/10 text-red-500 border border-red-500/20 rounded-2xl font-black text-[10px] uppercase hover:bg-red-500 hover:text-white transition-all">Efetuar Retirada</button>
        </div>

        <div className="lg:col-span-8 bg-[#0a0a0a] border border-white/5 rounded-3xl p-6 shadow-xl">
          <div className="flex justify-between items-center mb-6">
            <h4 className="text-[10px] font-black uppercase text-zinc-500 tracking-widest flex items-center gap-2"><Receipt size={14}/> Histórico Recente</h4>
            <select value={transFilter} onChange={(e) => setTransFilter(e.target.value)} className="bg-transparent border-none text-[9px] font-black text-[#BF953F] uppercase cursor-pointer outline-none">
              <option value="TODOS">Todos</option>
              <option value="PAGAMENTO">Pagamentos</option>
              <option value="APORTE">Aportes</option>
              <option value="RETIRADA">Retiradas</option>
            </select>
          </div>
          <div className="space-y-2 overflow-y-auto max-h-[250px] pr-2 custom-scrollbar">
            {filteredTransactions.length > 0 ? (
              filteredTransactions.map((t, i) => (
                <div key={t.id || i} className="flex justify-between items-center p-4 bg-white/[0.02] border border-white/5 rounded-2xl hover:bg-white/[0.05] transition-colors">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-white uppercase">{t.description}</span>
                    <span className="text-[8px] text-zinc-600 font-bold uppercase mt-1">{t.date ? new Date(t.date).toLocaleString('pt-BR') : 'Sem data'}</span>
                  </div>
                  <div className="text-right">
                    <span className={`text-xs font-black ${['RETIRADA', 'ESTORNO'].includes(t.type) ? 'text-red-500' : 'text-emerald-500'}`}>
                      {['RETIRADA', 'ESTORNO'].includes(t.type) ? '-' : '+'} R$ {Number(t.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-center py-10 text-[10px] text-zinc-600 uppercase font-black tracking-widest">Nenhuma movimentação encontrada</p>
            )}
          </div>
        </div>
      </div>

      {/* TABELA DE CONTRATOS */}
      <div className="bg-[#0a0a0a] border border-white/5 rounded-[2.5rem] p-8 shadow-2xl">
        <div className="flex flex-col xl:flex-row justify-between items-center mb-10 gap-6">
          <div className="flex items-center gap-6 w-full xl:w-auto">
            <h3 className="text-sm font-black uppercase tracking-[0.2em]">Controle de Contratos</h3>
            <div className="flex-1 xl:w-64 bg-black border border-white/10 rounded-full px-5 py-2.5 flex items-center gap-3 focus-within:border-[#BF953F]/50 transition-all">
              <Search size={14} className="text-zinc-600"/>
              <input 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="PROCURAR CLIENTE..." 
                className="bg-transparent border-none focus:ring-0 text-[10px] font-bold text-white w-full uppercase placeholder:text-zinc-700"
              />
            </div>
          </div>
          <div className="flex bg-black p-1.5 rounded-2xl border border-white/5">
            <button onClick={() => setFilterStatus('ATIVOS')} className={`px-8 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all ${filterStatus === 'ATIVOS' ? 'bg-[#BF953F] text-black shadow-lg shadow-[#BF953F]/20' : 'text-zinc-600 hover:text-zinc-400'}`}>EM ABERTO</button>
            <button onClick={() => setFilterStatus('FINALIZADOS')} className={`px-8 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all ${filterStatus === 'FINALIZADOS' ? 'bg-[#BF953F] text-black shadow-lg shadow-[#BF953F]/20' : 'text-zinc-600 hover:text-zinc-400'}`}>LIQUIDADOS</button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {filteredLoans.length > 0 ? filteredLoans.map(loan => (
            <div key={loan.id} className={`group border transition-all duration-300 rounded-[2rem] overflow-hidden ${expandedLoan === loan.id ? 'bg-[#050505] border-[#BF953F]/40' : 'bg-black/40 border-white/5 hover:border-white/10'}`}>
              <div className="p-6 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4 w-full md:w-auto">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${expandedLoan === loan.id ? 'bg-[#BF953F] text-black' : 'bg-white/5 text-[#BF953F]'}`}>
                    <Calendar size={20}/>
                  </div>
                  <div>
                    <h4 className="text-sm font-black uppercase text-white tracking-tight">{loan.customerName}</h4>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase mt-1">
                      Saldo Devedor: R$ {Math.max(0, (loan.totalToReturn || 0) - (loan.paidAmount || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
                
                <div className="flex gap-2 w-full md:w-auto items-center">
                  <button onClick={() => window.open(`https://wa.me/55${loan.customerId}?text=${encodeURIComponent(`Olá ${loan.customerName}, o saldo atual do seu contrato é R$ ${(loan.totalToReturn - (loan.paidAmount || 0)).toFixed(2)}. Como podemos agendar o pagamento?`)}`, '_blank')} className="p-3 bg-emerald-500/10 text-emerald-500 rounded-2xl hover:bg-emerald-500 hover:text-white transition-all"><MessageCircle size={18} /></button>
                  <button onClick={() => handleAction(loan, 'ESTORNO')} title="Estornar Último Pagamento" className="p-3 bg-zinc-900 rounded-2xl text-zinc-500 hover:text-red-500 hover:bg-red-500/10 transition-all"><RotateCcw size={18}/></button>
                  <button onClick={() => handleAction(loan, 'PARCIAL')} className="flex-1 md:flex-none px-6 py-3 bg-zinc-900 border border-white/5 rounded-2xl text-[10px] font-black uppercase hover:bg-white hover:text-black transition-all">Abatimento</button>
                  <button onClick={() => setExpandedLoan(expandedLoan === loan.id ? null : loan.id)} className={`p-3 rounded-2xl transition-all ${expandedLoan === loan.id ? 'bg-[#BF953F] text-black' : 'bg-[#BF953F]/10 text-[#BF953F]'}`}>
                    <ChevronDown size={20} className={`${expandedLoan === loan.id ? 'rotate-180' : ''} transition-transform`}/>
                  </button>
                </div>
              </div>

              {expandedLoan === loan.id && (
                <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 bg-black/40 border-t border-white/5 animate-in slide-in-from-top-2">
                  {(loan.installments || []).map((inst: any, idx: number) => (
                    <div key={idx} className={`relative p-5 rounded-[1.5rem] border transition-all ${inst.status === 'PAGO' ? 'opacity-40 bg-emerald-500/5 border-emerald-500/20' : 'bg-zinc-900/40 border-white/5'}`}>
                      <div className="flex justify-between items-start mb-4 text-[9px] font-black text-zinc-600 uppercase">
                        <span>P {inst.number}</span>
                        <span>{inst.dueDate?.split('-').reverse().join('/')}</span>
                      </div>
                      <p className="text-lg font-black text-white mb-4">R$ {Number(inst.amount || inst.value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                      {inst.status !== 'PAGO' && (
                        <button onClick={() => handleAction(loan, 'TOTAL', idx)} className="w-full py-3 bg-[#BF953F] text-black text-[10px] font-black uppercase rounded-xl hover:scale-[1.02] transition-all">Quitar</button>
                      )}
                      {inst.status === 'PAGO' && <div className="text-[8px] font-black text-emerald-500 uppercase text-center">Recebido</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )) : (
            <div className="text-center py-20 bg-black/20 rounded-3xl border border-dashed border-white/5">
              <p className="text-[10px] font-black uppercase text-zinc-600 tracking-widest">Nenhum contrato encontrado</p>
            </div>
          )}
        </div>
      </div>

      {/* MODAL DE MOVIMENTAÇÃO */}
      {isAddingMovement && (
        <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex items-center justify-center p-6">
          <div className="bg-[#0d0d0d] border border-white/10 w-full max-w-sm rounded-[2.5rem] p-10 shadow-2xl animate-in zoom-in-95">
            <h3 className="text-[10px] font-black text-[#BF953F] uppercase mb-8 text-center tracking-[0.3em]">Registrar {movementForm.type}</h3>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[8px] font-black text-zinc-600 uppercase ml-2">Valor</label>
                <input type="text" placeholder="0,00" className="w-full bg-black border border-white/5 rounded-xl p-4 text-white font-black focus:border-[#BF953F] outline-none transition-all" value={movementForm.amount} onChange={e => setMovementForm({...movementForm, amount: e.target.value})} />
              </div>
              <div className="space-y-1">
                <label className="text-[8px] font-black text-zinc-600 uppercase ml-2">Motivo / Descrição</label>
                <input type="text" placeholder="EX: APORTE CAPITAL SOCIAL" className="w-full bg-black border border-white/5 rounded-xl p-4 text-white font-bold uppercase focus:border-[#BF953F] outline-none transition-all" value={movementForm.description} onChange={e => setMovementForm({...movementForm, description: e.target.value})} />
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => setIsAddingMovement(false)} className="flex-1 py-4 bg-zinc-900 text-white rounded-xl font-black text-[10px] uppercase hover:bg-zinc-800 transition-all">Cancelar</button>
                <button onClick={handleSaveMovement} className="flex-1 py-4 bg-[#BF953F] text-black rounded-xl font-black text-[10px] uppercase hover:brightness-110 transition-all">Confirmar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard = ({ title, value, color, icon }: any) => (
  <div className="p-5 rounded-3xl bg-[#0a0a0a] border border-white/5 shadow-xl transition-all hover:border-[#BF953F]/20 group">
    <div className={`p-2.5 w-fit rounded-xl bg-white/5 mb-4 group-hover:scale-110 transition-transform ${color}`}>{icon}</div>
    <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">{title}</p>
    <h3 className="text-xl font-black text-white mt-1">
      <span className="text-xs opacity-40 mr-1.5 font-normal">R$</span>
      {Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
    </h3>
  </div>
);

export default Reports;