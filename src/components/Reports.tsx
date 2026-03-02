import React, { useMemo, useState } from 'react';
import {
  Wallet, TrendingUp, CheckCircle, 
  History, HandCoins, ArrowUpRight, 
  Receipt, ChevronDown, RotateCcw, 
  Calendar, Search, Plus, Minus, ArrowDownLeft
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

  // --- 1. FUNÇÃO DE JUROS (1,5% AO DIA) ---
  const calcularJurosAtraso = (dueDate: string, currentAmount: number) => {
    if (!dueDate || currentAmount <= 0) return { valorTotal: currentAmount, diasAtraso: 0, juros: 0 };
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const partes = dueDate.includes('/') ? dueDate.split('/') : dueDate.split('-');
    const vencimento = dueDate.includes('/') 
      ? new Date(Number(partes[2]), Number(partes[1]) - 1, Number(partes[0]))
      : new Date(dueDate + "T00:00:00");
    if (hoje <= vencimento) return { valorTotal: currentAmount, diasAtraso: 0, juros: 0 };
    const diffMs = hoje.getTime() - vencimento.getTime();
    const diasAtraso = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const juros = currentAmount * 0.015 * diasAtraso;
    return { valorTotal: currentAmount + juros, diasAtraso, juros };
  };

  // --- 2. EXTRATO UNIFICADO (RESTAURADO) ---
  const filteredTransactions = useMemo(() => {
    const list = Array.isArray(cashMovements) ? cashMovements : [];
    const sorted = [...list].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
    return transFilter === 'TODOS' ? sorted : sorted.filter(t => t.type === transFilter);
  }, [cashMovements, transFilter]);

  // --- 3. FILTRO DE CONTRATOS ---
  const filteredLoans = useMemo(() => {
    return loans.filter(l => {
      const isLiq = (l.paidAmount || 0) >= (l.totalToReturn - 0.1);
      const matchesSearch = l.customerName?.toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchesSearch) return false;
      return filterStatus === 'FINALIZADOS' ? isLiq : !isLiq;
    });
  }, [loans, filterStatus, searchTerm]);

  // --- 4. CÁLCULOS DE STATS ---
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

  const handleAction = async (loan: Loan, type: 'TOTAL' | 'PARCIAL' | 'ESTORNO', idx?: number) => {
    let installments = JSON.parse(JSON.stringify(loan.installments || [])); 
    if (type === 'TOTAL' && idx !== undefined) {
        const baseVal = Number(installments[idx].amount || installments[idx].value || 0);
        const { valorTotal } = calcularJurosAtraso(installments[idx].dueDate, baseVal);
        if(!confirm(`Receber R$ ${valorTotal.toFixed(2)}?`)) return;
        installments[idx].status = 'PAGO';
        installments[idx].lastPaidValue = valorTotal;
        installments[idx].amount = 0; installments[idx].value = 0;
        await onUpdateLoan(loan.id, { installments, paidAmount: Number(((loan.paidAmount || 0) + valorTotal).toFixed(2)) });
        onAddTransaction('PAGAMENTO', valorTotal, `PAG: ${loan.customerName} (P${installments[idx].number})`);
        showToast("Pago!", "success");
    } else if (type === 'ESTORNO') {
        const lastIdx = installments.slice().reverse().findIndex((i: any) => i.status === 'PAGO' || i.lastPaidValue > 0);
        const actualIdx = lastIdx !== -1 ? (installments.length - 1 - lastIdx) : -1;
        if (actualIdx === -1) return;
        const valor = installments[actualIdx].lastPaidValue;
        if (!confirm(`Estornar R$ ${valor.toFixed(2)}?`)) return;
        installments[actualIdx].status = 'PENDENTE';
        installments[actualIdx].amount = valor; installments[actualIdx].value = valor; installments[actualIdx].lastPaidValue = 0;
        await onUpdateLoan(loan.id, { installments, paidAmount: Number(((loan.paidAmount || 0) - valor).toFixed(2)) });
        onAddTransaction('ESTORNO', valor, `ESTORNO: ${loan.customerName}`);
        showToast("Estornado!", "info");
    }
  };

  return (
    <div className="space-y-8 pb-20">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard title="Caixa" value={caixa} color="text-emerald-500" icon={<Wallet/>}/>
        <StatCard title="Em Rua" value={stats.valorEmRua} color="text-[#BF953F]" icon={<TrendingUp/>}/>
        <StatCard title="Recebido" value={stats.totalRecebido} color="text-blue-400" icon={<CheckCircle/>}/>
        <StatCard title="A Receber" value={stats.totalAReceber} color="text-red-500" icon={<History/>}/>
        <StatCard title="Emprestado" value={stats.totalEmprestado} color="text-zinc-500" icon={<HandCoins/>}/>
        <StatCard title="Lucro Bruto" value={stats.totalRecebido + stats.totalAReceber - stats.totalEmprestado} color="text-emerald-400" icon={<ArrowUpRight/>}/>
      </div>

      {/* GESTÃO DE CAIXA */}
      <div className="bg-[#0a0a0a] border border-white/5 rounded-[2.5rem] p-8 shadow-2xl">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-sm font-black uppercase tracking-widest text-white">Gestão de Caixa</h3>
          <button onClick={() => setIsAddingMovement(!isAddingMovement)} className="px-6 py-2 bg-white/5 border border-white/10 rounded-full text-[10px] font-black text-[#BF953F]">
            {isAddingMovement ? 'FECHAR' : 'NOVO MOVIMENTO'}
          </button>
        </div>

        {isAddingMovement && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8 p-6 bg-black/40 rounded-3xl border border-[#BF953F]/20">
            <select value={movementForm.type} onChange={e => setMovementForm({...movementForm, type: e.target.value as any})} className="bg-black border border-white/10 rounded-xl px-4 py-3 text-[10px] text-white outline-none">
              <option value="APORTE">APORTE (ENTRADA)</option>
              <option value="RETIRADA">RETIRADA (SAÍDA)</option>
            </select>
            <input placeholder="VALOR" value={movementForm.amount} onChange={e => setMovementForm({...movementForm, amount: e.target.value})} className="bg-black border border-white/10 rounded-xl px-4 py-3 text-[10px] text-white outline-none"/>
            <input placeholder="MOTIVO" value={movementForm.description} onChange={e => setMovementForm({...movementForm, description: e.target.value})} className="bg-black border border-white/10 rounded-xl px-4 py-3 text-[10px] text-white outline-none"/>
            <button onClick={() => {
                const amt = parseFloat(movementForm.amount.replace(',', '.'));
                onAddTransaction(movementForm.type, amt, movementForm.description.toUpperCase());
                setIsAddingMovement(false); setMovementForm({type: 'APORTE', amount: '', description: ''});
            }} className="bg-[#BF953F] text-black rounded-xl text-[10px] font-black">CONFIRMAR</button>
          </div>
        )}

        <div className="flex flex-col xl:flex-row justify-between mt-10 mb-6 gap-6">
          <div className="flex-1 bg-black border border-white/10 rounded-full px-5 py-2.5 flex items-center gap-3">
            <Search size={14} className="text-zinc-600"/><input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="PROCURAR CONTRATO..." className="bg-transparent border-none text-[10px] text-white w-full outline-none uppercase"/>
          </div>
          <div className="flex bg-black p-1 rounded-2xl border border-white/5">
            <button onClick={() => setFilterStatus('ATIVOS')} className={`px-8 py-2 rounded-xl text-[9px] font-black ${filterStatus === 'ATIVOS' ? 'bg-[#BF953F] text-black' : 'text-zinc-600'}`}>ATIVOS</button>
            <button onClick={() => setFilterStatus('FINALIZADOS')} className={`px-8 py-2 rounded-xl text-[9px] font-black ${filterStatus === 'FINALIZADOS' ? 'bg-[#BF953F] text-black' : 'text-zinc-600'}`}>PAGOS</button>
          </div>
        </div>

        <div className="space-y-4">
          {filteredLoans.map(loan => (
            <div key={loan.id} className="border border-white/5 rounded-[2rem] bg-black/20">
              <div className="p-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-[#BF953F]"><Calendar size={18}/></div>
                  <div><h4 className="text-sm font-black text-white uppercase">{loan.customerName}</h4><p className="text-[9px] text-zinc-500 font-bold">FALTA: R$ {((loan.totalToReturn || 0) - (loan.paidAmount || 0)).toFixed(2)}</p></div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleAction(loan, 'ESTORNO')} className="p-2.5 bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500 hover:text-white transition-all"><RotateCcw size={16}/></button>
                  <button onClick={() => setExpandedLoan(expandedLoan === loan.id ? null : loan.id)} className="p-2.5 bg-[#BF953F]/10 text-[#BF953F] rounded-xl"><ChevronDown size={16} className={expandedLoan === loan.id ? 'rotate-180' : ''}/></button>
                </div>
              </div>
              {expandedLoan === loan.id && (
                <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 border-t border-white/5 bg-black/40">
                  {loan.installments?.map((inst: any, idx: number) => {
                    const { valorTotal, diasAtraso } = inst.status !== 'PAGO' ? calcularJurosAtraso(inst.dueDate, inst.amount) : { valorTotal: inst.lastPaidValue, diasAtraso: 0 };
                    return (
                      <div key={idx} className={`p-4 rounded-2xl border ${inst.status === 'PAGO' ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-white/5 border-white/5'}`}>
                        <div className="flex justify-between text-[8px] font-black text-zinc-500 mb-2"><span>P {inst.number}</span><span>{inst.dueDate?.split('-').reverse().join('/')}</span></div>
                        <p className={`text-base font-black ${diasAtraso > 0 && inst.status !== 'PAGO' ? 'text-red-500' : 'text-white'}`}>R$ {valorTotal.toFixed(2)}</p>
                        {diasAtraso > 0 && inst.status !== 'PAGO' && <p className="text-[7px] text-red-500 font-black mt-1 uppercase">{diasAtraso} DIAS ATRASO (+1.5%)</p>}
                        {inst.status !== 'PAGO' && <button onClick={() => handleAction(loan, 'TOTAL', idx)} className="w-full mt-3 py-2 bg-[#BF953F] text-black text-[9px] font-black uppercase rounded-lg">Quitar</button>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* EXTRATO DE MOVIMENTAÇÃO (RESTAURADO) */}
      <div className="bg-[#0a0a0a] border border-white/5 rounded-[2.5rem] p-8 shadow-2xl">
        <div className="flex justify-between items-center mb-8">
          <h3 className="text-sm font-black uppercase tracking-widest text-white">Extrato de Movimentação</h3>
          <div className="flex bg-black p-1 rounded-xl border border-white/5">
            {['TODOS', 'PAGAMENTO', 'APORTE', 'RETIRADA', 'ESTORNO'].map(f => (
              <button key={f} onClick={() => setTransFilter(f)} className={`px-4 py-1.5 rounded-lg text-[8px] font-black transition-all ${transFilter === f ? 'bg-white/10 text-white' : 'text-zinc-600'}`}>{f}</button>
            ))}
          </div>
        </div>

        <div className="space-y-2 overflow-y-auto max-h-[400px] pr-2 custom-scrollbar">
          {filteredTransactions.map((t, i) => (
            <div key={i} className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 rounded-2xl hover:bg-white/[0.04] transition-all">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  t.type === 'PAGAMENTO' || t.type === 'APORTE' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
                }`}>
                  {t.type === 'PAGAMENTO' || t.type === 'APORTE' ? <ArrowDownLeft size={18}/> : <ArrowUpRight size={18}/>}
                </div>
                <div>
                  <p className="text-[10px] font-black text-white uppercase tracking-wider">{t.description}</p>
                  <p className="text-[8px] font-bold text-zinc-500 uppercase">{new Date(t.date).toLocaleString('pt-BR')}</p>
                </div>
              </div>
              <div className="text-right">
                <p className={`text-xs font-black ${t.type === 'PAGAMENTO' || t.type === 'APORTE' ? 'text-emerald-500' : 'text-red-500'}`}>
                  {t.type === 'PAGAMENTO' || t.type === 'APORTE' ? '+' : '-'} R$ {Number(t.amount).toFixed(2)}
                </p>
                <p className="text-[7px] font-black text-zinc-600 uppercase tracking-tighter">{t.type}</p>
              </div>
            </div>
          ))}
          {filteredTransactions.length === 0 && <div className="text-center py-10 text-[10px] font-bold text-zinc-600 uppercase">Nenhuma movimentação encontrada</div>}
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, color, icon }: any) => (
  <div className="p-5 rounded-3xl bg-[#0a0a0a] border border-white/5 hover:border-white/10 transition-all">
    <div className={`p-2.5 w-fit rounded-xl bg-white/5 mb-4 ${color}`}>{icon}</div>
    <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-tighter">{title}</p>
    <h3 className="text-xl font-black text-white mt-1 leading-none">R$ {Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
  </div>
);

export default Reports;