# Credigrupo: encerramento de homologacao e ativacao futura

Estado desta entrega: sandbox. A ativacao live continua BLOQUEADA pelo backend.
O tipo interno `production` identifica proveniencia de dados; nao confirma qual
valor a Credigrupo exige para ativar a conta. Confirmar no contrato oficial antes
de alterar `CREDIGRUPO_ENV`. A documentacao online esteve indisponivel nesta auditoria.

## Previa de arquivamento

Executar `node scripts/audit-credigrupo-homologation.mjs` em sessao com credencial
Admin autorizada existente. O comando e somente leitura, projeta apenas IDs,
status, datas e marcadores de ambiente. Nao solicita ou imprime secrets.

Revisar o customerId de cada cadastro e os vinculos retornados. Nao concluir que
dois cartoes de operacoes representam dois clientes. O nome atualizado de um
borrower externo tambem nao prova a existencia de outro customerId local.

Somente apos confirmar os dois IDs e ausencia de efeitos financeiros reais:

- Preservar resumo tecnico em `migrationRuns`, com tipo `HOMOLOGACAO`, ambiente
  sandbox, IDs locais/externos, simulation externalIds, datas e status finais.
- Arquivar os clientes e suas operacoes sandbox com `archived=true`,
  `environment=sandbox`, `testData=true` e data/autor do arquivamento.
- Preservar referencias em creditBorrowers, creditSimulations e creditOperations.
- Manter inbox e ledger necessarios a rastreabilidade; nao apagar o historico externo.
- Nao duplicar dados pessoais ou URLs com tokens no resumo de auditoria.
- Conferir novamente contagens e saldo. Qualquer contrato, ledger ou movimento
  encontrado exige revisao especifica antes de arquivar. O script nao escreve.

## Isolamento implementado

Cadastro/sincronizacao e simulacao exigem cliente sandbox explicitamente marcado
como teste e ativo. A criacao revalida o cliente dentro da transacao e exige
simulacao do mesmo ambiente. Vínculos legados sem ambiente exigem revisao.
Esses marcadores so podem ser alterados por ADMIN nas Firestore Rules.

Novos borrowers locais, simulacoes e operacoes recebem ambiente e testData.
Eventos sandbox financeiros atualizam a trilha da integracao, sem criar contrato
operacional, movimento de caixa, contador ou ledger financeiro real. Eventos de
origem indeterminada ficam identificados para revisao. DIRECT nao usa esses fluxos.
Dados historicos existentes NAO sao migrados automaticamente por esse codigo.

## Checklist obrigatorio para uma futura ativacao real

- Confirmar com Credigrupo o ambiente e a conta OWN_INVESTOR_KEY da GR habilitada.
- Configurar manualmente CREDIGRUPO_API_KEY live somente no ambiente apropriado;
  validar em runtime apenas booleanos, sem revelar valores.
- Confirmar ausencia de chave test no runtime destinado a operacoes reais.
- Confirmar URL de webhook live e validar HMAC live com evidencia do provedor.
- Confirmar isolamento de borrowers, simulacoes, operacoes e eventos por ambiente;
  nao reutilizar IDs sandbox nem aplicar fallback para dados sem proveniencia.
- Concluir auditoria do financeiro: nenhum dado de homologacao deve compor saldo,
  receita ou capital proprio. Tratar divergencias com previa e backup.
- Confirmar minimo/maximo, unidade em centavos, taxas, IOF, KYC, CCB,
  cancelamento e requisitos de desembolso reais com a documentacao oficial.
- Preservar bloqueio test-pay fora de sandbox e para qualquer chave live.
- Obter confirmacao ADMIN registrada para ativacao. Um checkbox de interface
  ou uma chave live isoladamente nao atesta prontidao.
- Implementar e testar a habilitacao server-side com as evidencias acima antes
  de remover o bloqueio live atual; rodar lint, testes, Rules e build.

Nao ha ativacao live automatica nem operacao real autorizada por este checklist.
