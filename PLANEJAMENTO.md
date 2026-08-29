# Plano de expansão do First

> **Para agentes de implementação:** subskill obrigatória: use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para executar uma tarefa por vez. Os checkboxes são o registro de progresso.

**Objetivo:** evoluir o First para funcionar como portal autônomo de treino e, opcionalmente, como plataforma de acompanhamento entre um aluno e seu personal.

**Arquitetura:** manter um único React, uma única API Node e uma única instância de armazenamento. Dados privados do aluno continuam separados; vínculos, permissões, programas atribuídos, notificações, auditoria e medidas compartilhadas entram em um documento JSON versionado, com escrita atômica e controle de revisão. O portal muda por contexto de usuário, não por frontend ou login duplicado.

**Stack:** React 19, React Router, Zustand, Node `http`, WebAuthn/passkeys, arquivos JSON, Vitest, `node:test`, Playwright, nginx e Docker Compose.

**Especificação:** este documento incorpora os requisitos de portal aluno/personal, vínculo e notificações bidirecionais, prescrição e acompanhamento, peso/medidas, 5/3/1-style, novos planos iniciais, notas por exercício, calculadora de anilhas e português do Brasil.

## Restrições globais

- O modo aluno autônomo, guest, PWA e app móvel standalone deve continuar funcionando sem personal e sem chamadas colaborativas.
- Na primeira versão, cada aluno pode manter apenas um vínculo ativo com personal; um personal pode acompanhar vários alunos.
- Um usuário pode ter os papéis `student`, `trainer` ou ambos; o papel de trainer é autoativado e não representa certificação profissional.
- O aluno é o titular dos dados e concede permissões explícitas; papel de administrador não concede automaticamente acesso de personal.
- Permissões iniciais do vínculo: `plans:write`, `workouts:read` e `progress:read`. `measurements:write` e `liveActivity:read` começam desligadas.
- Alterações de programa autorizadas valem apenas para treinos futuros, geram notificação e nunca reescrevem histórico ou treino em andamento.
- A inbox persistida é a fonte da verdade; Web Push é apenas transporte opcional.
- Sem microserviços, fila, WebSocket, marketplace, pagamentos, chat, diagnóstico clínico ou recomendação médica nesta expansão.
- JSON permanece enquanto houver uma única instância da API. SQLite só entra após contenção, múltiplos processos ou consultas inviáveis serem demonstrados.
- Toda entrada externa recebe validação de tipo, tamanho, unidade, intervalo e autorização no servidor.
- Código novo deve atingir ao menos 80% de cobertura combinada e incluir testes unitários, integração e E2E dos fluxos críticos.
- A UI permanece sem gradientes; acessibilidade por teclado, contraste, viewport móvel e redução de movimento são critérios de aceite.
- `LICENSE`, `NOTICE.md`, a oferta do código correspondente e as atribuições de terceiros permanecem.

## Estado até a versão 1.3.0

- [x] Código importado em histórico Git independente, sem remote ou relação de fork.
- [x] Segredos e dados de runtime removidos do versionamento.
- [x] Interface padrão convertida para português do Brasil.
- [x] Catálogo com 1.324 exercícios traduzido; mídia visual mantida fora do Git e tratada como conteúdo de licença separada.
- [x] Compose preparado para build local, volume persistente e variáveis obrigatórias.
- [x] Armazenamento colaborativo JSON versionado, com escrita atômica e conflito de revisão.
- [x] Papéis de aluno/personal, conexões com consentimento, grants explícitos, inbox e auditoria.
- [x] Alternância de contexto e tela de conexões do aluno.
- [x] Painel profissional do personal com carteira de alunos, prioridades, métricas operacionais e cronograma.
- [x] Agenda com disponibilidade, horários livres, criação e cancelamento de atendimentos.
- [x] Financeiro com cobranças por aluno, recebimentos, pendências e gráficos.
- [x] Cadastro e edição de aluno, programa publicado e medidas corporais autorizadas.
- [x] E2E versionado do painel em celular, tablet e desktop, incluindo revogação fail-closed.

### Entregue, parcial e futuro

| Área | Situação em 1.3.0 | Limite atual |
|---|---|---|
| T1 — armazenamento e revisões | Entregue | O JSON exige uma única réplica da API. |
| T2 — papéis, vínculo, grants e inbox | Entregue | Web Push continua opcional; a inbox persistida é a fonte da verdade. |
| T3 — portais aluno/personal | Entregue | O portal colaborativo requer perfil web autenticado; o app móvel standalone continua local. |
| T4 — programas do personal | Parcial | O personal cria e publica o programa, mas a sincronização automática com o treino local do aluno ainda não foi concluída. |
| T5 — evolução | Parcial | Há visão operacional e endpoints autorizados; a integração ampliada com todo o histórico local de treinos permanece no roadmap. |
| T6 — medidas corporais | Parcial | O personal registra e consulta medidas autorizadas; a evolução combinada de medidas e peso ainda será ampliada. |
| T7 — novos starters, notas e anilhas | Planejado | Upper/lower, full-body, 5×5, notas por exercício e calculadora de anilhas ainda não foram implementados. |
| T8 — percentage/training-max | Planejado | A programação 5/3/1-style sobre o motor de progressão ainda não foi implementada. |
| T9 — tradução, segurança e release | Parcial | pt-BR, hardening e E2E do painel com API controlada estão cobertos; integração real com passkey e dados locais ainda é pendente. |

Os checklists abaixo preservam o plano técnico original. A tabela acima é o registro factual da
entrega; itens marcados como parciais ou planejados não devem ser interpretados como concluídos.

## Modelo de dados alvo

```js
// data/collaboration.json — representação lógica
{
  schemaVersion: 1,
  rev: 0,
  profiles: [{ userId, roles: ['student'], shareCode, createdAt, updatedAt }],
  connections: [{
    id, studentId, trainerId,
    requestedBy, status: 'pending',
    grants: {
      plansWrite: true,
      workoutsRead: true,
      progressRead: true,
      measurementsWrite: false,
      liveActivityRead: false
    },
    createdAt, respondedAt, endedAt
  }],
  notifications: [{ id, userId, type, resourceId, createdAt, readAt }],
  programs: [{ id, trainerId, studentId, name, currentVersion, status, createdAt, updatedAt }],
  programVersions: [{ id, programId, version, routines, week, publishedAt, publishedBy }],
  assignments: [{ id, programId, programVersionId, studentId, status, startsOn, endedAt }],
  measurements: [{ id, studentId, kind, side, value, unit, observedAt, recordedBy, createdAt }]
}
```

Todo treino iniciado por programa atribuído recebe um snapshot imutável:

```js
{
  assignmentId,
  programVersionId,
  prescriptionVersion: 1,
  entries: [{
    exerciseId,
    note,
    sets: [{ targetReps, targetWeight, percentage, amrap, trainingMax }]
  }]
}
```

## Ordem de execução

```text
T1 armazenamento/revisões
  └─ T2 papéis, vínculo, permissões, inbox e auditoria
       ├─ T3 portais aluno/personal
       ├─ T4 programas e atribuições
       │    └─ T5 acompanhamento e progresso
       └─ T6 medidas corporais

T1 ── T7 starters, notas e calculadora ── T8 5/3/1-style

T3 + T4 + T5 + T6 + T8 ── T9 segurança, tradução do catálogo e release
```

### Task 1: armazenamento versionado e API testável

**Arquivos:**

- Criar: `api/app.js`
- Criar: `api/lib/json-store.js`
- Criar: `api/lib/validation.js`
- Criar: `api/test/json-store.test.js`
- Criar: `api/test/current-api.test.js`
- Modificar: `api/server.js`
- Modificar: `api/package.json`

**Interfaces:**

```js
export function createJsonStore({ file, initial, migrate })
// -> { read(): object, update(expectedRev, reducer): object }

export function createApp({ config, stores, clock, randomBytes })
// -> async function requestHandler(req, res)
```

`update` recebe um reducer imutável, grava em arquivo temporário, faz rename atômico e lança `RevisionConflictError` quando `expectedRev` não é a revisão atual.

- [ ] Escrever testes RED para migração idempotente, escrita atômica, `409` por revisão obsoleta e rotas atuais.

```js
test('rejects a stale collaboration revision', () => {
  const store = createJsonStore(fixture())
  store.update(0, state => ({ ...state, profiles: [{ userId: 'u1', roles: ['student'] }] }))
  assert.throws(() => store.update(0, state => state), RevisionConflictError)
})
```

- [ ] Executar `npm test --prefix api`; o novo teste deve falhar por módulo ausente.
- [ ] Extrair o handler de `server.js`, implementar store/validação sem alterar envelopes ou rotas existentes.
- [ ] Executar `npm test --prefix api` e `npm test --prefix frontend`; ambas devem passar.
- [ ] Commit: `refactor: add revisioned atomic storage`.

### Task 2: papéis, vínculo, autorização, inbox e auditoria

**Arquivos:**

- Criar: `api/domain/access.js`
- Criar: `api/domain/connections.js`
- Criar: `api/domain/notifications.js`
- Criar: `api/domain/audit.js`
- Criar: `api/test/connections.test.js`
- Criar: `api/test/access-matrix.test.js`
- Modificar: `api/app.js`
- Modificar: `api/lib/validation.js`
- Modificar: `frontend/src/lib/api.js`
- Modificar: `frontend/src/store/useStore.js`

**Interfaces:**

```js
export function authorize({ actorId, studentId, action, collaboration })
// action: 'plans:write' | 'workouts:read' | 'progress:read' |
//         'measurements:write' | 'liveActivity:read'

export function requestConnection({ actorId, actorRole, shareCode, collaboration, now })
export function respondConnection({ actorId, connectionId, accept, grants, collaboration, now })
export function endConnection({ actorId, connectionId, collaboration, now })
```

Rotas: `GET/PUT /api/profile/roles`, `POST /api/connections`, `GET /api/connections`, `POST /api/connections/respond`, `POST /api/connections/end`, `GET /api/notifications`, `POST /api/notifications/read`.

- [ ] Escrever a matriz RED cobrindo aluno, personal, terceiro, vínculo pendente/ativo/encerrado e cada grant.

```js
for (const [action, grant] of Object.entries(ACTION_GRANTS)) {
  test(`denies ${action} when ${grant} is false`, () => {
    assert.equal(authorize(context({ [grant]: false }, action)), false)
  })
}
```

- [ ] Executar `npm test --prefix api -- access-matrix`; deve falhar por exports ausentes.
- [ ] Implementar códigos de compartilhamento aleatórios, expiração, limite de uma conexão ativa por aluno, inbox persistida e auditoria sem valores de saúde.
- [ ] Adicionar rate limit específico para solicitação/aceite e respostas `400/403/404/409` sem enumeração de contas.
- [ ] Executar testes de API e auditoria de autorização; cobertura do código novo deve ser pelo menos 80%.
- [ ] Commit: `feat: add consent-based trainer connections`.

### Task 3: contextos e portais aluno/personal

**Arquivos:**

- Criar: `frontend/src/lib/collaboration-api.js`
- Criar: `frontend/src/store/useCollaboration.js`
- Criar: `frontend/src/views/student/Connections.jsx`
- Criar: `frontend/src/views/personal/PersonalHome.jsx`
- Criar: `frontend/src/views/personal/Students.jsx`
- Criar: `frontend/src/views/personal/StudentDetail.jsx`
- Criar: `frontend/src/views/personal/PersonalRoutes.test.jsx`
- Modificar: `frontend/src/App.jsx`
- Modificar: `frontend/src/components/TabBar.jsx`
- Modificar: `frontend/src/views/Settings.jsx`

**Interfaces:**

```js
export const useCollaboration = create(() => ({
  context: 'student',
  connections: [],
  notifications: [],
  students: [],
  setContext(context) {},
  refresh() {}
}))
```

- [ ] Escrever testes RED para rota protegida, alternador de contexto e aluno sem personal.
- [ ] Executar o teste focado Vitest; deve falhar porque as rotas não existem.
- [ ] Adicionar `/aluno/conexoes`, `/personal`, `/personal/alunos` e `/personal/alunos/:studentId` reutilizando componentes atuais.
- [ ] Garantir que guest/mobile não inicializem `useCollaboration` e que proteção visual não substitua a autorização do servidor.
- [ ] Validar 360×800, 768×1024 e desktop; foco, rótulos e estados vazios devem ser utilizáveis.
- [ ] Commit: `feat: add student and trainer portals`.

### Task 4: programas versionados, atribuição e recomendação de treino

**Arquivos:**

- Criar: `api/domain/programs.js`
- Criar: `api/test/programs.test.js`
- Criar: `frontend/src/lib/programs.js`
- Criar: `frontend/src/lib/programs.test.js`
- Criar: `frontend/src/views/personal/ProgramEdit.jsx`
- Criar: `frontend/src/views/student/AssignedProgram.jsx`
- Modificar: `api/app.js`
- Modificar: `frontend/src/views/RoutineEdit.jsx`
- Modificar: `frontend/src/sheets.jsx`
- Modificar: `frontend/src/store/useStore.js`
- Modificar: `frontend/src/lib/plan-share.js`

**Interfaces:**

```js
export function publishProgram({ actorId, programId, draft, expectedRev, collaboration, now })
export function assignProgram({ actorId, programVersionId, studentId, startsOn, collaboration, now })
export function snapshotAssignment({ assignment, version, localState })
```

- [ ] Escrever testes RED: publicar cria versão imutável; ajuste cria nova versão; treino ativo e histórico não mudam; revogação impede publicação.
- [ ] Executar os testes focados de API e frontend; devem falhar por funções ausentes.
- [ ] Implementar rascunho, preview, publicação, atribuição, aceite inicial e atualização automática somente de agenda futura.
- [ ] Fotografar `assignmentId`, `programVersionId`, targets e nota no começo do treino.
- [ ] Preservar criação própria, freestyle, cópia do programa e desvinculação pelo aluno.
- [ ] Executar testes completos e um E2E personal publica → aluno inicia → personal atualiza → treino em andamento permanece igual.
- [ ] Commit: `feat: add versioned trainer programs`.

### Task 5: acompanhamento de execução e progresso

**Arquivos:**

- Criar: `api/domain/progress.js`
- Criar: `api/test/progress.test.js`
- Criar: `frontend/src/lib/student-progress.js`
- Criar: `frontend/src/lib/student-progress.test.js`
- Criar: `frontend/src/views/personal/StudentProgress.jsx`
- Modificar: `api/app.js`
- Modificar: `frontend/src/views/personal/StudentDetail.jsx`
- Modificar: `frontend/src/views/Workout.jsx`
- Modificar: `frontend/src/lib/history.js`

**Interfaces:**

```js
export function summarizeStudentProgress({ workouts, assignments, bodyweight, range })
// -> { adherence, volume, duration, e1rm, recentWorkouts, lastActivity }
```

- [ ] Escrever testes RED comparando os mesmos fixtures usados por Stats/History e cobrindo planned/completed/partial/missed.
- [ ] Executar teste focado; deve falhar por função ausente.
- [ ] Implementar projeção autorizada, leitura sob demanda e heartbeat já existente para atividade ao vivo consentida.
- [ ] Não adicionar WebSocket nem cache até medição demonstrar necessidade.
- [ ] Testar IDOR trocando `studentId`, revogação imediata e push desligado.
- [ ] Commit: `feat: add trainer progress monitoring`.

### Task 6: peso e medidas corporais compartilhadas

**Arquivos:**

- Criar: `api/domain/measurements.js`
- Criar: `api/test/measurements.test.js`
- Criar: `frontend/src/lib/measurements.js`
- Criar: `frontend/src/lib/measurements.test.js`
- Criar: `frontend/src/components/MeasurementForm.jsx`
- Criar: `frontend/src/views/student/Measurements.jsx`
- Criar: `frontend/src/views/personal/StudentMeasurements.jsx`
- Modificar: `api/app.js`
- Modificar: `frontend/src/views/Stats.jsx`

**Métricas da primeira versão:** peso, cintura, peito, quadril, pescoço, braço, coxa, panturrilha e percentual de gordura opcional. Braço/coxa/panturrilha aceitam lado esquerdo/direito; armazenamento usa kg e cm.

```js
export function normalizeMeasurement({ kind, side, value, unit, observedAt })
export function canRecordMeasurement({ actorId, studentId, collaboration })
```

- [ ] Escrever testes RED para conversão kg/lb e cm/in, limites plausíveis, autoria, data futura, grant desligado e migração do peso legado.
- [ ] Executar os testes focados; devem falhar por módulos ausentes.
- [ ] Implementar formulário, séries históricas, autoria visível, notificação e trilha de correção/exclusão.
- [ ] Garantir que um peso legado apareça uma única vez e que somente o aluno possa excluir registro de outro autor.
- [ ] Executar testes unitários, integração e E2E de permissão/revogação.
- [ ] Commit: `feat: add consented body measurements`.

### Task 7: starters, notas por exercício e calculadora de anilhas

**Arquivos:**

- Criar: `frontend/src/lib/plates.js`
- Criar: `frontend/src/lib/plates.test.js`
- Criar: `frontend/src/components/PlateCalculator.jsx`
- Modificar: `frontend/src/lib/starter.js`
- Modificar: `frontend/src/lib/plan-share.js`
- Modificar: `frontend/src/views/RoutineEdit.jsx`
- Modificar: `frontend/src/views/Workout.jsx`
- Modificar: `frontend/src/store/useStore.js`

**Planos exatos:** upper/lower quatro dias, full-body três dias e 5×5 três dias. Cada plano usa IDs existentes, gera novos IDs de rotina e é adicionado sem sobrescrever rotinas atuais.

```js
export function calculatePlates({ target, bar, available, unit })
// -> { perSide: number[], actual: number, delta: number, exact: boolean }
```

- [ ] Escrever testes RED para IDs, agenda, não sobrescrita, notas em export/import e cálculo kg/lb com inventário limitado.
- [ ] Executar os testes focados; devem falhar pelos casos e função ausentes.
- [ ] Adicionar os três starters, `note` persistente na rotina e snapshot da nota no treino.
- [ ] Implementar cálculo guloso por pares em ordem decrescente, retornando a carga atingível mais próxima sem ultrapassar o alvo.
- [ ] Validar integralmente em guest, PWA autenticada e app móvel.
- [ ] Commit: `feat: add starter plans notes and plate calculator`.

### Task 8: programação percentage/training-max 5/3/1-style

**Arquivos:**

- Criar: `frontend/src/lib/training-max.js`
- Criar: `frontend/src/lib/training-max.test.js`
- Modificar: `frontend/src/lib/progression.js`
- Modificar: `frontend/src/lib/progression.test.js`
- Modificar: `frontend/src/sheets.jsx`
- Modificar: `frontend/src/views/RoutineEdit.jsx`
- Modificar: `frontend/src/views/Workout.jsx`

**Variante fechada:** TM inicial sugerido em 90% do e1RM, semanas 1–3 em `65/75/85 × 5/5/5+`, `70/80/90 × 3/3/3+`, `75/85/95 × 5/3/1+`; deload em `40/50/60 × 5`. Avanço por ciclo: +2,5 kg para superiores e +5 kg para inferiores, sempre editável. Arredondamento usa o menor par de anilhas configurado.

```js
export function prescribeTrainingMaxSession({ week, trainingMax, increment, plates })
// -> [{ percentage, reps, amrap, targetWeight }]
```

- [ ] Escrever tabelas RED para quatro semanas, kg/lb, arredondamento, AMRAP, alteração de TM e histórico legado.
- [ ] Executar `npm test --prefix frontend -- training-max progression`; deve falhar por módulo/política ausente.
- [ ] Adicionar uma camada de prescrição por série sem alterar `linear`, `greyskull`, `double`, `time` ou progressão bodyweight.
- [ ] Salvar TM, semana, percentual e target de cada série no snapshot concluído.
- [ ] Exibir explicação da carga e exigir confirmação antes de aplicar aumento automático de TM.
- [ ] Executar toda a regressão do progression engine e cobertura mínima de 80% no módulo.
- [ ] Commit: `feat: add training-max percentage programming`.

### Task 9: português completo, segurança e release

**Arquivos:**

- Criar: `frontend/src/instr/pt.js`
- Criar: `e2e/student-autonomous.spec.js`
- Criar: `e2e/trainer-lifecycle.spec.js`
- Criar: `e2e/permissions.spec.js`
- Modificar: `frontend/src/lib/i18n.js`
- Modificar: `frontend/scripts/check-locales.mjs`
- Modificar: `README.md`
- Modificar: `SECURITY.md`
- Modificar: `docs/SELF_HOSTING.md`
- Modificar: `docs/MOBILE.md`

**Fluxos E2E obrigatórios:**

1. aluno autônomo cria plano e conclui treino sem personal;
2. personal solicita vínculo, aluno aceita e aparece na lista;
3. personal publica/ajusta programa e aluno executa a versão correta;
4. personal registra medida autorizada e aluno vê autoria;
5. aluno revoga vínculo e toda leitura/escrita cruzada retorna `403`;
6. backup legado é restaurado e migrado sem perda;
7. guest e mobile continuam locais.

- [ ] Escrever E2E RED e completar o pacote pt-BR de nomes/instruções do catálogo com a mesma contagem de exercícios da base inglesa.
- [ ] Executar Playwright em desktop e mobile; confirmar as falhas por fluxos ainda não conectados.
- [ ] Corrigir apenas lacunas observadas, incluir proteção de Origin/CSRF, rate limit, headers, limites de payload e logs sem dados sensíveis.
- [ ] Executar `npm test` em API/frontend, coverage, Playwright, build web, build APK, `npm audit --omit=dev` e smoke test do Compose.
- [ ] Fazer teste real de backup/restore antes da migração do deploy existente.
- [ ] Commit: `chore: harden and document trainer release`.

## Critério de conclusão do roadmap

O roadmap termina somente quando todos os fluxos E2E passam, código novo mantém 80% de cobertura, nenhum acesso cruzado indevido é possível, o aluno sem personal mantém a experiência atual e a versão publicada oferece seu código correspondente sob AGPL.
