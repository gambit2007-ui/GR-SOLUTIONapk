import React, { useMemo, useState, useEffect, useRef } from 'react';
import { 
  TrendingUp, ArrowDownCircle, CheckCircle, Clock, AlertTriangle, 
  ChevronDown, ChevronRight, User, MessageCircle, FileText,
  BellRing, SendHorizontal, Filter, Wallet, PlusCircle, 
  MinusCircle, History, Trash2, Edit3, Calendar, X, 
  FileDown, Download
} from 'lucide-react';
import { 
  collection, addDoc, updateDoc, deleteDoc, 
  doc, onSnapshot, query, orderBy 
} from 'firebase/firestore';
import { db } from '../firebase';
import { Loan, PaymentStatus, Installment, CashMovement, Customer, PaymentRecord } from '../types';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { generateContractPDF } from '../utils/contractGenerator';
// Componentes Auxiliares (Sub-renderização para limpeza de código)
const ReportCard = ({ title, value, icon, subtitle, isGold = false }: any) => (
  <div className={`p-6 rounded-3xl border ${isGold ? 'bg-[#BF953F]/10 border-[#BF953F]/20' : 'bg-[#0a0a0a] border-zinc-800'} shadow-xl`}>
    <div className="flex justify-between items-start mb-4">
      <div className="p-2 bg-black/40 rounded-lg">{icon}</div>
    </div>
    <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${isGold ? 'text-[#BF953F]' : 'text-zinc-500'}`}>{title}</p>
    <p className="text-2xl font-black text-white">{value}</p>
    <p className="text-[9px] text-zinc-600 font-bold uppercase mt-1">{subtitle}</p>
  </div>
);

const FilterButton = ({ active, onClick, label, count }: any) => (
  <button 
    onClick={onClick}
    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-2 ${
      active ? 'bg-[#BF953F] text-black' : 'bg-zinc-900 text-zinc-500 border border-zinc-800'
    }`}
  >
    {label} <span className={`px-1.5 py-0.5 rounded-md ${active ? 'bg-black/20' : 'bg-black'}`}>{count}</span>
  </button>
);

interface ReportsProps {
  loans: Loan[];
  onUpdateLoans?: (loans: Loan[]) => void;
  customers?: Customer[];
}

const Reports: React.FC<ReportsProps> = ({ loans, onUpdateLoans, customers = [] }) => {
  const [expandedLoanId, setExpandedLoanId] = useState<string | null>(null);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(['ATIVOS', 'INADIMPLENTES', 'FINALIZADOS']);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const reportsRef = useRef<HTMLDivElement>(null);
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
  const [isAddingMovement, setIsAddingMovement] = useState(false);
  const [editingMovementId, setEditingMovementId] = useState<string | null>(null);
  const [movementForm, setMovementForm] = useState({ type: 'APORTE' as 'APORTE' | 'RETIRADA', amount: '', description: '' });
  const [partialPaymentModal, setPartialPaymentModal] = useState<{ loanId: string, instId: string } | null>(null);
  const [partialAmount, setPartialAmount] = useState('');

  const todayStr = new Date().toISOString().split('T')[0];

  // 1. Escuta do Firebase (Real-time)
  useEffect(() => {
    const q = query(collection(db, "cashMovements"), orderBy("date", "desc"));
    const unsub = onSnapshot(q, (snapshot) => {
      const movements = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as CashMovement[];
      setCashMovements(movements);
    });
    return () => unsub();
  }, []);

  // 2. Lógica de Caixa Automático
  const registerAutoMovement = async (amount: number, customerName: string, contract: string) => {
    try {
      await addDoc(collection(db, "cashMovements"), {
        type: 'APORTE',
        amount: amount,
        description: `RECEBIMENTO: ${customerName} (Contrato: ${contract})`,
        date: Date.now(),
        isAuto: true
      });
    } catch (e) {
      console.error("Erro ao registrar fluxo automático:", e);
    }
  };

  // 3. Handlers de Movimentação de Caixa Manual
  const handleSaveMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!movementForm.amount || !movementForm.description) return;

    const data = {
      type: movementForm.type,
      amount: parseFloat(movementForm.amount),
      description: movementForm.description,
      date: editingMovementId ? undefined : Date.now()
    };

    try {
      if (editingMovementId) {
        const { date, ...updateData } = data;
        await updateDoc(doc(db, "cashMovements", editingMovementId), updateData);
      } else {
        await addDoc(collection(db, "cashMovements"), data);
      }
      closeMovementForm();
    } catch (error) {
      alert("Erro ao salvar no Firebase.");
    }
  };

  const deleteMovement = async (id: string) => {
    if (window.confirm('Excluir este registro permanentemente do banco?')) {
      try {
        await deleteDoc(doc(db, "cashMovements", id));
      } catch (error) {
        alert("Erro ao remover.");
      }
    }
  };

  const closeMovementForm = () => {
    setIsAddingMovement(false);
    setEditingMovementId(null);
    setMovementForm({ type: 'APORTE', amount: '', description: '' });
  };

  // 4. Lógica de Filtros e Estatísticas
  const treasuryStats = useMemo(() => {
    const totalAportes = cashMovements.filter(m => m.type === 'APORTE').reduce((acc, m) => acc + m.amount, 0);
    const totalRetiradas = cashMovements.filter(m => m.type === 'RETIRADA').reduce((acc, m) => acc + m.amount, 0);
    const balance = totalAportes - totalRetiradas;

    let totalRecebido = 0;
    loans.forEach(loan => {
      loan.installments.forEach(inst => {
        if (inst.paidValue) totalRecebido += inst.paidValue;
        else if (inst.status === 'PAGO') totalRecebido += inst.value + (inst.penaltyApplied || 0);
      });
    });

    return { totalAportes, totalRetiradas, balance, totalRecebido };
  }, [cashMovements, loans]);

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

  // Exportação
  const exportToPDF = async () => {
    if (!reportsRef.current) return;
    const dataUrl = await toPng(reportsRef.current, { quality: 0.95, backgroundColor: '#050505' });
    const pdf = new jsPDF('p', 'mm', 'a4');
    pdf.addImage(dataUrl, 'PNG', 0, 0, 210, 297);
    pdf.save(`relatorio-${todayStr}.pdf`);
  };

  return (
    <div className="space-y-10 p-4 bg-[#050505] min-h-screen text-white">
      {/* HEADER DE CAIXA */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 bg-[#0a0a0a] p-8 rounded-[2.5rem] border border-zinc-800 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <Wallet className="text-[#BF953F]" size={20} />
            <h3 className="text-[10px] font-black gold-text uppercase tracking-widest">Saldo em Caixa</h3>
          </div>
          <p className="text-4xl font-black tracking-tighter">
            {treasuryStats.balance.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </p>
          <div className="mt-8 flex gap-4">
            <button 
              onClick={() => { setMovementForm({ ...movementForm, type: 'APORTE' }); setIsAddingMovement(true); }}
              className="flex-1 py-3 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-xl text-[9px] font-black uppercase"
            >
              + Aporte
            </button>
            <button 
              onClick={() => { setMovementForm({ ...movementForm, type: 'RETIRADA' }); setIsAddingMovement(true); }}
              className="flex-1 py-3 bg-red-500/10 text-red-500 border border-red-500/20 rounded-xl text-[9px] font-black uppercase"
            >
              - Retirada
            </button>
          </div>
        </div>

        {/* EXTRATO SIMPLIFICADO */}
        <div className="lg:col-span-2 bg-[#0a0a0a] rounded-[2.5rem] border border-zinc-800 overflow-hidden">
          <div className="px-8 py-4 border-b border-zinc-900 bg-zinc-900/10 flex justify-between items-center">
            <h4 className="text-[10px] font-black text-zinc-500 uppercase flex items-center gap-2">
              <History size={14} /> Movimentações Recentes
            </h4>
          </div>
          <div className="max-h-[200px] overflow-y-auto p-4 space-y-2">
            {cashMovements.map(m => (
              <div key={m.id} className="flex justify-between items-center p-3 hover:bg-zinc-900 rounded-2xl transition-all">
                <div>
                  <p className="text-[11px] font-bold text-zinc-200">{m.description}</p>
                  <p className="text-[9px] text-zinc-600">{new Date(m.date).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`text-[11px] font-black ${m.type === 'APORTE' ? 'text-emerald-500' : 'text-red-500'}`}>
                    {m.type === 'APORTE' ? '+' : '-'} {m.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </span>
                  <button onClick={() => deleteMovement(m.id!)} className="text-zinc-800 hover:text-red-500"><Trash2 size={14}/></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CARDS DE RESUMO */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <ReportCard title="Principal Ativo" value={loans.reduce((acc, l) => acc + l.amount, 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} icon={<ArrowDownCircle/>} subtitle="Capital na rua" />
        <ReportCard title="Total Recebido" value={treasuryStats.totalRecebido.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} icon={<CheckCircle/>} subtitle="Juros + Principal" isGold />
        <ReportCard title="Inadimplência" value={loans.filter(l => l.installments.some(i => i.status === 'PENDENTE' && i.dueDate < todayStr)).length} icon={<AlertTriangle className="text-red-500"/>} subtitle="Contratos em atraso" />
        <button onClick={exportToPDF} className="bg-zinc-900 border border-zinc-800 rounded-3xl flex flex-col items-center justify-center hover:bg-zinc-800 transition-all group">
          <FileDown className="text-zinc-500 group-hover:text-[#BF953F] mb-2" size={32} />
          <span className="text-[10px] font-black uppercase text-zinc-400">Exportar Relatório</span>
        </button>
      </div>

      {/* LISTAGEM DE CONTRATOS (Restante da sua UI) */}
      <div className="bg-[#0a0a0a] border border-zinc-800 rounded-[2.5rem] p-8">
         <h3 className="text-lg font-black gold-text mb-6 uppercase tracking-widest">Carteira de Clientes</h3>
         {/* Aqui você renderiza a tabela de contratos filtrada por filteredLoans */}
      </div>

      {/* MODAL DE MOVIMENTAÇÃO */}
      {isAddingMovement && (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-6">
          <div className="bg-[#0d0d0d] border border-zinc-800 w-full max-w-md rounded-[2.5rem] p-10">
            <h3 className="text-sm font-black gold-text uppercase mb-8">Registrar {movementForm.type}</h3>
            <form onSubmit={handleSaveMovement} className="space-y-6">
              <input 
                type="number" step="0.01" placeholder="Valor R$" 
                className="w-full bg-black border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F]"
                value={movementForm.amount} onChange={e => setMovementForm({...movementForm, amount: e.target.value})}
              />
              <input 
                type="text" placeholder="Descrição" 
                className="w-full bg-black border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F]"
                value={movementForm.description} onChange={e => setMovementForm({...movementForm, description: e.target.value})}
              />
              <div className="flex gap-4">
                <button type="button" onClick={closeMovementForm} className="flex-1 p-4 text-[10px] font-black uppercase text-zinc-500">Cancelar</button>
                <button type="submit" className="flex-1 p-4 bg-[#BF953F] text-black rounded-2xl text-[10px] font-black uppercase">Confirmar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Reports;