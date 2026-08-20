import { collection, getDocs, query } from 'firebase/firestore';
import { db } from '../firebase';

interface BackupItem {
  id: string;
  [key: string]: unknown;
}

interface BackupAssetSummary {
  embeddedCustomerPhotos: number;
  embeddedCustomerDocuments: number;
  failedAssets: number;
}

export interface BackupPayload {
  schemaVersion: 2;
  generatedAt: string;
  customers: BackupItem[];
  loans: BackupItem[];
  cashMovement: BackupItem[];
  settings: BackupItem[];
  monthlySnapshots: BackupItem[];
  migrationRuns: BackupItem[];
  assetSummary: BackupAssetSummary;
  integrity: {
    algorithm: 'SHA-256';
    checksum: string;
    counts: {
      customers: number;
      loans: number;
      cashMovement: number;
      settings: number;
      monthlySnapshots: number;
      migrationRuns: number;
    };
  };
}

export type BackupPayloadWithoutIntegrity = Omit<BackupPayload, 'integrity'>;

const mapSnapshotItems = (docs: Array<{ id: string; data: () => Record<string, unknown> }>): BackupItem[] =>
  docs.map((item) => ({ id: item.id, ...item.data() }));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isDataUrl = (value: unknown): value is string =>
  typeof value === 'string' && /^data:/i.test(value.trim());

const toTrimmedString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('Falha ao converter arquivo em data URL.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler arquivo do backup.'));
    reader.readAsDataURL(blob);
  });

const downloadAsDataUrl = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const blob = await response.blob();
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
};

const embedPhotoData = async (customer: BackupItem, summary: BackupAssetSummary): Promise<BackupItem> => {
  const currentAvatar = toTrimmedString(customer.avatar);
  const currentPhotoUrl = toTrimmedString(customer.photoUrl);

  if (isDataUrl(currentAvatar) || isDataUrl(currentPhotoUrl)) {
    return customer;
  }

  const downloadCandidate = currentPhotoUrl || currentAvatar;
  if (!downloadCandidate) {
    return customer;
  }

  const embeddedAvatar = await downloadAsDataUrl(downloadCandidate);
  if (!embeddedAvatar) {
    summary.failedAssets += 1;
    return customer;
  }

  summary.embeddedCustomerPhotos += 1;
  return {
    ...customer,
    avatar: embeddedAvatar,
  };
};

const embedDocumentData = async (
  rawDocument: unknown,
  summary: BackupAssetSummary,
): Promise<Record<string, unknown> | null> => {
  if (!isRecord(rawDocument)) {
    return null;
  }

  const document: Record<string, unknown> = { ...rawDocument };
  const currentData = toTrimmedString(document.data);
  const currentUrl = toTrimmedString(document.url);

  if (isDataUrl(currentData)) {
    return document;
  }

  if (isDataUrl(currentUrl)) {
    summary.embeddedCustomerDocuments += 1;
    return {
      ...document,
      data: currentUrl,
    };
  }

  if (!currentUrl) {
    return document;
  }

  const embeddedData = await downloadAsDataUrl(currentUrl);
  if (!embeddedData) {
    summary.failedAssets += 1;
    return document;
  }

  summary.embeddedCustomerDocuments += 1;
  return {
    ...document,
    data: embeddedData,
  };
};

const embedCustomerAssets = async (rawCustomers: BackupItem[]) => {
  const summary: BackupAssetSummary = {
    embeddedCustomerPhotos: 0,
    embeddedCustomerDocuments: 0,
    failedAssets: 0,
  };

  const customersWithAssets: BackupItem[] = [];

  for (const rawCustomer of rawCustomers) {
    let customer = await embedPhotoData(rawCustomer, summary);
    const rawDocuments = Array.isArray(customer.documents) ? customer.documents : [];
    const hydratedDocuments: Record<string, unknown>[] = [];

    for (const rawDocument of rawDocuments) {
      const hydratedDocument = await embedDocumentData(rawDocument, summary);
      if (hydratedDocument) {
        hydratedDocuments.push(hydratedDocument);
      }
    }

    if (rawDocuments.length > 0) {
      customer = {
        ...customer,
        documents: hydratedDocuments,
      };
    }

    customersWithAssets.push(customer);
  }

  return {
    customers: customersWithAssets,
    summary,
  };
};

const calculateSha256 = async (payload: BackupPayloadWithoutIntegrity): Promise<string> => {
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

export const validateBackupPayload = async (payload: BackupPayload): Promise<boolean> => {
  if (!payload || payload.schemaVersion !== 2 || payload.integrity?.algorithm !== 'SHA-256') return false;
  const { integrity, ...content } = payload;
  const countsMatch = integrity.counts.customers === content.customers.length &&
    integrity.counts.loans === content.loans.length &&
    integrity.counts.cashMovement === content.cashMovement.length &&
    integrity.counts.settings === content.settings.length &&
    integrity.counts.monthlySnapshots === content.monthlySnapshots.length &&
    integrity.counts.migrationRuns === content.migrationRuns.length;
  if (!countsMatch) return false;
  return (await calculateSha256(content)) === integrity.checksum;
};

export const createBackupPayloadWithIntegrity = async (
  content: BackupPayloadWithoutIntegrity,
): Promise<BackupPayload> => ({
  ...content,
  integrity: {
    algorithm: 'SHA-256',
    checksum: await calculateSha256(content),
    counts: {
      customers: content.customers.length,
      loans: content.loans.length,
      cashMovement: content.cashMovement.length,
      settings: content.settings.length,
      monthlySnapshots: content.monthlySnapshots.length,
      migrationRuns: content.migrationRuns.length,
    },
  },
});

export const buildBackupPayload = async (): Promise<BackupPayload> => {
  const [customersSnap, loansSnap, movementsSnap, settingsSnap, monthlySnapshotsSnap, migrationRunsSnap] = await Promise.all([
    getDocs(collection(db, 'clientes')),
    getDocs(collection(db, 'loans')),
    getDocs(collection(db, 'cashMovement')),
    getDocs(query(collection(db, 'settings'))),
    getDocs(query(collection(db, 'monthlySnapshots'))),
    getDocs(query(collection(db, 'migrationRuns'))),
  ]);

  const { customers, summary } = await embedCustomerAssets(mapSnapshotItems(customersSnap.docs));

  const content: BackupPayloadWithoutIntegrity = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    customers,
    loans: mapSnapshotItems(loansSnap.docs),
    cashMovement: mapSnapshotItems(movementsSnap.docs),
    settings: mapSnapshotItems(settingsSnap.docs),
    monthlySnapshots: mapSnapshotItems(monthlySnapshotsSnap.docs),
    migrationRuns: mapSnapshotItems(migrationRunsSnap.docs),
    assetSummary: summary,
  };
  return createBackupPayloadWithIntegrity(content);
};
