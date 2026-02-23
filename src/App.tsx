import React, { useState, useEffect } from 'react';
import { db } from './firebase'; 
import { collection, addDoc, getDocs, query, orderBy } from 'firebase/firestore';
import { ShieldCheck, Save, LayoutDashboard, User } from 'lucide-react';

// --- INTERFACES ---
interface Customer { id: string; name: string; cpf?: string; }
interface Loan { 
  id?: string; 
  customerId: string; 
  amount: number; 
  date: string;
  status: string;
}

// --- COMPONENTE DO FORMULÁRIO (Definido aqui para evitar erro de import) ---
function LoanRegistration({ customers, onSaveLoan }: { customers: Customer[], onSaveLoan: (loan: any) => void }) {
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [amount, setAmount] = useState(0);

  const handleSubmit = () => {
    if (!selectedCustomerId || amount <= 0) {
      alert("Selecione um cliente e preencha o valor!");
      return;
    }
    onSaveLoan({ customerId: selectedCustomerId, amount });
    setSelectedCustomerId('');
    setAmount(0);
  };

  return (
    <div className="max-w-2xl mx-auto bg-zinc-900 border border-amber-900/30 p-8 rounded-3xl text-white shadow-2xl">
      <h2 className="text-xl font-black text-amber-500 mb-8 flex items-center gap-3 uppercase tracking-tighter">
        <ShieldCheck size={28} /> Novo Registro de Empréstimo
      </h2>

      <div className="space-y-6">
        <div>
          <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 ml-1">Proprietário do Contrato</label>
          <div className="relative">
            <select 
              className="w-full bg-black border border-zinc-800 p-4 rounded-2xl text-white appearance-none focus:border-amber-500 outline-none transition-all"
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
            >
              <option value="">Selecione um cliente...</option>
              {customers?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 ml-1">Montante Principal (R$)</label>
          <input 
            type="number" 
            value={amount || ''}
            className="w-full bg-black border border-zinc-800 p-4 rounded-2xl text-white focus:border-amber-500 outline-none transition-all font-bold text-lg"
            placeholder="0,00"
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        </div>

        <button 
          onClick={handleSubmit}
          className="w-full bg-amber-600 hover:bg-amber-500 text-black font-black py-4 rounded-2xl flex items-center justify-center gap-3 mt-6 transition-all active:scale-95 uppercase tracking-widest text-xs"
        >
          <Save size={18} /> Efetivar Contrato no Banco
        </button>
      </div>
    </div>
  );
}

// --- COMPONENTE PRINCIPAL (App) ---
export default function App() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const qCustomers = await getDocs(collection(db, "customers"));
      setCustomers(qCustomers.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Customer[]);

      const qLoans = await getDocs(query(collection(db, "loans"), orderBy("createdAt", "desc")));
      setLoans(qLoans.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Loan[]);
    } catch (err) {
      console.error("Erro Firebase:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSaveLoan = async (newLoan: any) => {
    try {
      await addDoc(collection(db, "loans"), {
        ...newLoan,
        createdAt: Date.now(),
        date: new Date().toLocaleDateString('pt-BR'),
        status: 'ATIVO'
      });
      alert("✅ Contrato salvo com sucesso!");
      fetchData();
    } catch (error) {
      alert("❌ Erro ao salvar");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-amber-500 font-black animate-pulse tracking-[0.3em] uppercase text-xs">
          GR Solution - Autenticando...
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#050505] text-white p-6 md:p-12">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-16 border-b border-zinc-900 pb-10">
          <div>
            <h1 className="text-5xl font-black tracking-tighter italic">GR<span className="text-amber-600">.</span></h1>
            <p className="text-zinc-600 text-[9px] font-bold uppercase tracking-[0.4em]">Gestão de Ativos Financeiros</p>
          </div>
          <div className="text-right">
            <p className="text-emerald-500 text-xs font-black flex items-center gap-2 justify-end">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></span>
              SISTEMA OPERACIONAL
            </p>
            <p className="text-zinc-700 text-[10px] font-bold mt-1 uppercase">{customers.length} clientes na base</p>
          </div>
        </div>

        <LoanRegistration customers={customers} onSaveLoan={handleSaveLoan} />

        <div className="mt-20">
          <h3 className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.3em] mb-8 flex items-center gap-3">
            <LayoutDashboard size={14} className="text-amber-600" /> Histórico de Contratos Recentes
          </h3>
          
          <div className="grid gap-3">
            {loans.map((loan) => (
              <div key={loan.id} className="bg-zinc-900/30 border border-zinc-900 p-6 rounded-2xl flex justify-between items-center hover:bg-zinc-900/50 transition-all group">
                <div className="flex items-center gap-5">
                  <div className="w-12 h-12 bg-black rounded-xl flex items-center justify-center border border-zinc-800 group-hover:border-amber-500/50 transition-all">
                    <User size={20} className="text-zinc-700 group-hover:text-amber-500" />
                  </div>
                  <div>
                    <p className="text-zinc-600 text-[9px] font-bold uppercase tracking-widest mb-1">ID do Cliente</p>
                    <p className="text-xs font-mono text-zinc-400">{loan.customerId}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xl font-black text-white mb-1">
                    R$ {Number(loan.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-[9px] font-bold text-amber-600 uppercase tracking-widest">{loan.date} • {loan.status}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}