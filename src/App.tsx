import React, { useState } from 'react';
import {
  LayoutDashboard, Users, FileText, PieChart, Calculator,
  Activity, X, Menu, Lock, LogOut, Loader2,
} from 'lucide-react';
import { FirebaseError } from 'firebase/app';

import { Customer, Loan, LoanDraft, MovementType, View } from './types';
import Dashboard from './components/Dashboard';
import CustomerSection from './components/CustomerSection';
import SimulationTab from './components/SimulationTab';
import Reports from './components/Reports';
import LoanSection from './components/LoanSection';
import { getLocalISODate } from './utils/dateTime';
import {
  effectiveLoanStatus,
  installmentAmount,
  installmentPaidAmount,
  normalizeInstallmentStatus,
} from './utils/loanCompat';
import { useAuthState } from './hooks/useAuthState';
import { useRealtimeData } from './hooks/useRealtimeData';
import { useToasts } from './hooks/useToasts';
import { useViewport } from './hooks/useViewport';
import { addCashMovement, recalculateCashBalance } from './services/cashService';
import { buildBackupPayload } from './services/backupService';
import { createCustomer, deleteCustomerAndLoans, updateCustomer } from './services/customerService';
import { createLoan, deleteLoan, updateLoan, updateLoanAndAddMovement } from './services/loanService';

const App: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [currentView, setCurrentView] = useState<View>('DASHBOARD');
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);

  const { user, authLoading, loginLoading, login, logout } = useAuthState();
  const { clientes, contratos, movimentacoes, caixa } = useRealtimeData(user);
  const { toasts, showToast, removeToast } = useToasts();
  const {
    isSidebarOpen,
    setIsSidebarOpen,
    isMobileSidebarOpen,
    setIsMobileSidebarOpen,
    isMobileViewport,
  } = useViewport();

  const movementActor = {
    uid: user?.uid,
    email: user?.email,
    displayName: user?.displayName,
  };

  const resolveMovementFallbacks = (type: MovementType): MovementType[] => {
    const normalized = String(type || '').toUpperCase() as MovementType;
    if (normalized === 'ENTRADA') return ['ENTRADA', 'APORTE'];
    if (normalized === 'SAIDA') return ['SAIDA', 'RETIRADA'];
    return [normalized];
  };

  const getFirebaseErrorCode = (error: unknown): string => {
    if (error instanceof FirebaseError) return String(error.code || '');
    if (typeof error === 'object' && error && 'code' in error) {
      const code = (error as { code?: unknown }).code;
      return typeof code === 'string' ? code : '';
    }
    return '';
  };

  const calculateLateFee = (dueDateValue: string | undefined, installmentValue: number, installmentStatus: unknown) => {
    if (!dueDateValue || normalizeInstallmentStatus(installmentStatus) === 'PAID') return 0;
    const dueDate = new Date(`${dueDateValue}T00:00:00`);
    if (Number.isNaN(dueDate.getTime())) return 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (dueDate >= today) return 0;

    const diffTime = today.getTime() - dueDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return 0;

    return Number((installmentValue * 0.015 * diffDays).toFixed(2));
  };

  const getRemainingInstallmentValue = (installment: Loan['installments'][number] | null | undefined) => {
    if (!installment || normalizeInstallmentStatus(installment.status) === 'PAID') return 0;
    const lateFee = calculateLateFee(installment.dueDate, Number(installmentAmount(installment) || 0), installment.status);
    const totalWithFee = Number((Number(installmentAmount(installment) || 0) + lateFee).toFixed(2));
    const remaining = Number((totalWithFee - Number(installmentPaidAmount(installment) || 0)).toFixed(2));
    return remaining > 0 ? remaining : 0;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(email, password);
      showToast('Acesso autorizado!', 'success');
    } catch (error: unknown) {
      showToast('E-mail ou senha incorretos', 'error');
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      showToast('Sessao encerrada', 'info');
    } catch (error: unknown) {
      showToast('Erro ao encerrar sessao', 'error');
    }
  };

  const handleUpdateLoan = async (loanId: string, payload: Partial<Loan>) => {
    try {
      await updateLoan(loanId, payload);
    } catch (error: unknown) {
      showToast('Erro ao atualizar contrato', 'error');
      throw error;
    }
  };

  const handleAddTransaction = async (type: MovementType, amount: number, description: string) => {
    const valor = Number(amount);
    const motivo = String(description ?? '').trim();

    if (!Number.isFinite(valor) || valor <= 0) {
      showToast('Valor invalido para movimentacao', 'error');
      throw new Error('VALOR_INVALIDO');
    }

    if (!motivo) {
      showToast('Informe um motivo para a movimentacao', 'error');
      throw new Error('MOTIVO_OBRIGATORIO');
    }

    try {
      const movementTypes = resolveMovementFallbacks(type);
      let lastError: unknown = null;

      for (const movementType of movementTypes) {
        try {
          await addCashMovement({
            type: movementType,
            amount: valor,
            description: motivo,
            actor: movementActor,
          });
          showToast('Caixa atualizado!', 'success');
          return;
        } catch (error) {
          lastError = error;
          const errorCode = getFirebaseErrorCode(error);
          const canRetryWithAlternativeType =
            movementTypes.length > 1 &&
            movementType !== movementTypes[movementTypes.length - 1] &&
            ['permission-denied', 'invalid-argument', 'failed-precondition'].some((code) =>
              errorCode.toLowerCase().includes(code),
            );

          if (canRetryWithAlternativeType) {
            continue;
          }

          break;
        }
      }

      throw lastError || new Error('FALHA_MOVIMENTACAO');
    } catch (error: unknown) {
      const errorCode = getFirebaseErrorCode(error);
      const detail = errorCode ? ` (${errorCode})` : '';
      showToast(`Erro no processamento do caixa${detail}`, 'error');
      throw error;
    }
  };

  const handleUpdateLoanAndAddTransaction = async (
    loanId: string,
    payload: Partial<Loan>,
    type: MovementType,
    amount: number,
    description: string,
  ) => {
    const valor = Number(amount);
    const motivo = String(description ?? '').trim();

    if (!loanId) {
      showToast('Contrato invalido para movimentacao', 'error');
      throw new Error('LOAN_ID_INVALIDO');
    }

    if (!Number.isFinite(valor) || valor <= 0) {
      showToast('Valor invalido para movimentacao', 'error');
      throw new Error('VALOR_INVALIDO');
    }

    if (!motivo) {
      showToast('Informe um motivo para a movimentacao', 'error');
      throw new Error('MOTIVO_OBRIGATORIO');
    }

    try {
      await updateLoanAndAddMovement(loanId, payload, {
        type,
        amount: valor,
        description: motivo,
        actor: movementActor,
      });
    } catch (error: unknown) {
      showToast('Erro ao processar operacao', 'error');
      throw error;
    }
  };

  const handleRecalculateCash = async () => {
    try {
      const novoSaldo = await recalculateCashBalance();
      showToast(
        `Caixa recalculado para R$ ${novoSaldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        'success',
      );
    } catch (error: unknown) {
      showToast('Erro ao recalcular o caixa', 'error');
    }
  };

  const handleAddCustomer = async (cliente: Customer) => {
    try {
      await createCustomer(cliente);
      showToast('Cliente cadastrado com sucesso!', 'success');
    } catch (error: unknown) {
      showToast('Erro ao salvar cliente', 'error');
      throw error;
    }
  };

  const handleUpdateCustomer = async (cliente: Customer) => {
    try {
      await updateCustomer(cliente);
      showToast('Cadastro atualizado!', 'info');
    } catch (error: unknown) {
      showToast('Erro ao atualizar cadastro', 'error');
      throw error;
    }
  };

  const handleDeleteCustomer = async (customerId: string) => {
    try {
      const removedLoansCount = await deleteCustomerAndLoans(customerId);
      showToast(`Cliente removido com ${removedLoansCount} contrato(s)`, 'info');
    } catch (error: unknown) {
      showToast('Erro ao remover cliente', 'error');
      throw error;
    }
  };

  const handleAddLoan = async (loanDraft: LoanDraft): Promise<string | void> => {
    try {
      const createdLoanId = await createLoan(loanDraft, movementActor);
      setCurrentView('DASHBOARD');
      showToast('Contrato efetivado!', 'success');
      return createdLoanId;
    } catch (error: unknown) {
      showToast('Erro ao salvar contrato', 'error');
      throw error;
    }
  };

  const handleDeleteLoan = async (loanId: string) => {
    try {
      await deleteLoan(loanId);
      showToast('Contrato excluido com sucesso!', 'success');
    } catch (error: unknown) {
      showToast('Erro ao excluir contrato', 'error');
      throw error;
    }
  };

  const handleDownloadBackup = async () => {
    try {
      const payload = await buildBackupPayload();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `backup-grjuros-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      showToast('Backup do banco baixado (clientes, contratos e financeiro do Firestore)!', 'success');
    } catch (error: unknown) {
      showToast('Erro ao gerar backup', 'error');
      throw error;
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-dvh bg-[#000000] flex items-center justify-center">
        <Activity size={40} className="text-[#BF953F] animate-pulse" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-dvh bg-[#000000] flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-[#050505] border border-zinc-900 p-10 rounded-[3rem] shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 gold-gradient opacity-50" />
          <div className="mb-10 text-center">
            <div className="inline-flex p-4 bg-zinc-900 rounded-2xl mb-4 border border-zinc-800">
              <Lock size={32} className="text-[#BF953F]" />
            </div>
            <h1 className="text-2xl font-black gold-text tracking-tighter">GR SULTION</h1>
            <p className="text-[9px] text-zinc-500 uppercase tracking-[0.4em] mt-2 text-center">Acesso ao Painel de Controle</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="email"
              placeholder="E-MAIL"
              required
              className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] transition-all text-xs"
              onChange={(event) => setEmail(event.target.value)}
            />
            <input
              type="password"
              placeholder="CHAVE DE ACESSO"
              required
              className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] transition-all text-xs"
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              disabled={loginLoading}
              className="w-full py-5 gold-gradient text-black rounded-2xl font-black uppercase text-[10px] tracking-widest hover:brightness-110 transition-all flex items-center justify-center gap-2"
            >
              {loginLoading ? <Loader2 className="animate-spin" size={16} /> : 'Entrar no Sistema'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const overdueLoansCount = contratos.filter((contrato) => {
    if (effectiveLoanStatus(contrato) !== 'ACTIVE') return false;
    const today = getLocalISODate();
    return (contrato.installments || []).some(
      (parcela) =>
        normalizeInstallmentStatus(parcela.status) !== 'PAID' &&
        parcela.dueDate < today &&
        getRemainingInstallmentValue(parcela) > 0,
    );
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
    <div className="flex min-h-dvh bg-[#000000] overflow-x-hidden text-white font-sans">
      <style>
        {`
          html, body, #root { background: #000000 !important; }
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
          className="fixed inset-0 z-[170] bg-[#000000]/70 backdrop-blur-[1px]"
        />
      )}

      <aside
        className={`flex flex-col bg-[#050505] border-r border-zinc-900 transition-all duration-300 ${
          isMobileViewport
            ? `fixed inset-y-0 left-0 z-[180] w-72 transform ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`
            : `relative z-[70] ${isSidebarOpen ? 'w-72' : 'w-24'}`
        }`}
      >
        <div className="h-24 flex items-center justify-between px-6 border-b border-zinc-900">
          {(isSidebarOpen || isMobileViewport) && <span className="font-black text-lg gold-text tracking-tighter">GR SULTION</span>}
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

      <main className="flex-1 min-w-0 flex flex-col overflow-hidden relative">
        <header className="h-16 md:h-20 bg-[#050505] border-b border-zinc-900 flex items-center justify-between px-3 sm:px-4 md:px-8 lg:px-10 flex-shrink-0 gap-3">
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
              {navItems.find((item) => item.id === currentView)?.label}
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

        <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#000000] p-3 sm:p-4 md:p-6">
          {currentView === 'DASHBOARD' && (
            <Dashboard
              loans={contratos}
              customers={clientes}
              cashMovements={movimentacoes}
              onNavigateToLoan={navigateToLoan}
            />
          )}
          {currentView === 'CUSTOMERS' && (
            <CustomerSection
              customers={clientes}
              loans={contratos}
              onAddCustomer={handleAddCustomer}
              onUpdateCustomer={handleUpdateCustomer}
              onDeleteCustomer={handleDeleteCustomer}
            />
          )}
          {currentView === 'LOANS' && (
            <LoanSection
              customers={clientes}
              loans={contratos}
              onAddLoan={handleAddLoan}
              onUpdateLoan={handleUpdateLoan}
              onDeleteLoan={handleDeleteLoan}
              showToast={showToast}
              initialExpandedLoanId={selectedLoanId}
              currentActor={movementActor}
              onUpdateLoanAndAddTransaction={handleUpdateLoanAndAddTransaction}
            />
          )}
          {currentView === 'SIMULATION' && <SimulationTab customers={clientes} />}
          {currentView === 'REPORTS' && (
            <Reports
              loans={contratos}
              cashMovements={movimentacoes}
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

        <div className="fixed top-3 sm:top-6 left-3 right-3 sm:left-auto sm:right-6 z-[200] flex flex-col gap-2 sm:gap-3 pointer-events-none">
          {toasts.map((toast) => (
            <div key={toast.id} className="pointer-events-auto flex items-start gap-2 sm:gap-4 px-3 sm:px-6 py-3 sm:py-4 rounded-xl sm:rounded-2xl border bg-zinc-950 border-[#BF953F]/50 text-[#BF953F] shadow-2xl animate-in slide-in-from-right">
              <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.14em] sm:tracking-widest break-words leading-snug">{toast.message}</span>
              <button type="button" onClick={() => removeToast(toast.id)} className="mt-0.5 text-[#BF953F] hover:text-white" aria-label="Fechar aviso">
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
