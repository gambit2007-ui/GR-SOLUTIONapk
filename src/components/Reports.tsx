import React, { useMemo, useState } from 'react';

import jsPDF from 'jspdf';

import autoTable from 'jspdf-autotable'; // Importamos a função diretamente

import {

  Wallet, Clock, ArrowUpCircle, ArrowDownCircle,

  Calendar, RotateCcw, ChevronDown,

  CheckCircle, AlertTriangle, FileDown, Search, X

} from 'lucide-react';

import { Loan, Customer } from '../types';



interface ReportsProps {

  loans: Loan[];

  customers: Customer[];

  transactions: any[];

  caixa: number;

  onAddTransaction: (type: 'APORTE' | 'RETIRADA' | 'PAGAMENTO' | 'ESTORNO', amount: number, description: string) => void;

  onUpdateLoan: (loanId: string, newData: any) => Promise<void>;

  showToast: (message: string, type: 'success' | 'info' | 'error') => void;

}



const ReportCard = ({ title, value, icon, subtitle, isGold = false }: any) => (

  <div className={`p-6 rounded-[2rem] border ${isGold ? 'bg-[#BF953F]/10 border-[#BF953F]/20' : 'bg-[#0d0d0d] border-white/5 shadow-2xl'}`}>

    <div className={`mb-4 ${isGold ? 'text-[#BF953F]' : 'text-zinc-500'}`}>{icon}</div>

    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">{title}</p>

    <h3 className={`text-2xl font-black tracking-tighter ${isGold ? 'text-[#BF953F]' : 'text-white'}`}>{value}</h3>

    <p className="text-[9px] font-bold text-zinc-600 uppercase mt-2">{subtitle}</p>

  </div>

);



const Reports: React.FC<ReportsProps> = ({

  loans = [],

  transactions = [],

  caixa = 0,

  onAddTransaction,

  onUpdateLoan,

  showToast

}) => {

  const [filterStatus, setFilterStatus] = useState<'ATIVOS' | 'ATRASADOS' | 'FINALIZADOS'>('ATIVOS');

  const [expandedLoan, setExpandedLoan] = useState<string | null>(null);

  const [isAddingMovement, setIsAddingMovement] = useState(false);

  const [movementForm, setMovementForm] = useState({ type: 'APORTE' as 'APORTE' | 'RETIRADA', amount: '', description: '' });



  const exportToPDF = () => {

    if (!transactions || transactions.length === 0) {

      return showToast("Não há movimentações para exportar.", "info");

    }



    const doc = new jsPDF();

    const dateStr = new Date().toLocaleDateString('pt-BR');



    // ... (mantenha seu código de cabeçalho igual) ...

    doc.setFillColor(15, 15, 15);

    doc.rect(0, 0, 210, 45, 'F');

    doc.setFontSize(22);

    doc.setTextColor(191, 149, 63);

    doc.text("GR-SOLUTION", 14, 20);



    // Preparar os dados

    const sortedTransactions = [...transactions].sort((a, b) =>

      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()

    );



    const tableRows = sortedTransactions.map(t => [

      t.timestamp ? new Date(t.timestamp).toLocaleDateString('pt-BR') : dateStr,

      t.description.toUpperCase(),

      t.type,

      `R$ ${t.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`

    ]);



    // AQUI ESTÁ A MUDANÇA: Chamamos a função autoTable(doc, { ... })

    autoTable(doc, {

      startY: 50,

      head: [['DATA', 'DESCRIÇÃO', 'TIPO', 'VALOR']],

      body: tableRows,

      headStyles: { fillColor: [191, 149, 63], textColor: [0, 0, 0], fontStyle: 'bold' },

      alternateRowStyles: { fillColor: [250, 250, 250] },

    });



    doc.save(`GR-SOLUTION-MOV-${dateStr.replace(/\//g, '-')}.pdf`);

    showToast("PDF gerado!", "success");

  };



  // --- CÁLCULOS ---

  const stats = useMemo(() => {

    const hoje = new Date(); hoje.setHours(0,0,0,0);

    return loans.reduce((acc, l) => {

      acc.principalAtivo += (l.amount || 0);

      acc.totalRecebido += (l.paidAmount || 0);

      const isLiq = (l.paidAmount || 0) >= (l.totalToReturn - 0.1);

      const temAt = l.installments?.some(i => {

        if (!i.dueDate || i.status !== 'PENDENTE') return false;

        const [y, m, d] = i.dueDate.split('-').map(Number);

        return hoje > new Date(y, m-1, d);

      });

      if (isLiq) acc.finalizados++;

      else if (temAt) { acc.atrasados++; acc.countInadimplencia++; }

      else acc.ativos++;

      return acc;

    }, { principalAtivo: 0, totalRecebido: 0, countInadimplencia: 0, ativos: 0, atrasados: 0, finalizados: 0 });

  }, [loans]);



  const filteredLoans = useMemo(() => {

    const hoje = new Date(); hoje.setHours(0,0,0,0);

    return loans.filter(l => {

      const isLiq = (l.paidAmount || 0) >= (l.totalToReturn - 0.1);

      const temAt = l.installments?.some(i => {

        if (!i.dueDate || i.status !== 'PENDENTE') return false;

        const [y, m, d] = i.dueDate.split('-').map(Number);

        return hoje > new Date(y, m-1, d);

      });

      if (filterStatus === 'FINALIZADOS') return isLiq;

      if (filterStatus === 'ATRASADOS') return temAt && !isLiq;

      return !isLiq && !temAt;

    });

  }, [loans, filterStatus]);



  // --- AÇÕES ---

  const handleAction = async (loan: Loan, type: 'TOTAL' | 'PARCIAL' | 'ESTORNO') => {

    let currentInstallments = [...(loan.installments || [])];

    if (type === 'ESTORNO') {

      const lastPaidIdx = [...currentInstallments].reverse().findIndex(i => i.status === 'PAGO');

      const actualIdx = lastPaidIdx !== -1 ? (currentInstallments.length - 1 - lastPaidIdx) : -1;

      if (actualIdx === -1) return showToast("Nada para estornar.", "info");

      const valor = currentInstallments[actualIdx].lastPaidValue || currentInstallments[actualIdx].value;

      if (!window.confirm(`Estornar R$ ${valor}?`)) return;

      currentInstallments[actualIdx].status = 'PENDENTE';

      await onUpdateLoan(loan.id, { installments: currentInstallments, paidAmount: Number(Math.max(0, (loan.paidAmount || 0) - valor).toFixed(2)) });

      onAddTransaction('ESTORNO', valor, `ESTORNO: ${loan.customerName}`);

      return showToast("Estornado!", "success");

    }



    const firstPendingIdx = currentInstallments.findIndex(i => i.status === 'PENDENTE');

    if (firstPendingIdx === -1) return;

    let valorPagoTotal = 0;



    if (type === 'TOTAL') {

      const parcela = currentInstallments[firstPendingIdx];

      if (!window.confirm(`Liquidar Parcela #${parcela.number}?`)) return;

      valorPagoTotal = parcela.value;

      currentInstallments[firstPendingIdx] = { ...parcela, status: 'PAGO', lastPaidValue: parcela.value };

    } else {

      const promptVal = prompt(`Valor pago pelo cliente:`);

      if (!promptVal) return;

      valorPagoTotal = parseFloat(promptVal.replace(',', '.'));

      if (isNaN(valorPagoTotal) || valorPagoTotal <= 0) return showToast("Valor inválido", "error");

      let saldoRestante = valorPagoTotal;

      for (let i = firstPendingIdx; i < currentInstallments.length; i++) {

        if (saldoRestante <= 0 || currentInstallments[i].status !== 'PENDENTE') continue;

        const valorDaParcela = currentInstallments[i].value;

        if (saldoRestante >= valorDaParcela - 0.01) {

          saldoRestante -= valorDaParcela;

          currentInstallments[i] = { ...currentInstallments[i], status: 'PAGO', lastPaidValue: valorDaParcela, partialPaid: (currentInstallments[i].partialPaid || 0) + valorDaParcela, value: 0 };

        } else {

          currentInstallments[i] = { ...currentInstallments[i], value: Number((valorDaParcela - saldoRestante).toFixed(2)), partialPaid: Number(((currentInstallments[i].partialPaid || 0) + saldoRestante).toFixed(2)) };

          saldoRestante = 0;

        }

      }

    }

    await onUpdateLoan(loan.id, { installments: currentInstallments, paidAmount: Number(((loan.paidAmount || 0) + valorPagoTotal).toFixed(2)) });

    onAddTransaction('PAGAMENTO', valorPagoTotal, `PAG: ${loan.customerName}`);

    showToast("Sucesso!", "success");

  };



  const handleSaveMovement = (e: React.FormEvent) => {

    e.preventDefault();

    const amt = parseFloat(movementForm.amount.replace(',', '.'));

    if (isNaN(amt) || amt <= 0) return;

    onAddTransaction(movementForm.type, amt, movementForm.description);

    setIsAddingMovement(false);

    setMovementForm({ type: 'APORTE', amount: '', description: '' });

  };



  return (

    <div className="p-6 lg:p-10 space-y-8 bg-black min-h-screen text-white">

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">

        <ReportCard title="Principal Ativo" value={stats.principalAtivo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} icon={<ArrowDownCircle/>} subtitle="Capital na rua" />

        <ReportCard title="Total Recebido" value={stats.totalRecebido.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} icon={<CheckCircle/>} subtitle="Juros + Principal" isGold />

        <ReportCard title="Inadimplência" value={stats.countInadimplencia} icon={<AlertTriangle className="text-red-500"/>} subtitle="Contratos em atraso" />

        {/* BOTÃO EXPORTAR CONECTADO */}

       <button

  onClick={exportToPDF} // Esta linha garante o download direto ao clicar

  className="bg-zinc-900/50 border border-white/5 rounded-[2rem] flex flex-col items-center justify-center hover:bg-zinc-800 p-6 shadow-xl transition-all group"

>

  <FileDown className="text-zinc-500 group-hover:text-[#BF953F] mb-2 transition-colors" size={32} />

  <span className="text-[10px] font-black uppercase text-zinc-400 group-hover:text-white transition-colors">

    Exportar Relatório

  </span>

</button>

      </div>



      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        <div className="lg:col-span-4 bg-[#0d0d0d] border border-white/5 rounded-[2.5rem] p-8">

          <div className="flex items-center gap-3 text-[#BF953F] mb-6"><Wallet size={18} /><span className="text-[10px] font-black uppercase text-zinc-400 tracking-widest">Caixa Geral</span></div>

          <h3 className="text-4xl font-black mb-8 tracking-tighter">R$ {caixa.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>

          <div className="grid grid-cols-2 gap-3">

            <button onClick={() => { setMovementForm({...movementForm, type: 'APORTE'}); setIsAddingMovement(true); }} className="py-4 bg-emerald-500/10 text-emerald-500 border border-emerald-500/10 rounded-2xl text-[9px] font-black uppercase hover:bg-emerald-500/20 transition-all">Aporte</button>

            <button onClick={() => { setMovementForm({...movementForm, type: 'RETIRADA'}); setIsAddingMovement(true); }} className="py-4 bg-red-500/10 text-red-500 border border-red-500/10 rounded-2xl text-[9px] font-black uppercase hover:bg-red-500/20 transition-all">Retirada</button>

          </div>

        </div>

        <div className="lg:col-span-8 bg-[#0d0d0d] border border-white/5 rounded-[2.5rem] p-8 overflow-hidden">

          <div className="flex items-center gap-3 text-zinc-500 mb-6 text-[10px] font-black uppercase tracking-widest"><Clock size={16} /> Movimentações Recentes</div>

          <div className="space-y-2 max-h-[130px] overflow-y-auto pr-2 custom-scrollbar">

            {transactions.slice(0, 5).map(t => (

              <div key={t.id} className="flex justify-between bg-white/[0.02] p-4 rounded-2xl border border-white/5 text-[10px] uppercase font-bold">

                <span className="text-zinc-400 tracking-tight">{t.description}</span>

                <span className={t.type === 'RETIRADA' || t.type === 'ESTORNO' ? 'text-red-500' : 'text-emerald-500'}>R$ {t.amount?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>

              </div>

            ))}

          </div>

        </div>

      </div>



      <div className="bg-[#0a0a0a] border border-white/5 rounded-[2.5rem] p-8">

        <div className="flex flex-col md:flex-row justify-between mb-8 gap-4 items-center">

          <h3 className="text-sm font-black text-[#BF953F] uppercase tracking-[0.3em]">Gestão de Carteira</h3>

          <div className="flex bg-black p-1 rounded-2xl border border-white/5">

            {['ATIVOS', 'ATRASADOS', 'FINALIZADOS'].map(st => (

              <button key={st} onClick={() => setFilterStatus(st as any)} className={`px-6 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all ${filterStatus === st ? 'bg-zinc-800 text-[#BF953F]' : 'text-zinc-500'}`}>{st}</button>

            ))}

          </div>

        </div>



        <div className="space-y-4">

          {filteredLoans.map(loan => {

            const isEx = expandedLoan === loan.id;

            return (

              <div key={loan.id} className={`bg-zinc-900/30 border border-white/5 rounded-[2.5rem] overflow-hidden transition-all ${isEx ? 'ring-1 ring-[#BF953F]/30 shadow-2xl' : ''}`}>

                <div className="p-7 flex flex-col md:flex-row items-center justify-between gap-6">

                  <div className="flex items-center gap-5 w-full md:w-auto">

                    <div className="w-12 h-12 rounded-2xl bg-[#BF953F]/10 flex items-center justify-center text-[#BF953F] shadow-inner"><Calendar size={22}/></div>

                    <div>

                      <h4 className="font-black uppercase text-xs tracking-tight">{loan.customerName}</h4>

                      <p className="text-[9px] text-zinc-500 uppercase font-bold mt-1">Saldo Devedor: R$ {(loan.totalToReturn - (loan.paidAmount || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>

                    </div>

                  </div>

                  <div className="flex gap-2 w-full md:w-auto justify-end">

                    <button onClick={() => handleAction(loan, 'ESTORNO')} title="Reverter último" className="p-3.5 bg-white/5 rounded-2xl text-zinc-500 hover:text-red-500 transition-colors"><RotateCcw size={18}/></button>

                    <button onClick={() => handleAction(loan, 'PARCIAL')} className="px-6 py-3.5 bg-zinc-800 rounded-2xl text-[10px] font-black uppercase hover:bg-zinc-700 transition-all shadow-lg">Abatimento</button>

                    <button onClick={() => setExpandedLoan(isEx ? null : loan.id)} className={`p-3.5 rounded-2xl transition-all ${isEx ? 'bg-[#BF953F] text-black' : 'bg-white/5 text-zinc-400'}`}><ChevronDown className={isEx ? 'rotate-180 transition-transform' : 'transition-transform'} size={20}/></button>

                  </div>

                </div>



                {isEx && (

                  <div className="px-8 pb-8 pt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 border-t border-white/[0.03] bg-black/40">

                    {loan.installments?.map((inst: any, idx) => {

                      const pPaid = inst.partialPaid || 0;

                      return (

                        <div key={idx} className={`p-5 rounded-[2rem] border transition-all ${inst.status === 'PAGO' ? 'bg-emerald-500/5 border-emerald-500/20 opacity-60 shadow-none' : 'bg-zinc-900/50 border-white/5 shadow-xl'}`}>

                          <div className="flex justify-between items-start mb-4">

                            <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Parc. #{inst.number}</span>

                            {inst.status === 'PAGO' ? <CheckCircle size={16} className="text-emerald-500" /> : <div className="w-2 h-2 rounded-full bg-zinc-800 animate-pulse" />}

                          </div>

                          {pPaid > 0 && inst.status === 'PENDENTE' && (

                            <div className="mb-4 bg-[#BF953F] p-3 rounded-2xl shadow-lg shadow-[#BF953F]/10">

                              <span className="text-[8px] font-black text-black uppercase block mb-1">Total Já Abatido</span>

                              <span className="text-sm font-black text-black leading-none">R$ {pPaid.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>

                            </div>

                          )}

                          <p className="text-[11px] font-black text-zinc-400 mb-3">{inst.dueDate.split('-').reverse().join('/')}</p>

                          <div className="flex justify-between items-end">

                            <div>

                              <span className="text-[8px] block text-zinc-500 font-bold uppercase mb-1">{inst.status === 'PAGO' ? 'Liquidação' : 'Restante'}</span>

                              <span className="text-sm font-black text-white">R$ {(inst.status === 'PAGO' ? (inst.lastPaidValue || inst.value) : inst.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>

                            </div>

                            {inst.status === 'PENDENTE' && (

                                <button onClick={() => handleAction(loan, 'TOTAL')} className="px-3 py-2 bg-[#BF953F] text-black text-[9px] font-black uppercase rounded-xl hover:scale-105 transition-transform">Quitar</button>

                            )}

                          </div>

                        </div>

                      );

                    })}

                  </div>

                )}

              </div>

            );

          })}

        </div>

      </div>



      {isAddingMovement && (

        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-6">

          <div className="bg-[#0d0d0d] border border-white/10 w-full max-w-md rounded-[3rem] p-10 relative shadow-[0_0_100px_rgba(0,0,0,0.5)]">

            <button onClick={() => setIsAddingMovement(false)} className="absolute top-8 right-8 text-zinc-500 hover:text-white transition-colors"><X size={24}/></button>

            <h3 className="text-sm font-black text-[#BF953F] uppercase mb-10 tracking-[0.2em] text-center">Registrar {movementForm.type}</h3>

            <form onSubmit={handleSaveMovement} className="space-y-6">

              <div className="space-y-2">

                <label className="text-[9px] font-black text-zinc-500 uppercase ml-2">Valor da Operação</label>

                <input type="number" step="0.01" placeholder="R$ 0,00" autoFocus className="w-full bg-black border border-white/5 rounded-2xl p-5 text-white text-xl font-black outline-none focus:border-[#BF953F]" value={movementForm.amount} onChange={e => setMovementForm({...movementForm, amount: e.target.value})} />

              </div>

              <div className="space-y-2">

                <label className="text-[9px] font-black text-zinc-500 uppercase ml-2">Motivação</label>

                <input type="text" placeholder="Ex: Reforço de capital" className="w-full bg-black border border-white/5 rounded-2xl p-5 text-white font-bold outline-none focus:border-[#BF953F]" value={movementForm.description} onChange={e => setMovementForm({...movementForm, description: e.target.value})} />

              </div>

              <button type="submit" className="w-full py-5 bg-[#BF953F] text-black rounded-2xl text-[10px] font-black uppercase hover:scale-[1.02] active:scale-95 transition-all shadow-xl shadow-[#BF953F]/10 mt-4">Confirmar</button>

            </form>

          </div>

        </div>

      )}

    </div>

  );

};



export default Reports;