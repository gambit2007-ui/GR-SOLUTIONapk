import type { View } from '../types';
import type { DataStatus } from './realtimeResource';

type Source = 'customers' | 'loans' | 'movements' | 'snapshots' | 'cash' | 'fees';
export type DataStatuses = Record<Source, DataStatus>;
const requirements: Record<View, Source[]> = {
  DASHBOARD: ['loans', 'fees'], CUSTOMERS: ['loans', 'fees'], LOANS: ['customers', 'fees'],
  REPORTS: ['loans', 'movements', 'snapshots', 'cash', 'fees'],
  AUDIT: ['loans', 'movements', 'cash'], SIMULATION: [],
};

export const getViewDataStatus = (view: View, statuses: DataStatuses): DataStatus => {
  const required = requirements[view].map((source) => statuses[source]);
  if (required.includes('error')) return 'error';
  return required.every((status) => status === 'ready') ? 'ready' : 'loading';
};
