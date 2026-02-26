import React, { useMemo, useState } from 'react';
import {
  Wallet, TrendingUp, CheckCircle, 
  History, HandCoins, ArrowUpRight, 
  Receipt, ChevronDown, RotateCcw, 
  Calendar, Search, MessageCircle
} from 'lucide-react';
import { Loan, Customer } from '../types';

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

  // --- 1. LÓGICA DO EXTRATO ---
  const filteredTransactions = useMemo(() => {
    const list = Array.isArray(cashMovements) ? cashMovements : [];
    const sorted = [...list].sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA;
    });
    if (transFilter === 'TODOS') return sorted;
    return sorted.filter(t => t.type === transFilter);
  }, [cashMovements, transFilter]);

  // --- 2. FILTRO DE CONTRATOS (CORRIGIDO PARA APARECER SEMPRE) ---
  const filteredLoans = useMemo(() => {
    return loans.filter(l => {
      const totalToReturn = Number(l.totalToReturn || 0);
      const paidAmount = Number(l.paidAmount || 0);
      const isLiq = paidAmount >= (totalToReturn - 0.1) && totalToReturn > 0;
      
      const name = l.customerName || "Cliente Sem Nome";
      const matchesSearch = name.toLowerCase().includes(searchTerm.toLowerCase());
      
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

  // --- 4. FUNÇÃO DE WHATSAPP ---
  const handleWhatsAppCharge = (loan: Loan) => {
    const saldo = (loan.totalToReturn - (loan.paidAmount || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const message = `Olá ${loan.customerName}, tudo bem? Passando para lembrar do seu contrato conosco. O saldo atual para quitação é de R$ ${saldo}. Como podemos prosseguir?`;
    // Remove caracteres não numéricos do telefone (exemplo simplificado)
    const phone = "55" + (loan.customerId); // Ajuste aqui se tiver o campo fone no objeto loan
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
  };

  // --- 5. AÇÕES DE LIQUIDAÇÃO E ESTORNO ---
  const handleAction = async (loan: Loan, type: 'TOTAL' | 'PARCIAL' | 'ESTORNO', idx?: number) => {
    let installments = [...(loan.installments || [])];
    
    if (type === 'TOTAL' && idx !== undefined) {
      const val = installments[idx].value;
      installments[idx] = { ...installments[idx], status: 'PAGO', lastPaidValue: val };
      await onUpdateLoan(loan.id, { installments, paidAmount: Number(((loan.paidAmount || 0) + val).toFixed(2)) });
      onAddTransaction('PAGAMENTO', val, `PAG: ${loan.customerName} (P${installments[idx].number})`);
      showToast("Pagamento confirmado!", "success");
    } 
    else if (type === 'PARCIAL') {
      const valInput = prompt("Valor para abatimento:");
      if (!valInput) return;
      const val = parseFloat(valInput.replace(',', '.'));
      if (isNaN(val) || val <= 0) return showToast("Valor inválido", "error");
      
      let rest = val;
      for (let i = 0; i < installments.length; i++) {
        if (rest <= 0 || installments[i].status === 'PAGO') continue;
        const vParc = installments[i].value;
        if (rest >= vParc - 0.01) {
          rest -= vParc;
          installments[i] = { ...installments[i], status: 'PAGO', lastPaidValue: vParc, value: 0 };
        } else {
          installments[i].value = Number((vParc - rest).toFixed(2));
          rest = 0;
        }
      }
      await onUpdateLoan(loan.id, { installments, paidAmount: Number(((loan.paidAmount || 0) + val).toFixed(2)) });
      onAddTransaction('PAGAMENTO', val, `ABATIMENTO: ${loan.customerName}`);
      showToast("Abatimento realizado!", "success");
    }
    else if (type === 'ESTORNO') {
      const lastIdx = installments.slice().reverse().findIndex(i => i.status === 'PAGO');
      const actualIdx = lastIdx !== -1 ? (installments.length - 1 - lastIdx) : -1;
      if (actualIdx === -1) return showToast("Nada a estornar", "info");
      const val = installments[actualIdx].lastPaidValue || installments[actualIdx].value;
      if (!confirm(`Estornar R$ ${val}?`)) return;
      
      installments[actualIdx] = { ...installments[actualIdx], status: 'PENDENTE', value: val };
      await onUpdateLoan(loan.id, { installments, paidAmount: Number(((loan.paidAmount || 0) - val).toFixed(2)) });
      onAddTransaction('ESTORNO', val, `ESTORNO: ${loan.customerName}`);
      showToast("Estorno concluído", "info");
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
      {/* INDICADORES */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard title="Caixa Geral" value={caixa} color="text-emerald-500" icon={<Wallet/>}/>
        <StatCard title="Valor em Rua" value={stats.valorEmRua} color="text-[#BF953F]" icon={<TrendingUp/>}/>
        <StatCard title="Total Recebido" value={stats.totalRecebido} color="text-blue-400" icon={<CheckCircle/>}/>
        <StatCard title="Total a Receber" value={stats.totalAReceber} color="text-red-500" icon={<History/>}/>
        <StatCard title="Total Emprestado" value={stats.totalEmprestado} color="text-zinc-500" icon={<HandCoins/>}/>
        <StatCard title="Lucro Bruto" value={stats.totalRecebido + stats.totalAReceber - stats.totalEmprestado} color="text-emerald-400" icon={<ArrowUpRight/>}/>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 bg-[#0a0a0a] border border-white/5 rounded-3xl p-6 flex flex-col justify-center gap-4">
          <h4 className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-2 flex items-center gap-2">Gestão de Saldo</h4>
          <button onClick={() => { setMovementForm({type:'APORTE', amount:'', description:''}); setIsAddingMovement(true); }} className="w-full py-4 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-2xl font-black text-[10px] uppercase hover:bg-emerald-500 transition-all">Efetuar Aporte</button>
          <button onClick={() => { setMovementForm({type:'RETIRADA', amount:'', description:''}); setIsAddingMovement(true); }} className="w-full py-4 bg-red-500/10 text-red-500 border border-red-500/20 rounded-2xl font-black text-[10px] uppercase hover:bg-red-500 transition-all">Efetuar Retirada</button>
        </div>

        <div className="lg:col-span-8 bg-[#0a0a0a] border border-white/5 rounded-3xl p-6 shadow-xl">
          <div className="flex justify-between items-center mb-6">
            <h4 className="text-[10px] font-black uppercase text-zinc-500 tracking-widest flex items-center gap-2"><Receipt size={14}/> Extrato de Caixa</h4>
            <select value={transFilter} onChange={(e) => setTransFilter(e.target.value)} className="bg-transparent border-none text-[9px] font-black text-[#BF953F] uppercase cursor-pointer">
              <option value="TODOS">Todos</option>
              <option value="PAGAMENTO">Pagamentos</option>
              <option value="APORTE">Aportes</option>
              <option value="RETIRADA">Retiradas</option>
            </select>
          </div>
          <div className="space-y-2 overflow-y-auto max-h-[250px] pr-2 custom-scrollbar">
            {filteredTransactions.length > 0 ? (
              filteredTransactions.map((t, i) => (
                <div key={t.id || i} className="flex justify-between items-center p-4 bg-white/[0.02] border border-white/5 rounded-2xl">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-white uppercase">{t.description}</span>
                    <span className="text-[8px] text-zinc-600 font-bold uppercase mt-1">{t.date ? new Date(t.date).toLocaleString('pt-BR') : ''}</span>
                  </div>
                  <div className="text-right">
                    <span className={`text-xs font-black ${t.type === 'RETIRADA' || t.type === 'ESTORNO' ? 'text-red-500' : 'text-emerald-500'}`}>
                      {t.type === 'RETIRADA' || t.type === 'ESTORNO' ? '-' : '+'} R$ {t.amount?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-center py-10 text-[10px] text-zinc-600 uppercase font-black">Sem movimentações</p>
            )}
          </div>
        </div>
      </div>

      {/* GESTÃO DE CONTRATOS */}
      <div className="bg-[#0a0a0a] border border-white/5 rounded-[2.5rem] p-8 shadow-2xl">
        <div className="flex flex-col xl:flex-row justify-between items-center mb-10 gap-6">
          <div className="flex items-center gap-6 w-full xl:w-auto">
            <h3 className="text-sm font-black uppercase tracking-[0.2em]">Gestão de Contratos</h3>
            <div className="flex-1 xl:w-64 bg-black border border-white/10 rounded-full px-4 py-2 flex items-center gap-3">
              <Search size={14} className="text-zinc-600"/>
              <input 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="BUSCAR CLIENTE..." 
                className="bg-transparent border-none focus:ring-0 text-[10px] font-bold text-white w-full uppercase"
              />
            </div>
          </div>
          <div className="flex bg-black p-1.5 rounded-2xl border border-white/5">
            <button onClick={() => setFilterStatus('ATIVOS')} className={`px-8 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all ${filterStatus === 'ATIVOS' ? 'bg-[#BF953F] text-black shadow-lg shadow-[#BF953F]/20' : 'text-zinc-600'}`}>ATIVOS</button>
            <button onClick={() => setFilterStatus('FINALIZADOS')} className={`px-8 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all ${filterStatus === 'FINALIZADOS' ? 'bg-[#BF953F] text-black shadow-lg shadow-[#BF953F]/20' : 'text-zinc-600'}`}>QUITADOS</button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {filteredLoans.length > 0 ? filteredLoans.map(loan => (
            <div key={loan.id} className={`group border transition-all rounded-[2rem] overflow-hidden ${expandedLoan === loan.id ? 'bg-[#050505] border-[#BF953F]/40' : 'bg-black/40 border-white/5'}`}>
              <div className="p-6 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4 w-full md:w-auto">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${expandedLoan === loan.id ? 'bg-[#BF953F] text-black' : 'bg-white/5 text-[#BF953F]'}`}>
                    <Calendar size={20}/>
                  </div>
                  <div>
                    <h4 className="text-sm font-black uppercase text-white tracking-tight">{loan.customerName || "Sem Nome"}</h4>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase mt-1">
                      Saldo Devedor: R$ {(Number(loan.totalToReturn || 0) - Number(loan.paidAmount || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
                
                <div className="flex gap-2 w-full md:w-auto items-center">
                  {/* BOTÃO WHATSAPP */}
                  <button 
                    onClick={() => handleWhatsAppCharge(loan)}
                    title="Cobrar via WhatsApp"
                    className="p-3 bg-emerald-500/10 text-emerald-500 rounded-2xl hover:bg-emerald-500 hover:text-white transition-all"
                  >
                    <MessageCircle size={18} />
                  </button>

                  <button onClick={() => handleAction(loan, 'ESTORNO')} className="p-3 bg-zinc-900 rounded-2xl text-zinc-500 hover:text-red-500 transition-all"><RotateCcw size={18}/></button>
                  <button onClick={() => handleAction(loan, 'PARCIAL')} className="flex-1 md:flex-none px-6 py-3 bg-zinc-900 border border-white/5 rounded-2xl text-[10px] font-black uppercase hover:bg-white hover:text-black transition-all">Abatimento</button>
                  <button onClick={() => setExpandedLoan(expandedLoan === loan.id ? null : loan.id)} className={`p-3 rounded-2xl transition-all ${expandedLoan === loan.id ? 'bg-[#BF953F] text-black' : 'bg-[#BF953F]/10 text-[#BF953F]'}`}>
                    <ChevronDown size={20} className={`${expandedLoan === loan.id ? 'rotate-180' : ''} transition-transform`}/>
                  </button>
                </div>
              </div>

              {expandedLoan === loan.id && (
                <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 bg-black/40 border-t border-white/5">
                  {loan.installments?.map((inst: any, idx) => (
                    <div key={idx} className={`relative p-5 rounded-[1.5rem] border ${inst.status === 'PAGO' ? 'opacity-30 bg-emerald-500/5 border-emerald-500/20' : 'bg-zinc-900/40 border-white/5'}`}>
                      <div className="flex justify-between items-start mb-4 text-[9px] font-black text-zinc-600 uppercase">
                        <span>Parcela {inst.number}</span>
                        <span>{inst.dueDate?.split('-').reverse().join('/')}</span>
                      </div>
                      <p className="text-lg font-black text-white mb-4">R$ {Number(inst.value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                      {inst.status !== 'PAGO' && (
                        <button onClick={() => handleAction(loan, 'TOTAL', idx)} className="w-full py-3 bg-[#BF953F] text-black text-[10px] font-black uppercase rounded-xl hover:brightness-110 transition-all">Quitar</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )) : (
            <div className="text-center py-20 bg-black/20 rounded-3xl border border-dashed border-white/5">
              <p className="text-[10px] font-black uppercase text-zinc-600 tracking-widest">Nenhum contrato encontrado nesta categoria</p>
            </div>
          )}
        </div>
      </div>

      {/* MODAL MOVIMENTAÇÃO */}
      {isAddingMovement && (
        <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-[#0d0d0d] border border-white/10 w-full max-w-md rounded-[2.5rem] p-10 shadow-2xl">
            <h3 className="text-[10px] font-black text-[#BF953F] uppercase mb-8 text-center tracking-widest">Registrar {movementForm.type}</h3>
            <div className="space-y-4">
              <input type="number" placeholder="VALOR R$" className="w-full bg-black border border-white/5 rounded-xl p-4 text-white font-black focus:border-[#BF953F] outline-none" value={movementForm.amount} onChange={e => setMovementForm({...movementForm, amount: e.target.value})} />
              <input type="text" placeholder="DESCRIÇÃO" className="w-full bg-black border border-white/5 rounded-xl p-4 text-white font-bold uppercase focus:border-[#BF953F] outline-none" value={movementForm.description} onChange={e => setMovementForm({...movementForm, description: e.target.value})} />
              <div className="flex gap-2">
                <button onClick={() => setIsAddingMovement(false)} className="flex-1 py-4 bg-zinc-900 text-white rounded-xl font-black text-[10px] uppercase">Cancelar</button>
                <button onClick={handleSaveMovement} className="flex-1 py-4 bg-[#BF953F] text-black rounded-xl font-black text-[10px] uppercase">Confirmar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard = ({ title, value, color, icon }: any) => (
  <div className="p-5 rounded-2xl bg-[#0a0a0a] border border-white/5 shadow-xl transition-transform hover:scale-[1.02]">
    <div className={`p-2 w-fit rounded-lg bg-white/5 mb-3 ${color}`}>{icon}</div>
    <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">{title}</p>
    <h3 className="text-xl font-black text-white mt-1">
      <span className="text-xs opacity-50 mr-1">R$</span>
      {Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
    </h3>
  </div>
);

export default Reports;