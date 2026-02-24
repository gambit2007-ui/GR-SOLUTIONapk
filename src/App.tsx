import React, { useState, useEffect } from "react";
import {
  LayoutDashboard, Users, FileText, PieChart, Calculator,
  Plus, ShieldCheck, Activity, ChevronLeft, ChevronRight,
  User as UserIcon, CheckCircle2, Info, AlertCircle, X,
} from "lucide-react";

import { Customer, Loan, View, AuthUser } from "./types";
import Dashboard from "./components/Dashboard";
import CustomerSection from "./components/CustomerSection";
import LoanRegistration from "./components/LoanRegistration";
import SimulationTab from "./components/SimulationTab";
import Reports from "./components/Reports";

// ✅ Firebase
import { db } from "./firebase";
import { 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  addDoc, 
  deleteDoc, 
  doc, 
  updateDoc 
} from "firebase/firestore";

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'info' | 'error';
}

const App: React.FC = () => {
  // --- ESTADO DO UTILIZADOR (Pronto para Firebase Auth) ---
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

  // --- UTILITÁRIOS: TOAST ---
  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => removeToast(id), 4000);
  };

  const removeToast = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  // --- SINCRONIZAÇÃO EM TEMPO REAL (FIRESTORE) ---

  // 1. Monitorizar Clientes
  useEffect(() => {
    const q = query(collection(db, "clientes"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Customer));
      setCustomers(list);
    }, (error) => {
      console.error("Erro Clientes:", error);
      showToast("Erro ao carregar clientes.", "error");
    });
    return () => unsub();
  }, []);

  // 2. Monitorizar Contratos (Loans) - AGORA NO FIRESTORE
  useEffect(() => {
    const q = query(collection(db, "contratos"), orderBy("startDate", "desc"));
    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Loan));
      setLoans(list);
    }, (error) => {
      console.error("Erro Contratos:", error);
      showToast("Erro ao carregar contratos.", "error");
    });
    return () => unsub();
  }, []);

  // --- OPERAÇÕES NA NUVEM (CRUD) ---

  const handleDeleteCustomer = async (id: string) => {
    if (!window.confirm('Tem certeza? Isso apagará o cliente permanentemente.')) return;
    
    try {
      await deleteDoc(doc(db, "clientes", id));
      // Dica: No Firestore, podes querer apagar os contratos vinculados também via Cloud Function ou loop manual
      showToast("Cliente removido com sucesso!");
    } catch (e) {
      showToast("Erro ao remover cliente.", "error");
    }
  };

  const handleAddLoan = async (loan: Loan) => {
    try {
      // Removemos o ID local se existir para o Firestore gerar um automático
      const { id, ...loanData } = loan;
      await addDoc(collection(db, "contratos"), {
        ...loanData,
        createdAt: Date.now()
      });
      setCurrentView('REPORTS');
      showToast('Novo contrato registado na nuvem!', 'success');
    } catch (e) {
      showToast("Erro ao guardar contrato.", "error");
    }
  };

  // --- UI COMPONENTS ---
  const navItems = [
    { id: 'DASHBOARD', label: 'Painel', icon: LayoutDashboard },
    { id: 'CUSTOMERS', label: 'Clientes', icon: Users },
    { id: 'LOANS', label: 'Contratos', icon: FileText },
    { id: 'SIMULATION', label: 'Simular', icon: Calculator },
    { id: 'REPORTS', label: 'Financeiro', icon: PieChart },
  ];

  return (
    <div className="flex h-screen bg-black overflow-hidden text-white font-sans">
      {/* Estilos Globais e Animações */}
      <style>{`
        .gold-text { background: linear-gradient(to right, #BF953F, #FCF6BA, #B38728); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .gold-gradient { background: linear-gradient(45deg, #BF953F, #FCF6BA, #B38728); }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #BF953F; border-radius: 10px; }
      `}</style>

      {/* Sidebar */}
      <aside className={`hidden lg:flex flex-col z-[70] ${isSidebarOpen ? 'w-72' : 'w-24'} bg-[#050505] border-r border-zinc-900 transition-all duration-300`}>
        <div className="h-24 flex items-center px-6 border-b border-zinc-900 shrink-0">
          <div className="flex items-center gap-4">
            <img src="https://i.ibb.co/L6WvFhH/gr-logo.jpg" alt="Logo" className="w-12 h-12 rounded-full border border-[#BF953F]/50 shadow-lg" />
            {isSidebarOpen && <span className="font-black text-lg gold-text tracking-tighter">GR SOLUTION</span>}
          </div>
        </div>

        <nav className="flex-1 py-8 px-4 space-y-2 overflow-y-auto custom-scrollbar">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setCurrentView(item.id as View)}
              className={`w-full flex items-center gap-4 px-4 py-4 rounded-2xl transition-all ${
                currentView === item.id ? 'gold-gradient text-black font-black' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/30'
              }`}
            >
              <item.icon size={22} />
              {isSidebarOpen && <span className="text-xs font-bold uppercase tracking-widest">{item.label}</span>}
            </button>
          ))}
        </nav>

        <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="h-10 border-t border-zinc-900 flex items-center justify-center text-zinc-700 hover:text-[#BF953F]">
          {isSidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>
      </aside>

      {/* Conteúdo Principal */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-20 bg-[#020202] border-b border-zinc-900 flex items-center justify-between px-10 shrink-0 z-40">
           <div className="flex items-center gap-4">
              <div className="w-1.5 h-8 gold-gradient rounded-full shadow-[0_0_10px_rgba(191,149,63,0.3)]"></div>
              <h2 className="text-xs font-black text-zinc-100 uppercase tracking-[0.3em]">
                {navItems.find(i => i.id === currentView)?.label}
              </h2>
           </div>
           
           <div className="flex items-center gap-6">
              <div className="hidden md:flex items-center gap-2 px-4 py-1.5 bg-zinc-950 border border-zinc-900 rounded-full">
                <Activity size={12} className="text-emerald-500 animate-pulse" />
                <span className="text-[9px] font-black text-zinc-500 uppercase">Cloud Sync Ativo</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right hidden sm:block">
                  <p className="text-[10px] font-black text-zinc-200 leading-none">{currentUser.name}</p>
                  <p className="text-[8px] text-[#BF953F] font-bold">ADMINISTRADOR</p>
                </div>
                <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center border border-zinc-800">
                  <UserIcon size={18} className="text-[#BF953F]" />
                </div>
              </div>
           </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 lg:p-10 bg-black pb-24">
          <div className="max-w-[1600px] mx-auto">
            {currentView === 'DASHBOARD' && <Dashboard loans={loans} customers={customers} />}
            {currentView === 'CUSTOMERS' && (
              <CustomerSection 
                customers={customers} 
                loans={loans} 
                onAddCustomer={(c) => showToast("Use o formulário para salvar no banco!")} 
                onUpdateCustomer={(c) => showToast("Atualizado!")} 
                onDeleteCustomer={handleDeleteCustomer} 
              />
            )}
            {currentView === 'LOANS' && (
              <LoanRegistration 
                customers={customers} 
                loans={loans} 
                onSaveLoan={handleAddLoan} 
              />
            )}
            {currentView === 'SIMULATION' && <SimulationTab customers={customers} />}
            {currentView === 'REPORTS' && (
              <Reports 
                loans={loans} 
                onUpdateLoans={() => {}} // Agora o Firestore atualiza automaticamente
                customers={customers} 
              />
            )}
          </div>
        </div>

        {/* Notificações Toast */}
        <div className="fixed top-6 right-6 z-[200] flex flex-col gap-3">
          {toasts.map(t => (
            <div key={t.id} className={`flex items-center gap-4 px-6 py-4 rounded-2xl border bg-zinc-950 shadow-2xl animate-in slide-in-from-right duration-300 ${t.type === 'error' ? 'border-red-500/50 text-red-500' : 'border-[#BF953F]/50 text-[#BF953F]'}`}>
              {t.type === 'success' ? <CheckCircle2 size={18} /> : t.type === 'error' ? <AlertCircle size={18} /> : <Info size={18} />}
              <span className="text-[10px] font-black uppercase tracking-widest">{t.message}</span>
              <X size={14} className="cursor-pointer opacity-50 hover:opacity-100" onClick={() => removeToast(t.id)} />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
};

export default App;
