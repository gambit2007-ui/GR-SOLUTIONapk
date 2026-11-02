export interface BankStatementRow {
  sequence: number;
  transactionDate: string;
  accountingDate: string;
  direction: 'IN' | 'OUT';
  type: string;
  description: string;
  amountCents: number;
}

export interface ParsedBankStatement {
  bank: 'C6 Bank';
  periodStart: string;
  periodEnd: string;
  closingBalanceCents: number;
  incomeCents: number;
  expenseCents: number;
  rows: BankStatementRow[];
}

interface PositionedText {
  str: string;
  transform: number[];
}

export const linesFromPdfItems = (items: PositionedText[]): string[] => {
  const positioned = items
    .filter((item) => item.str.trim() && Number.isFinite(item.transform[4]) && Number.isFinite(item.transform[5]))
    .map((item) => ({ text: item.str.trim(), x: item.transform[4], y: item.transform[5] }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: Array<{ y: number; items: typeof positioned }> = [];
  for (const item of positioned) {
    const group = groups.find((candidate) => Math.abs(candidate.y - item.y) <= 1.2);
    if (group) group.items.push(item);
    else groups.push({ y: item.y, items: [item] });
  }
  return groups.sort((a, b) => b.y - a.y)
    .map((group) => group.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
};

const MONTHS: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export const parseBrazilianMoneyCents = (value: string): number => {
  const match = value.replace(/\u00a0/g, ' ').trim().match(/^(-?)\s*R\$\s*([\d.]+),(\d{2})$/);
  if (!match) throw new Error('VALOR_BANCARIO_INVALIDO');
  const integer = Number(match[2].replaceAll('.', ''));
  const cents = integer * 100 + Number(match[3]);
  if (!Number.isSafeInteger(cents)) throw new Error('VALOR_BANCARIO_INVALIDO');
  return match[1] ? -cents : cents;
};

const parseLongDate = (day: string, month: string, year: string): string => {
  const monthNumber = MONTHS[normalize(month)];
  if (!monthNumber) throw new Error('MES_DO_EXTRATO_INVALIDO');
  return `${year}-${String(monthNumber).padStart(2, '0')}-${day.padStart(2, '0')}`;
};

const parseNumericDate = (day: string, month: string, year: string): string => {
  const dayNumber = Number(day);
  const monthNumber = Number(month);
  const yearNumber = Number(year.length === 2 ? `20${year}` : year);
  const date = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));
  if (
    date.getUTCFullYear() !== yearNumber
    || date.getUTCMonth() !== monthNumber - 1
    || date.getUTCDate() !== dayNumber
  ) {
    throw new Error('DATA_DO_EXTRATO_INVALIDA');
  }
  return date.toISOString().slice(0, 10);
};

const resolveShortDate = (shortDate: string, periodStart: string, periodEnd: string): string => {
  const [day, month] = shortDate.split('/').map(Number);
  const startYear = Number(periodStart.slice(0, 4));
  const endYear = Number(periodEnd.slice(0, 4));
  const candidates = [...new Set([startYear, endYear])].map((year) => {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
      ? date.toISOString().slice(0, 10) : '';
  });
  const found = candidates.find((date) => date >= periodStart && date <= periodEnd);
  if (!found) throw new Error('DATA_FORA_DO_PERIODO_DO_EXTRATO');
  return found;
};

export const parseC6StatementLines = (pages: string[][]): ParsedBankStatement => {
  const lines = pages.flat().map((line) => line.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const header = lines.join('\n');
  const isLegacyC6Layout = /Extrato exportado no dia/i.test(header);
  const isCurrentC6Layout = /Extrato da conta/i.test(header) && /\bC6\s+Bank\b/i.test(header);
  if ((!isLegacyC6Layout && !isCurrentC6Layout) || !/Ag[eê]ncia:.*Conta:/i.test(header)) {
    throw new Error('FORMATO_C6_NAO_RECONHECIDO');
  }

  const longPeriod = header.match(/Per[ií]odo\s*[•·-]?\s*(\d{1,2}) de ([A-Za-zÀ-ÿ]+) de (\d{4}) at[eé] (\d{1,2}) de ([A-Za-zÀ-ÿ]+) de (\d{4})/i);
  const numericPeriod = header.match(/\(?\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*(?:-|–|a|at[eé])\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*\)?/i);
  if (!longPeriod && !numericPeriod) throw new Error('PERIODO_DO_EXTRATO_NAO_ENCONTRADO');
  const periodStart = longPeriod
    ? parseLongDate(longPeriod[1], longPeriod[2], longPeriod[3])
    : parseNumericDate(numericPeriod![1], numericPeriod![2], numericPeriod![3]);
  const periodEnd = longPeriod
    ? parseLongDate(longPeriod[4], longPeriod[5], longPeriod[6])
    : parseNumericDate(numericPeriod![4], numericPeriod![5], numericPeriod![6]);
  if (periodStart > periodEnd) throw new Error('PERIODO_DO_EXTRATO_INVALIDO');

  const longClosingMatch = header.match(/Saldo do dia\s*[•·-]?\s*\d{1,2} de [A-Za-zÀ-ÿ]+ de \d{4}\s*[•·-]?\s*(-?R\$\s*[\d.]+,\d{2})/i);
  const exportClosingMatch = header.match(/Saldo no dia da exporta[çc][aã]o\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s*(?:-|–|a|at[eé])\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s*(-?R\$\s*[\d.]+,\d{2})/i);
  const shortClosingMatches = [...header.matchAll(/Saldo(?:\s+cont[aá]bil)? do dia\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*(-?R\$\s*[\d.]+,\d{2})/gi)];
  const periodEndClosingMatch = shortClosingMatches.find((match) =>
    parseNumericDate(match[1], match[2], match[3]) === periodEnd,
  );
  const closingBalanceCents = longClosingMatch
    ? parseBrazilianMoneyCents(longClosingMatch[1])
    : exportClosingMatch
      ? parseBrazilianMoneyCents(exportClosingMatch[1])
    : periodEndClosingMatch
      ? parseBrazilianMoneyCents(periodEndClosingMatch[4])
      : (() => { throw new Error('SALDO_FINAL_NAO_ENCONTRADO'); })();

  const monthSummaries = [...header.matchAll(/Entradas:\s*(R\$\s*[\d.]+,\d{2})\s*[•·-]?\s*Sa[ií]das:\s*(R\$\s*[\d.]+,\d{2})/gim)];
  if (monthSummaries.length === 0) throw new Error('TOTAIS_DO_EXTRATO_NAO_ENCONTRADOS');
  const reportedIncomeCents = monthSummaries.reduce((sum, match) => sum + parseBrazilianMoneyCents(match[1]), 0);
  const reportedExpenseCents = monthSummaries.reduce((sum, match) => sum + parseBrazilianMoneyCents(match[2]), 0);

  const rows: BankStatementRow[] = [];
  const transactionPrefix = /^\d{2}\/\d{2}\s+\d{2}\/\d{2}\s+(Entrada|Sa[ií]da)\b/i;
  const transactionPattern = /^(\d{2}\/\d{2})\s+(\d{2}\/\d{2})\s+(Entrada|Sa[ií]da)\s+(PIX|TED|DOC|BOLETO|TRANSFER[EÊ]NCIA|TARIFA|PAGAMENTO|RENDIMENTO)\s+(.+?)\s+(-?R\$\s*[\d.]+,\d{2})$/i;
  for (const line of lines) {
    if (!transactionPrefix.test(line)) continue;
    const match = line.match(transactionPattern);
    if (!match) throw new Error('LINHA_BANCARIA_NAO_RECONHECIDA');
    const direction: BankStatementRow['direction'] = normalize(match[3]) === 'entrada' ? 'IN' : 'OUT';
    const signedCents = parseBrazilianMoneyCents(match[6]);
    if ((direction === 'IN' && signedCents <= 0) || (direction === 'OUT' && signedCents >= 0)) {
      throw new Error('SINAL_BANCARIO_INCONSISTENTE');
    }
    rows.push({
      sequence: rows.length + 1,
      transactionDate: resolveShortDate(match[1], periodStart, periodEnd),
      accountingDate: resolveShortDate(match[2], periodStart, periodEnd),
      direction,
      type: match[4].toUpperCase(),
      description: match[5].trim(),
      amountCents: Math.abs(signedCents),
    });
  }

  if (rows.length === 0) throw new Error('EXTRATO_SEM_LANCAMENTOS');
  const incomeCents = rows.filter((row) => row.direction === 'IN').reduce((sum, row) => sum + row.amountCents, 0);
  const expenseCents = rows.filter((row) => row.direction === 'OUT').reduce((sum, row) => sum + row.amountCents, 0);
  if (incomeCents !== reportedIncomeCents || expenseCents !== reportedExpenseCents) {
    throw new Error('TOTAIS_DO_PDF_DIVERGEM_DAS_LINHAS');
  }
  return { bank: 'C6 Bank', periodStart, periodEnd, closingBalanceCents, incomeCents, expenseCents, rows };
};
