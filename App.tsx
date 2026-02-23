import React, { useState, useEffect } from 'react';
import { db } from "./firebase"; 
import { collection, addDoc, getDocs } from "firebase/firestore";
import { 
  LayoutDashboard, 
  Users, 
  FileText, 
  PieChart,
  Calculator, 
  Plus,
  ShieldCheck,
  Activity,
  ChevronLeft,
  ChevronRight,
  User as UserIcon,
  CheckCircle2,
  Info,
  AlertCircle,
  X 
} from 'lucide-react';
import { Customer, Loan, View, AuthUser } from './types';
import Dashboard from './components/Dashboard';
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

  // Efeito para carregar dados do Firebase
  useEffect(() => {
    const fetchCustomers = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, "customers"));
        const customersData = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setCustomers(customersData as any);
      } catch (error) {
        console.error("Erro ao buscar clientes:", error);
      }
    };

    fetchCustomers();

    if (window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }
  }, []);

  const addCustomer = async (customer: Customer) => {
    try {
      await addDoc(collection(db, "customers"), customer);
      const querySnapshot = await getDocs(collection(db, "customers"));
      const customersData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setCustomers(customersData as any);
      showToast('Cliente adicionado com sucesso!');
    } catch (e) {
      showToast('Erro ao salvar no banco', 'error');
    }
  };

  const updateCustomer = (updated: Customer) => {
    setCustomers(prev => prev.map(c => c.id === updated.id ? updated : c));
    showToast('Cadastro atualizado!', 'info');
  };

  const deleteCustomer = (id: string) => {
    if (window.confirm('Tem certeza que deseja excluir este cliente?')) {
      setCustomers(prev => prev.filter(c => c.id !== id));
      setLoans(prev => prev.filter(l => l.customerId !== id));
      showToast('Cliente removido.', 'info');
    }
  };

  const addLoan = (loan: Loan) => {
    setLoans(prev => [...prev, loan]);
    setCurrentView('REPORTS');
    showToast('Novo contrato efetivado!', 'success');
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
          @media screen and (max-width: 768px) {
            input, select, textarea { font-size: 16px !important; }
          }
        `}
      </style>
      
      <aside className={`hidden lg:flex flex-col z-[70] ${isSidebarOpen ? 'w-72' : 'w-24'} bg-[#050505] border-r border-zinc-900 transition-all duration-300 no-print`}>
        <div className="h-24 flex items-center px-6 border-b border-zinc-900 overflow-hidden shrink-0">
          <div className="flex items-center gap-4 shrink-0">
            <div className="w-12 h-12 rounded-full overflow-hidden border border-[#BF953F]/50 shadow-[0_0_15px_rgba(191,149,63,0.2)]">
              <img src="https://i.ibb.co/L6WvFhH/gr-logo.jpg" alt="Logo" className="w-full h-full object-cover scale-110" />
            </div>
            {isSidebarOpen && (
              <div className="flex flex-col">
                <span className="font-black text-lg leading-none gold-text tracking-tighter">GR SULUTION</span>
                <span className="text-[7px] text-zinc-600 font-bold uppercase tracking-widest">ajudando voce e sua familia</span>
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 py-8 px-4 space-y-2 overflow-y-auto custom-scrollbar">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setCurrentView(item.id as View)}
              className={`w-full flex items-center gap-4 px-4 py-4 rounded-2xl transition-all group ${
                currentView === item.id 
                  ? 'bg-[#BF953F] text-black font-black' 
                  : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/50'
              }`}
            >
              <item.icon size={22} className="shrink-0" />
              {isSidebarOpen && <span className="text-xs font-bold uppercase tracking-widest">{item.label}</span>}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-zinc-900 space-y-4 bg-black/20 shrink-0">
          <div className={`flex items-center ${isSidebarOpen ? 'gap-3 px-2' : 'justify-center'}`}>
            <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center border border-zinc-800 shrink-0">
               <UserIcon size={18} className="text-[#BF953F]" />
            </div>
            {isSidebarOpen && (
              <div className="flex flex-col overflow-hidden">
                <span className="text-[10px] font-black text-zinc-200 uppercase tracking-tighter truncate">{currentUser.name}</span>
                <span className="text-[8px] font-bold text-zinc-600 uppercase">ADMINISTRADOR</span>
              </div>
            )}
          </div>
        </div>

        <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="h-10 border-t border-zinc-900 flex items-center justify-center text-zinc-700 hover:text-[#BF953F]">
          {isSidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden relative">
        <header className="h-16 lg:h-20 bg-[#020202] border-b border-zinc-900 flex items-center justify-between px-6 lg:px-10 shrink-0 no-print z-40 relative">
           <div className="lg:hidden absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
              <div className="w-10 h-10 rounded-full overflow-hidden border border-[#BF953F]/50 shadow-[0_0_15px_rgba(191,149,63,0.2)]">
                <img src="https://i.ibb.co/L6WvFhH/gr-logo.jpg" alt="Logo Central" className="w-full h-full object-cover scale-110" />
              </div>
           </div>

           <div className="flex items-center gap-4">
              <div className="hidden lg:block w-1.5 h-8 bg-[#BF953F] rounded-full"></div>
              <div className="flex flex-col">
                <h2 className="text-[10px] lg:text-xs font-black text-zinc-100 uppercase tracking-[0.2em]">
                  {navItems.find(item => item.id === currentView)?.label}
                </h2>
              </div>
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
            {currentView === 'REPORTS' && <Reports loans={loans} onUpdateLoans={setLoans} customers={customers} />}
          </div>
        </div>

        {/* Toasts */}
        <div className="fixed top-6 right-6 z-[200] flex flex-col gap-3 pointer-events-none">
          {toasts.map(toast => (
            <div key={toast.id} className="pointer-events-auto flex items-center gap-3 px-6 py-4 rounded-2xl border bg-zinc-950 text-white shadow-2xl">
              {toast.message}
              <button onClick={() => removeToast(toast.id)} className="ml-2"><X size={14} /></button>
            </div>
          ))}
        </div>

        {/* Mobile Nav */}
        <nav className="mobile-nav fixed bottom-0 left-0 right-0 h-20 bg-black/90 border-t border-zinc-800 flex items-center justify-around z-[100] lg:hidden">
          {navItems.map((item) => (
            <button key={item.id} onClick={() => setCurrentView(item.id as View)} className="flex flex-col items-center gap-1">
              <item.icon size={20} className={currentView === item.id ? 'text-[#BF953F]' : 'text-zinc-600'} />
              <span className="text-[8px] uppercase">{item.label}</span>
            </button>
          ))}
        </nav>
      </main>
    </div>
  );
};

export default App;
