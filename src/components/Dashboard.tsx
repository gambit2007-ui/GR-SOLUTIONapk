import React, { useMemo, useState, useEffect, useRef } from 'react';
import { 
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';
import { 
  Users, Briefcase, AlertCircle, ShieldCheck, ArrowUpRight, 
  ArrowDownRight, TrendingUp, Wallet, Coins, Filter
} from 'lucide-react';
import { db } from "../firebase"; // Certifique-se que o caminho está correto
// Adicione 'serverTimestamp' dentro das chaves:
import { 
  collection, 
  onSnapshot, 
  query, 
  doc, 
  updateDoc, 
  addDoc, 
  orderBy, 
  serverTimestamp // <--- Esta é a peça que está faltando!
} from 'firebase/firestore';

const Dashboard = () => {
  const [loans, setLoans] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [isMounted, setIsMounted] = useState(false);
  const [period, setPeriod] = useState('30D');
  const dashboardRef = useRef<HTMLDivElement>(null);

  const todayStr = new Date().toISOString().split('T')[0];
// Exemplo de função para salvar aporte/retirada
const registrarMovimentacao = async (valor, motivo, tipo) => {
  const valorFinal = tipo === 'retirada' ? -Math.abs(valor) : Math.abs(valor);
  
  await addDoc(collection(db, "caixa"), {
    valor: valorFinal,
    motivo: motivo,
    tipo: tipo,
    data: serverTimestamp()
  });
  
  // Aqui você deve atualizar o estado do saldo disponível
};
  // --- CONEXÃO FIREBASE EM TEMPO REAL ---
  useEffect(() => {
    setIsMounted(true);
    
    // Escutar Contratos
    const unsubLoans = onSnapshot(collection(db, "contratos"), (snap) => {
      setLoans(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    // Escutar Movimentações (Extrato)
    const qMov = query(collection(db, "movimentacoes"), orderBy("date", "desc"));
    const unsubMov = onSnapshot(qMov, (snap) => {
      setTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => { unsubLoans(); unsubMov(); };
  }, []);

  // --- LÓGICA DE CÁLCULO (O "CÉREBRO" DO DASHBOARD) ---
  const stats = useMemo(() => {
    // 1. Total que saiu do caixa (Aportes dos investidores)
    const aportes = transactions
      .filter(t => t.type === 'APORTE')
      .reduce((acc, t) => acc + (Number(t.value) || 0), 0);

    // 2. Total que saiu para empréstimos (O que está na rua)
    const totalEmprestado = loans.reduce((acc, l) => acc + (Number(l.amount) || 0), 0);

    // 3. Total recebido de parcelas
    const totalRecebido = transactions
      .filter(t => t.type === 'RETORNO_PARCELA')
      .reduce((acc, t) => acc + (Number(t.value) || 0), 0);

    // 4. Inadimplência (Parcelas vencidas e não pagas)
    const overdueCount = loans.filter(l => 
      l.installments?.some((inst: any) => 
        inst.status !== 'PAID' && inst.dueDate < todayStr
      )
    ).length;

    // 5. Saldo Real (Aportes + Retornos - Saídas/Retiradas)
    const retiradas = transactions
      .filter(t => t.type === 'RETIRADA')
      .reduce((acc, t) => acc + (Number(t.value) || 0), 0);
    
    const saldoEmCaixa = (aportes + totalRecebido) - (totalEmprestado + retiradas);

    return {
      totalEmprestado,
      totalRecebido,
      saldoEmCaixa,
      overdueCount,
      customerCount: loans.length,
      activeContracts: loans.filter(l => l.installments?.some((i:any) => i.status !== 'PAID')).length
    };
  }, [loans, transactions, todayStr]);

  // Dados para o Gráfico de Pizza
  const statusData = [
    { name: 'Em Dia', value: stats.activeContracts - stats.overdueCount, color: '#BF953F' },
    { name: 'Atrasados', value: stats.overdueCount, color: '#EF4444' },
    { name: 'Finalizados', value: loans.length - stats.activeContracts, color: '#10B981' }
  ];

  if (!isMounted) return null;

  return (
    <div className="p-8 space-y-8 bg-black min-h-screen text-white" ref={dashboardRef}>
      
      {/* HEADER */}
      <div className="flex justify-between items-center bg-[#0a0a0a] p-6 rounded-[2rem] border border-zinc-900 shadow-2xl">
        <div>
          <h2 className="text-2xl font-black italic tracking-tighter text-[#BF953F]">DASHBOARD OPERACIONAL</h2>
          <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.3em]">GR Solution • Gestão de Ativos</p>
        </div>
        <div className="flex gap-2 bg-black p-1 rounded-xl border border-zinc-800">
          {['7D', '30D', '90D', 'TOTAL'].map(p => (
            <button key={p} onClick={() => setPeriod(p)} className={`px-4 py-2 rounded-lg text-[9px] font-black transition-all ${period === p ? 'bg-[#BF953F] text-black' : 'text-zinc-500 hover:text-white'}`}>{p}</button>
          ))}
        </div>
      </div>

      {/* CARDS DE IMPACTO */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-[#0a0a0a] p-8 rounded-[2.5rem] border border-zinc-900 relative overflow-hidden group">
          <Briefcase className="absolute right-[-10px] top-[-10px] text-zinc-900/50 group-hover:text-[#BF953F]/10 transition-colors" size={120} />
          <p className="text-[10px] font-black text-zinc-500 uppercase mb-2 italic">Capital na Rua</p>
          <p className="text-4xl font-black text-white italic">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.totalEmprestado)}</p>
        </div>

        <div className="bg-[#0a0a0a] p-8 rounded-[2.5rem] border border-zinc-900 relative overflow-hidden group">
          <TrendingUp className="absolute right-[-10px] top-[-10px] text-zinc-900/50 group-hover:text-emerald-500/10 transition-colors" size={120} />
          <p className="text-[10px] font-black text-zinc-500 uppercase mb-2 italic">Total Recuperado</p>
          <p className="text-4xl font-black text-emerald-500 italic">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.totalRecebido)}</p>
        </div>

        <div className="bg-[#BF953F] p-8 rounded-[2.5rem] shadow-[0_20px_50px_rgba(191,149,63,0.2)]">
          <Wallet className="mb-4 text-black/40" size={32} />
          <p className="text-[10px] font-black text-black/60 uppercase mb-1 italic">Saldo Disponível em Caixa</p>
          <p className="text-4xl font-black text-black italic">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.saldoEmCaixa)}</p>
        </div>
      </div>

      {/* SEÇÃO DE ANÁLISE GRÁFICA */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Gráfico de Pizza - Status da Carteira */}
        <div className="lg:col-span-5 bg-[#0a0a0a] p-8 rounded-[3rem] border border-zinc-900 h-[450px] flex flex-col">
          <div className="flex items-center gap-3 mb-8">
            <div className="p-2 bg-[#BF953F]/10 rounded-lg"><ShieldCheck size={18} className="text-[#BF953F]"/></div>
            <h4 className="text-[11px] font-black uppercase tracking-widest text-zinc-400">Saúde da Carteira</h4>
          </div>
          <div className="flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusData} innerRadius={80} outerRadius={110} paddingAngle={8} dataKey="value">
                  {statusData.map((entry, index) => <Cell key={index} fill={entry.color} stroke="none" />)}
                </Pie>
                <Tooltip contentStyle={{backgroundColor: '#111', border: 'none', borderRadius: '10px', fontSize: '12px'}} />
                <Legend iconType="circle" wrapperStyle={{paddingTop: '20px', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase'}} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Resumo de Clientes e Inadimplência */}
        <div className="lg:col-span-7 space-y-6">
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-[#0a0a0a] p-8 rounded-[2.5rem] border border-zinc-900 text-center">
              <Users className="mx-auto mb-4 text-[#BF953F]" size={32} />
              <p className="text-5xl font-black italic">{stats.customerCount}</p>
              <p className="text-[10px] font-black text-zinc-600 uppercase mt-2">Clientes Totais</p>
            </div>
            <div className={`p-8 rounded-[2.5rem] border text-center transition-all ${stats.overdueCount > 0 ? 'bg-red-500/5 border-red-500/30' : 'bg-zinc-900/20 border-zinc-800'}`}>
              <AlertCircle className={`mx-auto mb-4 ${stats.overdueCount > 0 ? 'text-red-500' : 'text-zinc-700'}`} size={32} />
              <p className={`text-5xl font-black italic ${stats.overdueCount > 0 ? 'text-red-500' : 'text-zinc-800'}`}>{stats.overdueCount}</p>
              <p className="text-[10px] font-black text-zinc-600 uppercase mt-2">Contratos em Atraso</p>
            </div>
          </div>

          <div className="bg-[#0a0a0a] p-8 rounded-[2.5rem] border border-zinc-900 flex items-center justify-between group hover:border-[#BF953F]/30 transition-all">
             <div>
                <p className="text-[10px] font-black text-zinc-500 uppercase mb-1">Índice de Adimplência</p>
                <p className="text-4xl font-black text-[#BF953F] italic">
                  {stats.activeContracts > 0 ? Math.round(((stats.activeContracts - stats.overdueCount) / stats.activeContracts) * 100) : 100}%
                </p>
             </div>
             <div className="h-16 w-16 rounded-full border-4 border-zinc-900 border-t-[#BF953F] animate-spin-slow"></div>
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