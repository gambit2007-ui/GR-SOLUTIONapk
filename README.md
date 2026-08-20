# GR SOLUTION

Aplicacao React/Vite para gestao de clientes, contratos de emprestimo e caixa, com persistencia no Firebase.

## Desenvolvimento

```bash
npm install
npm run dev
```

## Validacao obrigatoria

```bash
npm run lint
npm run test
npm run build
```

Antes de publicar regras, valide sem deploy:

```bash
npx firebase-tools deploy --only firestore:rules --dry-run --project grsolution-8e6cb
```

## Controles financeiros

- Pagamentos, estornos, renovacoes e concessoes usam identificadores idempotentes e movimentacoes imutaveis.
- O saldo consolidado deve coincidir com a soma do livro caixa. A tela Financeiro exibe a reconciliacao automaticamente.
- Clientes sem contratos sao arquivados; contratos e movimentacoes financeiras nao possuem exclusao fisica.
- Correcoes de dados antigos devem comecar pela auditoria e por um backup validado. Nunca altere o historico diretamente.

## Controle de acesso

Ao entrar como proprietario, use o aviso **Ativar agora** para registrar a conta atual como administradora e restringir o banco aos usuarios autorizados. Confirme o acesso da conta administradora antes de encerrar a sessao.

## Backup

O backup JSON inclui versao de esquema, contagens e checksum SHA-256. A geracao e interrompida se a verificacao de integridade falhar.
