import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { LegacyInstallmentLike, LegacyLoanLike } from '../../src/utils/legacyBreakdownMigration.ts';

export interface LegacyLoanDocument {
  id: string;
  raw: Record<string, unknown>;
  normalized: LegacyLoanLike;
}

export interface InstallmentEstornoIndex {
  perInstallment: Map<string, Set<number>>;
  genericLoanEstorno: Set<string>;
}

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeInstallment = (raw: unknown): LegacyInstallmentLike => {
  const payload = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    id: typeof payload.id === 'string' ? payload.id : undefined,
    number: toNumber(payload.number),
    amount: toNumber(payload.amount),
    value: toNumber(payload.value),
    status: payload.status,
    paidAmount: toNumber(payload.paidAmount),
    partialPaid: toNumber(payload.partialPaid),
    paymentAmount: toNumber(payload.paymentAmount),
    paymentDate: typeof payload.paymentDate === 'string' ? payload.paymentDate : undefined,
    paidAt: typeof payload.paidAt === 'string' ? payload.paidAt : undefined,
    lastPaymentDate: typeof payload.lastPaymentDate === 'string' ? payload.lastPaymentDate : undefined,
    paymentBreakdown:
      typeof payload.paymentBreakdown === 'object' && payload.paymentBreakdown !== null
        ? (payload.paymentBreakdown as LegacyInstallmentLike['paymentBreakdown'])
        : undefined,
    expectedPrincipal: toNumber(payload.expectedPrincipal),
    expectedInterest: toNumber(payload.expectedInterest),
  };
};

const normalizeLoan = (raw: Record<string, unknown>): LegacyLoanLike => {
  const installmentsRaw = Array.isArray(raw.installments) ? raw.installments : [];
  const installments = installmentsRaw.map((item) => normalizeInstallment(item));

  return {
    id: typeof raw.id === 'string' ? raw.id : undefined,
    amount: toNumber(raw.amount),
    totalToReturn: toNumber(raw.totalToReturn),
    interestRate: toNumber(raw.interestRate),
    interestType: raw.interestType,
    installmentCount: toNumber(raw.installmentCount),
    installmentsCount: toNumber(raw.installmentsCount),
    installments,
  };
};

export const loadLegacyLoanDocuments = async (db: Firestore): Promise<LegacyLoanDocument[]> => {
  const snapshot = await getDocs(collection(db, 'loans'));
  return snapshot.docs.map((docSnapshot) => {
    const raw = docSnapshot.data() as Record<string, unknown>;
    return {
      id: docSnapshot.id,
      raw,
      normalized: normalizeLoan(raw),
    };
  });
};

export const loadLegacyLoanDocumentById = async (
  db: Firestore,
  loanId: string,
): Promise<LegacyLoanDocument | null> => {
  const snapshot = await getDoc(doc(db, 'loans', loanId));
  if (!snapshot.exists()) return null;
  const raw = snapshot.data() as Record<string, unknown>;
  return {
    id: snapshot.id,
    raw,
    normalized: normalizeLoan(raw),
  };
};

export const loadLegacyLoanDocumentsByContractNumber = async (
  db: Firestore,
  contractNumber: string,
): Promise<LegacyLoanDocument[]> => {
  const snapshot = await getDocs(
    query(collection(db, 'loans'), where('contractNumber', '==', contractNumber)),
  );
  return snapshot.docs.map((docSnapshot) => {
    const raw = docSnapshot.data() as Record<string, unknown>;
    return {
      id: docSnapshot.id,
      raw,
      normalized: normalizeLoan(raw),
    };
  });
};

const estornoNumberRegex = /ESTORNO\s+PARCELA\s+(\d+)/i;

const buildEstornoIndex = (
  snapshot: Awaited<ReturnType<typeof getDocs>>,
): InstallmentEstornoIndex => {
  const perInstallment = new Map<string, Set<number>>();
  const genericLoanEstorno = new Set<string>();

  snapshot.docs.forEach((docSnapshot) => {
    const raw = docSnapshot.data() as Record<string, unknown>;
    const movementType = String(raw.type ?? '').trim().toUpperCase();
    if (movementType !== 'ESTORNO') return;

    const loanId = String(raw.loanId ?? '').trim();
    if (!loanId) return;

    const description = String(raw.description ?? '').trim();
    const match = description.match(estornoNumberRegex);

    if (match) {
      const installmentNumber = Number(match[1]);
      if (!Number.isFinite(installmentNumber) || installmentNumber <= 0) {
        genericLoanEstorno.add(loanId);
        return;
      }
      const current = perInstallment.get(loanId) ?? new Set<number>();
      current.add(Math.trunc(installmentNumber));
      perInstallment.set(loanId, current);
      return;
    }

    genericLoanEstorno.add(loanId);
  });

  return { perInstallment, genericLoanEstorno };
};

export const loadInstallmentEstornoIndex = async (db: Firestore): Promise<InstallmentEstornoIndex> => {
  const snapshot = await getDocs(collection(db, 'cashMovement'));
  return buildEstornoIndex(snapshot);
};

export const loadInstallmentEstornoIndexByLoanId = async (
  db: Firestore,
  loanId: string,
): Promise<InstallmentEstornoIndex> => {
  const snapshot = await getDocs(
    query(collection(db, 'cashMovement'), where('loanId', '==', loanId)),
  );
  return buildEstornoIndex(snapshot);
};

export const isLinkedToEstorno = (
  estornoIndex: InstallmentEstornoIndex,
  loanId: string,
  installmentNumber: number | null,
): boolean => {
  if (estornoIndex.genericLoanEstorno.has(loanId)) return true;
  if (installmentNumber === null) return false;
  const indexedInstallments = estornoIndex.perInstallment.get(loanId);
  if (!indexedInstallments) return false;
  return indexedInstallments.has(installmentNumber);
};

