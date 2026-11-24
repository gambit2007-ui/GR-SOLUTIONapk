// Date-only financial records represent a calendar day, not midnight UTC.
// Timestamps retain their instant and continue to use the report's local zone.
export const parseFinancialDate = (value: unknown): Date | null => {
  if (value === null || value === undefined || value === '') return null;
  let date: Date;
  if (value instanceof Date) {
    date = new Date(value);
  } else if (typeof value === 'number') {
    date = new Date(value);
  } else if (typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    try {
      const converted = (value as { toDate: () => unknown }).toDate();
      if (!(converted instanceof Date)) return null;
      date = new Date(converted);
    } catch {
      return null;
    }
  } else if (typeof value === 'string') {
    const normalized = value.trim();
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
    date = new Date(day ? `${normalized}T12:00:00` : normalized);
    if (day && (
      date.getFullYear() !== Number(day[1]) ||
      date.getMonth() + 1 !== Number(day[2]) ||
      date.getDate() !== Number(day[3])
    )) return null;
  } else {
    return null;
  }
  return Number.isNaN(date.getTime()) ? null : date;
};

export const getFinancialMonthKey = (value: unknown): string | null => {
  const date = parseFinancialDate(value);
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` : null;
};

export const getLocalISODate = (baseDate: Date = new Date()): string => {
  const date = new Date(baseDate);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const canCloseMonth = (month: string, referenceDate = new Date()): boolean => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return false;
  const currentMonth = `${referenceDate.getFullYear()}-${String(referenceDate.getMonth() + 1).padStart(2, '0')}`;
  return month < currentMonth;
};

const toLocalDateAtNoon = (value: string | Date): Date | null => {
  const date = value instanceof Date ? new Date(value) : new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeDailyChargeDays = (value?: readonly number[]): number[] | null => {
  if (!value) return null;
  const days = [...new Set(value.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
  return days.length > 0 ? days : null;
};

export const addCalendarMonthsClamped = (value: string | Date, months: number): string | null => {
  const source = toLocalDateAtNoon(value);
  if (!source || !Number.isInteger(months)) return null;

  const originalDay = source.getDate();
  const target = new Date(source.getFullYear(), source.getMonth() + months, 1, 12);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
  target.setDate(Math.min(originalDay, lastDay));
  return getLocalISODate(target);
};

export const buildInstallmentDueDate = (
  value: string | Date,
  offset: number,
  frequency: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY',
  dailyChargeDays?: readonly number[],
): string | null => {
  const source = toLocalDateAtNoon(value);
  if (!source || !Number.isInteger(offset) || offset < 0) return null;

  if (frequency === 'MONTHLY') return addCalendarMonthsClamped(source, offset);

  if (frequency === 'DAILY') {
    const selectedDays = normalizeDailyChargeDays(dailyChargeDays);
    if (selectedDays) {
      const target = new Date(source);
      let remainingCharges = offset;
      while (remainingCharges > 0) {
        target.setDate(target.getDate() + 1);
        if (selectedDays.includes(target.getDay())) remainingCharges -= 1;
      }
      return getLocalISODate(target);
    }
  }

  const target = new Date(source);
  const days = frequency === 'DAILY' ? offset : frequency === 'WEEKLY' ? offset * 7 : offset * 15;
  target.setDate(source.getDate() + days);
  return getLocalISODate(target);
};

export const formatDateTimeBR = (value: string | number | Date): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--/--/---- --:--';
  const datePart = date.toLocaleDateString('pt-BR');
  const timePart = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${datePart} ${timePart}`;
};
