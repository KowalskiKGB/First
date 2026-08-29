# Portal Personal Profissional Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** entregar um workspace seguro e profissional para o Personal gerenciar alunos, programas, medidas, evolução, agenda e contas a receber sem quebrar o First autônomo.

**Architecture:** preservar `state-<uid>.json` como estado privado do aluno e adicionar `collaboration.json` revisionado para o domínio compartilhado. Regras puras ficam em `api/domain`, rotas novas entram por um router injetável, e o React usa uma store colaborativa separada do store de treino local.

**Tech Stack:** React 19, React Router 7, Zustand 5, Node `http`, JSON atômico, WebAuthn, Vitest, `node:test`, nginx e Docker Compose.

**Spec:** `docs/superpowers/specs/2026-08-29-personal-workspace-design.md`

## Global Constraints

- Guest, demo, PWA e app móvel offline continuam sem chamadas colaborativas.
- Admin e Personal são domínios e autorizações diferentes.
- Nenhuma rota dá ao Personal escrita do estado inteiro do aluno.
- Toda escrita colaborativa exige `rev` e retorna `409` para revisão obsoleta.
- Dinheiro usa centavos inteiros e `BRL`; não implementar gateway.
- UI sem gradientes novos, com foco visível, contraste e reduced motion.
- Sem dependências novas para agenda, gráficos, formulário ou gerenciamento de estado.
- Entradas externas são validadas no servidor e toda referência de recurso recebe checagem de ownership/vínculo.

---

### Task 1: store revisionado e schema colaborativo

**Files:**
- Create: `api/lib/json-store.js`
- Create: `api/domain/schema.js`
- Create: `api/test/json-store.test.js`
- Modify: `api/package.json`

**Interfaces:**
- Produces: `createJsonStore({ file, initial, migrate }) -> { read(), update(expectedRev, reducer) }`
- Produces: `RevisionConflictError`, `INITIAL_COLLABORATION`, `migrateCollaboration(value)`

- [ ] **Step 1: escrever RED para criação, migração, cópia imutável e revisão obsoleta**

```js
test('rejects stale collaboration writes', () => {
  const store = createJsonStore(fixture())
  store.update(0, state => ({ ...state, profiles: [{ userId: 'u1', roles: ['student'] }] }))
  assert.throws(() => store.update(0, state => state), RevisionConflictError)
})
```

- [ ] **Step 2: executar `npm test --prefix api -- json-store`; confirmar falha por módulo ausente**
- [ ] **Step 3: implementar escrita temporária + rename, clone na leitura e migração idempotente**
- [ ] **Step 4: executar o teste focado e cobertura do módulo; confirmar GREEN**
- [ ] **Step 5: commit `refactor: add revisioned collaboration storage`**

### Task 2: acesso, papéis, vínculos, clientes e router base

**Files:**
- Create: `api/domain/access.js`
- Create: `api/domain/connections.js`
- Create: `api/domain/clients.js`
- Create: `api/domain/notifications.js`
- Create: `api/domain/audit.js`
- Create: `api/lib/validation.js`
- Create: `api/personal-router.js`
- Create: `api/test/access.test.js`
- Create: `api/test/connections.test.js`
- Create: `api/test/personal-router.test.js`
- Modify: `api/server.js`

**Interfaces:**
- Consumes: store e schema da Task 1.
- Produces: `authorize({ actorId, client, action, collaboration })`.
- Produces: handlers `GET /api/collaboration`, `PUT /api/profile/roles`, conexão, notificação, workspace e cliente.

- [ ] **Step 1: escrever matriz RED para dono, Personal ativo, pendente, encerrado, terceiro e Admin**
- [ ] **Step 2: escrever RED de router para autenticação, Origin, limite de payload, IDOR e `409`**
- [ ] **Step 3: executar `npm test --prefix api -- access connections personal-router`; confirmar RED pelos exports ausentes**
- [ ] **Step 4: implementar perfil lazy com `student`, ativação de `trainer`, share code de 128 bits e cliente gerenciado**
- [ ] **Step 5: implementar vínculo pendente/aceite/encerramento, grants e inbox persistida**
- [ ] **Step 6: integrar router no `routes` existente sem mudar `/api/data` ou `/api/admin/*`**
- [ ] **Step 7: executar testes focados e regressão de API; confirmar GREEN**
- [ ] **Step 8: commit `feat: add consent based trainer clients`**

### Task 3: programas, medidas e projeção de evolução

**Files:**
- Create: `api/domain/programs.js`
- Create: `api/domain/measurements.js`
- Create: `api/domain/progress.js`
- Create: `api/test/programs.test.js`
- Create: `api/test/measurements.test.js`
- Create: `api/test/progress.test.js`
- Modify: `api/personal-router.js`

**Interfaces:**
- Produces: `saveProgram`, `normalizeMeasurement`, `summarizeStudentProgress`.
- Adds: `PUT /api/personal/program`, `POST /api/personal/measurements`, detalhe completo do aluno.

- [ ] **Step 1: escrever RED para versão imutável, apenas treino futuro e revogação de `plansWrite`**
- [ ] **Step 2: escrever RED para kg/cm/percentual, lados, limites, data futura e `measurementsWrite`**
- [ ] **Step 3: escrever RED para aderência 28d, volume, duração, último treino e inatividade**
- [ ] **Step 4: executar testes focados; confirmar RED pelos módulos ausentes**
- [ ] **Step 5: implementar os três módulos com reducers imutáveis e auditoria sem payload sensível**
- [ ] **Step 6: expor somente projeções autorizadas no detalhe do aluno**
- [ ] **Step 7: executar testes focados e regressão; confirmar GREEN**
- [ ] **Step 8: commit `feat: add trainer programs measurements and progress`**

### Task 4: agenda, disponibilidade e financeiro manual

**Files:**
- Create: `api/domain/schedule.js`
- Create: `api/domain/finance.js`
- Create: `api/test/schedule.test.js`
- Create: `api/test/finance.test.js`
- Modify: `api/personal-router.js`

**Interfaces:**
- Produces: `deriveOpenSlots`, `saveAppointment`, `saveReceivable`, `summarizeFinance`.
- Adds: rotas de disponibilidade, compromissos, cobranças e mutações de status.

- [ ] **Step 1: escrever RED para slots, sobreposição, cancelamento, intervalo inválido e ownership**
- [ ] **Step 2: escrever RED para centavos, competência única, pago/aberto/vencido/isenção e isolamento entre Personais**
- [ ] **Step 3: executar testes focados; confirmar RED pelos módulos ausentes**
- [ ] **Step 4: implementar expediente padrão Fortaleza e slots derivados sem persistir disponibilidade calculada**
- [ ] **Step 5: implementar cobranças recuperáveis por status, nunca exclusão destrutiva**
- [ ] **Step 6: incluir agenda, totais financeiros e motivos de prioridade no workspace**
- [ ] **Step 7: executar testes focados e regressão; confirmar GREEN**
- [ ] **Step 8: commit `feat: add trainer schedule and receivables`**

### Task 5: cliente React, contexto e rotas protegidas

**Files:**
- Create: `frontend/src/lib/collaboration-api.js`
- Create: `frontend/src/lib/personal.js`
- Create: `frontend/src/lib/personal.test.js`
- Create: `frontend/src/store/useCollaboration.js`
- Create: `frontend/src/views/personal/PersonalGuard.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/TabBar.jsx`
- Modify: `frontend/src/views/Settings.jsx`
- Modify: `frontend/src/store/useStore.js`

**Interfaces:**
- Produces: `useCollaboration` com `context`, `profile`, `workspace`, `selected`, `load`, `selectClient`, `mutate` e `reset`.
- Produces: rotas `/personal`, `/personal/alunos`, `/personal/alunos/:id`, `/personal/agenda`, `/personal/financeiro` e `/aluno/conexoes`.

- [ ] **Step 1: escrever RED para formatação BRL, classificação/prioridade e derivação de navegação**
- [ ] **Step 2: executar teste focado; confirmar RED**
- [ ] **Step 3: implementar cliente API e store com uma carga paralela, recuperação de `409` e reset no logout**
- [ ] **Step 4: proteger rotas por `roles.includes('trainer')`; guest/mobile não chamam `load`**
- [ ] **Step 5: adaptar TabBar para cinco destinos do Personal e alternância de contexto em Settings**
- [ ] **Step 6: executar testes frontend e build; confirmar GREEN**
- [ ] **Step 7: commit `feat: add trainer context and navigation`**

### Task 6: dashboard profissional e lista priorizada de alunos

**Files:**
- Create: `frontend/src/components/personal/PersonalHeader.jsx`
- Create: `frontend/src/components/personal/MetricCard.jsx`
- Create: `frontend/src/components/personal/PriorityBadge.jsx`
- Create: `frontend/src/components/personal/AgendaRail.jsx`
- Create: `frontend/src/views/personal/PersonalHome.jsx`
- Create: `frontend/src/views/personal/Students.jsx`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Consumes: workspace/store da Task 5.
- Produces: dashboard com KPIs, linha operacional do dia, prioridades, busca e criação de aluno.

- [ ] **Step 1: implementar estados loading/error/empty com ações claras e labels pt-BR**
- [ ] **Step 2: implementar KPIs, prioridades com motivo textual e agenda livre/ocupada**
- [ ] **Step 3: implementar busca/filtros e sheet de aluno gerenciado**
- [ ] **Step 4: adicionar CSS mobile-first, desktop em três colunas, números tabulares e transições ≤180 ms**
- [ ] **Step 5: verificar 360×800, 768×1024 e desktop; corrigir foco e overflow**
- [ ] **Step 6: executar testes e build; confirmar GREEN**
- [ ] **Step 7: commit `feat: add professional trainer dashboard`**

### Task 7: ficha do aluno, treino, medidas, agenda e financeiro

**Files:**
- Create: `frontend/src/views/personal/StudentDetail.jsx`
- Create: `frontend/src/views/personal/Agenda.jsx`
- Create: `frontend/src/views/personal/Finance.jsx`
- Create: `frontend/src/components/personal/MeasurementForm.jsx`
- Create: `frontend/src/components/personal/ProgramEditor.jsx`
- Create: `frontend/src/components/personal/AppointmentForm.jsx`
- Create: `frontend/src/components/personal/ReceivableForm.jsx`
- Create: `frontend/src/components/personal/MoneyBars.jsx`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Consumes: detalhe e mutações da store; catálogo `EXDB`, `exerciseName`, `SearchField`, `LineChart`.
- Produces: edição recuperável da ficha e dos quatro domínios do aluno.

- [ ] **Step 1: construir abas resumo/treino/evolução/medidas/agenda/financeiro com URL estável**
- [ ] **Step 2: implementar editor de programa com busca sem acento, séries, repetições e publicação versionada**
- [ ] **Step 3: implementar formulário de medidas com autoria, unidade e data**
- [ ] **Step 4: implementar criação/reagendamento/cancelamento de aula e indicação de conflito**
- [ ] **Step 5: implementar cobrança/pagamento/isenção e gráfico sólido com tabela acessível**
- [ ] **Step 6: testar via navegador seleção → medida → programa → agenda → financeiro e revogação**
- [ ] **Step 7: executar testes e build; confirmar GREEN**
- [ ] **Step 8: commit `feat: add complete trainer student workspace`**

### Task 8: vínculo do aluno, hardening, E2E, documentação e release

**Files:**
- Create: `frontend/src/views/student/Connections.jsx`
- Create: `api/test/personal-e2e.test.js`
- Create: `docs/testing/personal-workspace.tdd.md`
- Modify: `frontend/src/locales/pt.js`
- Modify: `frontend/scripts/check-locales.mjs`
- Modify: `README.md`
- Modify: `PLANEJAMENTO.md`
- Modify: `docs/SELF_HOSTING.md`
- Modify: `docs/MOBILE.md`

**Interfaces:**
- Consumes: todos os módulos anteriores.
- Produces: fluxo vínculo/aceite/revogação, evidências, docs e release implantável.

- [ ] **Step 1: implementar solicitações, grants, notificações e revogação no contexto aluno**
- [ ] **Step 2: escrever integração RED para Personal A/Personal B, conflito de agenda, revogação e financeiro isolado**
- [ ] **Step 3: executar RED, aplicar somente correções observadas e confirmar GREEN**
- [ ] **Step 4: auditar Origin/CSRF, payloads, IDOR, logs, defaults e segredos**
- [ ] **Step 5: executar frontend/API tests com cobertura, audits, build web, Compose e E2E browser desktop/mobile**
- [ ] **Step 6: registrar RED/GREEN/cobertura no relatório TDD e atualizar roadmap/docs**
- [ ] **Step 7: atualizar versão, changelog, build APK e Graphify**
- [ ] **Step 8: revisão final, commit `feat: release professional trainer workspace`, push e deploy Coolify**
