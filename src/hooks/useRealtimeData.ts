import { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
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
};

interface UseRealtimeDataOptions {
  loadCustomers?: boolean;
  loadLoans?: boolean;
  loadCashMovements?: boolean;
  loadMonthlySnapshots?: boolean;
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
    onError,
  } = options;

  useEffect(() => {
    if (!user) {
      setState(initialState);
      return;
    }

    let clientesListener = () => {};

    if (loadCustomers) {
      setState((previous) => ({
        ...previous,
        isCustomersLoading: true,
      }));

      clientesListener = onSnapshot(
        query(collection(db, 'clientes'), orderBy('createdAt', 'desc')),
        (snapshot) => {
          const clientes = snapshot.docs.map((docSnap) => parseCustomer(docSnap.id, docSnap.data()));
          setState((previous) => ({ ...previous, clientes, isCustomersLoading: false }));
        },
        (error) => {
          reportRealtimeError('clientes', error, onError);
          setState((previous) => ({ ...previous, clientes: [], isCustomersLoading: false }));
        },
      );
    } else {
      setState((previous) => (
        previous.clientes.length > 0 || previous.isCustomersLoading
          ? { ...previous, clientes: [], isCustomersLoading: false }
          : previous
      ));
    }

    const contratosListener = loadLoans
      ? onSnapshot(
          query(collection(db, 'loans'), orderBy('startDate', 'desc')),
          (snapshot) => {
            const contratos = snapshot.docs.map((docSnap) => parseLoan(docSnap.id, docSnap.data()));
            setState((previous) => ({ ...previous, contratos }));
          },
          (error) => {
            reportRealtimeError('contratos', error, onError);
            setState((previous) => ({ ...previous, contratos: [] }));
          },
        )
      : (() => {
          setState((previous) => previous.contratos.length > 0 ? { ...previous, contratos: [] } : previous);
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
      clientesListener();
      contratosListener();
      caixaListener();
      feesListener();
      movimentacoesListener();
      monthlySnapshotsListener();
    };
  }, [loadCashMovements, loadCustomers, loadLoans, loadMonthlySnapshots, onError, user]);

  return state;
};
