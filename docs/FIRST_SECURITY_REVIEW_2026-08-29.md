# Revisão de segurança do primeiro deploy — First

Data: 2026-08-29

Escopo somente leitura: Dockerfile, `docker-compose*.yml`, `.env.example`, `nginx.conf`, `web/nginx.conf`, API de autenticação/health, frontend e toggles de mídia.

## Resultado

Nenhum achado crítico ou alto ficou aberto neste diff.

## Achados corrigidos antes do push

### Médio — `/api/health` expunha contagem de usuários

- Arquivo: `api/server.js`
- Problema: o endpoint público de health retornava `{ ok: true, users: db.users.length }`.
- Impacto: enumeração passiva de adoção/uso da instância.
- Correção mínima aplicada: o endpoint agora retorna apenas `{ ok: true }`.

### Médio — imagem API podia iniciar em produção com RP/Origin padrão de localhost

- Arquivo: `api/server.js`
- Problema: se a imagem fosse executada fora do Compose, `NODE_ENV=production` poderia cair nos defaults `localhost`.
- Impacto: WebAuthn incorreto e deploy silenciosamente mal configurado.
- Correção mínima aplicada: em produção, a API encerra se `RP_ID` ou `ORIGIN` não estiverem definidos. O Compose continua exigindo ambos via `${VAR:?}`.

### Médio — headers de segurança não eram herdados em algumas rotas estáticas do Nginx

- Arquivos: `nginx.conf`, `web/nginx.conf`
- Problema: `add_header Cache-Control` em `location` específico sobrescrevia a herança dos headers de segurança do `server`.
- Impacto: respostas de HTML/JS/CSS/JSON e assets poderiam sair sem CSP, `nosniff`, `DENY` e `Referrer-Policy`.
- Correção mínima aplicada: headers de segurança repetidos explicitamente nos blocos estáticos relevantes.

### Alto — limite de autenticação podia agrupar todos os clientes atrás do proxy

- Arquivos: `nginx.conf`, `web/nginx.conf`
- Problema: o limite usava o endereço imediato do proxy do Coolify como chave.
- Impacto: logins legítimos poderiam compartilhar um único balde e causar bloqueio global por `429`.
- Correção aplicada: o Nginx aceita `X-Real-IP` somente de redes privadas do proxy, restaura o cliente antes de calcular `$binary_remote_addr` e usa 60 requisições por minuto com burst de 20 nas rotas WebAuthn.

### Baixo — contexto Docker incluía arquivos não necessários

- Arquivos: `.dockerignore`, `api/.dockerignore`
- Problema: sem ignore dedicado, o build poderia empacotar diretórios grandes/gerados ou arquivos locais.
- Impacto: build instável, lento e com risco operacional de contexto excessivo.
- Correção mínima aplicada: contexto limitado a código-fonte necessário; `.env`, dados, mídia, builds, `node_modules` e `graphify-out` excluídos.

### Baixo — mídia/licenças de exercícios podiam ser puxadas automaticamente

- Arquivos: `docker-compose.yml`, `Dockerfile`, `frontend/src/lib/exercises.js`, `frontend/src/components/Media.jsx`
- Problema: o projeto original buscava mídia de terceiros no primeiro deploy.
- Impacto: dependência externa e risco de redistribuição sem decisão explícita.
- Correção mínima aplicada: mídia desativada por padrão (`VITE_EXERCISE_MEDIA=0`) e serviço/script de download removidos.

## Riscos operacionais aceitos para o primeiro acesso

- `INVITE_ONLY=0` em `.env.example` é intencional para permitir criar o primeiro perfil. O deploy inicial deve permanecer atrás de autenticação HTTP temporária do Coolify; depois do primeiro perfil, preencher `ADMIN_UIDS`, mudar para `INVITE_ONLY=1` e remover essa barreira temporária.
- O backend ainda usa armazenamento JSON em volume. Serve para este primeiro deploy, mas o plano de expansão move os dados relacionais/roles para um banco transacional.
- Não há CORS liberado; o app depende de mesma origem via proxy Nginx/Coolify. Esse é o comportamento esperado para passkeys.

## Verificações executadas

- `node --test scripts/deployment.test.mjs`
- `node scripts/check-locales.mjs` a partir de `frontend/`
- `npm test -- --run` a partir de `frontend/`: 208 testes
- `npm run build`
- `npm audit --omit=dev` no frontend e na API
- `docker compose --env-file .env.example -f docker-compose.yml -f docker-compose.local.yml up -d --build`
- `GET /api/health` e headers HTTP via `127.0.0.1:8080`
- Browser mobile/desktop com Playwright para login inicial em pt-BR e ausência de requests `/img/`/`/gif/`
- APK Android inspecionado como `com.kowalskikgb.first`, label `First`
