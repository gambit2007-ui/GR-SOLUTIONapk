import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  collection,
  DocumentData,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  QueryDocumentSnapshot,
  startAfter,
} from 'firebase/firestore';
import { db } from '../firebase';

type OrderDirection = 'asc' | 'desc';

interface UsePaginatedFirestoreListOptions<T> {
  collectionName: string;
  enabled?: boolean;
  orderByField: string;
  orderDirection?: OrderDirection;
  pageSize: number;
  searchTerm?: string;
  filterKey?: string;
  parser: (id: string, raw: unknown) => T;
  matchesSearch?: (item: T, normalizedSearch: string) => boolean;
  matchesFilters?: (item: T) => boolean;
  searchBatchSize?: number;
}

interface UsePaginatedFirestoreListResult<T> {
  items: T[];
  currentPage: number;
  totalPages: number;
  totalItems: number;
  isLoading: boolean;
  isSearchMode: boolean;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  setCurrentPage: Dispatch<SetStateAction<number>>;
  refresh: () => void;
}

export const usePaginatedFirestoreList = <T,>({
  collectionName,
  enabled = true,
  orderByField,
  orderDirection = 'desc',
  pageSize,
  searchTerm = '',
  filterKey = '',
  parser,
  matchesSearch,
  matchesFilters,
  searchBatchSize = 50,
}: UsePaginatedFirestoreListOptions<T>): UsePaginatedFirestoreListResult<T> => {
  const [items, setItems] = useState<T[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const pageStartCursorsRef = useRef<Map<number, QueryDocumentSnapshot<DocumentData> | null>>(new Map([[1, null]]));
  const searchMatcherRef = useRef(matchesSearch);
  const filterMatcherRef = useRef(matchesFilters);

  searchMatcherRef.current = matchesSearch;
  filterMatcherRef.current = matchesFilters;

  const normalizedSearch = useMemo(() => searchTerm.trim().toLowerCase(), [searchTerm]);
  const isSearchMode = normalizedSearch.length > 0 || Boolean(filterKey);
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const hasPreviousPage = currentPage > 1;

  const resetPaginationState = useCallback(() => {
    pageStartCursorsRef.current = new Map([[1, null]]);
  }, []);

  const refresh = useCallback(() => {
    setRefreshTick((previous) => previous + 1);
  }, []);

  useEffect(() => {
    setCurrentPage(1);
    resetPaginationState();
  }, [filterKey, normalizedSearch, resetPaginationState]);

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      setTotalItems(0);
      setHasNextPage(false);
      setCurrentPage(1);
      resetPaginationState();
    }
  }, [enabled, resetPaginationState]);

  useEffect(() => {
    if (!enabled || isSearchMode) return;

    let cancelled = false;

    const loadCount = async () => {
      try {
        const snapshot = await getCountFromServer(collection(db, collectionName));
        if (cancelled) return;

        const nextTotal = snapshot.data().count;
        setTotalItems(nextTotal);
        const nextTotalPages = Math.max(1, Math.ceil(nextTotal / pageSize));
        setCurrentPage((previous) => Math.min(previous, nextTotalPages));
      } catch {
        if (cancelled) return;
        setTotalItems(0);
      }
    };

    void loadCount();

    return () => {
      cancelled = true;
    };
  }, [collectionName, enabled, isSearchMode, pageSize, refreshTick]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const loadData = async () => {
      setIsLoading(true);

      try {
        if (isSearchMode) {
          const results: T[] = [];
          let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
          const batchLimit = Math.max(pageSize * 2, searchBatchSize);

          while (true) {
            const snapshot = await getDocs(query(
              collection(db, collectionName),
              orderBy(orderByField, orderDirection),
              ...(cursor ? [startAfter(cursor)] : []),
              limit(batchLimit),
            ));

            const docs = snapshot.docs;
            if (docs.length === 0) break;

            docs.forEach((docSnap) => {
              const parsed = parser(docSnap.id, docSnap.data());
              const matchesQuery = normalizedSearch
                ? (searchMatcherRef.current ? searchMatcherRef.current(parsed, normalizedSearch) : true)
                : true;
              const matchesActiveFilters = filterMatcherRef.current ? filterMatcherRef.current(parsed) : true;

              if (matchesQuery && matchesActiveFilters) {
                results.push(parsed);
              }
            });

            cursor = docs[docs.length - 1] || null;
            if (docs.length < batchLimit || !cursor) break;
          }

          if (cancelled) return;

          const nextTotal = results.length;
          const nextTotalPages = Math.max(1, Math.ceil(nextTotal / pageSize));
          const safePage = Math.min(currentPage, nextTotalPages);
          if (safePage !== currentPage) {
            setCurrentPage(safePage);
          }

          setTotalItems(nextTotal);
          setItems(results.slice((safePage - 1) * pageSize, safePage * pageSize));
          setHasNextPage(safePage < nextTotalPages);
          return;
        }

        const ensurePageCursor = async (page: number) => {
          if (page <= 1) return null;

          for (let targetPage = 2; targetPage <= page; targetPage += 1) {
            if (pageStartCursorsRef.current.has(targetPage)) continue;

            const previousPageCursor = targetPage === 2
              ? null
              : pageStartCursorsRef.current.get(targetPage - 1) ?? null;

            const previousPageSnapshot = await getDocs(query(
              collection(db, collectionName),
              orderBy(orderByField, orderDirection),
              ...(previousPageCursor ? [startAfter(previousPageCursor)] : []),
              limit(pageSize),
            ));

            const lastDoc = previousPageSnapshot.docs[previousPageSnapshot.docs.length - 1] || null;
            if (!lastDoc) {
              return null;
            }

            pageStartCursorsRef.current.set(targetPage, lastDoc);
          }

          return pageStartCursorsRef.current.get(page) ?? null;
        };

        const pageCursor = await ensurePageCursor(currentPage);
        if (cancelled) return;

        const snapshot = await getDocs(query(
          collection(db, collectionName),
          orderBy(orderByField, orderDirection),
          ...(pageCursor ? [startAfter(pageCursor)] : []),
          limit(pageSize + 1),
        ));

        if (cancelled) return;

        const pageDocs = snapshot.docs.slice(0, pageSize);
        const nextCursor = pageDocs[pageDocs.length - 1] || null;
        const nextPageExists = snapshot.docs.length > pageSize;

        if (nextPageExists && nextCursor) {
          pageStartCursorsRef.current.set(currentPage + 1, nextCursor);
        } else {
          pageStartCursorsRef.current.delete(currentPage + 1);
        }

        setItems(pageDocs.map((docSnap) => parser(docSnap.id, docSnap.data())));
        setHasNextPage(nextPageExists);
      } catch {
        if (cancelled) return;
        setItems([]);
        setHasNextPage(false);
        if (isSearchMode) {
          setTotalItems(0);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [
    collectionName,
    currentPage,
    enabled,
    isSearchMode,
    normalizedSearch,
    orderByField,
    orderDirection,
    pageSize,
    parser,
    refreshTick,
    searchBatchSize,
  ]);

  return {
    items,
    currentPage,
    totalPages,
    totalItems,
    isLoading,
    isSearchMode,
    hasPreviousPage,
    hasNextPage,
    setCurrentPage,
    refresh,
  };
};
