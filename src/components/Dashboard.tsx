import React, { useMemo, useState, useEffect, useRef } from 'react';
import { 
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';
import { 
  Users, Briefcase, AlertCircle, ShieldCheck, 
  ArrowUpRight, ArrowDownRight, TrendingUp, CalendarDays,
  Filter, FileDown, FileText, Wallet, ArrowRightLeft, Coins, Plus, Minus
} from 'lucide-react';
import { db } from "../firebase";
import { collection, onSnapshot, query, addDoc } from "firebase/firestore";
import { jsPDF } from 'jspdf';
import { toPng } from 'html-to-image';

const Dashboard = ({ loans = [], customers = [] }: any) => {
  const [isMounted, setIsMounted] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [period, setPeriod] = useState('30D');
  const dashboardRef = useRef<HTMLDivElement>(null);

  // ✅ Conexão com Firebase para pegar Aportes e Retiradas
  useEffect(() => {
    const q = query(collection(db, "movimentacoes"));
    const unsub = onSnapshot(q, (snap) => {
      setTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    setIsMounted(true);
    return () => unsub();
  }, []);

  // ✅ Cálculos Fundamentais (Unindo Contratos + Movimentações)
  const stats = useMemo(() => {
    // 1. O que saiu em empréstimos
    const totalBorrowed = loans.reduce((acc: number, l: any) => acc + (Number(l.amount) || 0), 0);
    
    // 2. O que já voltou das parcelas (Liquidado no Reports)
    const totalReceived = loans.reduce((acc: number, l: any) => {
      return acc + (l.installments?.reduce((sum: number, inst: any) => 
        inst.status === 'PAID' ? sum + (Number(inst.value) || 0) : sum, 0) || 0);
    }, 0);

    // 3. Aportes e Retiradas manuais
    const totalAportes = transactions.filter(t => t.type === 'APORTE').reduce((acc, t) => acc + t.value, 0);
    const totalRetiradas = transactions.filter(t => t.type === 'RETIRADA').reduce((acc, t) => acc + t.value, 0);

    // 4. Saldo Real (Fórmula Mestra)
    const currentBalance = (totalAportes + totalReceived) - (totalBorrowed + totalRetiradas);

    // 5. Inadimplência (Parcelas vencidas e não pagas)
    const today = new Date().toISOString().split('T')[0];
    const overdueContracts = loans.filter((l: any) => 
      l.installments?.some((i: any) => i.status !== 'PAID' && i.dueDate < today)
    ).length;

    return { totalBorrowed, totalReceived, currentBalance, overdueContracts, totalAportes };
  }, [loans, transactions]);

  // ✅ Função de Aporte/Retirada Rápida
  const handleQuickTransaction = async (type: 'APORTE' | 'RETIRADA') => {
    const val = prompt(`Digite o valor do ${type}:`);
    if (!val || isNaN(Number(val))) return;
    await addDoc(collection(db, "movimentacoes"), {
      type,
      value: Number(val),
      date: Date.now(),
      description: `Operação via Dashboard`
    });
  };

  // ✅ Exportação PDF
  const exportToPDF = async () => {
    if (!dashboardRef.current) return;
    const dataUrl = await toPng(dashboardRef.current, { backgroundColor: '#050505' });
    const pdf = new jsPDF('p', 'mm', 'a4');
    pdf.addImage(dataUrl, 'PNG', 0, 0, 210, 297 * (dashboardRef.current.offsetHeight / dashboardRef.current.offsetWidth));
    pdf.save('relatorio-gr-solution.pdf');
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      
      {/* HEADER DE AÇÕES */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-[#0a0a0a] p-4 rounded-3xl border border-zinc-900">
        <div className="flex items-center gap-4">
          <button onClick={() => setPeriod('30D')} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${period === '30D' ? 'bg-[#BF953F] text-black' : 'text-zinc-500'}`}>30 Dias</button>
          <button onClick={() => setPeriod('ALL')} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${period === 'ALL' ? 'bg-[#BF953F] text-black' : 'text-zinc-500'}`}>Tudo</button>
        </div>
        <div className="flex gap-2">
          <button onClick={exportToPDF} className="flex items-center gap-2 px-6 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black text-zinc-400 uppercase tracking-widest hover:text-white transition-all">
            <FileDown size={14} /> PDF
          </button>
        </div>
      </div>

      <div ref={dashboardRef} className="space-y-8">
        {/* GRID DE CARDS PRINCIPAIS */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-[#0a0a0a] p-10 rounded-[2.5rem] border border-zinc-900 relative overflow-hidden group min-h-[300px] flex flex-col justify-center shadow-2xl">
            <div className="absolute top-0 right-0 p-10 opacity-5">
              <Wallet size={200} className="text-[#BF953F]" />
            </div>
            <div className="relative z-10">
              <span className="text-[10px] font-black text-[#BF953F] uppercase tracking-[0.4em]">Saldo Real em Caixa</span>
              <h2 className="text-6xl lg:text-7xl font-black mt-4 tracking-tighter text-white">
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.currentBalance)}
              </h2>
              <div className="flex gap-4 mt-10">
                <button onClick={() => handleQuickTransaction('APORTE')} className="flex items-center gap-3 px-8 py-4 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 rounded-2xl border border-emerald-500/20 transition-all font-black text-[10px] uppercase tracking-widest">
                  <Plus size={18} /> Aporte
                </button>
                <button onClick={() => handleQuickTransaction('RETIRADA')} className="flex items-center gap-3 px-8 py-4 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-2xl border border-red-500/20 transition-all font-black text-[10px] uppercase tracking-widest">
                  <Minus size={18} /> Retirada
                </button>
              </div>
            </div>
          </div>

          <div className="bg-[#BF953F] p-10 rounded-[2.5rem] flex flex-col justify-between text-black shadow-[0_20px_50px_rgba(191,149,63,0.3)]">
             <Users size={40} className="opacity-80" />
             <div>
                <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Clientes Base</span>
                <h3 className="text-7xl font-black tracking-tighter mt-2">{customers.length}</h3>
             </div>
          </div>
        </div>

        {/* CARDS DE MÉTRICAS */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatMiniCard title="Capital Emprestado" value={stats.totalBorrowed} icon={<Briefcase size={16}/>} color="text-white" />
          <StatMiniCard title="Total Recuperado" value={stats.totalReceived} icon={<ArrowUpRight size={16}/>} color="text-emerald-500" />
          <StatMiniCard title="Inadimplência" value={stats.overdueContracts} icon={<AlertCircle size={16}/>} color="text-red-500" isCurrency={false} />
          <StatMiniCard title="Contratos Ativos" value={loans.length} icon={<TrendingUp size={16}/>} color="text-[#BF953F]" isCurrency={false} />
        </div>

        {/* GRÁFICOS */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 bg-[#0a0a0a] p-8 rounded-[2.5rem] border border-zinc-900 shadow-2xl">
            <h3 className="text-xs font-black text-[#BF953F] uppercase tracking-[0.2em] mb-8">Fluxo de Caixa Operacional</h3>
            <div className="h-[350px]">
              {isMounted && (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[
                    { name: 'Saída (Empréstimo)', valor: stats.totalBorrowed },
                    { name: 'Retorno (Parcelas)', valor: stats.totalReceived },
                    { name: 'Aportes (Capital)', valor: stats.totalAportes }
                  ]}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#18181b" vertical={false} />
                    <XAxis dataKey="name" axisLine={false} tick={{fill: '#52525b', fontSize: 10}} />
                    <YAxis axisLine={false} tick={{fill: '#52525b', fontSize: 10}} />
                    <Tooltip cursor={{fill: '#111'}} contentStyle={{backgroundColor: '#000', borderRadius: '15px', border: '1px solid #333'}} />
                    <Bar dataKey="valor" fill="#BF953F" radius={[10, 10, 0, 0]} barSize={50} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="lg:col-span-4 bg-[#0a0a0a] p-8 rounded-[2.5rem] border border-zinc-900 shadow-2xl flex flex-col items-center justify-center">
            <h3 className="text-xs font-black text-[#BF953F] uppercase tracking-[0.2em] mb-8">Saúde da Carteira</h3>
            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Recuperado', value: stats.totalReceived },
                      { name: 'Pendente', value: stats.totalBorrowed - stats.totalReceived }
                    ]}
                    innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value"
                  >
                    <Cell fill="#10B981" />
                    <Cell fill="#333" />
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="text-center mt-4">
               <p className="text-[10px] font-black text-zinc-500 uppercase">Eficiência de Retorno</p>
               <p className="text-3xl font-black text-white">
                {stats.totalBorrowed > 0 ? ((stats.totalReceived / stats.totalBorrowed) * 100).toFixed(1) : 0}%
               </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Componente auxiliar para os cards pequenos
const StatMiniCard = ({ title, value, icon, color, isCurrency = true }: any) => (
  <div className="bg-[#0a0a0a] p-6 rounded-3xl border border-zinc-900 group hover:border-[#BF953F]/30 transition-all">
    <div className="flex justify-between items-center mb-4">
      <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">{title}</span>
      <div className="p-2 bg-black rounded-lg border border-zinc-800 text-zinc-500">{icon}</div>
    </div>
    <p className={`text-xl font-black ${color}`}>
      {isCurrency ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value) : value}
    </p>
  </div>
);

export default Dashboard;