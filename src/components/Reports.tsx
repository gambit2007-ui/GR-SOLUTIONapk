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

  // --- FUNÇÃO DE CÁLCULO DE JUROS (1,5% AO DIA) ---
  const calcularJurosAtraso = (dueDate: string, originalAmount: number) => {
    if (!dueDate) return { valorTotal: originalAmount, diasAtraso: 0, juros: 0 };
    
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    
    // Converte data do formato DD/MM/AAAA ou AAAA-MM-DD para objeto Date
    const partes = dueDate.includes('/') ? dueDate.split('/') : dueDate.split('-');
    const vencimento = dueDate.includes('/') 
      ? new Date(Number(partes[2]), Number(partes[1]) - 1, Number(partes[0]))
      : new Date(dueDate + "T00:00:00");

    if (hoje <= vencimento) return { valorTotal: originalAmount, diasAtraso: 0, juros: 0 };

    const diffMs = hoje.getTime() - vencimento.getTime();
    const diasAtraso = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    // Cálculo: 1,5% ao dia sobre o valor da parcela
    const juros = originalAmount * 0.015 * diasAtraso;
    const valorTotal = originalAmount + juros;

    return { valorTotal, diasAtraso, juros };
  };

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
    let installments = JSON.parse(JSON.stringify(loan.installments || [])); 
    
    if (type === 'TOTAL' && idx !== undefined) {
      const baseVal = Number(installments[idx].amount || installments[idx].value || 0);
      
      // Aplicar juros no momento do pagamento
      const { valorTotal, diasAtraso } = calcularJurosAtraso(installments[idx].dueDate, baseVal);
      
      const confirmMsg = diasAtraso > 0 
        ? `Parcela com ${diasAtraso} dias de atraso. Valor com juros (1,5%/dia): R$ ${valorTotal.toFixed(2)}. Confirmar?`
        : `Confirmar pagamento de R$ ${valorTotal.toFixed(2)}?`;

      if(!confirm(confirmMsg)) return;

      installments[idx].status = 'PAGO';
      installments[idx].lastPaidValue = valorTotal;
      
      const newPaidAmount = Number(((loan.paidAmount || 0) + valorTotal).toFixed(2));
      await onUpdateLoan(loan.id, { installments, paidAmount: newPaidAmount });
      onAddTransaction('PAGAMENTO', valorTotal, `PAG: ${loan.customerName} (P${installments[idx].number}${diasAtraso > 0 ? ' C/ JUROS' : ''})`);
      showToast("Pagamento recebido!", "success");
    } 
    // ... (restante das funções PARCIAL e ESTORNO permanecem iguais)
  };

  // ... (handleSaveMovement permanece igual)

  return (
    <div className="space-y-8 pb-20 animate-in fade-in duration-500">
      {/* ... (Grid de StatCards permanece igual) */}

      <div className="bg-[#0a0a0a] border border-white/5 rounded-[2.5rem] p-8 shadow-2xl">
        {/* ... (Header de busca e filtros permanece igual) */}

        <div className="grid grid-cols-1 gap-4">
          {filteredLoans.length > 0 ? filteredLoans.map(loan => (
            <div key={loan.id} className={`group border transition-all duration-300 rounded-[2rem] overflow-hidden ${expandedLoan === loan.id ? 'bg-[#050505] border-[#BF953F]/40' : 'bg-black/40 border-white/5 hover:border-white/10'}`}>
              {/* Card Header (Inalterado) */}
              
              {expandedLoan === loan.id && (
                <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 bg-black/40 border-t border-white/5 animate-in slide-in-from-top-2">
                  {(loan.installments || []).map((inst: any, idx: number) => {
                    // Cálculo de juros em tempo real para exibição
                    const baseAmount = Number(inst.amount || inst.value || 0);
                    const { valorTotal, diasAtraso } = inst.status !== 'PAGO' 
                      ? calcularJurosAtraso(inst.dueDate, baseAmount)
                      : { valorTotal: inst.lastPaidValue || baseAmount, diasAtraso: 0 };

                    return (
                      <div key={idx} className={`relative p-5 rounded-[1.5rem] border transition-all ${inst.status === 'PAGO' ? 'opacity-40 bg-emerald-500/5 border-emerald-500/20' : 'bg-zinc-900/40 border-white/5'}`}>
                        <div className="flex justify-between items-start mb-4 text-[9px] font-black text-zinc-600 uppercase">
                          <span>P {inst.number}</span>
                          <span className={diasAtraso > 0 && inst.status !== 'PAGO' ? 'text-red-500' : ''}>
                            {inst.dueDate?.split('-').reverse().join('/')}
                          </span>
                        </div>
                        
                        <p className={`text-lg font-black mb-1 ${diasAtraso > 0 && inst.status !== 'PAGO' ? 'text-red-500' : 'text-white'}`}>
                          R$ {valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </p>

                        {diasAtraso > 0 && inst.status !== 'PAGO' ? (
                          <div className="text-[8px] font-black text-red-500/80 uppercase mb-4 flex items-center gap-1">
                            <History size={10}/> {diasAtraso} dias de atraso (+1,5%/dia)
                          </div>
                        ) : (
                          <div className="mb-4 h-[12px]"></div>
                        )}

                        {inst.status !== 'PAGO' && (
                          <button onClick={() => handleAction(loan, 'TOTAL', idx)} className="w-full py-3 bg-[#BF953F] text-black text-[10px] font-black uppercase rounded-xl hover:scale-[1.02] transition-all">Quitar</button>
                        )}
                        {inst.status === 'PAGO' && <div className="text-[8px] font-black text-emerald-500 uppercase text-center">Recebido</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )) : (
            <div className="text-center py-20">Nenhum contrato</div>
          )}
        </div>
      </div>
      {/* ... (Modal de movimentação permanece igual) */}
    </div>
  );
};

// ... (StatCard e Export)