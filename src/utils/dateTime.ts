export const getLocalISODate = (baseDate: Date = new Date()): string => {
  const date = new Date(baseDate);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const formatDateTimeBR = (value: string | number | Date): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--/--/---- --:--';
  const datePart = date.toLocaleDateString('pt-BR');
  const timePart = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${datePart} ${timePart}`;
};

