# Integracao Credigrupo

## Escopo

A GR Solution possui dois modos independentes de formalizacao:

- `DIRECT` / `GR`: fluxo historico, sem chamada externa.
- `BANCARIZED` / `CREDIGRUPO`: fluxo CCB no sandbox da Credigrupo.

Contratos antigos sem os novos campos sao interpretados como `DIRECT`. Nao existe migracao destrutiva.

Cada contrato possui exatamente um investidor. Um mesmo investidor pode financiar varios contratos. A origem do capital e gravada no contrato como `GR` ou `EXTERNAL`.

O app nao divide um contrato entre investidores. Se o mesmo investidor operar com capital proprio da GR e capital externo em contratos diferentes, os relatorios mantem os dois grupos separados por origem.

## Investidores

O cadastro e a aprovacao KYC do investidor continuam sendo realizados no fluxo oficial da Credigrupo. O app sincroniza apenas investidores retornados pela API e permite selecionar os que estejam com `kyc_status=approved`.

O nome usado no contrato nao e aceito do navegador: o backend o recupera de `creditInvestors/{investorId}` no momento da reserva da operacao. Um investidor aprovado pode ser reutilizado em varios contratos, mas cada operacao guarda somente um `investorId`.

## Arquitetura

O navegador chama somente os endpoints internos em `api/credigrupo`. Cada chamada interna exige um Firebase ID Token e valida o usuario em `authorizedUsers` quando a protecao de acesso esta ativa.

O backend utiliza Firebase Admin e o cliente central em `api/_lib/credit-providers/credigrupo/client.ts`. A API Key nunca e enviada ao navegador.

Fluxo de criacao:

1. Cadastrar/aprovar o investidor no fluxo oficial e sincroniza-lo no app.
2. Cadastrar ou atualizar o tomador vinculado ao investidor.
3. Aguardar KYC aprovado e consultar elegibilidade CCB.
4. Gerar a simulacao oficial.
5. Confirmar a bancarizacao.
6. Reservar `creditOperations/{operationId}` antes da chamada externa.
7. Criar a proposta e exibir o PIX de funding.
8. Receber CCB, assinatura e funding pelos webhooks.
9. Criar o contrato local somente em `loan.funded`.

## Contabilizacao

- `GR + loan.funded`: cria uma `RETIRADA` no caixa pelo principal desembolsado.
- `EXTERNAL + loan.funded`: cria o contrato, mas nao altera o caixa proprio da GR.
- `installment.paid`: baixa a parcela no motor financeiro, sem alterar o caixa.
- `GR + installment.investor_repaid`: cria `PAGAMENTO` e credita o caixa da GR.
- `EXTERNAL + installment.investor_repaid`: registra o repasse no ledger do investidor, sem alterar o caixa da GR.
- Receitas agregadas da agencia em `/earnings` nao sao lancadas automaticamente, pois a API nao fornece rateio por parcela. Isso evita lucro duplicado.

O financeiro exibe a carteira consolidada e um agrupamento por investidor. Contratos diretos antigos pertencem ao grupo `GR Solutions`.

## Variaveis de ambiente

Configurar somente no backend da Vercel:

```text
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
CREDIGRUPO_API_KEY=wl_test_...
CREDIGRUPO_WEBHOOK_SECRET=segredo-com-32-ou-mais-caracteres
CREDIGRUPO_ENV=sandbox
CREDIGRUPO_ENABLED=true
```

`CREDIGRUPO_ENV` diferente de `sandbox` e chaves `wl_live_` sao bloqueados. Quando `CREDIGRUPO_ENABLED=false`, novas operacoes ficam ocultas, mas webhooks e conciliacao de operacoes existentes continuam funcionando.

## Endpoints internos

- `GET /api/credigrupo/status`: disponibilidade segura da integracao.
- `GET /api/credigrupo/investors`: sincroniza investidores do parceiro.
- `POST /api/credigrupo/borrowers`: cria ou atualiza o tomador e elegibilidade.
- `POST /api/credigrupo/simulate`: cria simulacao oficial valida por 30 minutos.
- `POST /api/credigrupo/loans`: cria a proposta de forma idempotente.
- `GET /api/credigrupo/operations`: lista as operacoes recentes.
- `POST /api/credigrupo/reconcile`: concilia proposta e parcelas por polling.
- `POST /api/credigrupo/cancel`: cancela proposta ainda nao assinada; exige ADMIN.
- `POST /api/webhooks/credigrupo`: recebe eventos assinados.

## Collections e campos

- `creditInvestors`: espelho minimo dos investidores Credigrupo.
- `creditBorrowers`: vinculo cliente + investidor + borrower + KYC.
- `creditSimulations`: simulacoes de curta duracao, vinculadas ao usuario.
- `creditOperations`: estado da proposta e identificadores externos.
- `creditWebhookEvents`: inbox idempotente e auditavel dos webhooks.
- `creditInvestorLedger`: pagamentos e repasses por investidor.
- `clientes.credigrupo`: resumo do ultimo vinculo KYC do cliente.
- `loans.formalizationType`, `loans.provider`, `loans.funding`, `loans.credigrupo`.
- `loans.installments[].credigrupo`: ID, PIX, status e repasse externo.

As collections de integracao nao possuem acesso pelo Firebase Client SDK. O fallback das regras nega leitura e escrita; somente Firebase Admin opera esses documentos. Metadados Credigrupo em clientes e contratos tambem sao imutaveis pelo navegador.

## Webhooks

O endpoint usa o corpo bruto, calcula HMAC-SHA256 com `CREDIGRUPO_WEBHOOK_SECRET` e compara `X-Webhook-Signature` em tempo constante.

Eventos implementados:

- `kyc.approved`
- `kyc.rejected`
- `ccb_ready_for_signature`
- `loan.signed`
- `loan.funded`
- `loan.cancelled`
- `installment.pix_created`
- `installment.paid`
- `installment.investor_repaid`

O hash SHA-256 do payload identifica a entrega. Efeitos financeiros possuem uma segunda idempotencia por parcela, impedindo pagamento ou repasse duplicado mesmo quando o provedor reenviar um evento com outro envelope.

## Checklist de sandbox

1. Configurar as variaveis usando somente `wl_test_`.
2. Publicar e registrar `https://DOMINIO/api/webhooks/credigrupo` com segredo de 32 ou mais caracteres.
3. Sincronizar um investidor aprovado.
4. Selecionar um cliente e preencher os dados adicionais de KYC.
5. Cadastrar o tomador e aprovar seu KYC no portal Credigrupo.
6. Atualizar KYC/elegibilidade no app.
7. Simular e conferir principal, IOF, tarifa, juros e parcelas.
8. Confirmar a bancarizacao uma unica vez.
9. Copiar o PIX de funding e usar o endpoint sandbox `test-pay` da Credigrupo.
10. Abrir os links ZapSign de tomador e investidor.
11. Confirmar que `loan.funded` criou um unico contrato local.
12. Confirmar a retirada somente quando a fonte for GR.
13. Simular o pagamento da parcela.
14. Reenviar o mesmo webhook e confirmar que a baixa nao duplica.
15. Conciliar manualmente pelo card e confirmar que os valores permanecem iguais.

No sandbox, `ccb_url` pode permanecer `null` e `installment.investor_repaid` pode nao ser entregue por falta de saldo Woovi. Esses comportamentos nao devem bloquear a homologacao.

## Troubleshooting

- `CREDIGRUPO_DISABLED`: habilitar a feature flag somente depois de configurar o sandbox.
- `CREDIGRUPO_SANDBOX_KEY_REQUIRED`: a chave nao possui prefixo `wl_test_`.
- `KYC_NOT_APPROVED`: aprovar o usuario no portal e atualizar o status no app.
- `BANCARIZATION_PENDING`: uma tentativa com o mesmo identificador ja esta em curso; nao gerar outra proposta.
- `RECONCILIATION_REQUIRED`: consultar a operacao na Credigrupo antes de tentar novamente.
- Erros externos registram somente operacao, status, request ID e horario; chaves e documentos completos nao sao logados.

## Producao futura

Antes de permitir `wl_live_` sera necessario remover conscientemente o bloqueio de producao, homologar o contrato comercial e contabil, revisar LGPD/KYC, configurar backup Admin das collections de integracao, testar restauracao e executar o fluxo completo com aprovacao formal da Credigrupo.
