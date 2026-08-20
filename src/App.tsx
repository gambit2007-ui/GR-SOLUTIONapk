import React, { Suspense, lazy, useCallback, useState } from 'react';
import {
  LayoutDashboard, Users, FileText, PieChart, Calculator,
  Activity, X, Menu, Lock, LogOut, Loader2, ShieldCheck,
} from 'lucide-react';
import { FirebaseError } from 'firebase/app';

import {
  CashOutflowCategory,
  CreatedLoanResult,
  Customer,
  Loan,
  LoanDraft,
  LoanPaymentRequest,
  LoanPaymentReversalRequest,
  MovementType,
  View,
} from './types';
import { getLocalISODate } from './utils/dateTime';
import { getInstallmentOutstanding } from './utils/financialEngine';
import {
  effectiveLoanStatus,
  normalizeInstallmentStatus,
} from './utils/loanCompat';
import { useAuthState } from './hooks/useAuthState';
import { useRealtimeData } from './hooks/useRealtimeData';
import { useToasts } from './hooks/useToasts';
import { useViewport } from './hooks/useViewport';
import { useAccessControlState } from './hooks/useAccessControlState';
import { usePaginatedCustomers, usePaginatedLoans } from './hooks/usePaginatedData';
import { addCashMovement, recalculateCashBalance } from './services/cashService';
import { archiveCustomer, createCustomer, updateCustomer } from './services/customerService';
import {
  applyLoanPayment,
  cancelLoan,
  createLoan,
  reverseLoanPayment,
  updateLoan,
  updateLoanAndAddMovement,
} from './services/loanService';
import { enableAccessControlForCurrentUser } from './services/accessControlService';
import { reportOperationalError } from './services/operationalLoggingService';

const Dashboard = lazy(() => import('./components/Dashboard'));
const CustomerSection = lazy(() => import('./components/CustomerSection'));
const SimulationTab = lazy(() => import('./components/SimulationTab'));
const Reports = lazy(() => import('./components/Reports'));
const LoanSection = lazy(() => import('./components/LoanSection'));

const ViewLoadingFallback: React.FC = () => (
  <div className="min-h-[240px] flex items-center justify-center">
    <div className="flex items-center gap-3 px-5 py-4 bg-[#050505] border border-zinc-900 rounded-2xl">
      <Loader2 size={18} className="text-[#BF953F] animate-spin" />
      <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
        Carregando modulo...
      </span>
    </div>
  </div>
);

const App: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [currentView, setCurrentView] = useState<View>('DASHBOARD');
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);
  const [isEnablingAccessControl, setIsEnablingAccessControl] = useState(false);
  const shouldLoadCustomers = currentView === 'LOANS';
  const shouldLoadLoans = currentView !== 'SIMULATION' && currentView !== 'LOANS';
  const shouldLoadCashMovements = currentView === 'DASHBOARD' || currentView === 'REPORTS';
  const shouldLoadMonthlySnapshots = currentView === 'REPORTS';

  const { user, authLoading, loginLoading, login, logout } = useAuthState();
  const accessControl = useAccessControlState(user);
  const { toasts, showToast, removeToast } = useToasts();
  const handleRealtimeError = useCallback((message: string) => {
    showToast(message, 'error');
  }, [showToast]);
  const activeDataUser = accessControl.authorized ? user : null;
  const {
    clientes: realtimeCustomers,
    contratos: realtimeLoans,
    movimentacoes,
    monthlySnapshots,
    feeSettings,
    caixa,
    isCustomersLoading: isRealtimeCustomersLoading,
  } = useRealtimeData(activeDataUser, {
    loadCustomers: shouldLoadCustomers,
    loadLoans: shouldLoadLoans,
    loadCashMovements: shouldLoadCashMovements,
    loadMonthlySnapshots: shouldLoadMonthlySnapshots,
    onError: handleRealtimeError,
  });
  const paginatedCustomers = usePaginatedCustomers(
    activeDataUser,
    currentView === 'CUSTOMERS',
    handleRealtimeError,
  );
  const paginatedLoans = usePaginatedLoans(
    activeDataUser,
    currentView === 'LOANS',
    selectedLoanId,
    handleRealtimeError,
  );
  const clientes = currentView === 'CUSTOMERS' ? paginatedCustomers.items : realtimeCustomers;
  const contratos = currentView === 'LOANS' ? paginatedLoans.items : realtimeLoans;
  const isCustomersLoading = currentView === 'CUSTOMERS'
    ? paginatedCustomers.loading
    : isRealtimeCustomersLoading;
  const dailyLateFeeRate = feeSettings.dailyLateFeeRate;
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

  const getRemainingInstallmentValue = (installment: Loan['installments'][number] | null | undefined) => {
    return getInstallmentOutstanding(installment, new Date(), dailyLateFeeRate).total;
  };
  const reportAppError = (source: string, error: unknown) => {
    void reportOperationalError(source, error, movementActor);
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
      await updateLoan(loanId, payload, movementActor);
    } catch (error: unknown) {
      reportAppError('loan.update', error);
      showToast('Erro ao atualizar contrato', 'error');
      throw error;
    }
  };

  const handleAddTransaction = async (
    type: MovementType,
    amount: number,
    description: string,
    category?: CashOutflowCategory,
  ) => {
    const valor = Number(amount);
    const motivo = String(description ?? '').trim();
    const normalizedType = String(type || '').toUpperCase() as MovementType;

    if (!Number.isFinite(valor) || valor <= 0) {
      showToast('Valor invalido para movimentacao', 'error');
      throw new Error('VALOR_INVALIDO');
    }

    if (!motivo) {
      showToast('Informe um motivo para a movimentacao', 'error');
      throw new Error('MOTIVO_OBRIGATORIO');
    }

    if (normalizedType === 'SAIDA' && !category) {
      showToast('Selecione a categoria da saida', 'error');
      throw new Error('CATEGORIA_SAIDA_OBRIGATORIA');
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
            category: movementType === 'SAIDA' ? category : undefined,
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
      reportAppError('cash.movement.create', error);
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
      const currentLoan = contratos.find((loan) => loan.id === loanId);
      const operationSource = JSON.stringify([loanId, type, valor, motivo, payload]);
      let operationHash = 2166136261;
      for (let index = 0; index < operationSource.length; index += 1) {
        operationHash ^= operationSource.charCodeAt(index);
        operationHash = Math.imul(operationHash, 16777619);
      }
      await updateLoanAndAddMovement(loanId, payload, {
        type,
        amount: valor,
        description: motivo,
        actor: movementActor,
        operationId: `loan-operation-${(operationHash >>> 0).toString(36)}`,
        expectedVersion: Math.max(0, Math.trunc(Number(currentLoan?.version || 0))),
      });
    } catch (error: unknown) {
      reportAppError('loan.operation', error);
      showToast('Erro ao processar operacao', 'error');
      throw error;
    }
  };

  const handleEnableAccessControl = async () => {
    if (!user || isEnablingAccessControl) return;
    if (!window.confirm('Ativar acesso restrito? A conta atual sera registrada como administradora.')) return;
    setIsEnablingAccessControl(true);
    try {
      await enableAccessControlForCurrentUser(user.uid);
      showToast('Protecao de acesso ativada', 'success');
    } catch (error) {
      console.error('Falha ao ativar protecao de acesso:', error);
      showToast('Nao foi possivel ativar a protecao de acesso', 'error');
    } finally {
      setIsEnablingAccessControl(false);
    }
  };

  const handleApplyLoanPayment = async (loanId: string, request: LoanPaymentRequest) => {
    try {
      return await applyLoanPayment(loanId, request, movementActor);
    } catch (error: unknown) {
      reportAppError('loan.payment', error);
      showToast('Erro ao processar pagamento', 'error');
      throw error;
    }
  };

  const handleRecalculateCash = async () => {
    try {
      if (!window.confirm('Recalcular o saldo usando exclusivamente o livro de movimentacoes?')) return;
      const novoSaldo = await recalculateCashBalance(movementActor);
      showToast(
        `Caixa recalculado para R$ ${novoSaldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        'success',
      );
    } catch (error: unknown) {
      reportAppError('cash.recalculate', error);
      showToast('Erro ao recalcular o caixa', 'error');
    }
  };

  const handleAddCustomer = async (cliente: Customer) => {
    try {
      await createCustomer(cliente);
      showToast('Cliente cadastrado com sucesso!', 'success');
    } catch (error: unknown) {
      reportAppError('customer.create', error);
      showToast('Erro ao salvar cliente', 'error');
      throw error;
    }
  };

  const handleUpdateCustomer = async (cliente: Customer) => {
    try {
      await updateCustomer(cliente);
      showToast('Cadastro atualizado!', 'info');
    } catch (error: unknown) {
      reportAppError('customer.update', error);
      showToast('Erro ao atualizar cadastro', 'error');
      throw error;
    }
  };

  const handleDeleteCustomer = async (customerId: string) => {
    try {
      await archiveCustomer(customerId, movementActor);
      showToast('Cliente arquivado com historico preservado', 'info');
    } catch (error: unknown) {
      reportAppError('customer.archive', error);
      const message = error instanceof Error && error.message === 'CLIENTE_POSSUI_CONTRATOS'
        ? 'Cliente possui contratos e nao pode ser excluido. Cancele os contratos se necessario.'
        : 'Erro ao remover cliente';
      showToast(message, 'error');
      throw error;
    }
  };

  const handleAddLoan = async (loanDraft: LoanDraft): Promise<CreatedLoanResult> => {
    try {
      const createdLoanId = await createLoan(loanDraft, movementActor);
      setCurrentView('DASHBOARD');
      showToast('Contrato efetivado!', 'success');
      return createdLoanId;
    } catch (error: unknown) {
      reportAppError('loan.create', error);
      showToast('Erro ao salvar contrato', 'error');
      throw error;
    }
  };

  const handleCancelLoan = async (loanId: string, reason: string) => {
    try {
      await cancelLoan(loanId, movementActor, reason);
      showToast('Contrato cancelado com historico preservado!', 'success');
    } catch (error: unknown) {
      reportAppError('loan.cancel', error);
      showToast('Erro ao cancelar contrato', 'error');
      throw error;
    }
  };

  const handleReverseLoanPayment = async (loanId: string, request: LoanPaymentReversalRequest) => {
    try {
      return await reverseLoanPayment(loanId, request, movementActor);
    } catch (error: unknown) {
      reportAppError('loan.payment.reverse', error);
      showToast('Erro ao estornar pagamento', 'error');
      throw error;
    }
  };

  const handleDownloadBackup = async () => {
    try {
      const { buildBackupPayload, validateBackupPayload } = await import('./services/backupService');
      const payload = await buildBackupPayload();
      if (!(await validateBackupPayload(payload))) {
        throw new Error('BACKUP_INTEGRITY_CHECK_FAILED');
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `backup-grjuros-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      if (payload.assetSummary.failedAssets > 0) {
        showToast(
          `Backup baixado com ${payload.assetSummary.failedAssets} anexo(s) nao incorporado(s).`,
          'info',
        );
      } else {
        showToast('Backup completo baixado com clientes, contratos, financeiro e anexos!', 'success');
      }
    } catch (error: unknown) {
      reportAppError('backup.generate', error);
      showToast('Erro ao gerar backup', 'error');
      throw error;
    }
  };

  const renderCurrentView = () => {
    switch (currentView) {
      case 'DASHBOARD':
        return (
          <Dashboard
            loans={contratos}
            cashMovements={movimentacoes}
            dailyLateFeeRate={dailyLateFeeRate}
            onNavigateToLoan={navigateToLoan}
          />
        );
      case 'CUSTOMERS':
        return (
          <CustomerSection
            customers={clientes}
            loans={contratos}
            isLoadingCustomers={isCustomersLoading}
            totalCustomers={paginatedCustomers.total}
            hasMoreCustomers={paginatedCustomers.hasMore}
            onLoadMoreCustomers={() => { void paginatedCustomers.loadMore(); }}
            dailyLateFeeRate={dailyLateFeeRate}
            onAddCustomer={handleAddCustomer}
            onUpdateCustomer={handleUpdateCustomer}
            onDeleteCustomer={handleDeleteCustomer}
          />
        );
      case 'LOANS':
        return (
          <LoanSection
            customers={clientes}
            loans={contratos}
            isLoadingCustomers={isCustomersLoading}
            totalLoans={paginatedLoans.total}
            hasMoreLoans={paginatedLoans.hasMore}
            onLoadMoreLoans={() => { void paginatedLoans.loadMore(); }}
            onAddLoan={handleAddLoan}
            onUpdateLoan={handleUpdateLoan}
            onCancelLoan={handleCancelLoan}
            showToast={showToast}
            initialExpandedLoanId={selectedLoanId}
            currentActor={movementActor}
            dailyLateFeeRate={dailyLateFeeRate}
            onUpdateLoanAndAddTransaction={handleUpdateLoanAndAddTransaction}
            onApplyLoanPayment={handleApplyLoanPayment}
            onReverseLoanPayment={handleReverseLoanPayment}
          />
        );
      case 'SIMULATION':
        return <SimulationTab />;
      case 'REPORTS':
        return (
          <Reports
            loans={contratos}
            cashMovements={movimentacoes}
            monthlySnapshots={monthlySnapshots}
            caixa={caixa}
            currentUserUid={user?.uid}
            dailyLateFeeRate={dailyLateFeeRate}
            onAddTransaction={handleAddTransaction}
            onRecalculateCash={handleRecalculateCash}
            onDownloadBackup={handleDownloadBackup}
            showToast={showToast}
          />
        );
      default:
        return null;
    }
  };

  if (authLoading || (user && accessControl.loading)) {
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
            <h1 className="text-2xl font-black gold-text tracking-tighter">GR SOLUTION</h1>
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

  if (!accessControl.authorized) {
    return (
      <div className="min-h-dvh bg-black flex items-center justify-center p-6 text-white">
        <div className="w-full max-w-md bg-[#050505] border border-red-500/30 rounded-[2rem] p-8 text-center">
          <Lock size={32} className="mx-auto text-red-500" />
          <h1 className="mt-5 text-lg font-black uppercase tracking-widest">Acesso nao autorizado</h1>
          <p className="mt-3 text-[10px] text-zinc-500 uppercase tracking-wider leading-relaxed">
            Esta conta nao possui permissao para consultar os dados do sistema.
          </p>
          <button onClick={handleLogout} className="mt-6 px-5 py-3 border border-zinc-800 rounded-xl text-[9px] font-black uppercase tracking-widest text-zinc-300">
            Sair
          </button>
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
    {
      id: 'LOANS',
      label: 'Contratos',
      icon: FileText,
      badge: currentView !== 'LOANS' && overdueLoansCount > 0 ? overdueLoansCount : null,
    },
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
          {(isSidebarOpen || isMobileViewport) && <span className="font-black text-lg gold-text tracking-tighter">GR SOLUTION</span>}
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

        {!accessControl.enforced && (
          <div className="mx-3 sm:mx-4 md:mx-6 mt-3 px-4 py-3 rounded-2xl border border-[#BF953F]/30 bg-[#BF953F]/5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-3">
              <ShieldCheck size={17} className="text-[#BF953F] shrink-0" />
              <div>
                <p className="text-[9px] font-black text-[#F5D77B] uppercase tracking-widest">Protecao de acesso pendente</p>
                <p className="mt-1 text-[8px] text-zinc-500 uppercase tracking-wider">Ative para permitir somente usuarios cadastrados.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => { void handleEnableAccessControl(); }}
              disabled={isEnablingAccessControl}
              className="px-4 py-2.5 rounded-xl bg-[#BF953F]/15 border border-[#BF953F]/30 text-[#F5D77B] text-[8px] font-black uppercase tracking-widest disabled:opacity-50"
            >
              {isEnablingAccessControl ? 'Ativando...' : 'Ativar agora'}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#000000] p-3 sm:p-4 md:p-6">
          <Suspense fallback={<ViewLoadingFallback />}>
            {renderCurrentView()}
          </Suspense>
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
