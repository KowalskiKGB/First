# Task 1 — Store revisionado e schema colaborativo

## TDD

- RED: `npm test --prefix api -- test/json-store.test.js` saiu com código 1 porque `api/lib/json-store.js` ainda não existia (`ERR_MODULE_NOT_FOUND`).
- GREEN: `npm test --prefix api -- test/json-store.test.js` saiu com código 0: 4 testes passaram.
- Cobertura: `npm run test:coverage --prefix api -- test/json-store.test.js` saiu com código 0. Linhas: 100% em `api/domain/schema.js` e `api/lib/json-store.js`; ramos totais: 88%.

## Arquivos

- `api/domain/schema.js`: documento colaborativo inicial e migração idempotente para o schema 1.
- `api/lib/json-store.js`: leitura com cópia defensiva, persistência atômica por arquivo temporário e rename, e escrita com revisão otimista.
- `api/test/json-store.test.js`: criação, migração, cópias defensivas e conflito de revisão.
- `api/package.json`: comandos nativos de teste e cobertura.

## Self-review

- A criação do documento inicial e a migração são persistidas; dados existentes não são apagados pela migração.
- `read()` e a entrada do reducer recebem clones, evitando alterar o estado interno por referência.
- `update()` verifica a revisão atual no disco antes de escrever e lança `RevisionConflictError` para revisão obsoleta.
- A solução usa apenas módulos nativos do Node; não foram adicionadas dependências ou abstrações especulativas.
