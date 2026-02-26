import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard, Users, FileText, PieChart, Calculator,
  Activity, X, Menu, Lock, LogOut, Loader2
} from 'lucide-react';

// ✅ Firebase Imports
import { db, auth } from "./firebase";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from "firebase/auth";
import {
  collection, onSnapshot, query, orderBy, addDoc,
  updateDoc, doc, setDoc, writeBatch, serverTimestamp, deleteDoc
} from "firebase/firestore";

// Tipos e Componentes
import { Customer, Loan, View } from './types';
import Dashboard from './components/Dashboard';
import CustomerSection from './components/CustomerSection';
import SimulationTab from './components/SimulationTab';
import Reports from './components/Reports';
import LoanSection from './components/LoanSection';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'info' | 'error';
}

const App: React.FC = () => {
  // --- ESTADOS DE AUTENTICAÇÃO ---
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // --- ESTADOS DA APLICAÇÃO ---
  const [currentView, setCurrentView] = useState<View>('DASHBOARD');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [caixa, setCaixa] = useState<number>(0);
  const [transactions, setTransactions] = useState<any[]>([]);

  // --- MONITORAMENTO DE AUTH ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // --- FUNÇÕES DE AUTH ---
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      showToast("Acesso autorizado!", "success");
    } catch (error: any) {
      showToast("E-mail ou senha incorretos", "error");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    showToast("Sessão encerrada", "info");
  };

  // --- SISTEMA DE NOTIFICAÇÕES ---
  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  const removeToast = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  // --- SINCRONIZAÇÃO EM TEMPO REAL ---
  useEffect(() => {
    if (!user) return;

    const unsubCust = onSnapshot(query(collection(db, "clientes"), orderBy("createdAt", "desc")), (snap) => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Customer)));
    });

    const unsubLoans = onSnapshot(query(collection(db, "loans"), orderBy("startDate", "desc")), (snap) => {
      setLoans(snap.docs.map(d => ({ id: d.id, ...d.data() } as Loan)));
    });

    const unsubCaixa = onSnapshot(doc(db, 'settings', 'caixa'), (snap) => {
      if (snap.exists()) setCaixa(Number(snap.data().value) || 0);
    });

    const unsubTrans = onSnapshot(query(collection(db, 'cashMovement'), orderBy('date', 'desc')), (snap) => {
      setTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => { unsubCust(); unsubLoans(); unsubCaixa(); unsubTrans(); };
  }, [user]);

  // --- FUNÇÕES DE OPERAÇÃO (CRUD) ---

  const handleUpdateLoan = async (loanId: string, newData: Partial<Loan>) => {
    try {
      await updateDoc(doc(db, 'loans', loanId), newData);
    } catch (e) { showToast("Erro ao atualizar contrato", "error"); }
  };

  const handleAddTransaction = async (type: string, amount: number, description: string) => {
    try {
      const valorNum = Number(amount);
      await addDoc(collection(db, 'cashMovement'), {
        type: type.toUpperCase(),
        amount: valorNum,
        description: description.toUpperCase(),
        date: new Date().toISOString()
      });
      
      let novoSaldo = (type === 'APORTE' || type === 'PAGAMENTO') ? caixa + valorNum : caixa - valorNum;
      await setDoc(doc(db, 'settings', 'caixa'), { value: novoSaldo, updatedAt: serverTimestamp() });
      showToast('Caixa atualizado!', 'success');
    } catch (e) { showToast("Erro no processamento do caixa", "error"); }
  };

  const handleAddCustomer = async (c: Customer) => {
    try { 
      const { id, ...data } = c;
      await addDoc(collection(db, "clientes"), { ...data, createdAt: Date.now() }); 
      showToast('Cliente cadastrado com sucesso!'); 
    } catch (e) { showToast('Erro ao salvar cliente', 'error'); }
  };

  // ✅ CORREÇÃO: Função que estava faltando
  const handleUpdateCustomer = async (updated: Customer) => {
    try {
      const { id, ...data } = updated;
      await updateDoc(doc(db, "clientes", id), data);
      showToast('Cadastro atualizado!', 'info');
    } catch (e) { showToast('Erro ao atualizar cadastro', 'error'); }
  };

  const handleDeleteCustomer = async (id: string) => {
    if (!window.confirm("Isso excluirá o cliente e todos os seus registros permanentemente. Confirma?")) return;
    try {
      await deleteDoc(doc(db, "clientes", id));
      showToast('Cliente removido', 'info');
    } catch (e) { showToast('Erro ao remover cliente', 'error'); }
  };

  const handleAddLoan = async (l: Loan) => {
    try {
      const { id, ...data } = l;
      await setDoc(doc(db, "loans", l.id), { ...data, createdAt: serverTimestamp() });
      await handleAddTransaction('RETIRADA', l.amount, `EMPRÉSTIMO: ${l.customerName}`);
      setCurrentView('DASHBOARD');
      showToast('Contrato efetivado!');
    } catch (e) { showToast('Erro ao salvar contrato', 'error'); }
  };

  // --- COMPONENTES DE TELA ---

  if (authLoading) {
    return (
      <div className="h-screen bg-black flex items-center justify-center">
        <Activity size={40} className="text-[#BF953F] animate-pulse" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen bg-black flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-[#050505] border border-zinc-900 p-10 rounded-[3rem] shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 gold-gradient opacity-50" />
          <div className="mb-10 text-center">
            <div className="inline-flex p-4 bg-zinc-900 rounded-2xl mb-4 border border-zinc-800">
              <Lock size={32} className="text-[#BF953F]" />
            </div>
            <h1 className="text-2xl font-black gold-text tracking-tighter">GR SOLUTION</h1>
            <p className="text-[9px] text-zinc-500 uppercase tracking-[0.4em] mt-2 text-center">Acesso ao Painel de Controle</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <input 
              type="email" placeholder="E-MAIL" required
              className="w-full bg-black border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] transition-all text-xs"
              onChange={e => setEmail(e.target.value)}
            />
            <input 
              type="password" placeholder="CHAVE DE ACESSO" required
              className="w-full bg-black border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] transition-all text-xs"
              onChange={e => setPassword(e.target.value)}
            />
            <button 
              disabled={loginLoading}
              className="w-full py-5 gold-gradient text-black rounded-2xl font-black uppercase text-[10px] tracking-widest hover:brightness-110 transition-all flex items-center justify-center gap-2"
            >
              {loginLoading ? <Loader2 className="animate-spin" size={16} /> : "Entrar no Sistema"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const navItems = [
    { id: 'DASHBOARD', label: 'Painel', icon: LayoutDashboard },
    { id: 'CUSTOMERS', label: 'Clientes', icon: Users },
    { id: 'LOANS', label: 'Contratos', icon: FileText },
    { id: 'SIMULATION', label: 'Simular', icon: Calculator },
    { id: 'REPORTS', label: 'Financeiro', icon: PieChart },
  ];

  return (
    <div className="flex h-screen bg-black overflow-hidden text-white font-sans">
      <style>
        {`
          .gold-text { background: linear-gradient(to right, #BF953F, #FCF6BA, #B38728); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
          .gold-gradient { background: linear-gradient(45deg, #BF953F, #FCF6BA, #B38728); }
          .custom-scrollbar::-webkit-scrollbar { width: 4px; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: #BF953F; border-radius: 10px; }
        `}
      </style>

      {/* SIDEBAR */}
      <aside className={`flex flex-col z-[70] ${isSidebarOpen ? 'w-72' : 'w-24'} bg-[#050505] border-r border-zinc-900 transition-all duration-300`}>
        <div className="h-24 flex items-center justify-between px-6 border-b border-zinc-900">
           {isSidebarOpen && <span className="font-black text-lg gold-text tracking-tighter">GR SOLUTION</span>}
           <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 hover:bg-zinc-900 rounded-xl transition-colors">
              <Menu size={20} className="text-[#BF953F]" />
           </button>
        </div>
        <nav className="flex-1 py-8 px-4 space-y-2">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setCurrentView(item.id as View)}
              className={`w-full flex items-center gap-4 px-4 py-4 rounded-2xl transition-all ${
                currentView === item.id ? 'gold-gradient text-black font-black' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/50'
              }`}
            >
              <item.icon size={22} />
              {isSidebarOpen && <span className="text-[10px] font-black uppercase tracking-widest">{item.label}</span>}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-zinc-900">
            <button onClick={handleLogout} className="w-full flex items-center gap-4 px-4 py-4 rounded-2xl text-red-500 hover:bg-red-500/10 transition-all">
              <LogOut size={22} />
              {isSidebarOpen && <span className="text-[10px] font-black uppercase tracking-widest">Sair</span>}
            </button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <header className="h-20 bg-[#020202] border-b border-zinc-900 flex items-center justify-between px-10 flex-shrink-0">
            <h2 className="text-xs font-black text-zinc-100 uppercase tracking-widest">
              {navItems.find(item => item.id === currentView)?.label}
            </h2>
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 px-4 py-1.5 bg-zinc-950 border border-zinc-900 rounded-full">
                  <Activity size={12} className="text-emerald-500 animate-pulse" />
                  <span className="text-[9px] font-black text-zinc-500 uppercase">Online: {user?.email}</span>
                </div>
            </div>
        </header>

        <div className="flex-1 overflow-y-auto custom-scrollbar bg-black p-6">
            {currentView === 'DASHBOARD' && <Dashboard loans={loans} customers={customers} cashMovements={transactions} />}
            {currentView === 'CUSTOMERS' && (
              <CustomerSection
                customers={customers} loans={loans}
                onAddCustomer={handleAddCustomer} onUpdateCustomer={handleUpdateCustomer} onDeleteCustomer={handleDeleteCustomer}
              />
            )}
            {currentView === 'LOANS' && <LoanSection customers={customers} loans={loans} onAddLoan={handleAddLoan} showToast={showToast} />}
            {currentView === 'SIMULATION' && <SimulationTab customers={customers} />}
            {currentView === 'REPORTS' && (
              <Reports
                loans={loans} cashMovements={transactions} customers={customers}
                caixa={caixa} onAddTransaction={handleAddTransaction} onUpdateLoan={handleUpdateLoan} showToast={showToast}
              />
            )}
        </div>

        {/* TOASTS */}
        <div className="fixed top-6 right-6 z-[200] flex flex-col gap-3">
          {toasts.map(t => (
            <div key={t.id} className="flex items-center gap-4 px-6 py-4 rounded-2xl border bg-zinc-950 border-[#BF953F]/50 text-[#BF953F] shadow-2xl animate-in slide-in-from-right">
              <span className="text-[10px] font-black uppercase tracking-widest">{t.message}</span>
              <X size={14} className="cursor-pointer hover:text-white" onClick={() => removeToast(t.id)} />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
};

export default App;