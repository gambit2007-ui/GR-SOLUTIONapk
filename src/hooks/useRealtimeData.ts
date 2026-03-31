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
}

const initialState: RealtimeDataState = {
  clientes: [],
  contratos: [],
  movimentacoes: [],
  caixa: 0,
};

export const useRealtimeData = (user: User | null) => {
  const [state, setState] = useState<RealtimeDataState>(initialState);

  useEffect(() => {
    if (!user) {
      setState(initialState);
      return;
    }

    const clientesListener = onSnapshot(
      query(collection(db, 'clientes'), orderBy('createdAt', 'desc')),
      (snapshot) => {
        const clientes = snapshot.docs.map((docSnap) => parseCustomer(docSnap.id, docSnap.data()));
        setState((previous) => ({ ...previous, clientes }));
      },
    );

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
  }, [user]);

  return state;
};

