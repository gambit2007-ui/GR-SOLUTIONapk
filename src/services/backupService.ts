import { collection, getDocs, query } from 'firebase/firestore';
import { db } from '../firebase';

interface BackupItem {
  id: string;
  [key: string]: unknown;
}

export interface BackupPayload {
  generatedAt: string;
  customers: BackupItem[];
  loans: BackupItem[];
  cashMovement: BackupItem[];
  settings: BackupItem[];
}

const mapSnapshotItems = (docs: Array<{ id: string; data: () => Record<string, unknown> }>): BackupItem[] =>
  docs.map((item) => ({ id: item.id, ...item.data() }));

export const buildBackupPayload = async (): Promise<BackupPayload> => {
  const [customersSnap, loansSnap, movementsSnap, settingsSnap] = await Promise.all([
    getDocs(collection(db, 'clientes')),
    getDocs(collection(db, 'loans')),
    getDocs(collection(db, 'cashMovement')),
    getDocs(query(collection(db, 'settings'))),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    customers: mapSnapshotItems(customersSnap.docs),
    loans: mapSnapshotItems(loansSnap.docs),
    cashMovement: mapSnapshotItems(movementsSnap.docs),
    settings: mapSnapshotItems(settingsSnap.docs),
  };
};

export const createBackupDownload = async () => {
  const payload = await buildBackupPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const filename = `backup-grjuros-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  return { blob, filename };
};

