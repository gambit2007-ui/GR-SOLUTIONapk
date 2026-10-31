import {
  collection, doc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp,
  where, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { CashMovement } from '../types';
import { parseCashMovement } from '../utils/domainParsers';
import { getLocalISODate } from '../utils/dateTime';
import { bankPixCounterpartyName, evaluateBankMatch, expectedPayerName } from '../utils/bankStatementMatching';
import type { BankStatementRow } from '../utils/c6StatementParser';
import type { StatementPdfPreview } from '../utils/c6Pdf';

export interface BankStatementImport {
  id: string;
  bank: string;
  sha256: string;
  periodStart: string;
  periodEnd: string;
  closingBalanceCents: number;
  incomeCents: number;
  expenseCents: number;
  transactionCount: number;
  status: 'ACTIVE' | 'REMOVED';
  createdByUid: string;
  createdAt?: { toDate: () => Date };
}

export interface BankStatementEntry extends BankStatementRow {
  id: string;
  statementId: string;
}

export interface BankStatementLink {
  entryId: string;
  statementId: string;
  movementId: string;
  actorUid: string;
  matchBasis?: 'NAME_AMOUNT_DIRECTION' | 'AMOUNT_DIRECTION' | 'THIRD_PARTY_PIX';
  matchMode?: 'AUTO' | 'MANUAL';
  expectedPayer?: string;
  bankPayer?: string;
  exceptionNote?: string;
  createdAt?: { toDate: () => Date };
}

export type BankMovementJustificationReason =
  | 'CASH' | 'OTHER_ACCOUNT' | 'THIRD_PARTY_PIX' | 'OTHER_METHOD' | 'NEEDS_CORRECTION';

export interface BankMovementJustification {
  id: string;
  statementId: string;
  movementId: string;
  reason: BankMovementJustificationReason;
  note: string;
  actorUid: string;
  createdAt?: { toDate: () => Date };
}

/** Audit-only explanation for a bank receipt with no matching GR movement. */
export interface BankEntryJustification {
  id: string;
  statementId: string;
  entryId: string;
  note: string;
  actorUid: string;
  createdAt?: { toDate: () => Date };
}

export interface BankStatementAuditEvent {
  id: string;
  statementId: string;
  action: 'IMPORTED' | 'LINKED' | 'AUTO_LINKED' | 'UNLINKED' | 'REMOVED' | 'JUSTIFIED' | 'BANK_ENTRY_JUSTIFIED';
  actorUid: string;
  entryId?: string;
  movementId?: string;
  createdAt?: { toDate: () => Date };
}

const entryIdFor = (statementId: string, sequence: number) => `${statementId}_${String(sequence).padStart(5, '0')}`;

export const listBankStatementImports = async (): Promise<BankStatementImport[]> => {
  const snapshot = await getDocs(query(collection(db, 'bankStatementImports'), orderBy('createdAt', 'desc'), limit(50)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as BankStatementImport));
};

export const listBankStatementEntries = async (statementId: string): Promise<BankStatementEntry[]> => {
  const snapshot = await getDocs(query(collection(db, 'bankStatementEntries'), where('statementId', '==', statementId)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as BankStatementEntry))
    .sort((a, b) => a.sequence - b.sequence);
};

export const listBankStatementLinks = async (): Promise<BankStatementLink[]> => {
  const snapshot = await getDocs(collection(db, 'bankStatementLinks'));
  return snapshot.docs.map((item) => ({ entryId: item.id, ...item.data() } as BankStatementLink));
};

export const listBankMovementJustifications = async (statementId: string): Promise<BankMovementJustification[]> => {
  const snapshot = await getDocs(query(collection(db, 'bankMovementJustifications'), where('statementId', '==', statementId)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as BankMovementJustification));
};

export const listBankEntryJustifications = async (statementId: string): Promise<BankEntryJustification[]> => {
  const snapshot = await getDocs(query(collection(db, 'bankEntryJustifications'), where('statementId', '==', statementId)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as BankEntryJustification));
};

export const listBankStatementAuditEvents = async (statementId: string): Promise<BankStatementAuditEvent[]> => {
  const snapshot = await getDocs(query(collection(db, 'bankStatementAuditEvents'), where('statementId', '==', statementId)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as BankStatementAuditEvent))
    .sort((a, b) => (b.createdAt?.toDate?.().getTime() || 0) - (a.createdAt?.toDate?.().getTime() || 0));
};

export const importBankStatement = async (preview: StatementPdfPreview, actorUid: string): Promise<string> => {
  if (!actorUid) throw new Error('USUARIO_NAO_IDENTIFICADO');
  if (preview.statement.rows.length > 400) throw new Error('PDF_COM_MAIS_DE_400_LANCAMENTOS');
  const sameHash = await getDocs(query(collection(db, 'bankStatementImports'), where('sha256', '==', preview.sha256)));
  if (sameHash.docs.some((item) => item.data().status === 'ACTIVE')) throw new Error('EXTRATO_JA_IMPORTADO');

  const id = crypto.randomUUID();
  const batch = writeBatch(db);
  batch.set(doc(db, 'bankStatementImports', id), {
    bank: preview.statement.bank,
    sha256: preview.sha256,
    periodStart: preview.statement.periodStart,
    periodEnd: preview.statement.periodEnd,
    closingBalanceCents: preview.statement.closingBalanceCents,
    incomeCents: preview.statement.incomeCents,
    expenseCents: preview.statement.expenseCents,
    transactionCount: preview.statement.rows.length,
    status: 'ACTIVE',
    createdByUid: actorUid,
    createdAt: serverTimestamp(),
  });
  for (const row of preview.statement.rows) {
    batch.set(doc(db, 'bankStatementEntries', entryIdFor(id, row.sequence)), { ...row, statementId: id });
  }
  batch.set(doc(collection(db, 'bankStatementAuditEvents')), {
    statementId: id, action: 'IMPORTED', actorUid, createdAt: serverTimestamp(),
  });
  await batch.commit();
  return id;
};

export const linkBankEntryToCashMovement = async (
  entry: BankStatementEntry,
  movement: CashMovement,
  actorUid: string,
  manualNote = '',
  matchMode: 'AUTO' | 'MANUAL' = 'MANUAL',
): Promise<void> => {
  if (!movement.id || !actorUid) throw new Error('VINCULO_SEM_IDENTIFICADOR');
  const trimmedNote = manualNote.trim();
  if (matchMode === 'MANUAL' && (trimmedNote.length < 8 || trimmedNote.length > 1000)) {
    throw new Error('JUSTIFICATIVA_OBRIGATORIA');
  }
  const importRef = doc(db, 'bankStatementImports', entry.statementId);
  const entryRef = doc(db, 'bankStatementEntries', entry.id);
  const movementRef = doc(db, 'cashMovement', movement.id);
  const entryLinkRef = doc(db, 'bankStatementLinks', entry.id);
  const movementLinkRef = doc(db, 'bankMovementLinks', movement.id);
  await runTransaction(db, async (tx) => {
    const [importSnap, entrySnap, movementSnap, entryLinkSnap, movementLinkSnap] = await Promise.all([
      tx.get(importRef), tx.get(entryRef), tx.get(movementRef), tx.get(entryLinkRef), tx.get(movementLinkRef),
    ]);
    if (!importSnap.exists() || importSnap.data().status !== 'ACTIVE' || !entrySnap.exists() || !movementSnap.exists()) {
      throw new Error('REGISTRO_DE_CONFERENCIA_NAO_ENCONTRADO');
    }
    if (entryLinkSnap.exists() || movementLinkSnap.exists()) throw new Error('LANCAMENTO_JA_VINCULADO');
    const bankRow = entrySnap.data() as BankStatementEntry;
    const ledgerMovement = parseCashMovement(movement.id!, movementSnap.data());
    if (bankRow.statementId !== entry.statementId) throw new Error('REGISTRO_DE_CONFERENCIA_NAO_ENCONTRADO');
    const loanId = ledgerMovement.loanId;
    const loanSnap = loanId ? await tx.get(doc(db, 'loans', loanId)) : null;
    const expectedPayer = expectedPayerName(ledgerMovement, loanSnap?.exists()
      ? { customerName: String(loanSnap.data().customerName || '') } : undefined);
    const match = evaluateBankMatch(ledgerMovement, bankRow, expectedPayer);
    if (matchMode === 'AUTO') {
      const rawDate = ledgerMovement.date;
      const parsedDate = new Date(rawDate);
      const movementDay = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate
        : Number.isNaN(parsedDate.getTime()) ? '' : getLocalISODate(parsedDate);
      const period = importSnap.data();
      if (ledgerMovement.type !== 'PAGAMENTO' || bankRow.type.toUpperCase() !== 'PIX' ||
        bankRow.direction !== 'IN' || !expectedPayer || match !== 'MATCH' ||
        movementDay < period.periodStart || movementDay > period.periodEnd) {
        throw new Error('VINCULO_AUTOMATICO_NAO_SEGURO');
      }
    }
    if (match === 'AMOUNT_OR_DIRECTION_MISMATCH') {
      throw new Error('VALOR_OU_SENTIDO_NAO_CONFERE');
    }
    const isThirdParty = ledgerMovement.type === 'PAGAMENTO' && bankRow.direction === 'IN' &&
      match === 'PAYER_MISMATCH' && trimmedNote.length >= 8 && trimmedNote.length <= 1000;
    if (match !== 'MATCH' && !isThirdParty) throw new Error('PAGADOR_NAO_CONFERE');
    const matchBasis: BankStatementLink['matchBasis'] = isThirdParty ? 'THIRD_PARTY_PIX'
      : expectedPayer && bankRow.type.toUpperCase() === 'PIX' ? 'NAME_AMOUNT_DIRECTION' : 'AMOUNT_DIRECTION';
    const link = {
      statementId: entry.statementId, entryId: entry.id, movementId: movement.id, actorUid, matchBasis,
      ...(matchMode === 'AUTO' ? { matchMode } : {}),
      expectedPayer: expectedPayer.slice(0, 200),
      bankPayer: bankRow.type.toUpperCase() === 'PIX'
        ? bankPixCounterpartyName(bankRow.description, bankRow.direction).slice(0, 200) : '',
      exceptionNote: matchMode === 'MANUAL' ? trimmedNote : '',
      createdAt: serverTimestamp(),
    };
    tx.set(entryLinkRef, link);
    tx.set(movementLinkRef, link);
    if (isThirdParty) {
      tx.set(doc(collection(db, 'bankMovementJustifications')), {
        statementId: entry.statementId, movementId: movement.id, reason: 'THIRD_PARTY_PIX',
        note: trimmedNote, actorUid, createdAt: serverTimestamp(),
      });
    }
    tx.set(doc(collection(db, 'bankStatementAuditEvents')), {
      statementId: entry.statementId, action: matchMode === 'AUTO' ? 'AUTO_LINKED' : 'LINKED', entryId: entry.id,
      movementId: movement.id, actorUid, createdAt: serverTimestamp(),
    });
  });
};

export const addBankEntryJustification = async (
  entry: BankStatementEntry,
  note: string,
  actorUid: string,
): Promise<void> => {
  const trimmedNote = note.trim();
  if (!actorUid || !entry.id || !entry.statementId || trimmedNote.length < 8 || trimmedNote.length > 1000) {
    throw new Error('JUSTIFICATIVA_OBRIGATORIA');
  }
  const importRef = doc(db, 'bankStatementImports', entry.statementId);
  const entryRef = doc(db, 'bankStatementEntries', entry.id);
  const linkRef = doc(db, 'bankStatementLinks', entry.id);
  await runTransaction(db, async (tx) => {
    const [importSnap, entrySnap, linkSnap] = await Promise.all([
      tx.get(importRef), tx.get(entryRef), tx.get(linkRef),
    ]);
    if (!importSnap.exists() || importSnap.data().status !== 'ACTIVE' || !entrySnap.exists() ||
      entrySnap.data().statementId !== entry.statementId || entrySnap.data().direction !== 'IN') {
      throw new Error('REGISTRO_DE_CONFERENCIA_NAO_ENCONTRADO');
    }
    if (linkSnap.exists()) throw new Error('LANCAMENTO_JA_VINCULADO');
    tx.set(doc(collection(db, 'bankEntryJustifications')), {
      statementId: entry.statementId, entryId: entry.id, note: trimmedNote,
      actorUid, createdAt: serverTimestamp(),
    });
    tx.set(doc(collection(db, 'bankStatementAuditEvents')), {
      statementId: entry.statementId, action: 'BANK_ENTRY_JUSTIFIED', entryId: entry.id,
      actorUid, createdAt: serverTimestamp(),
    });
  });
};

export const unlinkBankEntry = async (entryId: string, actorUid: string): Promise<void> => {
  if (!actorUid) throw new Error('USUARIO_NAO_IDENTIFICADO');
  const entryLinkRef = doc(db, 'bankStatementLinks', entryId);
  await runTransaction(db, async (tx) => {
    const entryLink = await tx.get(entryLinkRef);
    if (!entryLink.exists()) return;
    const movementId = entryLink.data().movementId as string;
    const movementLinkRef = doc(db, 'bankMovementLinks', movementId);
    const movementLink = await tx.get(movementLinkRef);
    if (!movementLink.exists() || movementLink.data().entryId !== entryId) throw new Error('VINCULO_DE_CONFERENCIA_INCONSISTENTE');
    tx.delete(entryLinkRef);
    tx.delete(movementLinkRef);
    tx.set(doc(collection(db, 'bankStatementAuditEvents')), {
      statementId: entryLink.data().statementId, action: 'UNLINKED', entryId,
      movementId, actorUid, createdAt: serverTimestamp(),
    });
  });
};

export const addBankMovementJustification = async (
  statementId: string,
  movementId: string,
  reason: BankMovementJustificationReason,
  note: string,
  actorUid: string,
): Promise<void> => {
  const trimmedNote = note.trim();
  if (!actorUid || !movementId || !statementId || !reason || trimmedNote.length < 8 || trimmedNote.length > 1000) {
    throw new Error('JUSTIFICATIVA_OBRIGATORIA');
  }
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'bankMovementJustifications')), {
    statementId, movementId, reason, note: trimmedNote, actorUid, createdAt: serverTimestamp(),
  });
  batch.set(doc(collection(db, 'bankStatementAuditEvents')), {
    statementId, action: 'JUSTIFIED', movementId, actorUid, createdAt: serverTimestamp(),
  });
  await batch.commit();
};

export const removeBankStatement = async (statementId: string, actorUid: string): Promise<void> => {
  if (!actorUid) throw new Error('USUARIO_NAO_IDENTIFICADO');
  const importRef = doc(db, 'bankStatementImports', statementId);
  // Archive first: any concurrent link operation must see the statement as inactive.
  await runTransaction(db, async (tx) => {
    const current = await tx.get(importRef);
    if (!current.exists()) throw new Error('EXTRATO_NAO_ENCONTRADO');
    if (current.data().status !== 'ACTIVE') return;
    tx.update(importRef, { status: 'REMOVED', removedByUid: actorUid, removedAt: serverTimestamp() });
    tx.set(doc(collection(db, 'bankStatementAuditEvents')), {
      statementId, action: 'REMOVED', actorUid, createdAt: serverTimestamp(),
    });
  });
  while (true) {
    const linked = await getDocs(query(collection(db, 'bankStatementLinks'), where('statementId', '==', statementId), limit(200)));
    if (linked.empty) break;
    const batch = writeBatch(db);
    for (const item of linked.docs) {
      batch.delete(item.ref);
      batch.delete(doc(db, 'bankMovementLinks', item.data().movementId as string));
    }
    await batch.commit();
  }
};
