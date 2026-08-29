# Revisão diferencial: painel dev e treino semanal com IA

Data: 2026-08-29

## Escopo

- `api/ai.js`
- `api/server.js`
- `api/Dockerfile`
- `frontend/src/views/Plan.jsx`
- `frontend/src/views/DevPanel.jsx`
- `frontend/src/lib/ai-plan.js`
- `frontend/src/store/useStore.js`
- `frontend/src/App.jsx`
- `frontend/src/views/Settings.jsx`
- `frontend/src/index.css`

## Resultado

**Aprovado para deploy privado.** Nenhum bloqueador crítico/alto ficou aberto após a revisão.

## Achados revisados

- API keys não aparecem no frontend e não entram no git. O navegador só envia a chave uma vez para `/api/dev/ai/providers`; depois o servidor retorna apenas `hasKey`.
- As chaves são criptografadas em `db.json` com AES-256-GCM em `api/ai.js`, derivado do segredo local de `/data/secret`.
- O painel `/dev` exige conta admin via passkey e uma segunda sessão `firstdev` de curta duração.
- O login dev recebeu rate limit em memória: 8 tentativas por IP/usuário a cada 15 minutos.
- A geração IA recebeu rate limit em memória: 6 gerações por aluno por hora.
- O prompt enviado à IA é compacto e inclui apenas os dados necessários do aluno e os IDs permitidos.
- A resposta do modelo é normalizada no servidor; exercício fora do catálogo permitido gera erro e não altera o estado do aluno.
- Rotinas antigas geradas por IA são substituídas; rotinas manuais e do personal são preservadas.

## Riscos aceitos

- O armazenamento continua JSON em volume, adequado à instância única atual já documentada. Se houver múltiplas réplicas da API, migrar para banco transacional.
- O catálogo inicial usado pela IA é curado e pequeno para reduzir tokens; a expansão para todo o catálogo traduzido fica no roadmap.
- O endpoint de geração chama provedores externos configurados pelo dono da instância. Dados enviados ao provedor dependem da política de privacidade do provedor escolhido.

## Verificação executada

- `cd api && npm test` — 73/73 testes passaram.
- `cd frontend && npm test` — 349/349 testes passaram.
- `cd frontend && npm run build` — build Vite concluído.
- Smoke Playwright mobile local em 390x844: tela de Plano, card IA, preenchimento de objetivo e seleção de aparelho.

## Referências oficiais de API

- OpenAI Structured Outputs / Responses API: `https://developers.openai.com/api/docs/guides/structured-outputs`
- OpenAI Models API: `https://developers.openai.com/api/docs/api-reference/models/list`
- Google Gemini structured output: `https://ai.google.dev/gemini-api/docs/structured-output`
- Google Gemini generateContent: `https://ai.google.dev/api/generate-content`
- Google Gemini models: `https://ai.google.dev/gemini-api/docs/models`
- Anthropic Messages API: `https://platform.claude.com/docs/en/api/messages/create`
- Anthropic Models API: `https://platform.claude.com/docs/en/api/models/list`
