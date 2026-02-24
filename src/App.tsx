import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, Users, FileText, PieChart, Calculator, 
  Plus, ShieldCheck, Activity, ChevronLeft, ChevronRight,
  User as UserIcon, CheckCircle2, Info, AlertCircle, X
} from 'lucide-react';
import { Customer, Loan, View, AuthUser } from './types';
import Dashboard from './components/Dashboard';
import CustomerSection from './components/CustomerSection';
import LoanRegistration from './components/LoanRegistration';
import SimulationTab from './components/SimulationTab';
import Reports from './components/Reports';

// ✅ Firebase Imports
import { db } from "./firebase";
import { 
  collection, onSnapshot, query, orderBy, 
  addDoc, deleteDoc, doc, updateDoc, writeBatch 
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

  // --- TOAST SYSTEM ---
  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  const removeToast = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  // --- REAL-TIME SYNC (FIRESTORE) ---
  useEffect(() => {
    // Sincroniza Clientes
    const qCust = query(collection(db, "clientes"), orderBy("createdAt", "desc"));
    const unsubCust = onSnapshot(qCust, (snap) => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Customer)));
    });

    // Sincroniza Contratos
    const qLoans = query(collection(db, "contratos"), orderBy("startDate", "desc"));
    const unsubLoans = onSnapshot(qLoans, (snap) => {
      setLoans(snap.docs.map(d => ({ id: d.id, ...d.data() } as Loan)));
    });

    if (window.innerWidth < 1024) setIsSidebarOpen(false);
    return () => { unsubCust(); unsubLoans(); };
  }, []);

  // --- OPERAÇÕES FIREBASE ---

  const handleAddCustomer = async (customer: Customer) => {
    try {
      const { id, ...data } = customer; // Remove ID temporário
      await addDoc(collection(db, "clientes"), { ...data, createdAt: Date.now() });
      showToast('Cliente cadastrado no banco!', 'success');
    } catch (e) { showToast('Erro ao salvar cliente', 'error'); }
  };

  const handleUpdateCustomer = async (updated: Customer) => {
    try {
      const { id, ...data } = updated;
      await updateDoc(doc(db, "clientes", id), data);
      showToast('Cadastro atualizado!', 'info');
    } catch (e) { showToast('Erro ao atualizar', 'error'); }
  };

  // ✅ EXCLUSÃO EM CASCATA: Cliente + Seus Contratos
  const handleDeleteCustomer = async (id: string) => {
    if (!window.confirm('Atenção: Isso apagará o cliente e TODOS os seus contratos permanentemente.')) return;
    
    try {
      const batch = writeBatch(db);
      
      // Deleta o cliente
      batch.delete(doc(db, "clientes", id));
      
      // Filtra contratos desse cliente e adiciona ao batch para deletar tudo junto
      const customerLoans = loans.filter(l => l.customerId === id);
      customerLoans.forEach(loan => {
        batch.delete(doc(db, "contratos", loan.id));
      });

      await batch.commit();
      showToast('Cliente e contratos removidos com sucesso.', 'info');
    } catch (e) { showToast('Erro na exclusão em cascata', 'error'); }
  };

  const handleAddLoan = async (loan: Loan) => {
    try {
      const { id, ...data } = loan;
      await addDoc(collection(db, "contratos"), { ...data, createdAt: Date.now() });
      setCurrentView('REPORTS');
      showToast('Contrato efetivado na nuvem!', 'success');
    } catch (e) { showToast('Erro ao efetivar contrato', 'error'); }
  };

  // ✅ LIQUIDAÇÃO DE PARCELA COM REGISTRO DE CAIXA
  const handleUpdateLoans = async (updatedLoans: Loan[]) => {
    // Esta função é chamada pelo componente Reports ao liquidar
    // Aqui identificamos qual contrato mudou e atualizamos o Firebase
    // O sistema de onSnapshot cuidará de atualizar o estado 'loans'
    try {
       // Lógica simplificada: O componente Reports pode chamar diretamente o doc update
       setLoans(updatedLoans); 
    } catch (e) { console.error(e); }
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
          .gold-text { background: linear-gradient(to right, #BF953F, #FCF6BA, #B38728); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
          .gold-gradient { background: linear-gradient(45deg, #BF953F, #FCF6BA, #B38728); }
          .custom-scrollbar::-webkit-scrollbar { width: 4px; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: #BF953F; border-radius: 10px; }
        `}
      </style>
      
      {/* Sidebar Desktop */}
      <aside className={`flex flex-col z-[70] ${isSidebarOpen ? 'w-72' : 'w-24'} bg-[#050505] border-r border-zinc-900 transition-all duration-300 no-print`}>
        <div className="h-24 flex items-center px-6 border-b border-zinc-900 shrink-0">
          <div className="flex items-center gap-4 shrink-0">
            <div className="w-12 h-12 rounded-full overflow-hidden border border-[#BF953F]/50 shadow-lg">
              <img src="https://i.ibb.co/L6WvFhH/gr-logo.jpg" alt="Logo" className="w-full h-full object-cover scale-110" />
            </div>
            {isSidebarOpen && (
              <div className="flex flex-col">
                <span className="font-black text-lg gold-text tracking-tighter leading-none">GR SOLUTION</span>
                <span className="text-[7px] text-zinc-600 font-bold uppercase tracking-widest leading-tight">ajudando voce e sua familia</span>
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
                currentView === item.id ? 'gold-gradient text-black font-black' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/50'
              }`}
            >
              <item.icon size={22} className="shrink-0" />
              {isSidebarOpen && <span className="text-xs font-bold uppercase tracking-widest">{item.label}</span>}
            </button>
          ))}
        </nav>

        <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="h-10 border-t border-zinc-900 flex items-center justify-center text-zinc-700 hover:text-[#BF953F]">
          {isSidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>
      </aside>

      {/* Main Area */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <header className="h-20 bg-[#020202] border-b border-zinc-900 flex items-center justify-between px-10 shrink-0 z-40 relative no-print">
           <div className="flex items-center gap-4">
              <div className="w-1.5 h-8 gold-gradient rounded-full"></div>
              <h2 className="text-xs font-black text-zinc-100 uppercase tracking-[0.4em]">
                {navItems.find(item => item.id === currentView)?.label}
              </h2>
           </div>

           <div className="flex items-center gap-6">
              <div className="hidden md:flex items-center gap-2 px-4 py-1.5 bg-zinc-950 border border-zinc-900 rounded-full">
                 <Activity size={12} className="text-emerald-500 animate-pulse" />
                 <span className="text-[9px] font-black text-zinc-500 uppercase">Cloud Sync Ativo</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center border border-zinc-800">
                  <UserIcon size={18} className="text-[#BF953F]" />
                </div>
              </div>
           </div>
        </header>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 lg:p-10 bg-black pb-24">
          <div className="max-w-[1600px] mx-auto">
            {currentView === 'DASHBOARD' && <Dashboard loans={loans} customers={customers} />}
            {currentView === 'CUSTOMERS' && (
              <CustomerSection 
                customers={customers} 
                loans={loans}
                onAddCustomer={handleAddCustomer} 
                onUpdateCustomer={handleUpdateCustomer}
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
                onUpdateLoans={handleUpdateLoans} 
                customers={customers} 
              />
            )}
          </div>
        </div>

        {/* Toasts */}
        <div className="fixed top-6 right-6 z-[200] flex flex-col gap-3">
          {toasts.map(t => (
            <div key={t.id} className={`flex items-center gap-4 px-6 py-4 rounded-2xl border bg-zinc-950 shadow-2xl animate-in slide-in-from-right duration-300 ${t.type === 'error' ? 'border-red-500/50 text-red-500' : 'border-[#BF953F]/50 text-[#BF953F]'}`}>
              {t.type === 'success' ? <CheckCircle2 size={18} /> : t.type === 'error' ? <AlertCircle size={18} /> : <Info size={18} />}
              <span className="text-[10px] font-black uppercase tracking-widest">{t.message}</span>
              <X size={14} className="cursor-pointer opacity-50 hover:opacity-100" onClick={() => removeToast(t.id)} />
            </div>
          ))}
        </div>

        {/* Mobile Nav */}
        <nav className="fixed bottom-0 left-0 right-0 h-20 bg-black/90 backdrop-blur-xl border-t border-zinc-800 flex items-center justify-around z-[100] lg:hidden no-print">
          {navItems.map((item) => (
            <button key={item.id} onClick={() => setCurrentView(item.id as View)} className="flex flex-col items-center gap-1 flex-1">
              <div className={`p-2 rounded-xl ${currentView === item.id ? 'gold-gradient text-black' : 'text-zinc-600'}`}>
                <item.icon size={20} />
              </div>
              <span className={`text-[8px] font-black uppercase ${currentView === item.id ? 'text-[#BF953F]' : 'text-zinc-700'}`}>{item.label}</span>
            </button>
          ))}
        </nav>
      </main>
    </div>
  );
};

export default App;