import React, { useState, useEffect } from 'react';
import { 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  orderBy,
  onSnapshot 
} from 'firebase/firestore';
import { db } from './firebase';
import { 
  LayoutDashboard, Users, FileText, PieChart, Calculator, 
  Activity, ChevronLeft, ChevronRight, CheckCircle2, X
} from 'lucide-react';
import { Customer, Loan, View, AuthUser } from './types';

// Componentes
import { Dashboard } from './components/Dashboard'
import CustomerSection from './components/CustomerSection';
import LoanRegistration from './components/LoanRegistration';
import SimulationTab from './components/SimulationTab';
import Reports from './components/Reports';

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

  // Sincronização em Tempo Real com Firebase
  useEffect(() => {
    const qCustomers = query(collection(db, "customers"), orderBy("name", "asc"));
    const unsubCustomers = onSnapshot(qCustomers, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any;
      setCustomers(data as Customer[]);
    });

    const qLoans = query(collection(db, "loans"), orderBy("createdAt", "desc"));
    const unsubLoans = onSnapshot(qLoans, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any;
      setLoans(data as Loan[]);
    });

    if (window.innerWidth < 1024) setIsSidebarOpen(false);
    return () => { unsubCustomers(); unsubLoans(); };
  }, []);

  // Sistema de Notificações (Toast)
  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // Funções de Gerenciamento de Clientes
  const addCustomer = async (customer: Omit<Customer, 'id'>) => {
    try {
      await addDoc(collection(db, "customers"), customer);
      showToast('Cliente cadastrado!', 'success');
    } catch (e) {
      showToast('Erro ao salvar no banco.', 'error');
    }
  };

  const updateCustomer = async (updated: Customer) => {
    try {
      const { id, ...data } = updated;
      await updateDoc(doc(db, "customers", id), data);
      showToast('Cadastro atualizado!', 'info');
    } catch (e) {
      showToast('Erro na atualização.', 'error');
    }
  };

  const deleteCustomer = async (id: string) => {
    if (window.confirm('Excluir cliente permanentemente?')) {
      try {
        await deleteDoc(doc(db, "customers", id));
        showToast('Cliente removido.', 'info');
      } catch (e) {
        showToast('Erro ao remover.', 'error');
      }
    }
  };

  // Funções de Gerenciamento de Empréstimos/Contratos
  const addLoan = async (loan: Omit<Loan, 'id'>) => {
    try {
      const loanWithDate = { ...loan, createdAt: Date.now() };
      await addDoc(collection(db, "loans"), loanWithDate);
      setCurrentView('REPORTS');
      showToast('Contrato efetivado!', 'success');
    } catch (e) {
      showToast('Erro ao registrar contrato.', 'error');
    }
  };

  // --- FUNÇÃO PARA ATUALIZAR EMPRÉSTIMOS VIA REPORTS ---
  const updateMultipleLoans = async (updatedLoans: Loan[]) => {
    try {
      const promises = updatedLoans.map(loan => {
        const { id, ...data } = loan;
        return updateDoc(doc(db, "loans", id), data as any);
      });
      await Promise.all(promises);
      showToast('Dados sincronizados!', 'success');
    } catch (e) {
      showToast('Erro ao sincronizar dados.', 'error');
    }
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
          @media print {
            aside, header, footer, .no-print, nav.mobile-nav { display: none !important; }
            main { padding: 0 !important; overflow: visible !important; height: auto !important; width: 100% !important; }
            body { background: white !important; color: black !important; }
          }
          .custom-scrollbar::-webkit-scrollbar { width: 4px; }
          .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: #1a1a1a; border-radius: 10px; }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #BF953F; }
          .gold-text { background: linear-gradient(to right, #BF953F, #FCF6BA, #B38728, #FBF5B7, #AA771C); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
          .gold-gradient { background: linear-gradient(to right, #BF953F, #FCF6BA, #B38728); }
        `}
      </style>
      
      {/* Sidebar Desktop */}
      <aside className={`hidden lg:flex flex-col z-[70] ${isSidebarOpen ? 'w-72' : 'w-24'} bg-[#050505] border-r border-zinc-900 transition-all duration-300 no-print`}>
        <div className="h-24 flex items-center px-6 border-b border-zinc-900 overflow-hidden shrink-0">
          <div className="flex items-center gap-4 shrink-0">
            <div className="w-12 h-12 rounded-full overflow-hidden border border-[#BF953F]/50">
              <img src="https://i.ibb.co/L6WvFhH/gr-logo.jpg" alt="Logo" className="w-full h-full object-cover" />
            </div>
            {isSidebarOpen && (
              <div className="flex flex-col">
                <span className="font-black text-lg gold-text tracking-tighter">GR SOLUTION</span>
                <span className="text-[7px] text-zinc-600 font-bold uppercase italic">ajudando você e sua família</span>
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 py-8 px-4 space-y-2 overflow-y-auto custom-scrollbar">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setCurrentView(item.id as View)}
              className={`w-full flex items-center gap-4 px-4 py-4 rounded-2xl transition-all ${
                currentView === item.id ? 'gold-gradient text-black font-black' : 'text-zinc-500 hover:bg-zinc-900/50'
              }`}
            >
              <item.icon size={22} />
              {isSidebarOpen && <span className="text-xs font-bold uppercase">{item.label}</span>}
            </button>
          ))}
        </nav>

        <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="h-10 border-t border-zinc-900 flex items-center justify-center text-zinc-700">
          {isSidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>
      </aside>

      {/* Main Area */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <header className="h-16 lg:h-20 bg-[#020202] border-b border-zinc-900 flex items-center justify-between px-6 lg:px-10 z-40 no-print">
          <div className="flex items-center gap-4">
              <div className="hidden lg:block w-1.5 h-8 gold-gradient rounded-full"></div>
              <h2 className="text-[10px] lg:text-xs font-black uppercase tracking-[0.4em]">
                {navItems.find(i => i.id === currentView)?.label}
              </h2>
          </div>
          <div className="flex items-center gap-3">
              <Activity size={12} className="text-emerald-500 animate-pulse" />
              <span className="text-[9px] font-black text-zinc-500 uppercase">Firebase Online</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 lg:p-10 bg-black pb-24 lg:pb-10">
          <div className="max-w-[1600px] mx-auto">
            {currentView === 'DASHBOARD' && <Dashboard loans={loans} customers={customers} />}
            {currentView === 'CUSTOMERS' && (
              <CustomerSection 
                customers={customers} 
                loans={loans}
                onAddCustomer={addCustomer} 
                onUpdateCustomer={updateCustomer}
                onDeleteCustomer={deleteCustomer}
              />
            )}
            {currentView === 'LOANS' && (
              <LoanRegistration 
                customers={customers} 
                loans={loans} 
                onSaveLoan={addLoan} 
              />
            )}
            {currentView === 'SIMULATION' && <SimulationTab customers={customers} />}
            
            {/* COMPONENTE REPORTS COM A FUNÇÃO DE ATUALIZAÇÃO */}
            {currentView === 'REPORTS' && (
              <Reports 
                loans={loans} 
                customers={customers} 
                onUpdateLoans={updateMultipleLoans} 
              />
            )}
          </div>
        </div>

        {/* Notificações */}
        <div className="fixed top-6 right-6 z-[200] flex flex-col gap-3 pointer-events-none">
          {toasts.map(toast => (
            <div key={toast.id} className={`pointer-events-auto flex items-center gap-3 px-6 py-4 rounded-2xl border bg-zinc-950 shadow-2xl ${
              toast.type === 'success' ? 'border-emerald-500/30 text-emerald-500' : 'border-red-500/30 text-red-500'
            }`}>
              <CheckCircle2 size={18} />
              <span className="text-[10px] font-black uppercase">{toast.message}</span>
              <X size={14} className="cursor-pointer" onClick={() => removeToast(toast.id)} />
            </div>
          ))}
        </div>

        {/* Mobile Nav */}
        <nav className="mobile-nav fixed bottom-0 left-0 right-0 h-20 bg-black/90 backdrop-blur-xl border-t border-zinc-800 flex items-center justify-around lg:hidden z-[100] no-print">
          {navItems.map((item) => (
            <button key={item.id} onClick={() => setCurrentView(item.id as View)} className="flex flex-col items-center flex-1">
              <div className={`p-2 rounded-xl ${currentView === item.id ? 'gold-gradient text-black' : 'text-zinc-600'}`}>
                <item.icon size={20} />
              </div>
            </button>
          ))}
        </nav>
      </main>
    </div>
  );
};

export default App;