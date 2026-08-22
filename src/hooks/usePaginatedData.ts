import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  documentId,
  DocumentData,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  QueryDocumentSnapshot,
  startAfter,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Customer, DataLoadStatus, Loan } from '../types';
import { parseCustomer, parseLoan } from '../utils/domainParsers';

interface PaginatedState<T> {
  items: T[];
  total: number;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  status: DataLoadStatus;
}

const createInitialState = <T,>(): PaginatedState<T> => ({
  items: [],
  total: 0,
  hasMore: false,
  loading: false,
  loadingMore: false,
  status: 'idle',
});

const mergeUniqueById = <T extends { id: string }>(current: T[], incoming: T[]): T[] => {
  const merged = new Map(current.map((item) => [item.id, item]));
  incoming.forEach((item) => merged.set(item.id, item));
  return Array.from(merged.values());
};

export const usePaginatedCustomers = (
  user: User | null,
  enabled: boolean,
  onError?: (message: string) => void,
  pageSize = 36,
) => {
  const [state, setState] = useState<PaginatedState<Customer>>(createInitialState);
  const cursorRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);

  const refreshTotal = useCallback(async () => {
    const [totalSnapshot, archivedSnapshot] = await Promise.all([
      getCountFromServer(collection(db, 'clientes')),
      getCountFromServer(query(collection(db, 'clientes'), where('archived', '==', true))),
    ]);
    setState((previous) => ({
      ...previous,
      total: Math.max(0, totalSnapshot.data().count - archivedSnapshot.data().count),
    }));
  }, []);

  useEffect(() => {
    if (!user || !enabled) {
      cursorRef.current = null;
      setState(createInitialState());
      return;
    }

    setState((previous) => ({ ...previous, loading: true, status: 'loading' }));
    const firstPageQuery = query(
      collection(db, 'clientes'),
      orderBy(documentId()),
      limit(pageSize + 1),
    );

    const unsubscribe = onSnapshot(
      firstPageQuery,
      (snapshot) => {
        const hasMore = snapshot.docs.length > pageSize;
        const pageDocs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;
        cursorRef.current = pageDocs.at(-1) || null;
        const items = pageDocs
          .map((item) => parseCustomer(item.id, item.data()))
          .filter((customer) => !customer.archived && !customer.archivedAt);
        setState((previous) => ({ ...previous, items, hasMore, loading: false, status: 'ready' }));
        void refreshTotal().catch(() => onError?.('Erro ao carregar total de clientes'));
      },
      () => {
        setState((previous) => ({ ...previous, loading: false, status: 'error' }));
        onError?.('Erro ao carregar clientes');
      },
    );

    return unsubscribe;
  }, [enabled, onError, pageSize, refreshTotal, user]);

  const loadMore = useCallback(async () => {
    if (!user || !enabled || !cursorRef.current || state.loadingMore || !state.hasMore) return;
    setState((previous) => ({ ...previous, loadingMore: true }));
    try {
      const nextPageQuery = query(
        collection(db, 'clientes'),
        orderBy(documentId()),
        startAfter(cursorRef.current),
        limit(pageSize + 1),
      );
      const snapshot = await getDocs(nextPageQuery);
      const hasMore = snapshot.docs.length > pageSize;
      const pageDocs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;
      cursorRef.current = pageDocs.at(-1) || cursorRef.current;
      const items = pageDocs
        .map((item) => parseCustomer(item.id, item.data()))
        .filter((customer) => !customer.archived && !customer.archivedAt);
      setState((previous) => ({
        ...previous,
        items: mergeUniqueById(previous.items, items),
        hasMore,
        loadingMore: false,
      }));
    } catch {
      setState((previous) => ({ ...previous, loadingMore: false }));
      onError?.('Erro ao carregar mais clientes');
    }
  }, [enabled, onError, pageSize, state.hasMore, state.loadingMore, user]);

  const loadAll = useCallback(async () => {
    if (!user || !enabled || state.loadingMore || !state.hasMore) return;
    setState((previous) => ({ ...previous, loadingMore: true }));
    try {
      const snapshot = await getDocs(query(collection(db, 'clientes'), orderBy(documentId())));
      const items = snapshot.docs
        .map((item) => parseCustomer(item.id, item.data()))
        .filter((customer) => !customer.archived && !customer.archivedAt);
      cursorRef.current = snapshot.docs.at(-1) || cursorRef.current;
      setState((previous) => ({
        ...previous,
        items: mergeUniqueById(previous.items, items),
        hasMore: false,
        loadingMore: false,
      }));
    } catch {
      setState((previous) => ({ ...previous, loadingMore: false }));
      onError?.('Erro ao pesquisar todos os clientes');
    }
  }, [enabled, onError, state.hasMore, state.loadingMore, user]);

  return { ...state, loadMore, loadAll };
};

export const usePaginatedLoans = (
  user: User | null,
  enabled: boolean,
  ensureLoanId?: string | null,
  onError?: (message: string) => void,
  pageSize = 30,
) => {
  const [state, setState] = useState<PaginatedState<Loan>>(createInitialState);
  const cursorRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);

  const refreshTotal = useCallback(async () => {
    const snapshot = await getCountFromServer(collection(db, 'loans'));
    setState((previous) => ({ ...previous, total: snapshot.data().count }));
  }, []);

  useEffect(() => {
    if (!user || !enabled) {
      cursorRef.current = null;
      setState(createInitialState());
      return;
    }

    setState((previous) => ({ ...previous, loading: true, status: 'loading' }));
    const firstPageQuery = query(
      collection(db, 'loans'),
      orderBy('startDate', 'desc'),
      limit(pageSize + 1),
    );
    const unsubscribe = onSnapshot(
      firstPageQuery,
      (snapshot) => {
        const hasMore = snapshot.docs.length > pageSize;
        const pageDocs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;
        cursorRef.current = pageDocs.at(-1) || null;
        const items = pageDocs.map((item) => parseLoan(item.id, item.data()));
        setState((previous) => ({ ...previous, items, hasMore, loading: false, status: 'ready' }));
        void refreshTotal().catch(() => onError?.('Erro ao carregar total de contratos'));
      },
      () => {
        setState((previous) => ({ ...previous, loading: false, status: 'error' }));
        onError?.('Erro ao carregar contratos');
      },
    );

    return unsubscribe;
  }, [enabled, onError, pageSize, refreshTotal, user]);

  useEffect(() => {
    if (!user || !enabled || !ensureLoanId || state.items.some((loan) => loan.id === ensureLoanId)) return;
    void getDoc(doc(db, 'loans', ensureLoanId))
      .then((snapshot) => {
        if (!snapshot.exists()) return;
        const loan = parseLoan(snapshot.id, snapshot.data());
        setState((previous) => ({ ...previous, items: mergeUniqueById([loan], previous.items) }));
      })
      .catch(() => onError?.('Erro ao localizar contrato'));
  }, [enabled, ensureLoanId, onError, state.items, user]);

  const loadMore = useCallback(async () => {
    if (!user || !enabled || !cursorRef.current || state.loadingMore || !state.hasMore) return;
    setState((previous) => ({ ...previous, loadingMore: true }));
    try {
      const nextPageQuery = query(
        collection(db, 'loans'),
        orderBy('startDate', 'desc'),
        startAfter(cursorRef.current),
        limit(pageSize + 1),
      );
      const snapshot = await getDocs(nextPageQuery);
      const hasMore = snapshot.docs.length > pageSize;
      const pageDocs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;
      cursorRef.current = pageDocs.at(-1) || cursorRef.current;
      const items = pageDocs.map((item) => parseLoan(item.id, item.data()));
      setState((previous) => ({
        ...previous,
        items: mergeUniqueById(previous.items, items),
        hasMore,
        loadingMore: false,
      }));
    } catch {
      setState((previous) => ({ ...previous, loadingMore: false }));
      onError?.('Erro ao carregar mais contratos');
    }
  }, [enabled, onError, pageSize, state.hasMore, state.loadingMore, user]);

  const loadAll = useCallback(async () => {
    if (!user || !enabled || state.loadingMore || !state.hasMore) return;
    setState((previous) => ({ ...previous, loadingMore: true }));
    try {
      const snapshot = await getDocs(query(collection(db, 'loans'), orderBy('startDate', 'desc')));
      const items = snapshot.docs.map((item) => parseLoan(item.id, item.data()));
      cursorRef.current = snapshot.docs.at(-1) || cursorRef.current;
      setState((previous) => ({
        ...previous,
        items: mergeUniqueById(previous.items, items),
        hasMore: false,
        loadingMore: false,
      }));
    } catch {
      setState((previous) => ({ ...previous, loadingMore: false }));
      onError?.('Erro ao pesquisar todos os contratos');
    }
  }, [enabled, onError, state.hasMore, state.loadingMore, user]);

  return { ...state, loadMore, loadAll };
};
