import { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import { CashMovement, Customer, Loan } from '../types';
import { parseCashMovement, parseCustomer, parseLoan } from '../utils/domainParsers';

interface RealtimeDataState {
  clientes: Customer[];
  contratos: Loan[];
  movimentacoes: CashMovement[];
  caixa: number;
  isCustomersLoading: boolean;
}

const initialState: RealtimeDataState = {
  clientes: [],
  contratos: [],
  movimentacoes: [],
  caixa: 0,
  isCustomersLoading: false,
};

interface UseRealtimeDataOptions {
  loadCustomers?: boolean;
}

export const useRealtimeData = (user: User | null, options: UseRealtimeDataOptions = {}) => {
  const [state, setState] = useState<RealtimeDataState>(initialState);
  const { loadCustomers = true } = options;

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
        () => {
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

    const contratosListener = onSnapshot(
      query(collection(db, 'loans'), orderBy('startDate', 'desc')),
      (snapshot) => {
        const contratos = snapshot.docs.map((docSnap) => parseLoan(docSnap.id, docSnap.data()));
        setState((previous) => ({ ...previous, contratos }));
      },
    );

    const caixaListener = onSnapshot(doc(db, 'settings', 'caixa'), (snapshot) => {
      const caixa = snapshot.exists() ? Number(snapshot.data().value) || 0 : 0;
      setState((previous) => ({ ...previous, caixa }));
    });

    const movimentacoesListener = onSnapshot(
      query(collection(db, 'cashMovement'), orderBy('date', 'desc')),
      (snapshot) => {
        const movimentacoes = snapshot.docs.map((docSnap) => parseCashMovement(docSnap.id, docSnap.data()));
        setState((previous) => ({ ...previous, movimentacoes }));
      },
    );

    return () => {
      clientesListener();
      contratosListener();
      caixaListener();
      movimentacoesListener();
    };
  }, [loadCustomers, user]);

  return state;
};
