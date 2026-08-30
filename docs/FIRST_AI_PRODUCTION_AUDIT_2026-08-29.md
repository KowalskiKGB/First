# Auditoria de produção — First IA

Data: 2026-08-30

**Production audit: 84/100, launchable with caveats.** O checkout local está pronto para um deploy privado de instância única; a nota fica limitada até existirem evidências do backup, deploy e smoke na URL pública.

## Bloqueadores

Nenhum bloqueador de código foi encontrado. Antes de liberar o host, o operador ainda precisa cumprir as ações externas do runbook: backup do volume, segredos únicos no Coolify, uma única réplica, deploy e smoke público.

## Correções de maior valor

1. Exercitar backup e restauração do volume `first-data` antes da primeira atualização com dados reais.
2. Adicionar CI que execute API, frontend, cobertura focada, Playwright e builds Docker; nesta auditoria a evidência é local.
3. Testar `userVerification` da passkey como `preferred` ou `required` no conjunto real de aparelhos.
4. Acrescentar observabilidade persistente para falhas de job e saúde do volume, sem registrar prompts, respostas ou chaves.
5. Dividir o bundle principal Vite, hoje próximo de 1,5 MB minificado; é desempenho, não bloqueio funcional.

## Evidência verificada

- Autenticação, autorização, criptografia, adapters, validação semântica, jobs e migração: `api/dev-auth.js`, `api/ai-providers.js`, `api/ai.js`, `api/ai-jobs.js`, `api/domain/schema.js`, `api/personal.js` e `api/server.js`.
- Ambiente e operação: `.env.example`, `docker-compose.yml`, `api/Dockerfile`, `Dockerfile`, `SECURITY.md`, `docs/SELF_HOSTING.md`, `docs/MOBILE.md` e os scripts fail-fast de backup/restore/credenciais.
- API: 189/189; 89,11% linhas, 82,47% branches e 82,37% funções. O módulo `ai-usage.js` alcançou 89,66% de branches.
- Frontend: 481/481; o materializador de planos IA alcançou 100% de linhas e 89,44% de branches, incluindo agenda/rotina legadas.
- E2E Playwright: 21/21 em fluxos de aluno, Dev, Personal, retomada de jobs, acessibilidade de modais e coexistência de sessões.
- Dependências: quatro auditorias npm (completo e produção, API e frontend), todas com zero vulnerabilidades.
- Build web local e dentro do Docker: concluídos; aviso não bloqueante de chunk grande.
- `docker compose config --quiet`: concluído com fixtures não produtivas.
- Imagens `first-api` e `first-web`: construídas sem chave de IA.
- Smoke da imagem `first-api` em `NODE_ENV=production`: `/api/health` e `/api/ready` responderam `{"ok":true}` com credenciais de fixture válidas e sem provedor comercial.
- Operações de release: 39 testes passaram e um teste exclusivo de ownership root foi ignorado no Windows; deployment, sintaxe Bash e comportamento de backup/restore/credenciais foram validados. O restore usa `TMPDIR` canônico externo, diretório 0700 e inode privado 0600 sem pathname com descritor estável; falhas de `find` abortam explicitamente. O gerador mantém temporários em diretórios 0700 e, em falha, trunca e sincroniza somente os inodes próprios pelos FDs, deixando placeholder vazio sem apagar uma substituição externa; nenhum segredo real foi gerado neste ciclo de auditoria.
- Capacitor: build web móvel, cópia de 1.324 JPG/1.324 GIF e sync Android/iOS concluídos.
- Android: `assembleDebug` concluído; APK em `frontend/android/app/build/outputs/apk/debug/app-debug.apk`, 146.378.102 bytes, SHA-256 `CDACDC84E440F4976345FEF4AC3CC765709D4D4AA4F86B3D08DCE737CC6BF55E`.
- Scan local de arquivos rastreados: nenhuma private key, chave OpenAI/Anthropic/Google ou atribuição de segredo conhecida; nenhum artefato de build rastreado.
- Inventário de mídia: 1.324 imagens JPG e 1.324 GIFs.

## Lentes de risco

| Área | Situação | Observação |
| --- | --- | --- |
| Auth e segurança | Pronta com ressalva | Duas camadas no Dev, origem exata, rate limit e chaves cifradas; user verification da passkey ainda opcional |
| Integridade de dados | Pronta para uma réplica | JSON atômico, revisão otimista, fila idempotente, migração e rollback de plano; não suporta escala horizontal |
| IA externa | Pronta sem chamada comercial | Três adapters mockados, structured output, sem fallback e validação dupla; ativação real depende de chave cadastrada/testada |
| Operação | Pronta localmente | Health independente do provedor, Compose e Docker verdes, runbook de backup/restore/deploy; falta evidência do ambiente público |
| Mobile | Android construído | APK gerado; instalação/teste USB ficam para o controlador. iOS precisa de macOS/Xcode/CocoaPods |
| Pagamentos | Fora do escopo | Não há cobrança nesta fase; somente gate/estrutura futura documentada |
| UX e acessibilidade | Sem bloqueador novo | Fluxos novos usam labels, estados, `aria-live`, foco e reduced motion; há dívida de acessibilidade herdada em superfícies antigas |

## Evidência ausente

- Backup e restauração executados no volume real do Coolify.
- Smoke após deploy da URL pública, cache/service worker e console do navegador.
- Chamada estruturada real com um provedor comercial cadastrado pelo operador.
- Instalação e teste físico por ADB no aparelho do usuário.
- Build/assinatura iOS em macOS.
- Execução em CI hospedada para este commit.

## Próxima ação

O controlador deve seguir `docs/SELF_HOSTING.md`: fazer backup do volume, configurar somente os nomes `INVITE_ONLY`, `DEV_PANEL_USER`, `DEV_PANEL_PASSWORD_HASH`, `AI_CONFIG_MASTER_KEY` e `FIRST_BASIC_AUTH_USERS` com valores novos, manter uma réplica, publicar e executar o smoke público antes de instalar o APK.
