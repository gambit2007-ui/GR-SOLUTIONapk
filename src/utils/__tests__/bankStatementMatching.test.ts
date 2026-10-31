import { describe, expect, it } from 'vitest';
import { bankPixPayerName, cashMovementMatchesBankEntry, evaluateBankMatch, expectedPayerName, isAppReceipt, isBankReceipt, orderBankReceiptsForReview, planAutomaticBankMatches } from '../bankStatementMatching';
import type { CashMovement } from '../../types';
import type { BankStatementRow } from '../c6StatementParser';

const payment = (id: string, name: string, amount = 100): CashMovement => ({
  id, type: 'PAGAMENTO', amount, description: `Pagamento: ${name}`, date: '2026-09-03',
});
const pix = (id: string, name: string, amountCents = 10000): BankStatementRow & { id: string } => ({
  id, sequence: 1, transactionDate: '2026-09-03', accountingDate: '2026-09-03',
  direction: 'IN', type: 'PIX', description: `Pix recebido de ${name}`, amountCents,
});
const plan = (entries: ReturnType<typeof pix>[], movements: CashMovement[],
  linkedEntries: string[] = [], linkedMovements: string[] = []) => planAutomaticBankMatches(
  entries, movements, new Map(), new Set(linkedEntries), new Set(linkedMovements), '2026-09-01', '2026-09-30',
);

describe('vinculo bancario manual', () => {
  it('exige valor e sentido iguais ao movimento financeiro existente', () => {
    const movement = { type: 'PAGAMENTO' as const, amount: 500, description: 'Pagamento', date: '2026-09-01' };
    const entry = { direction: 'IN' as const, amountCents: 50000, type: 'PIX', description: 'Pix recebido de João da Silva' };
    expect(cashMovementMatchesBankEntry(movement, entry, 'João da Silva')).toBe(true);
    expect(cashMovementMatchesBankEntry(movement, { ...entry, direction: 'OUT' }, 'João da Silva')).toBe(false);
    expect(cashMovementMatchesBankEntry(movement, { ...entry, amountCents: 49999 }, 'João da Silva')).toBe(false);
  });

  it('reconhece saida sem criar ou reclassificar uma despesa', () => {
    const movement = { type: 'SAIDA' as const, amount: 200, description: 'Saida', date: '2026-09-01' };
    expect(cashMovementMatchesBankEntry(movement, {
      direction: 'OUT', amountCents: 20000, type: 'PIX', description: 'Pix enviado para fornecedor',
    })).toBe(true);
  });

  it('nao confere Pix de outra pessoa mesmo com valor identico', () => {
    const payment = { type: 'PAGAMENTO' as const, amount: 100, loanId: 'loan-1', description: 'PAGAMENTO: JOAO DA SILVA', date: '2026-09-01' };
    const payer = expectedPayerName(payment, { customerName: 'João da Silva' });
    const bank = { direction: 'IN' as const, amountCents: 10000, type: 'PIX', description: 'Pix recebido de MARIA SOUZA' };
    expect(evaluateBankMatch(payment, bank, payer)).toBe('PAYER_MISMATCH');
    expect(cashMovementMatchesBankEntry(payment, bank, payer)).toBe(false);
  });

  it('reconhece acentos e identificador numerico do pagador no PDF C6', () => {
    const payment = { type: 'PAGAMENTO' as const, amount: 100, description: 'PAGAMENTO: ROBSON LEANDRO DA SILVA', date: '2026-09-01' };
    const bank = { direction: 'IN' as const, amountCents: 10000, type: 'PIX', description: 'Pix recebido c6 de 57.941.926 ROBSON LEANDRO DA SILVA' };
    expect(bankPixPayerName(bank.description)).toContain('ROBSON');
    expect(evaluateBankMatch(payment, bank, expectedPayerName(payment))).toBe('MATCH');
  });

  it('nao declara conferido quando o pagador do contrato e desconhecido ou nao ha Pix', () => {
    const payment = { type: 'PAGAMENTO' as const, amount: 100, description: 'Pagamento legado', date: '2026-09-01' };
    const bank = { direction: 'IN' as const, amountCents: 10000, type: 'PIX', description: 'Pix recebido de João' };
    expect(evaluateBankMatch(payment, bank)).toBe('PAYER_UNKNOWN');
    expect(evaluateBankMatch(payment, { ...bank, type: 'TED' }, 'João')).toBe('NOT_PIX_RECEIPT');
  });

  it('nao confere emprestimo enviado por Pix a outro destinatario', () => {
    const loanOutflow = {
      type: 'RETIRADA' as const, amount: 100, loanId: 'loan-1',
      description: 'EMPRESTIMO: JOAO DA SILVA', date: '2026-09-01',
    };
    const bank = { direction: 'OUT' as const, amountCents: 10000, type: 'PIX', description: 'Pix enviado para MARIA SOUZA' };
    expect(evaluateBankMatch(loanOutflow, bank, expectedPayerName(loanOutflow, { customerName: 'João da Silva' })))
      .toBe('PAYER_MISMATCH');
  });
});

describe('conferencia automatica conservadora', () => {
  it('vincula um unico Pix de mesmo nome, valor e sentido', () => {
    expect(plan([pix('bank-1', 'João da Silva')], [payment('gr-1', 'Joao da Silva')]))
      .toEqual([{ entryId: 'bank-1', movementId: 'gr-1' }]);
  });

  it('deixa nome ou valor diferente pendente', () => {
    expect(plan([pix('bank-1', 'Maria', 10000)], [payment('gr-1', 'Joao')])).toEqual([]);
    expect(plan([pix('bank-1', 'Joao', 9999)], [payment('gr-1', 'Joao')])).toEqual([]);
  });

  it('deixa ambiguo quando ha dois Pix ou dois pagamentos identicos', () => {
    expect(plan([pix('b1', 'Joao'), pix('b2', 'Joao')], [payment('g1', 'Joao')])).toEqual([]);
    expect(plan([pix('b1', 'Joao')], [payment('g1', 'Joao'), payment('g2', 'Joao')])).toEqual([]);
  });

  it('nao inclui saidas, outros tipos, datas fora do periodo ou vinculos existentes', () => {
    const entry = pix('b1', 'Joao');
    const movement = payment('g1', 'Joao');
    expect(plan([{ ...entry, direction: 'OUT' }], [movement])).toEqual([]);
    expect(plan([entry], [{ ...movement, type: 'ENTRADA' }])).toEqual([]);
    expect(plan([{ ...entry, type: 'TED' }], [movement])).toEqual([]);
    expect(plan([entry], [{ ...movement, date: '2026-08-31' }])).toEqual([]);
    expect(plan([entry], [movement], ['b1'])).toEqual([]);
    expect(plan([entry], [movement], [], ['g1'])).toEqual([]);
  });

  it('nao reconcilia automaticamente entrada bancaria ja conferida por observacao', () => {
    expect(plan([pix('bank-reviewed', 'Joao')], [payment('gr-1', 'Joao')], ['bank-reviewed']))
      .toEqual([]);
  });

  it('nao assume o nome quando o historico nao o identifica', () => {
    expect(plan([pix('b1', 'Joao')], [{ ...payment('g1', 'Joao'), description: 'Pagamento legado' }])).toEqual([]);
  });
});

describe('escopo de conferencia de recebimentos', () => {
  it('seleciona entradas bancarias e ignora saidas sem apagar o extrato', () => {
    const received = pix('in', 'Joao');
    const paid = { ...received, id: 'out', direction: 'OUT' as const };
    expect([received, paid].filter(isBankReceipt)).toEqual([received]);
  });

  it('seleciona movimentos positivos da GR, nao despesas ou emprestimos concedidos', () => {
    const received = payment('received', 'Joao');
    const deposit: CashMovement = { ...received, id: 'deposit', type: 'APORTE' };
    const expense: CashMovement = { ...received, id: 'expense', type: 'SAIDA' };
    const loanOutflow: CashMovement = { ...received, id: 'loan', type: 'RETIRADA' };
    expect([received, deposit, expense, loanOutflow].filter(isAppReceipt))
      .toEqual([received, deposit]);
  });
});

describe('ordem de revisao das entradas bancarias', () => {
  it('mostra automaticos antes dos pendentes por data e deixa manuais ja conferidos ao final', () => {
    const entries = [
      { ...pix('pending-new', 'A'), transactionDate: '2026-09-25' },
      { ...pix('manual', 'B'), transactionDate: '2026-09-01' },
      { ...pix('auto-new', 'C'), transactionDate: '2026-09-20' },
      { ...pix('pending-old', 'D'), transactionDate: '2026-09-02' },
      { ...pix('auto-old', 'E'), transactionDate: '2026-09-03' },
    ];
    const links = new Map([
      ['manual', { matchMode: 'MANUAL' as const }],
      ['auto-new', { matchMode: 'AUTO' as const }],
      ['auto-old', { matchMode: 'AUTO' as const }],
    ]);
    expect(orderBankReceiptsForReview(entries, links).map((entry) => entry.id))
      .toEqual(['auto-old', 'auto-new', 'pending-old', 'pending-new', 'manual']);
    expect(entries[0].id).toBe('pending-new');
  });

  it('usa sequencia e ID para desempate estavel na mesma data', () => {
    const sameDay = '2026-09-03';
    const entries = [
      { ...pix('z', 'Z'), transactionDate: sameDay, sequence: 2 },
      { ...pix('b', 'B'), transactionDate: sameDay, sequence: 1 },
      { ...pix('a', 'A'), transactionDate: sameDay, sequence: 1 },
    ];
    expect(orderBankReceiptsForReview(entries, new Map()).map((entry) => entry.id))
      .toEqual(['a', 'b', 'z']);
  });

  it('coloca entradas conferidas por observacao no grupo manual sem esconder pendencias', () => {
    const entries = [
      { ...pix('reviewed', 'A'), transactionDate: '2026-09-01' },
      { ...pix('pending', 'B'), transactionDate: '2026-09-02' },
      { ...pix('auto', 'C'), transactionDate: '2026-09-03' },
    ];
    expect(orderBankReceiptsForReview(entries, new Map([['auto', { matchMode: 'AUTO' }]]), new Set(['reviewed']))
      .map((entry) => entry.id)).toEqual(['auto', 'pending', 'reviewed']);
  });
});
