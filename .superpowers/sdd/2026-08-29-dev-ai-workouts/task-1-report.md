# Task 1 — Regressões, autenticação Dev e adapters dos provedores

## Status

Concluída. A Task 1 entrega autenticação Dev em duas camadas, configuração criptografada de três slots fixos, adapters oficiais, teste obrigatório antes da ativação, geração sem fallback, telemetria sem conteúdo e proteção de agenda/IDs. O build frontend foi restaurado com `Plan.jsx` exatamente igual ao commit `2658eb5`.

## Commits

- `f943a19` — `test: add security contracts for AI providers` (checkpoint RED)
- `7db2f1f` — `feat: secure Dev AI provider configuration` (checkpoint GREEN)

## Arquivos da tarefa

- `.env.example` — documenta usuário Dev obrigatório, hash scrypt e chave mestra hexadecimal de 32 bytes.
- `api/dev-auth.js` — credencial explícita, validação de produção, cookie de quatro horas e verificação de Origin/Capacitor.
- `api/ai-providers.js` — slots, AES-256-GCM, DTOs, adapters, modelos paginados, testes de slot, ativação e uso.
- `api/ai.js` — IDs de rotina gerados pelo servidor e aplicação de agenda sem sobrescrever Personal/manual.
- `api/server.js` — contratos HTTP, guards, integração dos adapters, ausência de fallback e persistência de métricas.
- `api/Dockerfile` — inclui os novos módulos na imagem.
- `docker-compose.yml` — conecta as variáveis de autenticação Dev e chave mestra.
- `api/test/ai-providers.test.js`, `api/test/dev-auth.test.js`, `api/test/dev-ai-contract.test.js`, `api/test/ai.test.js`, `api/test/dockerfile.test.js` — testes unitários, de segurança e de wiring.
- `frontend/src/views/Plan.jsx` — restaurado byte a byte do commit `2658eb5`; por coincidir com o baseline, não gerou diff no commit GREEN.

O WIP já existente em `docs/superpowers/plans/2026-08-29-dev-ai-workouts.md`, `frontend/src/lib/ai-plan.js` e `frontend/src/store/useStore.js` foi preservado fora do stage.

## Decisões

1. `AI_CONFIG_MASTER_KEY` aceita somente 64 caracteres hexadecimais, equivalentes a 32 bytes. A chave nunca é persistida; AES-256-GCM usa IV aleatório e tag de autenticação.
2. Chave mestra ausente ou inválida desabilita configuração, listagem e geração de IA com `503`, sem impedir health/core.
3. A configuração persistida tem no máximo um registro por `openai`, `gemini` e `anthropic`. O DTO contém apenas provider, modelo selecionado, configured, fingerprint, teste, active e métricas.
4. Atualizar chave ou modelo invalida o teste e desativa o slot. Ativação só aceita `testStatus=success` com `testedAt`; geração consulta exclusivamente o slot ativo testado.
5. O teste do slot chama `runStructuredOutput` com schema mínimo pelo mesmo adapter usado na geração. Não existe ativação simulada/local.
6. OpenAI usa Responses API, `store:false` e JSON Schema; Gemini usa `x-goog-api-key`, `responseMimeType` e `responseSchema`; Anthropic usa Messages, `output_config.format` e `anthropic-version`.
7. Hosts são fixos. Erros HTTP são sanitizados; timeout, recusas e truncamentos são tratados antes do parse.
8. Uso persiste somente provider, model, status, tokens normalizados, latência e timestamp. Prompt e resposta não são gravados.
9. Autenticação Dev continua subordinada à passkey de uma conta admin. Produção exige usuário começando por `first_dev_` e hash scrypt explícito; nenhum password inicial é gerado ou escrito em `/data`.
10. Toda mutação Dev/IA usa Origin exata. Capacitor é aceito somente sem Origin; um Origin conflitante sempre vence e é recusado.
11. IDs do modelo são apenas metadados (`_aiSourceRoutineId`). IDs efetivos são UUIDs gerados no servidor com verificação de colisão contra rotinas existentes e entre rotinas novas.
12. A agenda IA substitui apenas dias vazios ou anteriormente ocupados por IA; dias manuais e prescritos pelo Personal permanecem intactos.

## Evidência TDD

### RED 1

Comando:

```text
npm test -- --test-name-pattern="Dev|provider|Gemini|activation|generation|structured|model listing|applyAiWorkout|normalizeAiWorkout"
```

Resultado esperado observado: 4 falhas. Os módulos `ai-providers.js` e `dev-auth.js` não existiam; `applyAiWorkout` substituía um dia manual; `normalizeAiWorkout` aceitava IDs repetidos/controlados pelo modelo.

### RED 2

Comando:

```text
npm test -- --test-name-pattern="refusals|HTTP errors"
```

Resultado esperado observado: `structured generation rejects refusals and truncated provider responses` falhou porque uma resposta OpenAI incompleta era aceita.

### GREEN

Comando final:

```text
cd api && npm test
```

Resultado: 97 testes, 97 passaram, 0 falharam, 0 ignorados.

## Especificação de garantias

| Garantia | Teste | Tipo | Resultado |
|---|---|---|---|
| Agenda manual/Personal não é sobrescrita | `api/test/ai.test.js` | unidade | PASS |
| IDs efetivos são gerados no servidor e não colidem | `api/test/ai.test.js` | unidade | PASS |
| Gemini mantém chave apenas em header e usa campos camelCase | `api/test/ai-providers.test.js` | unidade | PASS |
| OpenAI/Anthropic usam os contratos oficiais solicitados | `api/test/ai-providers.test.js` | unidade | PASS |
| Ativação exige Structured Output real bem-sucedido | `api/test/ai-providers.test.js` | unidade com fetch controlado | PASS |
| Não existe fallback para outro slot configurado | `api/test/ai-providers.test.js` | unidade | PASS |
| DTO/uso/erros não expõem chave, prompt ou resposta | `api/test/ai-providers.test.js` | segurança | PASS |
| Produção exige usuário `first_dev_` e hash scrypt | `api/test/dev-auth.test.js` | segurança | PASS |
| Cookie Dev dura 4h e aplica HttpOnly/Strict/Secure | `api/test/dev-auth.test.js` | segurança | PASS |
| Origin exata e regra Capacitor conflitante | `api/test/dev-auth.test.js` | segurança | PASS |
| Todos os contratos e guards estão ligados no servidor | `api/test/dev-ai-contract.test.js` | contrato/wiring | PASS |

## Comandos e resultados

- `cd api && node --check server.js` — exit 0.
- `cd api && npm test` — 97/97 PASS.
- `cd api && npm run test:coverage` — 97/97 PASS; cobertura global 99,93% linhas, 81,48% branches, 92,90% funções.
- Cobertura dos módulos novos: `ai-providers.js` 100% linhas / 80,31% branches / 94% funções; `dev-auth.js` 100% / 86,96% / 100%.
- Cobertura de `ai.js`: 100% linhas / 71,70% branches / 94,87% funções; o threshold global e a cobertura de linhas do módulo excedem 80%.
- `cd api && npm audit --omit=dev` — 0 vulnerabilidades.
- `cd frontend && npm run build` — exit 0, 136 módulos transformados; apenas aviso não bloqueante de chunks grandes.
- `git diff --exit-code 2658eb5 -- frontend/src/views/Plan.jsx` — exit 0.
- `git diff --check` e `git diff --cached --check` — sem erros.
- Verificação adicional `cd frontend && npm test` — 347 passaram e 2 falharam no WIP pré-existente de `ai-plan`: expectativa antiga sem `academia` e rótulo acentuado. O brief exige build frontend, que passou; esses arquivos foram preservados fora do ownership/stage.

## Autorrevisão de segurança diferencial

### Resumo executivo

| Severidade | Achados |
|---|---:|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 1 |

Risco do diff: alto por natureza (auth, criptografia e chamadas externas), mas sem achado bloqueante após testes e análise adversarial. Recomendação para a Task 1: **APPROVE**. Recomendação para a branch completa: condicional às tarefas posteriores de integração do painel.

### Baseline e histórico

O baseline `2658eb5` introduziu `initialPassword`, fallback para qualquer provider configurado, chave Gemini em query string e criptografia derivada do segredo de sessão. `git log -S` confirma que esses padrões nasceram no mesmo commit de protótipo e não eram correções históricas removidas. O diff substitui cada padrão por um controle explícito.

### Trust boundaries e blast radius

- `createDevAuth` é chamado uma vez no startup; afeta todas as rotas `/api/dev/*` via `requireDev`.
- `isTrustedMutation` é chamado pelo guard compartilhado de sete mutações Dev/IA.
- `runStructuredOutput` é chamado pela geração e pelo teste de slot; ambos atravessam o trust boundary de providers externos.
- `activeProvider` tem dois consumidores de produção: status e geração.
- `normalizeAiWorkout`/`applyAiWorkout` têm um consumidor de produção na geração e testes diretos para suas invariantes.

### Cenários adversariais verificados

1. Admin autenticado recebe CSRF de Origin hostil: mutação retorna `403`; marcador Capacitor não supera Origin conflitante.
2. Operador configura duas chaves e não ativa nenhuma: geração retorna indisponível; não escolhe a primeira chave.
3. Modelo devolve ID `manual` repetido: servidor substitui por UUIDs únicos e mantém `_aiSourceRoutineId` apenas como auditoria.
4. Modelo agenda IA em dia manual/Personal: atribuição existente permanece.
5. Provider devolve mensagem contendo a chave no erro: resposta interna é substituída por status sanitizado; chave não entra no DTO/log controlado.
6. Chave mestra ausente/corrompida: IA fica desabilitada; health e rotas core continuam inicializando.

### Limitações da revisão

- Nenhuma chave real foi usada, portanto não foi disparada uma chamada paga contra OpenAI/Gemini/Anthropic durante a verificação. Os requests e respostas foram exercitados com `fetch` controlado; em produção, o endpoint de teste executa a mesma função com o `fetch` real.
- A análise foi focada nos arquivos de auth, crypto, adapters, endpoints e configuração; WIP futuro do frontend não foi alterado nem incluído no commit.

## Riscos e itens não feitos

1. `frontend/src/views/DevPanel.jsx` ainda usa endpoints/DTOs antigos. A atualização visual/funcional pertence às tarefas seguintes; até lá, os endpoints novos existem, mas o painel atual não configura os slots.
2. Registros do protótipo criptografados com o segredo de sessão não são migrados automaticamente. Eles nunca ficam ativos/testados; o operador deve regravar a chave no novo slot usando `AI_CONFIG_MASTER_KEY`.
3. A suíte frontend completa mantém duas falhas ligadas ao WIP não commitado, embora o build requerido passe.
4. O aviso de bundle grande do Vite permanece fora do escopo desta tarefa.
5. Nenhum deploy, push, chamada paga ou alteração de credencial externa foi executado.

## Fix round 1/5 — findings Important

Base revisada: `97ae279`.

### Escopo corrigido

1. Saídas malformadas de providers não propagam mais conteúdo bruto por `SyntaxError`, DTO de teste, resposta de geração ou log 5xx. O parse converte falhas para `AI provider returned invalid structured output`; o teste de slot retorna apenas `AI provider test failed`; a geração captura também erros semânticos de `normalizeAiWorkout` e expõe somente `AI provider request failed`.
2. `PUT /api/dev/ai/active` agora verifica `aiConfigurationEnabled()` antes de ler/mutar o body e retorna `503` quando `AI_CONFIG_MASTER_KEY` está ausente ou inválida.

### RED sentinel

Comando:

```text
npm test -- --test-name-pattern="malformed provider output|activation fails closed|generation never forwards"
```

Resultado: 3 falhas esperadas. O erro de parse continha `SENTINEL_PROVIDER_SECRET_PROMPT_RESPONSE`; a rota de ativação não possuía o guard; a geração encaminhava `error.message`.

Checkpoint RED: `ddb525f` (`test: reproduce Dev AI error disclosure`).

### GREEN e regressão

- Teste focado: 12/12 PASS.
- `cd api && npm test`: 100/100 PASS.
- `cd api && npm run test:coverage`: 100/100 PASS; global 99,93% linhas / 81,54% branches / 92,90% funções.
- `ai-providers.js`: 100% linhas / 80,61% branches / 94% funções.

### Limites

Somente os dois findings Important desta rodada foram tratados. Findings Minor permaneceram intocados conforme instrução.

## Fix round 2/5 — uso faturado em plano inválido

Base revisada: `c72737d`.

### Escopo corrigido

Quando o provider responde com usage válido, mas `normalizeAiWorkout` recusa o plano estrutural/semântico, o registro `AIUsage` agora mantém provider, modelo, input/output/total tokens e latência reais com status `failed`. Se a chamada falha antes de produzir usage, o fallback continua registrando zeros.

A seleção foi extraída para `failedGenerationUsage`, uma transformação imutável usada diretamente pelo catch da geração. A sanitização pública/log introduzida na rodada anterior permanece inalterada.

### RED

Comando:

```text
npm test -- --test-name-pattern="failed invalid-plan generation|generation failure wiring"
```

Resultado: 2 falhas esperadas — export inexistente e wiring do servidor ainda fixando tokens em zero.

Checkpoint RED: `7831a82` (`test: reproduce billed invalid-plan usage loss`).

### GREEN e regressão

- Teste focado: 11/11 PASS.
- `cd api && npm test`: 102/102 PASS.
- `cd api && npm run test:coverage`: 102/102 PASS; global 99,93% linhas / 81,60% branches / 92,92% funções.
- `ai-providers.js`: 100% linhas / 80,90% branches / 94,12% funções.

### Limites

Somente o finding de uso faturado desta rodada foi tratado. Findings Minor permaneceram intocados conforme instrução.
