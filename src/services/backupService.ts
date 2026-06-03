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
  generatedAt: string;
  customers: BackupItem[];
  loans: BackupItem[];
  cashMovement: BackupItem[];
  settings: BackupItem[];
  assetSummary: BackupAssetSummary;
}

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

export const buildBackupPayload = async (): Promise<BackupPayload> => {
  const [customersSnap, loansSnap, movementsSnap, settingsSnap] = await Promise.all([
    getDocs(collection(db, 'clientes')),
    getDocs(collection(db, 'loans')),
    getDocs(collection(db, 'cashMovement')),
    getDocs(query(collection(db, 'settings'))),
  ]);

  const { customers, summary } = await embedCustomerAssets(mapSnapshotItems(customersSnap.docs));

  return {
    generatedAt: new Date().toISOString(),
    customers,
    loans: mapSnapshotItems(loansSnap.docs),
    cashMovement: mapSnapshotItems(movementsSnap.docs),
    settings: mapSnapshotItems(settingsSnap.docs),
    assetSummary: summary,
  };
};

export const createBackupDownload = async () => {
  const payload = await buildBackupPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const filename = `backup-grjuros-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  return { blob, filename };
};
