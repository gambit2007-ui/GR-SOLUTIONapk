import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import type { User } from 'firebase/auth';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import type { CashMovement, Customer, Loan, MonthlySnapshot } from '../types';
import { parseMonthlySnapshot } from '../services/monthlySnapshotService';
import { parseFeeSettings } from '../services/settingsService';
import { parseCashMovement, parseCustomer, parseLoan } from '../utils/domainParsers';
import { DEFAULT_DAILY_LATE_FEE_RATE } from '../utils/lateFee';
import { createRealtimeResource, type ResourceSubscription } from '../utils/realtimeResource';

const emptyCustomers: Customer[] = [];
const emptyLoans: Loan[] = [];
const emptyMovements: CashMovement[] = [];
const emptySnapshots: MonthlySnapshot[] = [];
const defaultFees = { dailyLateFeeRate: DEFAULT_DAILY_LATE_FEE_RATE };

const subscribeCustomers: ResourceSubscription<Customer[]> = (next, fail) => onSnapshot(
  query(collection(db, 'clientes'), orderBy('createdAt', 'desc')), { includeMetadataChanges: true },
  (snapshot) => next(snapshot.docs.map((item) => parseCustomer(item.id, item.data()))
    .filter((item) => !item.archived && !item.archivedAt), !snapshot.metadata.fromCache), fail,
);
const subscribeLoans: ResourceSubscription<Loan[]> = (next, fail) => onSnapshot(
  query(collection(db, 'loans'), orderBy('startDate', 'desc')), { includeMetadataChanges: true },
  (snapshot) => next(snapshot.docs.map((item) => parseLoan(item.id, item.data())), !snapshot.metadata.fromCache), fail,
);
const subscribeMovements: ResourceSubscription<CashMovement[]> = (next, fail) => onSnapshot(
  query(collection(db, 'cashMovement'), orderBy('date', 'desc')), { includeMetadataChanges: true },
  (snapshot) => next(snapshot.docs.map((item) => parseCashMovement(item.id, item.data())), !snapshot.metadata.fromCache), fail,
);
const subscribeSnapshots: ResourceSubscription<MonthlySnapshot[]> = (next, fail) => onSnapshot(
  query(collection(db, 'monthlySnapshots'), orderBy('month', 'desc')), { includeMetadataChanges: true },
  (snapshot) => next(snapshot.docs.map((item) => parseMonthlySnapshot(item.id, item.data())), !snapshot.metadata.fromCache), fail,
);
const subscribeCash: ResourceSubscription<number> = (next, fail) => onSnapshot(
  doc(db, 'settings', 'caixa'), { includeMetadataChanges: true },
  (snapshot) => {
    const raw = snapshot.exists() ? snapshot.data().value : 0;
    const value = raw === null || raw === '' ? Number.NaN : Number(raw);
    if (!Number.isFinite(value)) { fail(new Error('INVALID_CASH_BALANCE')); return; }
    next(value, !snapshot.metadata.fromCache);
  }, fail,
);
const subscribeFees: ResourceSubscription<typeof defaultFees> = (next, fail) => onSnapshot(
  doc(db, 'settings', 'fees'), { includeMetadataChanges: true },
  (snapshot) => next(snapshot.exists() ? parseFeeSettings(snapshot.data()) : defaultFees, !snapshot.metadata.fromCache), fail,
);

interface UseRealtimeDataOptions {
  loadCustomers?: boolean;
  loadLoans?: boolean;
  loadCashMovements?: boolean;
  loadMonthlySnapshots?: boolean;
  onError?: (message: string) => void;
}

const useResource = <T>(
  uid: string | undefined, enabled: boolean, retry: number, initial: T,
  subscribe: ResourceSubscription<T>, label: string, onError?: (message: string) => void,
) => {
  // Stable identity prevents unrelated tab changes from reconnecting this resource.
  const resource = useMemo(() => createRealtimeResource(initial, Boolean(uid) && enabled, subscribe,
    () => onError?.(`Erro ao carregar ${label}`)), [uid, enabled, retry, initial, subscribe, label, onError]);
  return useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
};

export const useRealtimeData = (user: User | null, options: UseRealtimeDataOptions = {}) => {
  const [retry, setRetry] = useState(0);
  const reload = useCallback(() => setRetry((value) => value + 1), []);
  const { loadCustomers = true, loadLoans = true, loadCashMovements = true, loadMonthlySnapshots = true, onError } = options;
  const customers = useResource(user?.uid, loadCustomers, retry, emptyCustomers, subscribeCustomers, 'clientes', onError);
  const loans = useResource(user?.uid, loadLoans, retry, emptyLoans, subscribeLoans, 'contratos', onError);
  const movements = useResource(user?.uid, loadCashMovements, retry, emptyMovements, subscribeMovements, 'movimentacoes', onError);
  const snapshots = useResource(user?.uid, loadMonthlySnapshots, retry, emptySnapshots, subscribeSnapshots, 'fechamentos', onError);
  const cash = useResource(user?.uid, true, retry, 0, subscribeCash, 'caixa', onError);
  const fees = useResource(user?.uid, true, retry, defaultFees, subscribeFees, 'taxas', onError);
  return {
    clientes: customers.data, contratos: loans.data, movimentacoes: movements.data,
    monthlySnapshots: snapshots.data, caixa: cash.data, feeSettings: fees.data,
    isCustomersLoading: customers.status === 'loading',
    cashMovementsStatus: movements.status,
    statuses: { customers: customers.status, loans: loans.status, movements: movements.status,
      snapshots: snapshots.status, cash: cash.status, fees: fees.status },
    reload,
  };
};
