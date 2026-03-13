import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard, Users, FileText, PieChart, Calculator,
  Activity, X, Menu, Lock, LogOut, Loader2
} from 'lucide-react';

// Firebase imports
import { db, auth } from "./firebase";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from "firebase/auth";
import {
  collection, onSnapshot, query, orderBy, addDoc,
  updateDoc, doc, setDoc, runTransaction, serverTimestamp, deleteDoc, getDocs, where, writeBatch
} from "firebase/firestore";

// Tipos e Componentes
import { Customer, Loan, View, CashMovement } from './types';
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

type MovementType = 'APORTE' | 'RETIRADA' | 'PAGAMENTO' | 'ESTORNO' | 'ENTRADA' | 'SAIDA';

const App: React.FC = () => {
  // --- ESTADOS DE AUTENTICACAO ---
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  // --- ESTADOS DA APLICACAO ---
  const [currentView, setCurrentView] = useState<View>('DASHBOARD');
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [caixa, setCaixa] = useState<number>(0);
  const [transactions, setTransactions] = useState<CashMovement[]>([]);

  // --- MONITORAMENTO DE AUTH ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(max-width: 1023px)');

    const syncViewport = () => {
      const isMobile = mediaQuery.matches;
      setIsMobileViewport(isMobile);
      if (!isMobile) setIsMobileSidebarOpen(false);
    };

    syncViewport();
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', syncViewport);
      return () => mediaQuery.removeEventListener('change', syncViewport);
    }

    mediaQuery.addListener(syncViewport);
    return () => mediaQuery.removeListener(syncViewport);
  }, []);
  // --- FUNCOES DE AUTH ---
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
    showToast("Sess\u00E3o encerrada", "info");
  };
  // --- SISTEMA DE NOTIFICACOES ---
  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  const removeToast = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));
  // --- SINCRONIZACAO EM TEMPO REAL ---
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
  // --- FUNCOES DE OPERACAO (CRUD) ---

  const handleUpdateLoan = async (loanId: string, newData: Partial<Loan>) => {
    try {
      await updateDoc(doc(db, 'loans', loanId), newData);
    } catch (e) {
      showToast("Erro ao atualizar contrato", "error");
      throw e;
    }
  };

  const handleAddTransaction = async (type: MovementType, amount: number, description: string) => {
    const valorNum = Number(amount);
    const tipo = String(type || '').toUpperCase() as MovementType;
    const motivo = String(description || '').trim();

    if (!Number.isFinite(valorNum) || valorNum <= 0) {
      showToast("Valor invalido para movimentacao", "error");
      throw new Error('VALOR_INVALIDO');
    }

    if (!motivo) {
      showToast("Informe um motivo para a movimentacao", "error");
      throw new Error('MOTIVO_OBRIGATORIO');
    }

    try {
      await runTransaction(db, async (tx) => {
        const caixaRef = doc(db, 'settings', 'caixa');
        const movimentoRef = doc(collection(db, 'cashMovement'));
        const caixaSnap = await tx.get(caixaRef);
        const saldoAtual = caixaSnap.exists() ? Number(caixaSnap.data().value) || 0 : 0;
        const isEntrada = tipo === 'APORTE' || tipo === 'PAGAMENTO' || tipo === 'ENTRADA';
        const novoSaldo = Number((saldoAtual + (isEntrada ? valorNum : -valorNum)).toFixed(2));

        tx.set(movimentoRef, {
          type: tipo,
          amount: valorNum,
          description: motivo.toUpperCase(),
          date: new Date().toISOString(),
        });

        tx.set(caixaRef, { value: novoSaldo, updatedAt: serverTimestamp() }, { merge: true });
      });

      showToast('Caixa atualizado!', 'success');
    } catch (e) {
      showToast("Erro no processamento do caixa", "error");
      throw e;
    }
  };

  const handleUpdateLoanAndAddTransaction = async (
    loanId: string,
    newData: Partial<Loan>,
    type: MovementType,
    amount: number,
    description: string,
  ) => {
    const valorNum = Number(amount);
    const tipo = String(type || '').toUpperCase() as MovementType;
    const motivo = String(description || '').trim();

    if (!loanId) {
      showToast('Contrato invalido para estorno', 'error');
      throw new Error('LOAN_ID_INVALIDO');
    }

    if (!Number.isFinite(valorNum) || valorNum <= 0) {
      showToast("Valor invalido para movimentacao", "error");
      throw new Error('VALOR_INVALIDO');
    }

    if (!motivo) {
      showToast("Informe um motivo para a movimentacao", "error");
      throw new Error('MOTIVO_OBRIGATORIO');
    }

    try {
      await runTransaction(db, async (tx) => {
        const loanRef = doc(db, 'loans', loanId);
        const caixaRef = doc(db, 'settings', 'caixa');
        const movimentoRef = doc(collection(db, 'cashMovement'));

        const loanSnap = await tx.get(loanRef);
        if (!loanSnap.exists()) throw new Error('CONTRATO_NAO_ENCONTRADO');

        const caixaSnap = await tx.get(caixaRef);
        const saldoAtual = caixaSnap.exists() ? Number(caixaSnap.data().value) || 0 : 0;
        const isEntrada = tipo === 'APORTE' || tipo === 'PAGAMENTO' || tipo === 'ENTRADA';
        const novoSaldo = Number((saldoAtual + (isEntrada ? valorNum : -valorNum)).toFixed(2));

        tx.update(loanRef, newData);
        tx.set(movimentoRef, {
          type: tipo,
          amount: valorNum,
          description: motivo.toUpperCase(),
          date: new Date().toISOString(),
          loanId,
        });
        tx.set(caixaRef, { value: novoSaldo, updatedAt: serverTimestamp() }, { merge: true });
      });
    } catch (e) {
      showToast('Erro ao estornar parcela', 'error');
      throw e;
    }
  };

  const handleRecalculateCash = async () => {
    try {
      const movementSnap = await getDocs(collection(db, 'cashMovement'));

      const saldoCalculado = movementSnap.docs.reduce((acc, movementDoc) => {
        const data: any = movementDoc.data();
        const rawAmount = Number(data.amount ?? data.value ?? 0);
        if (!Number.isFinite(rawAmount) || rawAmount === 0) return acc;

        // Compatibilidade: alguns registros antigos salvaram saidas como valor negativo.
        if (rawAmount < 0) return acc + rawAmount;

        const type = String(data.type || '').toUpperCase();
        const isEntrada = type === 'APORTE' || type === 'PAGAMENTO' || type === 'ENTRADA';
        return acc + (isEntrada ? rawAmount : -rawAmount);
      }, 0);

      const novoSaldo = Number(saldoCalculado.toFixed(2));
      await setDoc(doc(db, 'settings', 'caixa'), { value: novoSaldo, updatedAt: serverTimestamp() }, { merge: true });
      showToast(`Caixa recalculado para R$ ${novoSaldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 'success');
    } catch (e) {
      showToast('Erro ao recalcular o caixa', 'error');
    }
  };

  const handleAddCustomer = async (c: Customer) => {
    try { 
      const { id, ...data } = c;
      await addDoc(collection(db, "clientes"), { ...data, createdAt: Date.now() }); 
      showToast('Cliente cadastrado com sucesso!'); 
    } catch (e) { showToast('Erro ao salvar cliente', 'error'); }
  };

  // Correcao: funcao que estava faltando
  const handleUpdateCustomer = async (updated: Customer) => {
    try {
      const { id, ...data } = updated;
      await updateDoc(doc(db, "clientes", id), data);
      showToast('Cadastro atualizado!', 'info');
    } catch (e) { showToast('Erro ao atualizar cadastro', 'error'); }
  };

  const handleDeleteCustomer = async (id: string) => {
    if (!window.confirm("Isso excluira o cliente e todos os contratos dele. Confirma?")) return;
    try {
      const loansSnap = await getDocs(query(collection(db, "loans"), where("customerId", "==", id)));
      const loanDocs = loansSnap.docs;

      const MAX_BATCH_SIZE = 450;
      let index = 0;

      while (index < loanDocs.length) {
        const batch = writeBatch(db);
        const slice = loanDocs.slice(index, index + MAX_BATCH_SIZE);
        slice.forEach((loanDoc) => batch.delete(doc(db, "loans", loanDoc.id)));
        await batch.commit();
        index += MAX_BATCH_SIZE;
      }

      await deleteDoc(doc(db, "clientes", id));
      showToast(`Cliente removido com ${loanDocs.length} contrato(s)`, 'info');
    } catch (e) { showToast('Erro ao remover cliente', 'error'); }
  };

  const handleAddLoan = async (l: Loan): Promise<void> => {
    try {
      const { id, ...data } = l;

      await runTransaction(db, async (tx) => {
        const loanRef = doc(db, "loans", l.id);
        const caixaRef = doc(db, 'settings', 'caixa');
        const movimentoRef = doc(collection(db, 'cashMovement'));

        const caixaSnap = await tx.get(caixaRef);
        const saldoAtual = caixaSnap.exists() ? Number(caixaSnap.data().value) || 0 : 0;
        const novoSaldo = Number((saldoAtual - Number(l.amount || 0)).toFixed(2));

        tx.set(loanRef, { ...data, createdAt: serverTimestamp() });
        tx.set(movimentoRef, {
          type: 'RETIRADA',
          amount: Number(l.amount || 0),
          description: `EMPRESTIMO: ${l.customerName}`,
          date: new Date().toISOString(),
          loanId: l.id,
        });
        tx.set(caixaRef, { value: novoSaldo, updatedAt: serverTimestamp() }, { merge: true });
      });

      setCurrentView('DASHBOARD');
      showToast('Contrato efetivado!');
    } catch (e) {
      showToast('Erro ao salvar contrato', 'error');
      throw e;
    }
  };

  const handleDeleteLoan = async (loanId: string) => {
    try {
      await deleteDoc(doc(db, 'loans', loanId));
      showToast('Contrato excluido com sucesso!', 'success');
    } catch (e) {
      showToast('Erro ao excluir contrato', 'error');
      throw e;
    }
  };

  const handleDownloadBackup = async () => {
    try {
      const [customersSnap, loansSnap, movementsSnap, caixaSnap] = await Promise.all([
        getDocs(collection(db, 'clientes')),
        getDocs(collection(db, 'loans')),
        getDocs(collection(db, 'cashMovement')),
        getDocs(query(collection(db, 'settings'))),
      ]);

      const payload = {
        generatedAt: new Date().toISOString(),
        customers: customersSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        loans: loansSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        cashMovement: movementsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        settings: caixaSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `backup-grjuros-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      showToast('Backup completo baixado (clientes, contratos e financeiro)!', 'success');
    } catch {
      showToast('Erro ao gerar backup', 'error');
    }
  };

  // --- COMPONENTES DE TELA ---

  if (authLoading) {
    return (
      <div className="min-h-dvh bg-[#071226] flex items-center justify-center">
        <Activity size={40} className="text-[#BF953F] animate-pulse" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-dvh bg-[#071226] flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-[#0b1730] border border-zinc-900 p-10 rounded-[3rem] shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 gold-gradient opacity-50" />
          <div className="mb-10 text-center">
            <div className="inline-flex p-4 bg-zinc-900 rounded-2xl mb-4 border border-zinc-800">
              <Lock size={32} className="text-[#BF953F]" />
            </div>
            <h1 className="text-2xl font-black gold-text tracking-tighter">GESTAO DE EMPRESTIMOS</h1>
            <p className="text-[9px] text-zinc-500 uppercase tracking-[0.4em] mt-2 text-center">Acesso ao Painel de Controle</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <input 
              type="email" placeholder="E-MAIL" required
              className="w-full bg-[#071226] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] transition-all text-xs"
              onChange={e => setEmail(e.target.value)}
            />
            <input 
              type="password" placeholder="CHAVE DE ACESSO" required
              className="w-full bg-[#071226] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] transition-all text-xs"
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

  const overdueLoansCount = loans.filter((loan) => {
    const saldoDevedor = Number(loan.totalToReturn || 0) - Number(loan.paidAmount || 0);
    if (saldoDevedor <= 0.5) return false;

    const today = new Date().toISOString().split('T')[0];
    return (loan.installments || []).some((inst) => inst.status !== 'PAGO' && inst.dueDate < today);
  }).length;

  const navItems = [
    { id: 'DASHBOARD', label: 'Painel', icon: LayoutDashboard },
    { id: 'CUSTOMERS', label: 'Clientes', icon: Users },
    { id: 'LOANS', label: 'Contratos', icon: FileText, badge: overdueLoansCount > 0 ? overdueLoansCount : null },
    { id: 'SIMULATION', label: 'Simular', icon: Calculator },
    { id: 'REPORTS', label: 'Financeiro', icon: PieChart },
  ];

  const handleSelectView = (view: View) => {
    setCurrentView(view);
    if (view !== 'LOANS') setSelectedLoanId(null);
    if (isMobileViewport) {
      setIsMobileSidebarOpen(false);
    }
  };

  const navigateToLoan = (loanId: string) => {
    setSelectedLoanId(loanId);
    setCurrentView('LOANS');
  };

  return (
    <div className="flex min-h-dvh bg-[#071226] overflow-x-hidden text-white font-sans">
      <style>
        {`
          .gold-text { background: linear-gradient(to right, #BF953F, #FCF6BA, #B38728); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
          .gold-gradient { background: linear-gradient(45deg, #BF953F, #FCF6BA, #B38728); }
          .custom-scrollbar::-webkit-scrollbar { width: 4px; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: #BF953F; border-radius: 10px; }
        `}
      </style>

      {isMobileViewport && isMobileSidebarOpen && (
        <button
          type="button"
          onClick={() => setIsMobileSidebarOpen(false)}
          aria-label="Fechar menu"
          className="fixed inset-0 z-[170] bg-[#071226]/70 backdrop-blur-[1px]"
        />
      )}

      {/* SIDEBAR */}
      <aside
        className={`flex flex-col bg-[#0b1730] border-r border-zinc-900 transition-all duration-300 ${
          isMobileViewport
            ? `fixed inset-y-0 left-0 z-[180] w-72 transform ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`
            : `relative z-[70] ${isSidebarOpen ? 'w-72' : 'w-24'}`
        }`}
      >
        <div className="h-24 flex items-center justify-between px-6 border-b border-zinc-900">
          {(isSidebarOpen || isMobileViewport) && <span className="font-black text-lg gold-text tracking-tighter">GESTAO DE EMPRESTIMOS</span>}
          <button
            onClick={() => {
              if (isMobileViewport) {
                setIsMobileSidebarOpen(false);
                return;
              }
              setIsSidebarOpen(!isSidebarOpen);
            }}
            className="p-2 hover:bg-zinc-900 rounded-xl transition-colors"
          >
            {isMobileViewport ? <X size={20} className="text-[#BF953F]" /> : <Menu size={20} className="text-[#BF953F]" />}
          </button>
        </div>
        <nav className="flex-1 py-8 px-4 space-y-2 overflow-y-auto">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleSelectView(item.id as View)}
              className={`w-full flex items-center gap-4 px-4 py-4 rounded-2xl transition-all relative ${
                currentView === item.id ? 'gold-gradient text-black font-black' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/50'
              }`}
            >
              <item.icon size={22} />
              {(isSidebarOpen || isMobileViewport) && (
                <div className="flex-1 flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest">{item.label}</span>
                  {item.badge && (
                    <span className="bg-red-500 text-white text-[8px] font-black px-2 py-0.5 rounded-full animate-pulse">
                      {item.badge}
                    </span>
                  )}
                </div>
              )}
              {!(isSidebarOpen || isMobileViewport) && item.badge && (
                <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              )}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-zinc-900">
          <button onClick={handleLogout} className="w-full flex items-center gap-4 px-4 py-4 rounded-2xl text-red-500 hover:bg-red-500/10 transition-all">
            <LogOut size={22} />
            {(isSidebarOpen || isMobileViewport) && <span className="text-[10px] font-black uppercase tracking-widest">Sair</span>}
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden relative">
        <header className="h-16 md:h-20 bg-[#08152b] border-b border-zinc-900 flex items-center justify-between px-3 sm:px-4 md:px-8 lg:px-10 flex-shrink-0 gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => setIsMobileSidebarOpen(true)}
                className="lg:hidden p-2 hover:bg-zinc-900 rounded-xl transition-colors"
                aria-label="Abrir menu"
              >
                <Menu size={18} className="text-[#BF953F]" />
              </button>
              <h2 className="text-[10px] sm:text-xs font-black text-zinc-100 uppercase tracking-[0.22em] truncate">
                {navItems.find(item => item.id === currentView)?.label}
              </h2>
            </div>
            <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                <div className="flex items-center gap-2 px-2.5 sm:px-4 py-1.5 bg-zinc-950 border border-zinc-900 rounded-full max-w-[72vw] sm:max-w-none">
                  <Activity size={12} className="text-emerald-500 animate-pulse shrink-0" />
                  <span className="text-[8px] sm:text-[9px] font-black text-zinc-500 uppercase truncate">
                    <span className="hidden sm:inline">Conectado: </span>{user?.email}
                  </span>
                </div>
            </div>
        </header>

        <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#071226] p-3 sm:p-4 md:p-6">
            {currentView === 'DASHBOARD' && (
              <Dashboard
                loans={loans}
                customers={customers}
                cashMovements={transactions}
                onNavigateToLoan={navigateToLoan}
              />
            )}
            {currentView === 'CUSTOMERS' && (
              <CustomerSection
                customers={customers} loans={loans}
                onAddCustomer={handleAddCustomer} onUpdateCustomer={handleUpdateCustomer} onDeleteCustomer={handleDeleteCustomer}
              />
            )}
            {currentView === 'LOANS' && (
              <LoanSection
                customers={customers}
                loans={loans}
                onAddLoan={handleAddLoan}
                onUpdateLoan={handleUpdateLoan}
                onDeleteLoan={handleDeleteLoan}
                showToast={showToast}
                initialExpandedLoanId={selectedLoanId}
                onUpdateLoanAndAddTransaction={handleUpdateLoanAndAddTransaction}
              />
            )}
            {currentView === 'SIMULATION' && <SimulationTab customers={customers} />}
            {currentView === 'REPORTS' && (
              <Reports
                loans={loans} cashMovements={transactions}
                caixa={caixa}
                onAddTransaction={handleAddTransaction}
                onUpdateLoan={handleUpdateLoan}
                onUpdateLoanAndAddTransaction={handleUpdateLoanAndAddTransaction}
                onRecalculateCash={handleRecalculateCash}
                onDownloadBackup={handleDownloadBackup}
                showToast={showToast}
              />
            )}
        </div>

        {/* TOASTS */}
        <div className="fixed top-3 sm:top-6 left-3 right-3 sm:left-auto sm:right-6 z-[200] flex flex-col gap-2 sm:gap-3 pointer-events-none">
          {toasts.map(t => (
            <div key={t.id} className="pointer-events-auto flex items-start gap-2 sm:gap-4 px-3 sm:px-6 py-3 sm:py-4 rounded-xl sm:rounded-2xl border bg-zinc-950 border-[#BF953F]/50 text-[#BF953F] shadow-2xl animate-in slide-in-from-right">
              <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.14em] sm:tracking-widest break-words leading-snug">{t.message}</span>
              <button type="button" onClick={() => removeToast(t.id)} className="mt-0.5 text-[#BF953F] hover:text-white" aria-label="Fechar aviso">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
};

export default App;
