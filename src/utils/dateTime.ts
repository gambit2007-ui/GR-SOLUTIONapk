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
): string | null => {
  const source = toLocalDateAtNoon(value);
  if (!source || !Number.isInteger(offset) || offset < 0) return null;

  if (frequency === 'MONTHLY') return addCalendarMonthsClamped(source, offset);

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
