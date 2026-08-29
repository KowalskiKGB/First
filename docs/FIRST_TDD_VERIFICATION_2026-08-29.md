# Verificação TDD do primeiro deploy — First

Data: 2026-08-29

## Testes adicionados

- `scripts/deployment.test.mjs`
  - exige `.env.example`;
  - impede imagens GHCR do projeto original;
  - impede download automático do dataset de mídia no Compose;
  - valida `Dockerfile`/`api/Dockerfile` com `npm ci`;
  - valida API sem contagem de usuários no health;
  - valida falha segura da API em produção sem `RP_ID`/`ORIGIN`;
  - valida identidade Android, iOS e Web como First;
  - valida restauração de IP do proxy e limite de autenticação por cliente;
  - exige o router Traefik prioritário usado para proteger o cadastro inicial;
  - impede que nomes de arquivos exportados voltem à marca anterior;
  - valida `docker compose --env-file .env.example config`.
- `frontend/src/lib/api.test.js`
  - valida que o rótulo de biometria segue o idioma do app, não o idioma do navegador.
- `frontend/src/lib/i18n.test.js`
  - valida português do Brasil como idioma padrão.
- `frontend/src/lib/exercises.test.js`
  - valida mídia de exercícios desativada por padrão.
- `frontend/src/lib/project.test.js`
  - valida nome, slug, URL pública e repositório próprios do First.
- `frontend/src/lib/format.test.js`
  - amplia a cobertura dos formatadores de data, duração, volume e semana ISO em pt-BR.

## Evidência RED

Antes da implementação, os testes falhavam por ausência de `.env.example`, referências ao projeto original/GHCR/mídia, idioma padrão diferente, identidades móveis originais e Compose sem ambiente documentado. A rodada de revisão também capturou em RED a ausência de real-IP no Nginx, o rótulo de biometria dependente do navegador e nomes de artefato antigos.

## Evidência GREEN

Depois da implementação, a suíte relevante passou:

- `node --test scripts/deployment.test.mjs`
- `node scripts/check-locales.mjs` a partir de `frontend/`: 11 idiomas e 628 chaves sincronizadas;
- `npm test -- --run` a partir de `frontend/`: 12 arquivos, 208 testes aprovados;
- `npx vitest run --coverage`: 81,79% de linhas;
- `npm run build` e `npm run build:mobile`;
- `npm audit --omit=dev` em `frontend/` e `api/`: zero vulnerabilidades de produção;
- build Android debug via Gradle
- Docker Compose local com healthcheck saudável;
- Playwright em 1440×900 e 390×844, sem erro de página, overflow horizontal ou requests de mídia.

## Observação de cobertura

O projeto herdado já tinha cobertura parcial por testes unitários. A rodada atual mediu 78,11% de statements, 71,12% de branches, 71,66% de funções e 81,79% de linhas. Os testes novos cobrem os riscos alterados no primeiro deploy; a meta mínima de 80% em todas as métricas fica obrigatória para cada módulo novo do plano do personal, sem declarar retroativamente uma cobertura que a base herdada ainda não possui.
