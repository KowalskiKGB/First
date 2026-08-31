# Plano de implementação — academia, IA e console Dev

**Objetivo:** unificar a seleção de aparelhos no catálogo de exercícios, publicar um diretório moderado de academias, tornar o `/devadmin` operacional e corrigir a geração semanal truncada.

**Arquitetura:** ampliar o JSON colaborativo versionado, adicionar rotas públicas/Dev pequenas no backend Node e extrair um navegador React de exercícios reutilizável. A academia escolhida é um snapshot; a fila de sugestões é append-only até revisão.

## Jornadas verificáveis

1. Visitante seleciona UF/município, pesquisa uma academia, abre o inventário e a escolhe sem login.
2. Aluno logado sugere academia ou aparelho pelo catálogo; o dado publicado não muda antes da aprovação Dev.
3. Dev autentica em `/devadmin`, edita um provedor por vez, alterna o ativo, revisa solicitações e abre usuários.
4. Aluno escolhe o objetivo em botões, configura equipamentos pelo catálogo e gera um plano sem truncamento.
5. A Home mostra uma única divisória antes da sessão de hoje e traduz nomes legados de rotina.

## Tarefas TDD

1. Criar testes RED de migração, validação, leitura pública, autoria e moderação de academias.
2. Criar testes RED do navegador compartilhado, objetivos canônicos, seleção exata e Home.
3. Criar testes RED das abas Dev, editor único, solicitações e usuários isolados.
4. Criar teste RED do adapter OpenAI para saída suficiente e raciocínio mínimo em modelos GPT-5; testar código de falha sanitizado.
5. Implementar schema e rotas; executar testes focados até GREEN.
6. Implementar componentes e telas; executar unitários e E2E até GREEN.
7. Cobrir integração, acessibilidade, responsividade, build web/mobile e segurança diferencial.
8. Fazer backup, commit/push, deploy, smoke de produção e instalação APK.

## Comandos de verificação permitidos

- `npm test` e `npm run test:coverage` em `api/`.
- `npm test`, `npm run build`, `npm run build:mobile` e `npm run test:e2e` em `frontend/`.
- `npm audit --audit-level=high` nos dois pacotes.
- Playwright local/produção e `adb` para o APK conectado.

