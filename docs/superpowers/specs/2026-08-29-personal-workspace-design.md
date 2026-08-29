# Portal Personal Profissional — Design

**Status:** aprovado para implementação autônoma pelo proprietário em 29/08/2026.

## Objetivo

Adicionar ao First um contexto profissional para o Personal organizar alunos, prescrever treinos futuros, acompanhar evolução, registrar medidas autorizadas, controlar horários e manter contas a receber. O portal atual do aluno continua funcionando sem vínculo, inclusive como guest, PWA e app móvel offline.

## Decisões de produto

1. `Admin` continua sendo operação da instância; `Personal` é um papel comum e nunca herda acesso global de administrador.
2. Um usuário autenticado pode ter os papéis `student`, `trainer` ou ambos e alternar o contexto na interface.
3. O Personal pode trabalhar com:
   - aluno com conta First e vínculo aceito;
   - aluno gerenciado, ainda sem conta, para agenda, ficha, treino, medidas e financeiro.
4. Alunos com conta concedem permissões explícitas. Alunos gerenciados pertencem ao Personal que os criou.
5. O financeiro é um contas-a-receber manual em BRL. Não haverá gateway, cobrança automática, cartão, PIX, conciliação ou emissão fiscal nesta entrega.
6. A agenda deriva horários livres do expediente menos bloqueios e aulas. Slots livres não são persistidos.
7. Programas do Personal são versionados e afetam somente treinos futuros. Histórico e treino em andamento são imutáveis.
8. JSON atômico continua sendo o armazenamento enquanto a API tiver uma única réplica.

## Arquitetura

Um novo documento `collaboration.json` guarda somente o domínio colaborativo. O estado local do aluno em `state-<uid>.json` continua sendo a fonte de verdade de treinos concluídos e preferências. Endpoints do Personal leem projeções autorizadas do estado do aluno, mas nunca oferecem um `PUT` do estado inteiro para outro usuário.

`api/server.js` mantém autenticação, passkeys, push, estado próprio e Admin. O módulo `api/personal-router.js` recebe dependências pequenas (`readSession`, `readState`, `sendPush`, configuração e store) e devolve handlers para as rotas novas. Regras de negócio ficam em módulos puros e testáveis em `api/domain/`.

No React, `useStore` continua responsável pelo treino local. Uma store separada, `useCollaboration`, carrega o perfil colaborativo e o workspace do Personal somente para usuário autenticado no navegador. Guest, demo e mobile offline não fazem chamadas colaborativas.

## Modelo de dados

```js
{
  schemaVersion: 1,
  rev: 0,
  profiles: [{
    userId,
    roles: ['student'],
    shareCode,
    shareCodeExpiresAt,
    timezone: 'America/Fortaleza',
    createdAt,
    updatedAt
  }],
  connections: [{
    id,
    studentId,
    trainerId,
    requestedBy,
    status: 'pending' | 'active' | 'ended',
    grants: {
      plansWrite: true,
      workoutsRead: true,
      progressRead: true,
      measurementsWrite: false,
      liveActivityRead: false
    },
    createdAt,
    respondedAt,
    endedAt
  }],
  clients: [{
    id,
    trainerId,
    studentUserId: null,
    name,
    goal,
    phone,
    notes,
    targetSessionsPerWeek: 3,
    inactiveAfterDays: 7,
    createdAt,
    archivedAt: null
  }],
  notifications: [{ id, userId, type, title, body, resourceId, createdAt, readAt }],
  audit: [{ id, actorId, action, entity, entityId, studentId, trainerId, createdAt }],
  programs: [{
    id,
    trainerId,
    clientId,
    name,
    version,
    status: 'draft' | 'published',
    routines,
    week,
    publishedAt,
    createdAt,
    updatedAt
  }],
  measurements: [{
    id,
    clientId,
    studentUserId,
    kind,
    side,
    value,
    unit,
    observedAt,
    recordedBy,
    createdAt,
    correctedAt: null
  }],
  availability: [{ trainerId, weekday, start, end, slotMinutes }],
  appointments: [{
    id,
    trainerId,
    clientId,
    startsAt,
    endsAt,
    status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show',
    note,
    createdBy,
    createdAt,
    updatedAt
  }],
  receivables: [{
    id,
    trainerId,
    clientId,
    period,
    dueOn,
    amountCents,
    status: 'open' | 'paid' | 'waived',
    paidAt,
    paymentMethod,
    note,
    createdAt,
    updatedAt
  }]
}
```

## Autorização

- O dono sempre lê seus próprios dados.
- Personal vinculado lê treino/progresso somente com `workoutsRead`/`progressRead`.
- Personal publica programa somente com `plansWrite`.
- Personal registra medida somente com `measurementsWrite`.
- Vínculo pendente ou encerrado não concede acesso.
- Personal sempre pode operar os próprios alunos gerenciados.
- Admin não ganha permissões de Personal automaticamente.
- Toda rota com `clientId`, `studentId`, `programId`, `appointmentId` ou `receivableId` resolve o recurso no servidor e valida ownership/vínculo.
- Revogação tem efeito imediato.
- Auditoria guarda metadados da ação, nunca o valor de medida, treino completo ou valor financeiro.

## API

Leitura:

- `GET /api/collaboration` — perfil, vínculos, notificações e programas atribuídos do usuário.
- `GET /api/personal/workspace` — KPIs, prioridades, agenda curta, alunos e financeiro consolidado.
- `GET /api/personal/client?id=<clientId>` — ficha, progresso, medidas, programa, agenda e financeiro de um aluno autorizado.

Escrita:

- `PUT /api/profile/roles`
- `POST /api/connections/request`
- `POST /api/connections/respond`
- `POST /api/connections/end`
- `POST /api/notifications/read`
- `POST /api/personal/clients`
- `PUT /api/personal/client`
- `PUT /api/personal/program`
- `POST /api/personal/measurements`
- `PUT /api/personal/availability`
- `POST /api/personal/appointments`
- `PUT /api/personal/appointment`
- `POST /api/personal/receivables`
- `PUT /api/personal/receivable`

Toda escrita recebe `rev`; revisão obsoleta retorna `409`. Payloads colaborativos comuns têm limite de 32 KiB; programa tem limite de 256 KiB. Em produção, escrita exige `Origin` exatamente igual a `ORIGIN`.

## Métricas e prioridades

O servidor calcula indicadores determinísticos, sempre acompanhados do motivo:

1. `urgent`: pagamento vencido; aula nas próximas 24 h sem programa publicado; inatividade acima do limite do aluno.
2. `attention`: aderência de 28 dias abaixo de 70%; medidas sem atualização há 30 dias; cobrança a vencer em até 3 dias.
3. `ok`: nenhum motivo anterior.

KPIs do Personal:

- alunos ativos;
- aulas hoje e nos próximos sete dias;
- horas livres hoje;
- aderência média em 28 dias;
- previsto, recebido, em aberto e vencido no mês;
- alunos por prioridade.

## Agenda

O expediente inicial é segunda a sexta, 06:00–21:00, slots de 60 minutos; sábado 07:00–13:00. O Personal pode alterar esse expediente. O servidor rejeita intervalo inválido, sobreposição com aula ativa e consulta maior que 62 dias. Cancelar libera o horário; registros não são apagados.

A interface móvel usa uma linha vertical do dia com hora, status e ação. Desktop mostra lista priorizada de alunos, conteúdo central e trilho do dia lado a lado. O mesmo modelo funciona sem biblioteca de calendário.

## Financeiro

Valores são inteiros em centavos e moeda fixa `BRL`. Uma cobrança tem competência `YYYY-MM`, vencimento, valor e estado. Marcar como pago registra data e método; isenção é explícita. O gráfico de seis meses usa barras sólidas e oferece tabela textual equivalente.

## Programas, exercícios e medidas

O editor do programa usa o catálogo pt-BR existente, pesquisa sem acento e guarda apenas IDs, séries, repetições, descanso e nota. Publicar incrementa a versão. Para aluno com conta, a versão publicada aparece como recomendação atribuída; aplicar ao próprio plano é uma ação explícita do aluno.

Medidas canônicas: peso em kg; cintura, peito, quadril, pescoço, braço, coxa e panturrilha em cm; gordura corporal em percentual. Braço, coxa e panturrilha aceitam lado. Limites plausíveis e datas futuras são rejeitados.

## Interface e identidade visual

O portal mantém os fundos sólidos, hairlines, cantos e acento configurável do First. Tipografia de interface continua na família do sistema; números financeiros, horários e métricas usam algarismos tabulares e `ui-monospace` como papel utilitário. Não há gradientes novos.

Elemento assinatura: a linha operacional do dia une agenda, intervalos livres e alertas. Estados nunca dependem apenas de cor: cada um tem rótulo e motivo.

Transições:

- entrada de rota e troca de aluno: 160–180 ms, opacidade e deslocamento máximo de 4 px;
- expansão de detalhe e atualização de indicador: 140 ms;
- nenhum loop decorativo;
- `prefers-reduced-motion: reduce` remove todas as animações.

## Estados de interface

Toda view cobre carregamento, vazio, erro com nova tentativa e sucesso. Falha `409` atualiza os dados e orienta o usuário a repetir a ação. Falha `403` fecha ações privilegiadas e explica que a permissão foi revogada.

## Fora de escopo

- processamento de pagamentos;
- chat e videochamada;
- marketplace de profissionais;
- prontuário clínico, diagnóstico ou recomendação médica;
- folha fiscal/contábil;
- WebSocket, microserviço, fila ou banco relacional sem necessidade demonstrada.

## Critérios de aceite

1. Usuário ativa o papel Personal e alterna entre os contextos sem perder o portal do aluno.
2. Personal cria aluno gerenciado ou solicita vínculo por código; aluno aceita e aparece na lista.
3. Lista ordena alunos por prioridade e mostra motivo, última atividade, aderência, próxima aula e situação financeira.
4. Personal seleciona aluno, edita ficha, registra medida autorizada e publica programa com exercícios.
5. Revogação bloqueia imediatamente toda leitura/escrita cruzada.
6. Agenda mostra livres/ocupados, rejeita conflito, permite reagendar e cancelar.
7. Financeiro reconcilia exatamente previsto/recebido/aberto/vencido e gráfico com tabela.
8. Guest, demo e app móvel offline continuam funcionando sem inicializar colaboração.
9. Views funcionam em 360×800, 768×1024 e desktop, com teclado, foco visível e redução de movimento.
10. Código novo mantém cobertura mínima de 80%, sem vulnerabilidade alta e com E2E dos fluxos críticos.
