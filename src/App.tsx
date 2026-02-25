import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, Users, FileText, PieChart, Calculator, 
  Activity, X
} from 'lucide-react';

// Tipos e Componentes
import { Customer, Loan, View, AuthUser } from './types';
import Dashboard from './components/Dashboard';
import CustomerSection from './components/CustomerSection';
import SimulationTab from './components/SimulationTab';
import Reports from './components/Reports';
import LoanSection from './components/LoanSection'; 

// ✅ Firebase Imports
import { db } from "./firebase";
import { 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  addDoc, 
  updateDoc, 
  doc,
  setDoc,
  writeBatch,
  serverTimestamp
} from "firebase/firestore";

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'info' | 'error';
}

const App: React.FC = () => {
  const [currentUser] = useState<AuthUser>({
    id: 'admin-01',
    name: 'Gestor Master',
    email: 'admin@grsolution.com',
    createdAt: Date.now()
  });
  
  const [currentView, setCurrentView] = useState<View>('DASHBOARD');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [caixa, setCaixa] = useState<number>(0);
  const [transactions, setTransactions] = useState<any[]>([]);

  // --- SISTEMA DE NOTIFICAÇÕES ---
  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  const removeToast = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  // --- FUNÇÕES DE OPERAÇÃO (FIREBASE) ---

  const handleUpdateLoan = async (loanId: string, newData: Partial<Loan>) => {
    try {
      const loanRef = doc(db, 'loans', loanId);
      await setDoc(loanRef, newData, { merge: true });
    } catch (error) {
      console.error("Erro ao atualizar contrato:", error);
      showToast("Erro ao atualizar contrato", "error");
    }
  };

  const handleAddTransaction = async (type: 'APORTE' | 'RETIRADA' | 'PAGAMENTO', amount: number, description: string) => {
    try {
      // 1. Salva no extrato
      await addDoc(collection(db, 'cashMovement'), {
        type,
        amount,
        description,
        date: new Date().toISOString()
      });

      // 2. Atualiza saldo
      let novoSaldo = caixa;
      if (type === 'APORTE' || type === 'PAGAMENTO') novoSaldo += amount;
      else if (type === 'RETIRADA') novoSaldo -= amount;

      const caixaRef = doc(db, 'settings', 'caixa');
      await setDoc(caixaRef, { value: novoSaldo });
      setCaixa(novoSaldo);
    } catch (error) {
      console.error("Erro na transação:", error);
    }
  };

  // --- SINCRONIZAÇÃO EM TEMPO REAL ---
  useEffect(() => {
    const unsubCust = onSnapshot(query(collection(db, "clientes"), orderBy("createdAt", "desc")), (snap) => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Customer)));
    });

    const unsubLoans = onSnapshot(query(collection(db, "loans"), orderBy("startDate", "desc")), (snap) => {
      setLoans(snap.docs.map(d => ({ id: d.id, ...d.data() } as Loan)));
    });

    const unsubCaixa = onSnapshot(doc(db, 'settings', 'caixa'), (snap) => {
      if (snap.exists()) setCaixa(snap.data().value || 0);
    });

    const unsubTrans = onSnapshot(query(collection(db, 'cashMovement'), orderBy('date', 'desc')), (snap) => {
      setTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => { unsubCust(); unsubLoans(); unsubCaixa(); unsubTrans(); };
  }, []);

  // --- CRUD CLIENTES E CONTRATOS ---
  const handleAddCustomer = async (customer: Customer) => {
    try {
      const { id, ...data } = customer; 
      await addDoc(collection(db, "clientes"), { ...data, createdAt: Date.now() });
      showToast('Cliente cadastrado!', 'success');
    } catch (e) { showToast('Erro ao salvar cliente', 'error'); }
  };

  const handleUpdateCustomer = async (updated: Customer) => {
    try {
      const { id, ...data } = updated;
      await updateDoc(doc(db, "clientes", id), data);
      showToast('Cadastro atualizado!', 'info');
    } catch (e) { showToast('Erro ao atualizar', 'error'); }
  };

  const handleDeleteCustomer = async (id: string) => {
    if (!window.confirm('Atenção: Isso apagará o cliente e TODOS os seus contratos.')) return;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, "clientes", id));
      loans.filter(l => l.customerId === id).forEach(loan => {
        batch.delete(doc(db, "loans", loan.id));
      });
      await batch.commit();
      showToast('Excluído com sucesso.', 'info');
    } catch (e) { showToast('Erro na exclusão', 'error'); }
  };

  const handleAddLoan = async (loan: Loan) => {
    try {
      const { id, ...data } = loan; 
      await addDoc(collection(db, "loans"), { ...data, createdAt: serverTimestamp() });
      setCurrentView('REPORTS'); 
      showToast('Contrato efetivado!', 'success');
    } catch (e) { showToast('Erro ao salvar contrato', 'error'); }
  };

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
          .gold-text { background: linear-gradient(to right, #BF953F, #FCF6BA, #B38728); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
          .gold-gradient { background: linear-gradient(45deg, #BF953F, #FCF6BA, #B38728); }
          .custom-scrollbar::-webkit-scrollbar { width: 4px; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: #BF953F; border-radius: 10px; }
        `}
      </style>

      <aside className={`flex flex-col z-[70] ${isSidebarOpen ? 'w-72' : 'w-24'} bg-[#050505] border-r border-zinc-900 transition-all duration-300`}>
        <div className="h-24 flex items-center px-6 border-b border-zinc-900">
           <span className="font-black text-lg gold-text tracking-tighter">GR SOLUTION</span>
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
              {isSidebarOpen && <span className="text-xs font-bold uppercase tracking-widest">{item.label}</span>}
            </button>
          ))}
        </nav>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden relative">
        <header className="h-20 bg-[#020202] border-b border-zinc-900 flex items-center justify-between px-10">
            <h2 className="text-xs font-black text-zinc-100 uppercase tracking-widest">
              {navItems.find(item => item.id === currentView)?.label}
            </h2>
            <div className="flex items-center gap-2 px-4 py-1.5 bg-zinc-950 border border-zinc-900 rounded-full">
               <Activity size={12} className="text-emerald-500 animate-pulse" />
               <span className="text-[9px] font-black text-zinc-500 uppercase">Cloud Sync Ativo</span>
            </div>
        </header>

        <div className="flex-1 overflow-y-auto custom-scrollbar bg-black p-6">
            {currentView === 'DASHBOARD' && <Dashboard loans={loans} customers={customers} />}
            {currentView === 'CUSTOMERS' && <CustomerSection customers={customers} loans={loans} onAddCustomer={handleAddCustomer} onUpdateCustomer={handleUpdateCustomer} onDeleteCustomer={handleDeleteCustomer} />}
            {currentView === 'LOANS' && <LoanSection customers={customers} loans={loans} onAddLoan={handleAddLoan} />}
            {currentView === 'SIMULATION' && <SimulationTab customers={customers} />}
            {currentView === 'REPORTS' && <Reports loans={loans} customers={customers} transactions={transactions} caixa={caixa} onAddTransaction={handleAddTransaction} onUpdateLoan={handleUpdateLoan} />}
        </div>

        <div className="fixed top-6 right-6 z-[200] flex flex-col gap-3">
          {toasts.map(t => (
            <div key={t.id} className="flex items-center gap-4 px-6 py-4 rounded-2xl border bg-zinc-950 border-[#BF953F]/50 text-[#BF953F] shadow-2xl animate-in slide-in-from-right">
              <span className="text-[10px] font-black uppercase tracking-widest">{t.message}</span>
              <X size={14} className="cursor-pointer" onClick={() => removeToast(t.id)} />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
};

export default App;