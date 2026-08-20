import { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import {
  collection,
  doc,
  getCountFromServer,
  limit as queryLimit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { CashMovement, Customer, FeeSettings, Loan, MonthlySnapshot } from '../types';
import { parseMonthlySnapshot } from '../services/monthlySnapshotService';
import { subscribeFeeSettings } from '../services/settingsService';
import { parseCashMovement, parseCustomer, parseLoan } from '../utils/domainParsers';
import { DEFAULT_DAILY_LATE_FEE_RATE } from '../utils/lateFee';

interface RealtimeDataState {
  clientes: Customer[];
  contratos: Loan[];
  movimentacoes: CashMovement[];
  monthlySnapshots: MonthlySnapshot[];
  feeSettings: FeeSettings;
  caixa: number;
  isCustomersLoading: boolean;
  totalCustomers: number;
  totalLoans: number;
  hasMoreCustomers: boolean;
  hasMoreLoans: boolean;
}

const initialState: RealtimeDataState = {
  clientes: [],
  contratos: [],
  movimentacoes: [],
  monthlySnapshots: [],
  feeSettings: {
    dailyLateFeeRate: DEFAULT_DAILY_LATE_FEE_RATE,
  },
  caixa: 0,
  isCustomersLoading: false,
  totalCustomers: 0,
  totalLoans: 0,
  hasMoreCustomers: false,
  hasMoreLoans: false,
};

interface UseRealtimeDataOptions {
  loadCustomers?: boolean;
  loadLoans?: boolean;
  loadCashMovements?: boolean;
  loadMonthlySnapshots?: boolean;
  customersLimit?: number;
  loansLimit?: number;
  onError?: (message: string) => void;
}

const reportRealtimeError = (
  source: string,
  error: unknown,
  onError?: (message: string) => void,
) => {
  console.error(`[useRealtimeData] Erro ao carregar ${source}:`, error);
  onError?.(`Erro ao carregar ${source}`);
};

export const useRealtimeData = (user: User | null, options: UseRealtimeDataOptions = {}) => {
  const [state, setState] = useState<RealtimeDataState>(initialState);
  const {
    loadCustomers = true,
    loadLoans = true,
    loadCashMovements = true,
    loadMonthlySnapshots = true,
    customersLimit,
    loansLimit,
    onError,
  } = options;

  useEffect(() => {
    if (!user) {
      setState(initialState);
      return;
    }

    let disposed = false;
    let clientesListener = () => {};
    const refreshCustomerCount = () => Promise.all([
      getCountFromServer(collection(db, 'clientes')),
      getCountFromServer(query(collection(db, 'clientes'), where('archived', '==', true))),
    ]).then(([totalSnapshot, archivedSnapshot]) => {
      if (disposed) return;
      setState((previous) => ({
        ...previous,
        totalCustomers: Math.max(0, totalSnapshot.data().count - archivedSnapshot.data().count),
      }));
    }).catch((error) => reportRealtimeError('total de clientes', error, onError));
    const refreshLoanCount = () => getCountFromServer(collection(db, 'loans'))
      .then((snapshot) => {
        if (!disposed) setState((previous) => ({ ...previous, totalLoans: snapshot.data().count }));
      })
      .catch((error) => reportRealtimeError('total de contratos', error, onError));

    if (loadCustomers) {
      setState((previous) => ({
        ...previous,
        isCustomersLoading: true,
      }));

      const customersQuery = Number.isInteger(customersLimit) && Number(customersLimit) > 0
        ? query(collection(db, 'clientes'), orderBy('createdAt', 'desc'), queryLimit(Number(customersLimit) + 1))
        : query(collection(db, 'clientes'), orderBy('createdAt', 'desc'));

      clientesListener = onSnapshot(
        customersQuery,
        (snapshot) => {
          const hasMoreCustomers = Number.isInteger(customersLimit) && snapshot.docs.length > Number(customersLimit);
          const visibleDocs = hasMoreCustomers ? snapshot.docs.slice(0, Number(customersLimit)) : snapshot.docs;
          const clientes = visibleDocs
            .map((docSnap) => parseCustomer(docSnap.id, docSnap.data()))
            .filter((customer) => !customer.archived && !customer.archivedAt);
          setState((previous) => ({ ...previous, clientes, hasMoreCustomers, isCustomersLoading: false }));
          void refreshCustomerCount();
        },
        (error) => {
          reportRealtimeError('clientes', error, onError);
          setState((previous) => ({ ...previous, clientes: [], hasMoreCustomers: false, isCustomersLoading: false }));
        },
      );
    } else {
      setState((previous) => (
        previous.clientes.length > 0 || previous.isCustomersLoading
          ? { ...previous, clientes: [], hasMoreCustomers: false, isCustomersLoading: false }
          : previous
      ));
    }

    const loansQuery = Number.isInteger(loansLimit) && Number(loansLimit) > 0
      ? query(collection(db, 'loans'), orderBy('startDate', 'desc'), queryLimit(Number(loansLimit) + 1))
      : query(collection(db, 'loans'), orderBy('startDate', 'desc'));

    const contratosListener = loadLoans
      ? onSnapshot(
          loansQuery,
          (snapshot) => {
            const hasMoreLoans = Number.isInteger(loansLimit) && snapshot.docs.length > Number(loansLimit);
            const visibleDocs = hasMoreLoans ? snapshot.docs.slice(0, Number(loansLimit)) : snapshot.docs;
            const contratos = visibleDocs.map((docSnap) => parseLoan(docSnap.id, docSnap.data()));
            setState((previous) => ({ ...previous, contratos, hasMoreLoans }));
            void refreshLoanCount();
          },
          (error) => {
            reportRealtimeError('contratos', error, onError);
            setState((previous) => ({ ...previous, contratos: [], hasMoreLoans: false }));
          },
        )
      : (() => {
          setState((previous) => previous.contratos.length > 0 ? { ...previous, contratos: [], hasMoreLoans: false } : previous);
          return () => {};
        })();

    const caixaListener = onSnapshot(
      doc(db, 'settings', 'caixa'),
      (snapshot) => {
        const caixa = snapshot.exists() ? Number(snapshot.data().value) || 0 : 0;
        setState((previous) => ({ ...previous, caixa }));
      },
      (error) => {
        reportRealtimeError('settings/caixa', error, onError);
        setState((previous) => ({ ...previous, caixa: 0 }));
      },
    );

    const feesListener = subscribeFeeSettings(
      (feeSettings) => {
        setState((previous) => ({ ...previous, feeSettings }));
      },
      (error) => {
        reportRealtimeError('settings/fees', error, onError);
        setState((previous) => ({
          ...previous,
          feeSettings: {
            dailyLateFeeRate: DEFAULT_DAILY_LATE_FEE_RATE,
          },
        }));
      },
    );

    const movimentacoesListener = loadCashMovements
      ? onSnapshot(
          query(collection(db, 'cashMovement'), orderBy('date', 'desc')),
          (snapshot) => {
            const movimentacoes = snapshot.docs.map((docSnap) => parseCashMovement(docSnap.id, docSnap.data()));
            setState((previous) => ({ ...previous, movimentacoes }));
          },
          (error) => {
            reportRealtimeError('movimentacoes do caixa', error, onError);
            setState((previous) => ({ ...previous, movimentacoes: [] }));
          },
        )
      : (() => {
          setState((previous) => previous.movimentacoes.length > 0 ? { ...previous, movimentacoes: [] } : previous);
          return () => {};
        })();

    const monthlySnapshotsListener = loadMonthlySnapshots
      ? onSnapshot(
          query(collection(db, 'monthlySnapshots'), orderBy('month', 'desc')),
          (snapshot) => {
            const monthlySnapshots = snapshot.docs.map((docSnap) => parseMonthlySnapshot(docSnap.id, docSnap.data()));
            setState((previous) => ({ ...previous, monthlySnapshots }));
          },
          (error) => {
            reportRealtimeError('fechamentos mensais', error, onError);
            setState((previous) => ({ ...previous, monthlySnapshots: [] }));
          },
        )
      : (() => {
          setState((previous) => previous.monthlySnapshots.length > 0 ? { ...previous, monthlySnapshots: [] } : previous);
          return () => {};
        })();

    return () => {
      disposed = true;
      clientesListener();
      contratosListener();
      caixaListener();
      feesListener();
      movimentacoesListener();
      monthlySnapshotsListener();
    };
  }, [customersLimit, loadCashMovements, loadCustomers, loadLoans, loadMonthlySnapshots, loansLimit, onError, user]);

  return state;
};
