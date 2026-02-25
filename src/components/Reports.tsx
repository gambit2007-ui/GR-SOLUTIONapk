import React, { useMemo, useState } from 'react';
import { 
  Wallet, TrendingUp, Clock, ArrowUpCircle, ArrowDownCircle,
  CheckCircle2, Eye, CheckCircle, History, RotateCcw, FileText
} from 'lucide-react';
import { Loan, Customer } from '../types';

interface ReportsProps {
  loans: Loan[];
  customers: Customer[];
  transactions: any[];
  caixa: number;
  onAddTransaction: (type: 'APORTE' | 'RETIRADA' | 'PAGAMENTO', amount: number, description: string) => void;
  onUpdateLoan: (loanId: string, newData: any) => Promise<void>;
  showToast: (message: string, type: 'success' | 'info' | 'error') => void;
}

const Reports: React.FC<ReportsProps> = ({ 
  loans = [], 
  customers = [], 
  transactions = [], 
  caixa = 0,
  onAddTransaction,
  onUpdateLoan,
  showToast 
}) => {
  const [expandedLoan, setExpandedLoan] = useState<string | null>(null);

  // --- LÓGICA DE ESTORNO EM CASCATA ---
  const handleEstornarParcela = async (loan: Loan) => {
    const valorUmaParcela = Number((loan.totalToReturn / loan.installmentCount).toFixed(2));
    const totalJaPago = loan.paidAmount || 0;

    if (totalJaPago <= 0) return;

    if (window.confirm(`Deseja ESTORNAR o último pagamento de ${loan.customerName}?`)) {
      // Descobrimos quanto foi pago na "última fatia"
      const resto = totalJaPago % valorUmaParcela;
      const valorAEstornar = resto > 0 ? resto : valorUmaParcela;
      
      const novoTotalPago = Number(Math.max(0, totalJaPago - valorAEstornar).toFixed(2));
      const novoSaldoDevedor = Number((loan.totalToReturn - novoTotalPago).toFixed(2));

      onAddTransaction('RETIRADA', valorAEstornar, `ESTORNO PARCELA: ${loan.customerName}`);
      await onUpdateLoan(loan.id, {
        installmentValue: novoSaldoDevedor,
        paidAmount: novoTotalPago,
        status: 'PENDENTE'
      });
      showToast("Pagamento estornado!", "info");
    }
  };

  // --- LÓGICA DE LIQUIDAÇÃO EM CASCATA ---
  const handleLiquidarParcela = async (loan: Loan, tipo: 'TOTAL' | 'PARCIAL') => {
    const valorUmaParcela = Number((loan.totalToReturn / loan.installmentCount).toFixed(2));
    const totalJaPago = loan.paidAmount || 0;
    
    const jaPagoNaParcelaAtual = Number((totalJaPago % valorUmaParcela).toFixed(2));
    const quantoFaltaParaEstaParcela = Number((valorUmaParcela - jaPagoNaParcelaAtual).toFixed(2));

    if (tipo === 'TOTAL') {
      if (window.confirm(`Liquidar parcela atual (R$ ${quantoFaltaParaEstaParcela.toLocaleString('pt-BR')})?`)) {
        const novoTotalPago = Number((totalJaPago + quantoFaltaParaEstaParcela).toFixed(2));
        const novoSaldoGeral = Number((loan.totalToReturn - novoTotalPago).toFixed(2));

        onAddTransaction('PAGAMENTO', quantoFaltaParaEstaParcela, `PAG. PARCELA: ${loan.customerName}`);
        await onUpdateLoan(loan.id, { 
          paidAmount: novoTotalPago,
          installmentValue: novoSaldoGeral,
          status: novoSaldoGeral <= 0.1 ? 'LIQUIDADO' : 'PENDENTE'
        });
        showToast("Parcela paga!", "success");
      }
    } else {
      const valorStr = prompt(`Digite o valor do abatimento:`);
      if (valorStr) {
        const valor = parseFloat(valorStr.replace(',', '.'));
        if (!isNaN(valor) && valor > 0) {
          const novoTotalPago = Number((totalJaPago + valor).toFixed(2));
          const novoSaldoGeral = Number((loan.totalToReturn - novoTotalPago).toFixed(2));

          onAddTransaction('PAGAMENTO', valor, `ABATIMENTO: ${loan.customerName}`);
          await onUpdateLoan(loan.id, { 
            paidAmount: novoTotalPago,
            installmentValue: novoSaldoGeral,
            status: novoSaldoGeral <= 0.1 ? 'LIQUIDADO' : 'PENDENTE'
          });
        }
      }
    }
  };

  return (
    <div className="p-6 lg:p-10 space-y-8 bg-black min-h-screen text-white font-sans">
      
      {/* SEÇÃO CAIXA (RESUMIDA) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 bg-[#0d0d0d] border border-white/5 rounded-[2.5rem] p-8 shadow-2xl">
          <div className="flex items-center gap-3 text-[#BF953F] mb-6 font-black uppercase tracking-widest text-[10px]">
            <Wallet size={18} /> Saldo Disponível
          </div>
          <h3 className="text-4xl font-black tracking-tighter">
            R$ {(caixa || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </h3>
        </div>
        <div className="lg:col-span-8 bg-[#0d0d0d] border border-white/5 rounded-[2.5rem] p-8">
           <div className="flex items-center gap-3 text-zinc-500 mb-4 text-[10px] font-black uppercase">
             <Clock size={16} /> Movimentações
           </div>
           <div className="space-y-2 overflow-y-auto max-h-[100px] custom-scrollbar">
              {transactions.slice(0, 3).map(t => (
                <div key={t.id} className="flex justify-between bg-white/[0.02] p-2 rounded-lg border border-white/5 text-[10px] font-bold">
                  <span className="text-zinc-400 uppercase">{t.description}</span>
                  <span className={t.type === 'RETIRADA' ? 'text-red-500' : 'text-emerald-500'}>
                    R$ {t.amount?.toLocaleString('pt-BR')}
                  </span>
                </div>
              ))}
           </div>
        </div>
      </div>

      {/* TABELA DE CONTRATOS */}
      <div className="bg-[#0a0a0a] border border-white/5 rounded-[2.5rem] overflow-hidden shadow-2xl">
        <div className="p-8 border-b border-white/5 bg-gradient-to-r from-zinc-950 to-black">
          <h3 className="text-base font-black text-[#BF953F] uppercase tracking-[0.3em]">Gestão de Contratos</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-black/50 border-b border-white/5 text-[9px] font-black text-zinc-500 uppercase tracking-widest">
                <th className="p-6 w-20">Expandir</th>
                <th className="p-6">Cliente</th>
                <th className="p-6 text-right">Valor Projetado</th>
                <th className="p-6">Amortização</th>
                <th className="p-6 text-right pr-10">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {loans.map((loan) => {
                const isExpanded = expandedLoan === loan.id;
                const progress = Math.min(((loan.paidAmount || 0) / (loan.totalToReturn || 1)) * 100, 100);

                return (
                  <React.Fragment key={loan.id}>
                    <tr className="hover:bg-white/[0.02] transition-colors border-b border-white/5">
                      <td className="p-6">
                        <button onClick={() => setExpandedLoan(isExpanded ? null : loan.id)} className="w-10 h-10 rounded-xl bg-gradient-to-b from-[#BF953F] to-[#8A6E2F] flex items-center justify-center text-black shadow-lg shadow-[#BF953F]/10">
                          <ArrowDownCircle size={20} className={isExpanded ? '' : '-rotate-90'} />
                        </button>
                      </td>
                      <td className="p-6">
                        <div className="flex flex-col">
                          <span className="text-[11px] font-black text-white uppercase">{loan.customerName}</span>
                          <span className="text-[8px] text-zinc-600 font-bold tracking-widest uppercase">ID: {loan.id.slice(-6).toUpperCase()}</span>
                        </div>
                      </td>
                      <td className="p-6 text-right text-xs font-black">R$ {loan.totalToReturn?.toLocaleString('pt-BR')}</td>
                      <td className="p-6">
                        <div className="w-32 space-y-1">
                          <div className="h-[3px] bg-zinc-900 rounded-full overflow-hidden">
                            <div className="h-full bg-[#BF953F]" style={{ width: `${progress}%` }} />
                          </div>
                          <span className="text-[8px] font-black text-zinc-500 uppercase">{progress.toFixed(0)}% Pago</span>
                        </div>
                      </td>
                      <td className="p-6 text-right pr-10">
                         <button onClick={() => setExpandedLoan(isExpanded ? null : loan.id)} className="p-2.5 bg-zinc-900 text-zinc-500 rounded-xl hover:text-[#BF953F] border border-white/5 transition-colors">
                            <Eye size={18} />
                         </button>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="bg-[#050505]">
                        <td colSpan={5} className="p-8 border-b border-white/5">
                          <table className="w-full text-[10px]">
                            <thead>
                              <tr className="text-zinc-600 font-black uppercase tracking-widest border-b border-white/5">
                                <th className="pb-4">Parcela</th>
                                <th className="pb-4">Vencimento</th>
                                <th className="pb-4 text-center">Saldo Restante</th>
                                <th className="pb-4 text-center">Status</th>
                                <th className="pb-4 text-right">Ações</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.02]">
                              {Array.from({ length: loan.installmentCount || 1 }).map((_, i) => {
                                const valorOriginalParcela = Number((loan.totalToReturn / loan.installmentCount).toFixed(2));
                                const totalPagoNoContrato = Number((loan.paidAmount || 0).toFixed(2));
                                const oQueJaQuitouAnteriores = Number((valorOriginalParcela * i).toFixed(2));
                                const amortizadoNestaParcela = Math.max(0, Math.min(valorOriginalParcela, totalPagoNoContrato - oQueJaQuitouAnteriores));
                                const saldoDevedorParcela = Number((valorOriginalParcela - amortizadoNestaParcela).toFixed(2));
                                
                                const isQuitada = saldoDevedorParcela <= 0;
                                const parcelaAnteriorQuitada = i === 0 || totalPagoNoContrato >= (oQueJaQuitouAnteriores - 0.05);
                                const podeInteragir = !isQuitada && parcelaAnteriorQuitada;
                                const ehAUltimaPaga = totalPagoNoContrato > oQueJaQuitouAnteriores && totalPagoNoContrato <= (oQueJaQuitouAnteriores + valorOriginalParcela + 0.1);

                                return (
                                  <tr key={i} className={podeInteragir || isQuitada ? 'opacity-100' : 'opacity-30'}>
                                    <td className="py-4 font-black text-zinc-600 uppercase">#{i + 1}</td>
                                    <td className="py-4 font-bold text-white/90">Mês {i + 1}</td>
                                    <td className="py-4 text-center">
  <div className="flex flex-col items-center">
    {/* SALDO RESTANTE DA PARCELA */}
    <span className={`text-[11px] font-black ${isQuitada ? 'text-emerald-500' : 'text-[#BF953F]'}`}>
      R$ {saldoDevedorParcela.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
    </span>
    
    {/* VALOR ORIGINAL TOTAL DA PARCELA */}
    <span className="text-[7px] font-black text-slate-500 uppercase mt-0.5">
      TOTAL: R$ {valorOriginalParcela.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
    </span>

    {/* VALOR QUE JÁ FOI ABATIDO (PAGO) - APARECE EM VERDE */}
    {amortizadoNestaParcela > 0 && (
      <span className="text-[7px] font-black text-emerald-500 uppercase mt-0.5">
        PAGO: R$ {amortizadoNestaParcela.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
      </span>
    )}
  </div>
</td>

<td className="py-4 text-center font-black uppercase text-[7px]">
  <span className={`px-3 py-1 rounded-full border transition-all ${
    isQuitada 
      ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' 
      : amortizadoNestaParcela > 0 
        ? 'bg-sky-500/10 text-sky-500 border-sky-500/20' 
        : podeInteragir 
          ? 'bg-zinc-900/50 text-zinc-400 border-white/5' 
          : 'bg-zinc-950 text-zinc-800 border-transparent opacity-40'
  }`}>
    {isQuitada ? 'Liquidado' : amortizadoNestaParcela > 0 ? 'Parcial' : podeInteragir ? 'Pendente' : 'Bloqueado'}
  </span>
</td>

<td className="py-4 text-right">
  <div className="flex justify-end gap-2 items-center">
    {isQuitada ? (
      ehAUltimaPaga ? (
        <button 
          onClick={() => handleEstornarParcela(loan)} 
          className="px-3 py-1.5 bg-red-500/10 text-red-500 rounded border border-red-500/20 text-[8px] font-black uppercase hover:bg-red-500 hover:text-white transition-all shadow-lg shadow-red-500/5"
        >
          Estornar
        </button>
      ) : (
        <CheckCircle size={14} className="text-emerald-900/50 mr-4" />
      )
    ) : podeInteragir ? (
      <>
        <button 
          onClick={() => handleLiquidarParcela(loan, 'PARCIAL')} 
          className="p-2 bg-white/5 rounded border border-white/5 text-zinc-400 hover:text-[#BF953F] transition-colors"
          title="Pagamento Parcial"
        >
          <TrendingUp size={14}/>
        </button>
        <button 
          onClick={() => handleLiquidarParcela(loan, 'TOTAL')} 
          className="px-5 py-2 bg-gradient-to-r from-[#EAD2A8] via-[#BF953F] to-[#8A6E2F] text-black rounded-lg text-[8px] font-black uppercase shadow-lg shadow-[#BF953F]/20 hover:brightness-110 active:scale-95 transition-all"
        >
          Liquidar
        </button>
      </>
    ) : (
      <Clock size={14} className="text-zinc-800 mr-4" />
    )}
  </div>
</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Reports;