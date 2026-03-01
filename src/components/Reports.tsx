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

  // --- 1. FUNÇÃO DE JUROS (1,5% AO DIA SOBRE O SALDO DEVEDOR DA PARCELA) ---
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
    const valorTotal = currentAmount + juros;

    return { valorTotal, diasAtraso, juros };
  };

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

  // --- 4. AÇÕES FINANCEIRAS (TOTAL, PARCIAL E ESTORNO) ---
  const handleAction = async (loan: Loan, type: 'TOTAL' | 'PARCIAL' | 'ESTORNO', idx?: number) => {
    let installments = JSON.parse(JSON.stringify(loan.installments || [])); 
    
    // --- QUITAR PARCELA INDIVIDUAL ---
    if (type === 'TOTAL' && idx !== undefined) {
      const baseVal = Number(installments[idx].amount || installments[idx].value || 0);
      const { valorTotal, diasAtraso } = calcularJurosAtraso(installments[idx].dueDate, baseVal);
      
      if(!window.confirm(`Confirmar recebimento de R$ ${valorTotal.toFixed(2)}${diasAtraso > 0 ? ' (incluindo juros)' : ''}?`)) return;

      installments[idx].status = 'PAGO';
      installments[idx].lastPaidValue = (installments[idx].lastPaidValue || 0) + valorTotal;
      installments[idx].amount = 0;
      installments[idx].value = 0;
      
      const newPaidAmount = Number(((loan.paidAmount || 0) + valorTotal).toFixed(2));
      await onUpdateLoan(loan.id, { installments, paidAmount: newPaidAmount });
      onAddTransaction('PAGAMENTO', valorTotal, `PAG: ${loan.customerName} (P${installments[idx].number})`);
      showToast("Pagamento recebido!", "success");
    } 

    // --- ABATIMENTO PARCIAL (DEDUZIR DO SALDO DEVEDOR) ---
    else if (type === 'PARCIAL') {
      const valInput = prompt("Valor pago pelo cliente para abatimento:");
      if (!valInput) return;
      const valTotalPago = parseFloat(valInput.replace(',', '.'));
      if (isNaN(valTotalPago) || valTotalPago <= 0) return showToast("Valor inválido", "error");
      
      let saldoRestante = valTotalPago;
      for (let i = 0; i < installments.length; i++) {
        if (saldoRestante <= 0 || installments[i].status === 'PAGO') continue;
        
        const valorDevidoNaParcela = Number(installments[i].amount || installments[i].value || 0);
        
        if (saldoRestante >= valorDevidoNaParcela) {
          saldoRestante -= valorDevidoNaParcela;
          installments[i].lastPaidValue = (installments[i].lastPaidValue || 0) + valorDevidoNaParcela;
          installments[i].status = 'PAGO';
          installments[i].amount = 0;
          installments[i].value = 0;
        } else {
          installments[i].lastPaidValue = (installments[i].lastPaidValue || 0) + saldoRestante;
          installments[i].amount = Number((valorDevidoNaParcela - saldoRestante).toFixed(2));
          installments[i].value = installments[i].amount;
          saldoRestante = 0;
        }
      }

      const newPaidAmount = Number(((loan.paidAmount || 0) + valTotalPago).toFixed(2));
      await onUpdateLoan(loan.id, { installments, paidAmount: newPaidAmount });
      onAddTransaction('PAGAMENTO', valTotalPago, `ABATIMENTO: ${loan.customerName}`);
      showToast(`R$ ${valTotalPago} abatidos com sucesso!`, "success");
    }

    // --- ESTORNO (DESFAZER ÚLTIMA AÇÃO) ---
    else if (type === 'ESTORNO') {
      const lastPaidIdx = installments.slice().reverse().findIndex((inst: any) => 
        inst.status === 'PAGO' || (inst.lastPaidValue > 0)
      );
      
      const actualIdx = lastPaidIdx !== -1 ? (installments.length - 1 - lastPaidIdx) : -1;
      if (actualIdx === -1) return showToast("Nenhum pagamento encontrado para estornar.", "info");
      
      const valorEstorno = installments[actualIdx].lastPaidValue || 0;
      if (!window.confirm(`Estornar R$ ${valorEstorno.toFixed(2)}? O valor sairá do caixa e voltará para a dívida.`)) return;
      
      installments[actualIdx].status = 'PENDENTE';
      installments[actualIdx].amount = (installments[actualIdx].amount || 0) + valorEstorno;
      installments[actualIdx].value = installments[actualIdx].amount;
      installments[actualIdx].lastPaidValue = 0;

      const newPaidAmount = Number(((loan.paidAmount || 0) - valorEstorno).toFixed(2));
      await onUpdateLoan(loan.id, { installments, paidAmount: newPaidAmount });
      onAddTransaction('ESTORNO', valorEstorno, `ESTORNO: ${loan.customerName}`);
      showToast("Estorno concluído!", "info");
    }
  };

  return (
    <div className="space-y-8 pb-20">
      {/* StatCards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard title="Caixa Geral" value={caixa} color="text-emerald-500" icon={<Wallet/>}/>
        <StatCard title="Valor em Rua" value={stats.valorEmRua} color="text-[#BF953F]" icon={<TrendingUp/>}/>
        <StatCard title="Total Recebido" value={stats.totalRecebido} color="text-blue-400" icon={<CheckCircle/>}/>
        <StatCard title="Total a Receber" value={stats.totalAReceber} color="text-red-500" icon={<History/>}/>
        <StatCard title="Total Emprestado" value={stats.totalEmprestado} color="text-zinc-500" icon={<HandCoins/>}/>
        <StatCard title="Lucro Bruto" value={stats.totalRecebido + stats.totalAReceber - stats.totalEmprestado} color="text-emerald-400" icon={<ArrowUpRight/>}/>
      </div>

      <div className="bg-[#0a0a0a] border border-white/5 rounded-[2.5rem] p-8 shadow-2xl">
        <div className="flex flex-col xl:flex-row justify-between items-center mb-10 gap-6">
          <div className="flex items-center gap-6 w-full xl:w-auto">
            <h3 className="text-sm font-black uppercase tracking-widest">Contratos</h3>
            <div className="flex-1 xl:w-64 bg-black border border-white/10 rounded-full px-5 py-2.5 flex items-center gap-3">
              <Search size={14} className="text-zinc-600"/>
              <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="BUSCAR..." className="bg-transparent border-none text-[10px] font-bold text-white w-full outline-none"/>
            </div>
          </div>
          <div className="flex bg-black p-1.5 rounded-2xl border border-white/5">
            <button onClick={() => setFilterStatus('ATIVOS')} className={`px-8 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all ${filterStatus === 'ATIVOS' ? 'bg-[#BF953F] text-black' : 'text-zinc-600'}`}>ATIVOS</button>
            <button onClick={() => setFilterStatus('FINALIZADOS')} className={`px-8 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all ${filterStatus === 'FINALIZADOS' ? 'bg-[#BF953F] text-black' : 'text-zinc-600'}`}>PAGOS</button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {filteredLoans.map(loan => (
            <div key={loan.id} className={`group border rounded-[2rem] overflow-hidden ${expandedLoan === loan.id ? 'bg-[#050505] border-[#BF953F]/40' : 'bg-black/40 border-white/5'}`}>
              <div className="p-6 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-[#BF953F]"><Calendar size={20}/></div>
                  <div>
                    <h4 className="text-sm font-black uppercase text-white">{loan.customerName}</h4>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase mt-1">
                      Falta: R$ {Math.max(0, (loan.totalToReturn || 0) - (loan.paidAmount || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleAction(loan, 'ESTORNO')} title="Estornar último pagamento" className="p-3 bg-red-500/10 text-red-500 rounded-2xl hover:bg-red-500 hover:text-white transition-all"><RotateCcw size={18}/></button>
                  <button onClick={() => setExpandedLoan(expandedLoan === loan.id ? null : loan.id)} className="p-3 bg-[#BF953F]/10 text-[#BF953F] rounded-2xl"><ChevronDown size={20} className={expandedLoan === loan.id ? 'rotate-180' : ''}/></button>
                </div>
              </div>

              {expandedLoan === loan.id && (
                <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 bg-black/40 border-t border-white/5">
                  {(loan.installments || []).map((inst: any, idx: number) => {
                    const currentVal = Number(inst.amount || inst.value || 0);
                    const abatido = Number(inst.lastPaidValue || 0);
                    const { valorTotal, diasAtraso } = inst.status !== 'PAGO' 
                      ? calcularJurosAtraso(inst.dueDate, currentVal)
                      : { valorTotal: abatido, diasAtraso: 0 };

                    return (
                      <div key={idx} className={`p-5 rounded-[1.5rem] border ${inst.status === 'PAGO' ? 'opacity-40 bg-emerald-500/5 border-emerald-500/20' : 'bg-zinc-900/40 border-white/5'}`}>
                        <div className="flex justify-between text-[9px] font-black text-zinc-600 uppercase mb-4">
                          <span>PARCELA {inst.number}</span>
                          <span className={diasAtraso > 0 && inst.status !== 'PAGO' ? 'text-red-500' : ''}>{inst.dueDate?.split('-').reverse().join('/')}</span>
                        </div>
                        
                        <p className={`text-lg font-black ${diasAtraso > 0 && inst.status !== 'PAGO' ? 'text-red-500' : 'text-white'}`}>
                          R$ {valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </p>

                        {abatido > 0 && (
                          <div className="mt-2 text-[8px] font-bold uppercase">
                            <span className="text-emerald-500 block">✓ Abatido: R$ {abatido.toFixed(2)}</span>
                            {inst.status !== 'PAGO' && <span className="text-zinc-500 block">Restante: R$ {currentVal.toFixed(2)}</span>}
                          </div>
                        )}

                        {diasAtraso > 0 && inst.status !== 'PAGO' && (
                          <div className="text-[8px] font-black text-red-500 uppercase mt-2 flex items-center gap-1">
                            <History size={10}/> {diasAtraso} DIAS DE ATRASO (+1,5%/DIA)
                          </div>
                        )}

                        <div className="mt-4 flex gap-2">
                          {inst.status !== 'PAGO' && (
                            <>
                              <button onClick={() => handleAction(loan, 'TOTAL', idx)} className="flex-1 py-2 bg-[#BF953F] text-black text-[9px] font-black uppercase rounded-lg">Quitar</button>
                              <button onClick={() => handleAction(loan, 'PARCIAL')} className="px-2 py-2 bg-white/5 text-white text-[9px] font-black uppercase rounded-lg">Parcial</button>
                            </>
                          )}
                          {inst.status === 'PAGO' && <span className="text-[9px] font-black text-emerald-500 uppercase w-full text-center">Paga</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, color, icon }: any) => (
  <div className="p-5 rounded-3xl bg-[#0a0a0a] border border-white/5">
    <div className={`p-2.5 w-fit rounded-xl bg-white/5 mb-4 ${color}`}>{icon}</div>
    <p className="text-[9px] font-bold text-zinc-500 uppercase">{title}</p>
    <h3 className="text-xl font-black text-white mt-1">R$ {Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
  </div>
);

export default Reports;