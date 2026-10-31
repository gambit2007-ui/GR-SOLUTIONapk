import React, { useEffect, useMemo, useState } from 'react';
import { FileSearch, LoaderCircle, Link2, Unlink2 } from 'lucide-react';
import type { CashMovement, Loan } from '../types';
import { resolveCashDelta } from '../utils/domainParsers';
import { getLocalISODate } from '../utils/dateTime';
import { bankPixCounterpartyName, evaluateBankMatch, expectedPayerName, isAppReceipt, isBankReceipt, orderBankReceiptsForReview, planAutomaticBankMatches } from '../utils/bankStatementMatching';
import type { StatementPdfPreview } from '../utils/c6Pdf';
import { readC6StatementPdfWithFallback } from '../services/c6PdfPreviewService';
import {
  addBankEntryJustification, addBankMovementJustification, importBankStatement, linkBankEntryToCashMovement,
  listBankEntryJustifications, listBankMovementJustifications, listBankStatementEntries, listBankStatementImports,
  listBankStatementLinks, listBankStatementAuditEvents, removeBankStatement, unlinkBankEntry,
  type BankMovementJustification, type BankMovementJustificationReason,
  type BankStatementEntry, type BankStatementImport, type BankStatementLink,
  type BankEntryJustification, type BankStatementAuditEvent,
} from '../services/bankStatementAuditService';

interface Props {
  loans: Loan[];
  cashMovements: CashMovement[];
  cashMovementsStatus: 'idle' | 'loading' | 'ready' | 'error';
  currentUserUid?: string;
  showToast: (message: string, type?: 'success' | 'error') => void;
}

const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const movementDate = (date: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? '' : getLocalISODate(parsed);
};

const reasonLabels: Record<BankMovementJustificationReason, string> = {
  CASH: 'Dinheiro',
  OTHER_ACCOUNT: 'Outra conta',
  THIRD_PARTY_PIX: 'Pix de terceiro',
  OTHER_METHOD: 'Outro meio',
  NEEDS_CORRECTION: 'Lancamento precisa ser corrigido',
};

const explainError = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  const known: Record<string, string> = {
    FORMATO_C6_NAO_RECONHECIDO: 'Este PDF nao tem o formato de extrato C6 validado.',
    ARQUIVO_PDF_OBRIGATORIO: 'Selecione um arquivo PDF valido.',
    PASSWORD_INVALID: 'Senha incorreta ou PDF protegido de forma nao suportada.',
    PDF_FALLBACK_SIZE_LIMIT: 'Este PDF e grande demais para a leitura alternativa no iPhone. Use um arquivo de ate 3 MB ou um computador.',
    PDF_FALLBACK_FILE_READ_FAILED: 'O iPhone nao conseguiu abrir o arquivo selecionado. Salve o PDF em Arquivos e tente novamente.',
    PDF_FALLBACK_NETWORK_FAILED: 'O iPhone nao conseguiu acessar a leitura alternativa. Verifique a conexao e tente novamente.',
    PDF_PREVIEW_FAILED: 'A leitura alternativa do PDF falhou. Nenhum lancamento foi importado.',
    PERIODO_DO_EXTRATO_NAO_ENCONTRADO: 'Nao foi possivel identificar o periodo do PDF.',
    SALDO_FINAL_NAO_ENCONTRADO: 'Nao foi possivel identificar o saldo final do PDF.',
    LINHA_BANCARIA_NAO_RECONHECIDA: 'Existe uma linha bancaria que nao foi reconhecida. Nenhum lancamento foi importado.',
    TOTAIS_DO_PDF_DIVERGEM_DAS_LINHAS: 'Os lancamentos extraidos nao fecham com os totais impressos. Importacao bloqueada.',
    EXTRATO_JA_IMPORTADO: 'Este mesmo PDF ja foi importado e esta ativo.',
    VALOR_OU_SENTIDO_NAO_CONFERE: 'Valor ou sentido diferente do lancamento da GR.',
    PAGADOR_NAO_CONFERE: 'O Pix nao e do cliente esperado. Para Pix de terceiro, informe o motivo da excecao.',
    LANCAMENTO_JA_VINCULADO: 'Uma das movimentacoes ja esta vinculada.',
    VINCULO_AUTOMATICO_NAO_SEGURO: 'A conferencia automatica deixou este lancamento para revisao manual.',
    JUSTIFICATIVA_OBRIGATORIA: 'Informe uma justificativa com pelo menos 8 caracteres.',
  };
  if (known[message]) return known[message];
  if (/password/i.test(message)) return 'Senha incorreta ou PDF protegido de forma nao suportada.';
  if (/Setting up fake worker failed/i.test(message) && /text\/html/i.test(message)) {
    return 'O app instalado esta usando um leitor de PDF antigo. Feche-o completamente, abra novamente e selecione o extrato de novo.';
  }
  if (error instanceof TypeError && /undefined is not a function|is not a function/i.test(message)) {
    return 'Este navegador nao conseguiu ler o PDF. Atualize o iOS/Safari ou selecione o arquivo em um computador.';
  }
  return message || 'Falha na conferencia do extrato.';
};

const BankStatementAudit: React.FC<Props> = ({ loans, cashMovements, cashMovementsStatus, currentUserUid, showToast }) => {
  const [imports, setImports] = useState<BankStatementImport[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [entries, setEntries] = useState<BankStatementEntry[]>([]);
  const [links, setLinks] = useState<BankStatementLink[]>([]);
  const [justifications, setJustifications] = useState<BankMovementJustification[]>([]);
  const [entryJustifications, setEntryJustifications] = useState<BankEntryJustification[]>([]);
  const [events, setEvents] = useState<BankStatementAuditEvent[]>([]);
  const [password, setPassword] = useState('');
  const [preview, setPreview] = useState<StatementPdfPreview | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState('');
  const [selectedMovementId, setSelectedMovementId] = useState('');
  const [manualNote, setManualNote] = useState('');
  const [justifyingEntryId, setJustifyingEntryId] = useState('');
  const [bankEntryNote, setBankEntryNote] = useState('');
  const [justifyingMovementId, setJustifyingMovementId] = useState('');
  const [reason, setReason] = useState<BankMovementJustificationReason>('CASH');
  const [note, setNote] = useState('');
  const [visibleCount, setVisibleCount] = useState(30);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const refreshImports = async () => {
    const items = await listBankStatementImports();
    setImports(items);
    return items;
  };

  const refreshSelected = async (statementId: string) => {
    const [nextEntries, nextLinks, nextJustifications, nextEntryJustifications, nextEvents] = await Promise.all([
      listBankStatementEntries(statementId), listBankStatementLinks(), listBankMovementJustifications(statementId),
      listBankEntryJustifications(statementId), listBankStatementAuditEvents(statementId),
    ]);
    setEntries(nextEntries);
    setLinks(nextLinks);
    setJustifications(nextJustifications);
    setEntryJustifications(nextEntryJustifications);
    setEvents(nextEvents);
  };

  useEffect(() => {
    let active = true;
    void listBankStatementImports().then((items) => {
      if (active) setImports(items);
    }).catch((error) => {
      if (active) showToast(explainError(error), 'error');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setEntries([]); setLinks([]); setJustifications([]); setEntryJustifications([]); setEvents([]);
      return;
    }
    let active = true;
    setLoading(true);
    void Promise.all([
      listBankStatementEntries(selectedId), listBankStatementLinks(), listBankMovementJustifications(selectedId),
      listBankEntryJustifications(selectedId), listBankStatementAuditEvents(selectedId),
    ]).then(([nextEntries, nextLinks, nextJustifications, nextEntryJustifications, nextEvents]) => {
      if (!active) return;
      setEntries(nextEntries); setLinks(nextLinks); setJustifications(nextJustifications);
      setEntryJustifications(nextEntryJustifications); setEvents(nextEvents);
    }).catch((error) => {
      if (active) showToast(explainError(error), 'error');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [selectedId]);

  const selectedImport = imports.find((item) => item.id === selectedId);
  const selected = selectedImport?.status === 'ACTIVE' ? selectedImport : undefined;
  const previewReceipts = preview?.statement.rows.filter(isBankReceipt) || [];
  const receiptEntries = useMemo(() => entries.filter((entry) => entry.statementId === selectedId && isBankReceipt(entry)), [entries, selectedId]);
  const receiptEntryIds = useMemo(() => new Set(receiptEntries.map((entry) => entry.id)), [receiptEntries]);
  const activeLinks = useMemo(() => links.filter((link) => link.statementId === selectedId), [links, selectedId]);
  const receiptLinks = useMemo(() => activeLinks.filter((link) => receiptEntryIds.has(link.entryId)), [activeLinks, receiptEntryIds]);
  const linksByEntry = useMemo(() => new Map(activeLinks.map((link) => [link.entryId, link])), [activeLinks]);
  const latestJustificationByEntry = useMemo(() => {
    const result = new Map<string, BankEntryJustification>();
    for (const item of entryJustifications) {
      const previous = result.get(item.entryId);
      const when = item.createdAt?.toDate?.().getTime() || 0;
      if (!previous || when >= (previous.createdAt?.toDate?.().getTime() || 0)) result.set(item.entryId, item);
    }
    return result;
  }, [entryJustifications]);
  const reviewedEntryIds = useMemo(() => new Set(latestJustificationByEntry.keys()), [latestJustificationByEntry]);
  const orderedReceiptEntries = useMemo(() => orderBankReceiptsForReview(receiptEntries, linksByEntry, reviewedEntryIds), [receiptEntries, linksByEntry, reviewedEntryIds]);
  const justifiedReceiptCount = receiptEntries.filter((entry) => !linksByEntry.has(entry.id) && reviewedEntryIds.has(entry.id)).length;
  const linkedMovementIds = useMemo(() => new Set(links.map((link) => link.movementId)), [links]);
  const movementsById = useMemo(() => new Map(cashMovements.filter((item) => item.id).map((item) => [item.id!, item])), [cashMovements]);
  const loansById = useMemo(() => new Map(loans.map((loan) => [loan.id, loan])), [loans]);
  const payerFor = (movement: CashMovement) => expectedPayerName(movement, movement.loanId ? loansById.get(movement.loanId) : undefined);
  const selectedEntry = receiptEntries.find((item) => item.id === selectedEntryId);

  const candidates = useMemo(() => {
    if (!selectedEntry) return [];
    return cashMovements.filter((movement) => {
      if (!movement.id || linkedMovementIds.has(movement.id)) return false;
      const match = evaluateBankMatch(movement, selectedEntry, payerFor(movement));
      return match === 'MATCH' || (movement.type === 'PAGAMENTO' && match === 'PAYER_MISMATCH');
    }).sort((a, b) => Math.abs(new Date(a.date).getTime() - new Date(selectedEntry.transactionDate).getTime()) -
      Math.abs(new Date(b.date).getTime() - new Date(selectedEntry.transactionDate).getTime())).slice(0, 30);
  }, [cashMovements, linkedMovementIds, loansById, selectedEntry]);
  const selectedMovement = movementsById.get(selectedMovementId);
  const selectedMatch = selectedMovement && selectedEntry
    ? evaluateBankMatch(selectedMovement, selectedEntry, payerFor(selectedMovement)) : null;

  const unmatchedMovements = useMemo(() => {
    if (!selected) return [];
    return cashMovements.filter((movement) => {
      const date = movementDate(movement.date);
      return movement.id && !linkedMovementIds.has(movement.id) && date >= selected.periodStart &&
        date <= selected.periodEnd && isAppReceipt(movement);
    }).sort((a, b) => movementDate(a.date).localeCompare(movementDate(b.date)) ||
      (a.id || '').localeCompare(b.id || ''));
  }, [cashMovements, linkedMovementIds, selected]);

  const latestJustificationByMovement = useMemo(() => {
    const result = new Map<string, BankMovementJustification>();
    for (const item of justifications) {
      const previous = result.get(item.movementId);
      const when = item.createdAt?.toDate?.().getTime() || 0;
      if (!previous || when >= (previous.createdAt?.toDate?.().getTime() || 0)) result.set(item.movementId, item);
    }
    return result;
  }, [justifications]);
  const pendingMovements = unmatchedMovements.filter((movement) => {
    const justification = latestJustificationByMovement.get(movement.id!);
    return !justification || justification.reason === 'NEEDS_CORRECTION';
  });
  const pendingIds = new Set(pendingMovements.map((movement) => movement.id));
  const reportMovements = [...pendingMovements, ...unmatchedMovements.filter((movement) => !pendingIds.has(movement.id))];
  const calendarMonth = selected?.periodEnd.slice(0, 7) || '';
  const lastCalendarDay = calendarMonth
    ? new Date(Date.UTC(Number(calendarMonth.slice(0, 4)), Number(calendarMonth.slice(5, 7)), 0)).toISOString().slice(0, 10) : '';
  const hasFullCalendarMonth = Boolean(selected && selected.periodStart <= `${calendarMonth}-01` && selected.periodEnd >= lastCalendarDay);

  const handleFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setPreview(null);
    try {
      setPreview(await readC6StatementPdfWithFallback(file, password));
      showToast('PDF validado: totais conferem com os lancamentos extraidos.', 'success');
    } catch (error) {
      console.error('Falha ao ler PDF do extrato C6:', error);
      showToast(explainError(error), 'error');
    } finally {
      setPassword('');
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!preview || !currentUserUid) return;
    setBusy(true);
    try {
      const id = await importBankStatement(preview, currentUserUid);
      await refreshImports();
      setPreview(null);
      setSelectedId(id);
      if (cashMovementsStatus === 'ready') {
        const statement = { id, periodStart: preview.statement.periodStart, periodEnd: preview.statement.periodEnd };
        try {
          const result = await reconcileAutomatically(statement);
          await refreshSelected(id);
          showToast(`Extrato importado. ${result.linked} pagamento(s) conferido(s) automaticamente.${result.failed ? ` ${result.failed} vinculo(s) exigem revisao.` : ''} Caixa e contratos inalterados.`, result.failed ? 'error' : 'success');
        } catch (error) {
          showToast(`Extrato importado, mas a conferencia automatica nao terminou: ${explainError(error)}. O caixa permanece inalterado.`, 'error');
        }
      } else {
        showToast('Extrato importado. Livro caixa ainda nao carregado; execute a conferencia automatica quando estiver pronto.', 'success');
      }
    } catch (error) {
      showToast(explainError(error), 'error');
    } finally { setBusy(false); }
  };

  const reconcileAutomatically = async (statement: Pick<BankStatementImport, 'id' | 'periodStart' | 'periodEnd'>) => {
    if (!currentUserUid || cashMovementsStatus !== 'ready') return { linked: 0, failed: 0 };
    const [statementEntries, existingLinks, existingEntryJustifications] = await Promise.all([
      listBankStatementEntries(statement.id), listBankStatementLinks(), listBankEntryJustifications(statement.id),
    ]);
    const planned = planAutomaticBankMatches(
      statementEntries, cashMovements, loansById,
      new Set([...existingLinks.map((link) => link.entryId), ...existingEntryJustifications.map((item) => item.entryId)]),
      new Set(existingLinks.map((link) => link.movementId)),
      statement.periodStart, statement.periodEnd,
    );
    let linked = 0;
    let failed = 0;
    for (const pair of planned) {
      const entry = statementEntries.find((item) => item.id === pair.entryId);
      const movement = movementsById.get(pair.movementId);
      if (!entry || !movement) continue;
      try {
        await linkBankEntryToCashMovement(entry, movement, currentUserUid, '', 'AUTO');
        linked += 1;
      } catch {
        failed += 1;
      }
    }
    return { linked, failed };
  };

  const handleAutoReconcile = async () => {
    if (!selected || !currentUserUid) return;
    setBusy(true);
    try {
      const result = await reconcileAutomatically(selected);
      await refreshSelected(selected.id);
      showToast(`${result.linked} pagamento(s) conferido(s) automaticamente.${result.failed ? ` ${result.failed} vinculo(s) permaneceram pendentes para revisao.` : ' Os demais continuam pendentes.'} Nenhum valor financeiro foi alterado.`, result.failed ? 'error' : 'success');
    } catch (error) { showToast(explainError(error), 'error'); }
    finally { setBusy(false); }
  };

  const handleLink = async () => {
    const movement = movementsById.get(selectedMovementId);
    if (!selectedEntry || !movement || !currentUserUid) return;
    setBusy(true);
    try {
      await linkBankEntryToCashMovement(selectedEntry, movement, currentUserUid, manualNote);
      await refreshSelected(selectedEntry.statementId);
      setSelectedEntryId(''); setSelectedMovementId(''); setManualNote('');
      showToast(selectedMatch === 'PAYER_MISMATCH'
        ? 'Pix de terceiro vinculado com justificativa. Nenhum valor financeiro foi alterado.'
        : 'Vinculo de conferencia registrado. Nenhum valor financeiro foi alterado.', 'success');
    } catch (error) { showToast(explainError(error), 'error'); }
    finally { setBusy(false); }
  };

  const handleJustifyEntry = async (entry: BankStatementEntry) => {
    if (!currentUserUid) return;
    setBusy(true);
    try {
      await addBankEntryJustification(entry, bankEntryNote, currentUserUid);
      await refreshSelected(entry.statementId);
      setJustifyingEntryId(''); setBankEntryNote('');
      showToast('Entrada bancaria conferida por observacao, sem lancamento na GR nem alteracao no caixa.', 'success');
    } catch (error) { showToast(explainError(error), 'error'); }
    finally { setBusy(false); }
  };

  const handleUnlink = async (entryId: string) => {
    if (!selected || !currentUserUid || !window.confirm('Desfazer apenas o vinculo de conferencia?')) return;
    setBusy(true);
    try {
      await unlinkBankEntry(entryId, currentUserUid);
      await refreshSelected(selected.id);
      showToast('Conferencia desfeita. Lancamentos financeiros inalterados.', 'success');
    } catch (error) { showToast(explainError(error), 'error'); }
    finally { setBusy(false); }
  };

  const handleJustify = async () => {
    if (!selected || !justifyingMovementId || !currentUserUid) return;
    setBusy(true);
    try {
      await addBankMovementJustification(selected.id, justifyingMovementId, reason, note, currentUserUid);
      await refreshSelected(selected.id);
      setJustifyingMovementId(''); setNote('');
      showToast('Justificativa de conferencia registrada; nenhum movimento foi criado.', 'success');
    } catch (error) { showToast(explainError(error), 'error'); }
    finally { setBusy(false); }
  };

  const handleRemove = async () => {
    if (!selectedImport || !currentUserUid || !window.confirm('Remover este extrato e seus vinculos de conferencia? O historico de importacao permanece auditavel. O caixa e os contratos nao mudam.')) return;
    setBusy(true);
    try {
      await removeBankStatement(selectedImport.id, currentUserUid);
      await refreshImports();
      setSelectedId('');
      showToast('Extrato removido da conferencia. Dados financeiros inalterados.', 'success');
    } catch (error) { showToast(explainError(error), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <section className="rounded-[2rem] border border-[#BF953F]/20 bg-[#050505] p-5 sm:p-6 space-y-5">
      <div className="flex items-start gap-3">
        <FileSearch className="text-[#BF953F] shrink-0" size={21} />
        <div>
          <h3 className="text-xs font-black uppercase tracking-widest text-[#BF953F]">Conferencia de extrato bancario</h3>
          <p className="mt-2 text-xs text-zinc-400">Conferencia de entradas bancarias com recebimentos da GR. As saidas continuam preservadas no historico do extrato, mas nao geram pendencias. Extrato e vinculos ficam separados do livro caixa; nenhuma acao aqui altera caixa, parcelas, contratos ou indicadores.</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
        <label className="text-xs text-zinc-300">Senha do PDF (se houver)
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" className="mt-2 w-full rounded-xl border border-zinc-700 bg-black p-3 text-white" />
        </label>
        <label className="text-xs text-zinc-300">Selecionar PDF para pre-visualizacao
          <input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(event) => { void handleFile(event.target.files?.[0]); event.target.value = ''; }} className="mt-2 block w-full rounded-xl border border-zinc-700 bg-black p-2 text-zinc-300" />
        </label>
      </div>
      {preview && (
        <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/10 p-4 text-xs text-zinc-300 space-y-2">
          <p className="font-bold text-emerald-400">Previa validada — {previewReceipts.length} entradas para conferencia</p>
          <p>{shortDate(preview.statement.periodStart)} a {shortDate(preview.statement.periodEnd)} · Recebido na conta {money(preview.statement.incomeCents)} · Saidas {money(preview.statement.expenseCents)} (fora da conferencia)</p>
          <div className="max-h-44 overflow-y-auto space-y-1">
            {previewReceipts.slice(0, 10).map((row) => <p key={row.sequence}>{shortDate(row.transactionDate)} · +{money(row.amountCents)} · {row.description}</p>)}
            {previewReceipts.length > 10 && <p className="text-zinc-500">Mais {previewReceipts.length - 10} entradas ficarao disponiveis para conferencia.</p>}
          </div>
          <button type="button" disabled={busy || !currentUserUid} onClick={() => { void handleImport(); }} className="rounded-xl bg-[#BF953F] px-4 py-2 font-bold text-black disabled:opacity-50">Importar somente para conferencia</button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs text-zinc-400">Extrato importado
          <select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setSelectedEntryId(''); setJustifyingEntryId(''); setManualNote(''); setBankEntryNote(''); setVisibleCount(30); }} className="mt-2 block min-w-64 max-w-full rounded-xl border border-zinc-700 bg-black p-3 text-white">
            <option value="">Selecione um extrato</option>
            {imports.map((item) => <option key={item.id} value={item.id}>{item.status === 'REMOVED' ? '[Removido] ' : ''}{item.bank} · {shortDate(item.periodStart)} a {shortDate(item.periodEnd)} · {item.transactionCount} linhas no PDF</option>)}
          </select>
        </label>
        {loading && <LoaderCircle size={17} className="animate-spin text-[#BF953F]" />}
        {selected && <button type="button" disabled={busy || cashMovementsStatus !== 'ready' || !currentUserUid} onClick={() => { void handleAutoReconcile(); }} className="self-end rounded-xl border border-emerald-800 px-3 py-3 text-xs text-emerald-400 disabled:opacity-50">Conferir Pix automaticamente</button>}
        {selectedImport && <button type="button" disabled={busy} onClick={() => { void handleRemove(); }} className="self-end rounded-xl border border-red-900 px-3 py-3 text-xs text-red-400 disabled:opacity-50">{selected ? 'Remover extrato' : 'Concluir limpeza dos vinculos'}</button>}
      </div>

      {selectedImport?.status === 'REMOVED' && <p className="text-xs text-zinc-500">Extrato removido. Linhas e justificativas historicas permanecem apenas para auditoria.</p>}

      {selectedImport && events.length > 0 && <details className="rounded-xl border border-zinc-800 p-3 text-xs text-zinc-400">
        <summary className="cursor-pointer font-bold text-zinc-200">Historico da conferencia ({events.length} eventos)</summary>
        <div className="mt-3 max-h-40 overflow-y-auto space-y-1">
          {events.map((event) => <p key={event.id}>{event.createdAt?.toDate?.().toLocaleString('pt-BR') || 'Sem data'} · {event.action} · {event.movementId || event.entryId || 'Extrato'} · {event.actorUid}</p>)}
        </div>
      </details>}

      {selected && (
        <>
          <p className="text-xs text-zinc-400">{receiptLinks.length + justifiedReceiptCount} de {receiptEntries.length} entradas bancarias conferidas: {receiptLinks.length} vinculada(s) a GR e {justifiedReceiptCount} justificada(s) sem lancamento na GR. As demais continuam <span className="text-red-400">pendentes</span>; nenhuma sera lancada automaticamente.</p>
          <p className="text-xs text-zinc-500">Ordem: conferidos automaticamente em azul; depois pendentes de revisao por data; por fim, conferidos manualmente em verde.</p>
          <div className="rounded-xl border border-amber-700/40 bg-amber-950/10 p-4 text-xs text-amber-200">
            <p className="font-black uppercase tracking-widest">Reporte para o administrador: {pendingMovements.length} recebimento(s) da GR pendente(s)</p>
            <p className="mt-1">{unmatchedMovements.length - pendingMovements.length} justificada(s) sem alterar o caixa. Um pagamento so e conferido normalmente com Pix de mesmo valor e pagador do contrato.</p>
          </div>
          {!hasFullCalendarMonth && <p className="rounded-xl border border-red-900/60 bg-red-950/10 p-3 text-xs text-red-300">Atencao: este PDF cobre {shortDate(selected.periodStart)} a {shortDate(selected.periodEnd)}, nao o mes civil inteiro de {calendarMonth}. Nao marque o fechamento mensal como totalmente conciliado com este extrato isolado.</p>}
          {cashMovementsStatus !== 'ready' && <p className="text-xs text-amber-400">Livro caixa nao carregado. Vinculos e justificativas estao desativados ate a leitura terminar.</p>}
          <div className="max-h-[520px] overflow-y-auto space-y-2">
            {orderedReceiptEntries.slice(0, visibleCount).map((entry) => {
              const link = linksByEntry.get(entry.id);
              const entryJustification = latestJustificationByEntry.get(entry.id);
              return <div key={entry.id} className="rounded-xl border border-zinc-800 p-3 text-xs text-zinc-300">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p><span className="font-bold text-white">{shortDate(entry.transactionDate)} · {entry.direction === 'IN' ? '+' : '-'}{money(entry.amountCents)}</span> · {entry.description}</p>
                  <span className={link?.matchMode === 'AUTO' ? 'text-blue-400' : link || entryJustification ? 'text-emerald-400' : 'text-red-400'}>{link?.matchMode === 'AUTO' ? 'Conferido automaticamente (nome e valor)' : link ? link.matchBasis === 'THIRD_PARTY_PIX' ? 'Conferido manualmente: Pix de terceiro' : link.matchBasis === 'AMOUNT_DIRECTION' ? 'Conferido manualmente por valor/sentido' : 'Conferido manualmente (nome e valor)' : entryJustification ? 'Conferido por observacao (sem lancamento na GR)' : 'Nao identificado na GR'}</span>
                </div>
                {link ? <div className="mt-2 flex flex-wrap items-center gap-3 text-zinc-500"><span>GR: {movementsById.get(link.movementId)?.description || link.movementId}</span>{link.exceptionNote && <span className="text-amber-400">Observacao: {link.exceptionNote}</span>}<button type="button" disabled={busy} onClick={() => { void handleUnlink(entry.id); }} className="inline-flex items-center gap-1 text-amber-400 disabled:opacity-50"><Unlink2 size={12} /> Desconciliar</button></div>
                  : <div className="mt-2 space-y-2">
                    {entryJustification && <p className="text-emerald-300">Observacao do administrador: {entryJustification.note}</p>}
                    <div className="flex flex-wrap gap-3">
                      <button type="button" disabled={busy || cashMovementsStatus !== 'ready'} onClick={() => { setSelectedEntryId(selectedEntryId === entry.id ? '' : entry.id); setSelectedMovementId(''); setManualNote(''); setJustifyingEntryId(''); }} className="inline-flex items-center gap-1 text-[#BF953F] disabled:opacity-50"><Link2 size={12} /> {entryJustification ? 'Vincular lancamento encontrado' : 'Vincular manualmente'}</button>
                      <button type="button" disabled={busy || !currentUserUid} onClick={() => { setJustifyingEntryId(justifyingEntryId === entry.id ? '' : entry.id); setBankEntryNote(''); setSelectedEntryId(''); }} className="text-emerald-400 disabled:opacity-50">{entryJustification ? 'Registrar nova observacao' : 'Conferir por observacao'}</button>
                    </div>
                  </div>}
                {selectedEntryId === entry.id && !link && <div className="mt-3 flex flex-wrap gap-2">
                  <select value={selectedMovementId} onChange={(event) => setSelectedMovementId(event.target.value)} className="min-w-64 max-w-full flex-1 rounded-lg border border-zinc-700 bg-black p-2 text-white">
                    <option value="">Selecione lancamento da GR com mesmo valor e sentido</option>
                    {candidates.map((movement) => <option key={movement.id} value={movement.id}>{movementDate(movement.date)} · {money(Math.abs(Math.round(resolveCashDelta(movement) * 100)))} · {movement.description}{evaluateBankMatch(movement, entry, payerFor(movement)) === 'PAYER_MISMATCH' ? ' · PAGADOR DIFERENTE' : ''}</option>)}
                  </select>
                  {selectedMatch === 'PAYER_MISMATCH' && <div className="w-full space-y-2 rounded-lg border border-amber-800/60 p-3 text-amber-300">
                    <p>Pagador esperado: {selectedMovement ? payerFor(selectedMovement) : 'nao identificado'} · No banco: {bankPixCounterpartyName(entry.description, entry.direction)}. Somente o administrador pode vincular como Pix de terceiro, com justificativa.</p>
                  </div>}
                  <label className="w-full text-zinc-400">Observacao obrigatoria da vinculacao manual
                    <textarea value={manualNote} onChange={(event) => setManualNote(event.target.value)} maxLength={1000} placeholder={selectedMatch === 'PAYER_MISMATCH' ? 'Explique quem pagou pelo cliente e por que o Pix esta em outro nome (minimo 8 caracteres)' : 'Explique a correspondencia com o lancamento da GR (minimo 8 caracteres)'} className="mt-1 w-full rounded-lg border border-zinc-700 bg-black p-2 text-white" />
                  </label>
                  <button type="button" disabled={busy || !selectedMovementId || manualNote.trim().length < 8} onClick={() => { void handleLink(); }} className="rounded-lg bg-[#BF953F] px-3 py-2 font-bold text-black disabled:opacity-50">{selectedMatch === 'PAYER_MISMATCH' ? 'Vincular com excecao' : 'Confirmar vinculo'}</button>
                  {candidates.length === 0 && <span className="text-amber-400">Nenhum candidato de mesmo valor e sentido.</span>}
                </div>}
                {justifyingEntryId === entry.id && !link && <div className="mt-3 space-y-2 rounded-lg border border-emerald-900/60 p-3">
                  <p className="text-emerald-300">Explique a origem desta entrada bancaria sem vinculo na GR. Isto nao cria receita, pagamento ou movimentacao no caixa.</p>
                  <textarea value={bankEntryNote} onChange={(event) => setBankEntryNote(event.target.value)} maxLength={1000} placeholder="Ex.: pagamento de outro servico ou venda; nao pertence aos contratos da GR (minimo 8 caracteres)" className="w-full rounded-lg border border-zinc-700 bg-black p-2 text-white" />
                  <button type="button" disabled={busy || bankEntryNote.trim().length < 8} onClick={() => { void handleJustifyEntry(entry); }} className="rounded-lg bg-emerald-600 px-3 py-2 font-bold text-white disabled:opacity-50">Conferir por observacao</button>
                </div>}
              </div>;
            })}
          </div>
          {receiptEntries.length > visibleCount && <button type="button" onClick={() => setVisibleCount((count) => count + 30)} className="text-xs text-[#BF953F]">Mostrar mais 30 entradas</button>}

          <div className="border-t border-zinc-800 pt-4 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-widest text-white">Recebimentos da GR pendentes ({unmatchedMovements.length})</h4>
            <p className="text-xs text-zinc-500">Como esta movimentacao foi realizada? A resposta registra apenas uma justificativa de conferencia.</p>
            <div className="max-h-80 overflow-y-auto space-y-2">
              {reportMovements.map((movement) => {
                const previous = latestJustificationByMovement.get(movement.id!);
                const payer = payerFor(movement);
                const exactPix = movement.type === 'PAGAMENTO' && receiptEntries.some((entry) => !linksByEntry.has(entry.id) && evaluateBankMatch(movement, entry, payer) === 'MATCH');
                const otherPayerPixCount = movement.type === 'PAGAMENTO'
                  ? receiptEntries.filter((entry) => !linksByEntry.has(entry.id) && evaluateBankMatch(movement, entry, payer) === 'PAYER_MISMATCH').length : 0;
                return <div key={movement.id} className="rounded-xl border border-zinc-800 p-3 text-xs text-zinc-300">
                  <p>{movementDate(movement.date)} · {money(Math.round(resolveCashDelta(movement) * 100))} · {movement.description}</p>
                  {movement.type === 'PAGAMENTO' && <p className="mt-1 text-zinc-400">Cliente esperado: {payer || 'nao identificado'} · {exactPix ? 'Pix compativel encontrado; falta confirmar o vinculo' : `Sem Pix confirmado do cliente${otherPayerPixCount ? `; ${otherPayerPixCount} Pix de outro pagador com o mesmo valor` : ''}`}</p>}
                  {previous && <p className="mt-1 text-amber-400">Justificado: {reasonLabels[previous.reason]} — {previous.note}</p>}
                  {!previous && <p className="mt-1 font-bold text-red-400">Pendente de analise do administrador</p>}
                  {justifyingMovementId === movement.id ? <div className="mt-2 space-y-2">
                    <select value={reason} onChange={(event) => setReason(event.target.value as BankMovementJustificationReason)} className="w-full rounded-lg border border-zinc-700 bg-black p-2 text-white">{Object.entries(reasonLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                    {reason === 'THIRD_PARTY_PIX' && <p className="text-amber-400">Se o Pix de terceiro aparece acima, vincule-o com excecao e justificativa para conferir os dois lados.</p>}
                    <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Descreva como ocorreu a movimentacao (minimo 8 caracteres)" maxLength={1000} className="w-full rounded-lg border border-zinc-700 bg-black p-2 text-white" />
                    <div className="flex gap-3"><button type="button" disabled={busy || note.trim().length < 8} onClick={() => { void handleJustify(); }} className="text-emerald-400 disabled:opacity-50">Registrar justificativa</button><button type="button" onClick={() => setJustifyingMovementId('')} className="text-zinc-500">Cancelar</button></div>
                  </div> : <button type="button" disabled={busy || cashMovementsStatus !== 'ready'} onClick={() => { setJustifyingMovementId(movement.id!); setReason('CASH'); setNote(''); }} className="mt-2 text-[#BF953F] disabled:opacity-50">{previous ? 'Registrar nova justificativa' : 'Informar meio de pagamento'}</button>}
                </div>;
              })}
            </div>
          </div>
        </>
      )}
    </section>
  );
};

export default BankStatementAudit;
