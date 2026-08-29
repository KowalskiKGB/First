# Plano de implementação: painel dev e treino semanal com IA

> **Para agentes de implementação:** use este plano por tarefa, validando cada etapa com teste ou build antes de avançar.

**Objetivo:** permitir que um admin configure provedores BYOK de IA e que o aluno gere um treino semanal aplicado ao app com base em peso, altura, objetivo, preferências e aparelhos disponíveis.

## Referências oficiais usadas

- OpenAI Responses API / Structured Outputs: `https://developers.openai.com/api/docs/guides/structured-outputs`
- OpenAI Models API: `https://developers.openai.com/api/docs/api-reference/models/list`
- Google Gemini structured output: `https://ai.google.dev/gemini-api/docs/structured-output`
- Google Gemini generateContent: `https://ai.google.dev/api/generate-content`
- Google Gemini models: `https://ai.google.dev/gemini-api/docs/models`
- Anthropic Messages API: `https://platform.claude.com/docs/en/api/messages/create`
- Anthropic Models API: `https://platform.claude.com/docs/en/api/models/list`

## Implementado nesta fase

- [x] Núcleo backend de IA com prompt Markdown compacto, schema JSON, filtro por aparelhos e normalização do plano.
- [x] Chaves de provedores criptografadas com AES-256-GCM usando o segredo do servidor.
- [x] Painel dev em `/dev`, exigindo conta admin por passkey e credencial dev adicional.
- [x] Cadastro, edição, ativação, exclusão e listagem de modelos para OpenAI, Gemini e Anthropic.
- [x] Tela do aluno em Plano com dados mínimos, objetivo, preferências, restrições e aparelhos disponíveis.
- [x] Treino gerado aplicado ao estado do aluno e marcado como `_aiGenerated`.
- [x] Testes unitários de backend e frontend para as regras críticas.

## Roadmap de expansão

- [ ] Ampliar catálogo usado pela IA para todo o banco traduzido, com seleção curta por grupo muscular e equipamento antes da chamada ao modelo.
- [ ] Adicionar plano pago por aluno com limites de uso, histórico de gerações, custo por provedor e auditoria por solicitação.
- [ ] Permitir que o personal gere ou revise treino de um aluno vinculado, preservando consentimento e permissões do vínculo.
- [ ] Implementar programação por porcentagem/training max estilo 5/3/1 sobre o motor de progressão.
- [ ] Adicionar planos iniciais upper/lower, full-body e 5x5.
- [ ] Levar medidas corporais completas para o app do aluno: cintura, braço, peito, quadril, coxa e panturrilha.
- [ ] Adicionar notas por exercício e calculadora de anilhas por barra/equipamento.
- [ ] Evoluir agenda/financeiro do personal com recorrência, pacotes e inadimplência automática.

## Critérios de aceite

- O app não envia chave de IA ao navegador do aluno.
- O prompt enviado ao modelo contém apenas os dados necessários e IDs permitidos.
- A resposta é validada no servidor antes de alterar o treino.
- Se o provedor estiver sem chave, travado ou retornar exercício inválido, o treino do aluno não é alterado.
- A interface móvel deve continuar utilizável em largura de 390 px.
