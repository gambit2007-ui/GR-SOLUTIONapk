import React, { useMemo, useState } from 'react';
import {
  Wallet, TrendingUp, CheckCircle, 
  History, HandCoins, ArrowUpRight, 
  ChevronDown, RotateCcw, 
  Calendar, Search, ArrowDownLeft
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
  const [expandedLoan, setExpandedLoan] = useState<string | null>(null);
  const [isAddingMovement, setIsAddingMovement] = useState(false);
  const [movementForm, setMovementForm] = useState({ type: 'APORTE' as 'APORTE' | 'RETIRADA', amount: '', description: '' });

  // --- CÁLCULO DE JUROS E VERIFICAÇÃO DE ATRASO ---
  const checkAtraso = (dueDate: string) => {
    if (!dueDate) return false;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const [ano, mes, dia] = dueDate.split('-');
    const vencimento = new Date(Number(ano), Number(mes) - 1, Number(dia));
    return hoje > vencimento;
  };

  const calcularJurosAtraso = (dueDate: string, amount: any) => {
    const valorBase = Number(amount) || 0;
    if (!dueDate || valorBase <= 0) return { valorTotal: valorBase, diasAtraso: 0 };
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const [ano, mes, dia] = dueDate.split('-');
    const vencimento = new Date(Number(ano), Number(mes) - 1, Number(dia));
    if (hoje <= vencimento) return { valorTotal: valorBase, diasAtraso: 0 };
    const diffMs = hoje.getTime() - vencimento.getTime();
    const diasAtraso = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return { valorTotal: valorBase + (valorBase * 0.015 * diasAtraso), diasAtraso };
  };

  // --- FILTRO: SUMIR SE NÃO HOUVER PARCELAS ATRASADAS PENDENTES ---
  const filteredLoans = useMemo(() => {
    return (loans || []).filter(l => {
      const matchesSearch = l.customerName?.toLowerCase().includes(searchTerm.toLowerCase());
      
      // Verifica se existe QUALQUER parcela que está atrasada E não está paga
      const temParcelaAtrasada = (l.installments || []).some(inst => 
        inst.status !== 'PAGO' && checkAtraso(inst.dueDate)
      );

      // Se o filtro for ATIVOS (Inadimplentes), só mostra quem TEM parcela atrasada
      if (filterStatus === 'ATIVOS') {
        return temParcelaAtrasada && matchesSearch;
      } else {
        // Se for FINALIZADOS, mostra quem NÃO tem mais parcelas atrasadas pendentes
        return !temParcelaAtrasada && matchesSearch;
      }
    });
  }, [loans, filterStatus, searchTerm]);

  const stats = useMemo(() => {
    return (loans || []).reduce((acc, l) => {
      acc.totalEmprestado += (l.amount || 0);
      acc.totalRecebido += (l.paidAmount || 0);
      acc.totalAReceber += Math.max(0, (l.totalToReturn || 0) - (l.paidAmount || 0));
      return acc;
    }, { totalRecebido: 0, totalAReceber: 0, totalEmprestado: 0 });
  }, [loans]);

  const handleAction = async (loan: Loan, type: 'TOTAL' | 'ESTORNO', idx?: number) => {
    const installments = JSON.parse(JSON.stringify(loan.installments || []));
    if (type === 'TOTAL' && idx !== undefined) {
      const { valorTotal } = calcularJurosAtraso(installments[idx].dueDate, installments[idx].amount || installments[idx].value);
      if(!window.confirm(`Receber R$ ${valorTotal.toFixed(2)}?`)) return;
      installments[idx].status = 'PAGO';
      installments[idx].lastPaidValue = valorTotal;
      installments[idx].amount = 0;
      const novoTotalPago = Number(((loan.paidAmount || 0) + valorTotal).toFixed(2));
      await onUpdateLoan(loan.id, { installments, paidAmount: novoTotalPago });
      onAddTransaction('PAGAMENTO', valorTotal, `PAG: ${loan.customerName}`);
      showToast("Parcela quitada!", "success");
    } else if (type === 'ESTORNO') {
      const lastIdx = installments.slice().reverse().findIndex((i: any) => i.status === 'PAGO');
      const actualIdx = lastIdx !== -1 ? (installments.length - 1 - lastIdx) : -1;
      if (actualIdx === -1) return;
      const valor = installments[actualIdx].lastPaidValue || 0;
      if(!confirm(`Estornar R$ ${valor.toFixed(2)}?`)) return;
      installments[actualIdx].status = 'PENDENTE';
      installments[actualIdx].amount = installments[actualIdx].value || valor;
      installments[actualIdx].lastPaidValue = 0;
      await onUpdateLoan(loan.id, { installments, paidAmount: Number(((loan.paidAmount || 0) - valor).toFixed(2)) });
      onAddTransaction('ESTORNO', valor, `ESTORNO: ${loan.customerName}`);
      showToast("Estornado!", "info");
    }
  };

  return (
    <div className="space-y-6 pb-20">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Caixa" value={caixa} color="text-emerald-500" icon={<Wallet/>}/>
        <StatCard title="Total Recebido" value={stats.totalRecebido} color="text-blue-400" icon={<CheckCircle/>}/>
        <StatCard title="A Receber" value={stats.totalAReceber} color="text-red-500" icon={<History/>}/>
        <StatCard title="Lucro Bruto" value={stats.totalRecebido + stats.totalAReceber - stats.totalEmprestado} color="text-emerald-400" icon={<ArrowUpRight/>}/>
      </div>

      <div className="bg-[#0a0a0a] border border-white/5 rounded-[2rem] p-6">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xs font-black uppercase text-white tracking-widest">Controle Financeiro</h3>
          <button onClick={() => setIsAddingMovement(!isAddingMovement)} className="px-4 py-2 bg-white/5 border border-white/10 rounded-full text-[9px] font-black text-[#BF953F]">
            {isAddingMovement ? 'FECHAR' : 'MOVIMENTAÇÃO MANUAL'}
          </button>
        </div>

        {isAddingMovement && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6 p-4 bg-black/40 rounded-2xl border border-[#BF953F]/20">
            <select value={movementForm.type} onChange={e => setMovementForm({...movementForm, type: e.target.value as any})} className="bg-black border border-white/10 rounded-lg px-3 py-2 text-[10px] text-white">
              <option value="APORTE">APORTE</option>
              <option value="RETIRADA">RETIRADA</option>
            </select>
            <input placeholder="VALOR" value={movementForm.amount} onChange={e => setMovementForm({...movementForm, amount: e.target.value})} className="bg-black border border-white/10 rounded-lg px-3 py-2 text-[10px] text-white"/>
            <input placeholder="MOTIVO" value={movementForm.description} onChange={e => setMovementForm({...movementForm, description: e.target.value})} className="bg-black border border-white/10 rounded-lg px-3 py-2 text-[10px] text-white"/>
            <button onClick={() => {
                const amt = parseFloat(movementForm.amount.replace(',', '.'));
                if(amt > 0) onAddTransaction(movementForm.type, amt, movementForm.description.toUpperCase());
                setIsAddingMovement(false);
            }} className="bg-[#BF953F] text-black rounded-lg text-[10px] font-black">SALVAR</button>
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex-1 bg-black border border-white/10 rounded-full px-4 py-2 flex items-center gap-2">
            <Search size={14} className="text-zinc-600"/><input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="BUSCAR CLIENTE..." className="bg-transparent border-none text-[10px] text-white w-full outline-none uppercase"/>
          </div>
          <div className="flex bg-black p-1 rounded-xl border border-white/5">
            <button onClick={() => setFilterStatus('ATIVOS')} className={`px-6 py-1.5 rounded-lg text-[9px] font-black ${filterStatus === 'ATIVOS' ? 'bg-red-500 text-white' : 'text-zinc-600'}`}>INADIMPLENTES</button>
            <button onClick={() => setFilterStatus('FINALIZADOS')} className={`px-6 py-1.5 rounded-lg text-[9px] font-black ${filterStatus === 'FINALIZADOS' ? 'bg-[#BF953F] text-black' : 'text-zinc-600'}`}>EM DIA / PAGOS</button>
          </div>
        </div>

        <div className="space-y-3">
          {filteredLoans.map(loan => (
            <div key={loan.id} className="border border-white/5 rounded-[1.5rem] bg-black/20 overflow-hidden">
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-[#BF953F]"><Calendar size={18}/></div>
                  <div><h4 className="text-xs font-black text-white uppercase">{loan.customerName}</h4><p className="text-[9px] text-zinc-500 font-bold">DÍVIDA: R$ {((loan.totalToReturn || 0) - (loan.paidAmount || 0)).toFixed(2)}</p></div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleAction(loan, 'ESTORNO')} className="p-2 bg-white/5 text-zinc-500 rounded-lg hover:text-red-500"><RotateCcw size={14}/></button>
                  <button onClick={() => setExpandedLoan(expandedLoan === loan.id ? null : loan.id)} className="p-2 bg-[#BF953F]/10 text-[#BF953F] rounded-lg"><ChevronDown size={14} className={expandedLoan === loan.id ? 'rotate-180' : ''}/></button>
                </div>
              </div>
              {expandedLoan === loan.id && (
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 border-t border-white/5 bg-black/40">
                  {loan.installments?.map((inst: any, idx: number) => {
                    const { valorTotal, diasAtraso } = inst.status !== 'PAGO' ? calcularJurosAtraso(inst.dueDate, inst.amount || inst.value) : { valorTotal: inst.lastPaidValue, diasAtraso: 0 };
                    return (
                      <div key={idx} className={`p-3 rounded-xl border ${inst.status === 'PAGO' ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-white/5 border-white/5'}`}>
                        <div className="flex justify-between text-[8px] font-bold text-zinc-500 mb-1"><span>PARCELA {inst.number}</span><span>{inst.dueDate?.split('-').reverse().join('/')}</span></div>
                        <p className={`text-sm font-black ${diasAtraso > 0 && inst.status !== 'PAGO' ? 'text-red-500' : 'text-white'}`}>R$ {Number(valorTotal).toFixed(2)}</p>
                        {inst.status !== 'PAGO' && <button onClick={() => handleAction(loan, 'TOTAL', idx)} className="w-full mt-2 py-1.5 bg-[#BF953F] text-black text-[9px] font-black uppercase rounded-md">Quitar</button>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          {filteredLoans.length === 0 && <p className="text-center py-10 text-[10px] text-zinc-600 font-black">NENHUM CONTRATO NESTE FILTRO</p>}
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, color, icon }: any) => (
  <div className="p-4 rounded-2xl bg-[#0a0a0a] border border-white/5">
    <div className={`p-2 w-fit rounded-lg bg-white/5 mb-2 ${color}`}>{icon}</div>
    <p className="text-[8px] font-bold text-zinc-500 uppercase">{title}</p>
    <h3 className="text-lg font-black text-white leading-none">R$ {Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
  </div>
);

export default Reports;