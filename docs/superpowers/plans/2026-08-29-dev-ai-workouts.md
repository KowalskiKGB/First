# First — Painel Dev e geração de treinos com IA

> Plano executável. Cada tarefa segue RED → GREEN → REFACTOR, produz commit convencional e mantém o restante do aplicativo funcional.

## Decisões fixas

- Backend Node e armazenamento JSON de instância única.
- OpenAI, Gemini e Anthropic; somente um provedor/modelo ativo globalmente e sem fallback automático.
- Aplicação automática apenas após validação completa no servidor, com versão e rollback.
- Agenda manual, do Personal e da IA coexistem. `S.week` continua sendo apenas a agenda manual.
- Uma ficha de academia por aluno, editável pelo aluno ou Personal autorizado.
- Todas as idades são permitidas; menores exigem confirmação do responsável e regras conservadoras.
- Sem cobrança nesta fase; apenas feature gate e contadores para evolução futura.
- Interface pt-BR, preta/verde, campos sólidos, sem gradientes. Movimento somente com `opacity` e `transform`, respeitando `prefers-reduced-motion`.

## Contratos-alvo

### Painel Dev

- `GET /api/dev/ai/providers`
- `PUT /api/dev/ai/provider`
- `POST /api/dev/ai/provider/test`
- `GET /api/dev/ai/models?provider=...`
- `PUT /api/dev/ai/active`
- `GET /api/dev/ai/usage?window=7d|30d`

### Aluno

- `GET /api/ai/context`
- `PUT /api/ai/profile`
- `PUT /api/ai/gym`
- `POST /api/ai/measurements`
- `POST /api/ai/jobs`
- `GET /api/ai/job?id=...`
- `POST /api/ai/plan/rollback`

### Personal

- Ampliar o detalhe do aluno com perfil, academia e plano IA.
- `PUT /api/personal/training-profile`
- `PUT /api/personal/gym`

## Task 1 — Regressões, autenticação Dev e adapters dos provedores

**Objetivo:** fechar os problemas de segurança do protótipo e entregar slots oficiais testáveis para os três provedores.

**Arquivos principais:** `api/server.js`, `api/ai.js`, novos módulos focados em `api/lib/`, `api/test/`, `.env.example`, `.gitignore`.

1. Escrever testes inicialmente falhos para sobrescrita da agenda do Personal, colisão de IDs, parâmetros Gemini, `Origin`, vazamento de `initialPassword`, ativação sem teste e retorno/log de chave.
2. Separar autenticação Dev da configuração de IA: usuário `first_dev_<aleatório>`, senha de 32 bytes, somente hash `scrypt` em produção, sessão de quatro horas, logout, rate limit, passkey admin mais credencial Dev e `Origin` exata.
3. Usar `AI_CONFIG_MASTER_KEY` exclusivamente para AES-256-GCM das chaves. Falhar fechado na IA quando ausente/inválida sem derrubar o app.
4. Persistir slots `openai`, `gemini`, `anthropic` com `selectedModel`, `configured`, `keyFingerprint`, `testedAt`, `testStatus` e métricas. Nunca persistir senha inicial nem retornar segredo.
5. Implementar adapters oficiais sem base URL customizada: OpenAI Responses com `store:false`; Gemini com `x-goog-api-key` e campos camelCase; Anthropic Messages com `output_config.format`. Normalizar timeout, recusa e truncamento.
6. Listar modelos pelas APIs oficiais, incluindo paginação aplicável.
7. Exigir teste real de Structured Output antes da ativação. Ativar exatamente um slot testado e nunca escolher outro automaticamente.
8. Registrar `AIUsage` com tokens, latência, status, provedor e modelo, sem prompt/resposta.

**Verificação:** testes unitários/HTTP de adapters e segurança, cobertura dos módulos alterados e `npm test` da API.

## Task 2 — Schema colaborativo, perfil, academia, permissões e medidas

**Objetivo:** criar a fonte persistente e autorizada para contexto de treino do aluno.

**Arquivos principais:** `api/domain/schema.js`, `api/domain/store.js`, `api/personal.js`, `api/test/`, `frontend/src/lib/connections.js`.

1. Escrever testes de migração idempotente e preservação dos dados existentes.
2. Evoluir o schema com `trainingProfiles`, `gymProfiles`, `aiPlans`, `aiJobs` e `aiUsage`. Reter dez versões IA por aluno e dois mil usos.
3. `TrainingProfile` inclui faixa etária, altura, objetivo, experiência, dias, duração, focos, favoritos, evitados, limitações e consentimentos.
4. `GymProfile` inclui nome, categorias genéricas, máquinas específicas e IDs de exercícios suportados.
5. Adicionar grants `trainingProfileWrite` e `aiPlanRead`; somente o aluno os altera sem encerrar vínculo.
6. Implementar endpoints do aluno para contexto, perfil, academia e medidas com validação, limites e revisão otimista.
7. Implementar endpoints do Personal para perfil/academia com vínculo ativo e `trainingProfileWrite`; leitura do plano exige `aiPlanRead`.
8. Notificar o Personal autorizado em nova versão IA e o aluno quando o Personal alterar perfil/academia.
9. Projetar perfil/academia/plano apenas para atores autorizados.

**Verificação:** schema, autorização positiva/negativa, isolamento, retenção e endpoints HTTP.

## Task 3 — Catálogo completo, shortlist, contrato e fila persistente

**Objetivo:** gerar e aplicar plano seguro com o catálogo real de 1.324 exercícios.

**Arquivos principais:** `api/ai.js`, novos módulos em `api/lib/`, `api/server.js`, `api/Dockerfile`, `docker-compose.yml`, catálogo pt-BR e `api/test/`.

1. Escrever testes falhos para shortlist determinística, privacidade, schema semântico, idempotência e reinício de job.
2. Compartilhar no container API o catálogo real e nomes pt-BR como fonte única.
3. Equipamento genérico libera sua categoria; máquina específica libera só IDs associados. Bloqueados/incompatíveis são filtrados antes e depois do modelo.
4. Construir shortlist determinística de até 120 itens priorizando favoritos, histórico, foco, experiência e fundamentos.
5. Gerar Markdown versionado apenas com perfil anonimizado, medidas, objetivo/disponibilidade, limitações não confiáveis, resumo de 28 dias, exercícios permitidos, segurança e contrato.
6. Nunca enviar nome, telefone, e-mail, financeiro, notas privadas ou histórico bruto.
7. Definir `AIWorkoutPlanV1`: rotinas, dias, exercícios, modo, séries, faixa de repetições/tempo, descanso, progressão e nota; objetos fechados e campos obrigatórios compatíveis com os três providers.
8. Gerar IDs finais no servidor e rejeitar duplicidades, IDs desconhecidos, aparelho ausente, dia/valor inválido, carga absoluta, recusa e truncamento.
9. Implementar `AIJob` persistente `queued|running|applied|failed`, etapa pública e idempotência. Um job ativo/aluno, sem retry/fallback. Reinício durante `running` falha com segurança.
10. Aplicar somente após validação, manter dez versões, rollback e `contextHash` determinístico.

**Verificação:** shortlist/prompt/validator, providers mockados, jobs/restart/rollback e build da imagem API.

## Task 4 — Agendas independentes e execução coexistente

**Objetivo:** impedir que IA ou Personal apaguem a programação manual ou uma à outra.

**Arquivos principais:** `frontend/src/lib/personal-forms.js`, novo helper de agenda, `history.js`, store, `TabBar.jsx`, `Workout.jsx`, `sheets.jsx` e testes.

1. Escrever testes para opções manual/IA/Personal no mesmo dia, preferência diária, adesão única e sessões separadas.
2. Manter `S.week` só manual e adicionar agendas versionadas por fonte; migrar estado legado sem perder rotinas.
3. Criar helper puro que retorna todas as sessões do dia com `sourceType`, `planId`, `version` e rótulo.
4. `dayPlan` define preferência e nunca esconde outras opções.
5. Com múltiplas sessões, TabBar, Workout e lembretes abrem seletor e informam a quantidade.
6. Histórico registra origem/plano/versão; sessões contam separadamente no volume/histórico e uma vez ao dia em adesão/sequência.
7. Rotinas IA são somente leitura e podem ser copiadas como manuais; nova geração substitui só IA.

**Verificação:** unitários de agenda/histórico, componentes críticos e build frontend.

## Task 5 — Wizard do aluno, Painel Dev e área IA do Personal

**Objetivo:** entregar a experiência completa em mobile, tablet e desktop.

**Arquivos principais:** `Plan.jsx`, `Home.jsx`, `DevPanel.jsx`, `StudentDetail.jsx`, componentes focados, `index.css`, i18n e testes.

1. Substituir formulário extenso por card premium e wizard de quatro etapas: dados/medidas; objetivo/experiência/dias/duração; academia/aparelhos/favoritos/restrições; consentimento e gerar/aplicar.
2. Exibir estados persistidos incompleto, fila, organizando, gerando, validando, aplicado e falha; retomar polling ao reabrir.
3. Comparar `contextHash` e avisar atualização sem gastar tokens automaticamente.
4. Mostrar badges “IA”, “Personal” e “Meu treino”, versão, justificativa e rollback.
5. Painel Dev com três cartões, seletor pesquisável, chave mascarada, teste obrigatório, ativação e métricas 7/30 dias.
6. Área “IA e academia” no aluno do Personal com medidas, aparelhos, prioridades, versão, justificativa e edição autorizada.
7. Todos os textos no i18n pt-BR, sem mojibake; labels, foco e `aria-live` corretos.
8. Sem gradientes; animações só `opacity`/`transform` e reduced motion.

**Verificação:** componentes/helpers, Playwright de Dev/wizard/rollback/Personal/seletor; screenshots e console limpo em 390 px, tablet e desktop.

## Task 6 — Documentação, auditorias, credenciais, deploy e Android

**Objetivo:** publicar com segurança e provar produção e app móvel.

1. Atualizar roadmap: training max 5/3/1, upper/lower, full-body, 5×5, medidas corporais, notas e calculadora de anilhas.
2. Atualizar `SECURITY.md` com ameaça, dados enviados, retenção, rotação e incidentes.
3. Manter `CREDENCIAIS_TESTE.md` ignorado. No deploy gerar usuário `first_dev_<aleatório>`, senha de 32 bytes e `AI_CONFIG_MASTER_KEY`; Coolify recebe somente hash/chave mestra e o arquivo local recebe apenas credencial Dev.
4. Executar auditoria diferencial, defaults inseguros, `npm audit`, testes, cobertura, builds web/mobile e E2E.
5. Fazer backup do volume, commit convencional, push para First e deploy Coolify.
6. Validar produção, bundles/cache/service worker, API, login Dev, segredos, console e responsividade.
7. Gerar Capacitor; se celular conectado, `adb install -r` e smoke. Caso contrário, deixar APK pronto e pedir conexão apenas nessa etapa.

**Verificação final:** cobertura mínima de 80% nos módulos novos/alterados; unitários, integração e E2E verdes; zero segredo no Git/log/browser; produção e app móvel funcionais.

## Critérios globais de aceite

- Sem provedor testado, geração indisponível sem afetar o app.
- Falha/recusa/timeout/reinício não troca plano e não faz fallback.
- Equipamentos validados antes e depois da chamada.
- Prompt inclui contexto útil sem PII, financeiro ou notas privadas.
- Personal sem grant não lê nem altera dados IA.
- Manual, IA e Personal coexistem.
- Chaves não retornam ao navegador, logs ou Git.
- Nenhuma chave comercial é presumida.
