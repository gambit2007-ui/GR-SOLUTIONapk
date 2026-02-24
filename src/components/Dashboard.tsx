import React, { useState, useEffect } from "react";
import { 
  TrendingUp, TrendingDown, Wallet, Users, 
  ArrowUpCircle, ArrowDownCircle, DollarSign, Plus, Minus 
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { db } from "../firebase";
import { collection, onSnapshot, query, addDoc } from "firebase/firestore";

const Dashboard = ({ loans = [], customers = [] }: any) => {
  const [mounted, setMounted] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);

  // Carrega movimentações de caixa (Aportes e Retiradas) do Firebase
  useEffect(() => {
    const q = query(collection(db, "movimentacoes"));
    const unsub = onSnapshot(q, (snap) => {
      setTransactions(snap.docs.map(d => d.data()));
    });
    const timer = setTimeout(() => setMounted(true), 500);
    return () => { unsub(); clearTimeout(timer); };
  }, []);

  // --- CÁLCULOS FINANCEIROS TOTAIS ---
  
  // 1. Total que saiu do seu bolso (Empréstimos realizados)
  const totalEmprestado = loans.reduce((acc: number, loan: any) => acc + (Number(loan.amount) || 0), 0);

  // 2. Total que já voltou para o bolso (Parcelas pagas)
  const totalRecebido = loans.reduce((acc: number, loan: any) => {
    const paidInLoan = loan.installments?.filter((i: any) => i.status === 'PAID')
      .reduce((sum: number, inst: any) => sum + (Number(inst.value) || 0), 0) || 0;
    return acc + paidInLoan;
  }, 0);

  // 3. Gestão de Capital (Aportes e Retiradas manuais)
  const totalAportes = transactions.filter(t => t.type === 'APORTE').reduce((acc, t) => acc + t.value, 0);
  const totalRetiradas = transactions.filter(t => t.type === 'RETIRADA').reduce((acc, t) => acc + t.value, 0);

  // 4. SALDO FINAL: (Aportes + Recebidos) - (Emprestados + Retiradas)
  const saldoDisponivel = (totalAportes + totalRecebido) - (totalEmprestado + totalRetiradas);

  // --- FUNÇÕES DE BOTÃO ---
  const handleQuickTransaction = async (type: 'APORTE' | 'RETIRADA') => {
    const val = prompt(`Digite o valor do ${type}:`);
    if (!val || isNaN(Number(val))) return;

    await addDoc(collection(db, "movimentacoes"), {
      type,
      value: Number(val),
      date: Date.now(),
      description: `Operação manual via Dashboard`
    });
  };

  const chartData = [
    { name: 'Saída', amount: totalEmprestado },
    { name: 'Retorno', amount: totalRecebido }
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      {/* CARD PRINCIPAL DE SALDO */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[#0a0a0a] p-8 rounded-[2.5rem] border border-zinc-900 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
            <Wallet size={120} className="text-[#BF953F]" />
          </div>
          
          <div className="relative z-10">
            <span className="text-[10px] font-black text-[#BF953F] uppercase tracking-[0.3em]">Saldo Disponível em Caixa</span>
            <h2 className={`text-5xl lg:text-6xl font-black mt-4 tracking-tighter ${saldoDisponivel >= 0 ? 'text-white' : 'text-red-500'}`}>
              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(saldoDisponivel)}
            </h2>
            
            <div className="flex gap-4 mt-8">
              <button onClick={() => handleQuickTransaction('APORTE')} className="flex items-center gap-2 px-6 py-3 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 rounded-2xl border border-emerald-500/20 transition-all font-bold text-xs">
                <Plus size={16} /> APORTE
              </button>
              <button onClick={() => handleQuickTransaction('RETIRADA')} className="flex items-center gap-2 px-6 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-2xl border border-red-500/20 transition-all font-bold text-xs">
                <Minus size={16} /> RETIRADA
              </button>
            </div>
          </div>
        </div>

        <div className="bg-[#BF953F] p-8 rounded-[2.5rem] flex flex-col justify-between text-black shadow-[0_20px_40px_rgba(191,149,63,0.2)]">
          <Users size={32} />
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Total de Clientes</span>
            <h3 className="text-4xl font-black tracking-tighter">{customers.length}</h3>
          </div>
        </div>
      </div>

      {/* GRÁFICOS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#0a0a0a] p-8 rounded-[2.5rem] border border-zinc-900">
          <h3 className="text-[10px] font-black text-[#BF953F] uppercase mb-8 tracking-widest">Fluxo de Caixa (Saída vs Retorno)</h3>
          <div className="h-[300px] w-full">
            {mounted && (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
                  <XAxis dataKey="name" tick={{fill: '#52525b', fontSize: 12}} axisLine={false} />
                  <YAxis tick={{fill: '#52525b', fontSize: 12}} axisLine={false} />
                  <Tooltip cursor={{fill: '#1a1a1a'}} contentStyle={{backgroundColor: '#000', border: '1px solid #333', borderRadius: '12px'}} />
                  <Bar dataKey="amount" fill="#BF953F" radius={[8, 8, 0, 0]} barSize={60} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* LISTA RÁPIDA DE ALERTAS */}
        <div className="bg-[#0a0a0a] p-8 rounded-[2.5rem] border border-zinc-900">
           <h3 className="text-[10px] font-black text-red-500 uppercase mb-8 tracking-widest">Atenção Crítica</h3>
           <div className="space-y-4">
              {loans.filter((l:any) => l.status === 'OVERDUE').length === 0 ? (
                <div className="text-zinc-600 text-xs font-medium italic">Nenhum contrato em atraso no momento.</div>
              ) : (
                // Mapear contratos atrasados aqui
                null
              )}
           </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;