# Exercise Media and pt-BR Catalogue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exibir todo o catálogo, instruções e mídia de exercícios em pt-BR no web e no APK Android pessoal.

**Architecture:** Nomes e instruções ficam em packs lazy-loaded por ID; mídia web vem de volume privado same-origin e mídia Android é copiada apenas para artefatos gerados. IDs e campos canônicos em inglês não mudam.

**Tech Stack:** React 19, Vite 8, Vitest, Capacitor 7, Node 22, Docker Compose, nginx, Playwright e Android Gradle.

**Spec:** `docs/superpowers/specs/2026-08-29-exercise-media-ptbr-design.md`

## Global Constraints

- Não versionar `media/`, JPGs, GIFs, `dist/`, assets Capacitor gerados nem APKs.
- Preservar IDs e busca em inglês ao adicionar pt-BR.
- Fixar as fontes de dados nos commits definidos na especificação.
- Manter mídia em 180×180 e atribuição à Gym visual.
- Não adicionar dependência de runtime para tradução ou mídia.
- Não usar gradientes.

---

### Task 1: Garantias RED do catálogo e da mídia

**Files:**
- Modify: `frontend/src/lib/i18n.test.js`
- Modify: `frontend/src/lib/exercises.test.js`
- Create: `scripts/media-integrity.test.mjs`
- Modify: `scripts/deployment.test.mjs`

**Interfaces:**
- Consumes: `EXDB`, `setLang`, `instrFor`, `media/img`, `media/gif`.
- Produces: garantias executáveis para `exerciseName(ex)`, `exerciseSearchText(ex)` e o Compose de mídia.

- [ ] Escrever testes que exigem 1.324 nomes pt-BR não vazios, 1.324 instruções/7.710 etapas, busca por português e inglês e fallback para exercício personalizado.
- [ ] Escrever teste Node que compara os nomes de arquivo de `EXDB` com os dois diretórios de mídia e rejeita faltas/extras.
- [ ] Atualizar o teste de deploy para exigir build args ativos, fonte fixada, volume nomeado e montagem read-only.
- [ ] Executar `npm test -- --run src/lib/i18n.test.js src/lib/exercises.test.js` e `node --test scripts/media-integrity.test.mjs scripts/deployment.test.mjs`; confirmar RED causado apenas pelas interfaces ausentes.
- [ ] Commitar com `test: add red checks for exercise media and pt-BR catalogue`.

### Task 2: Packs pt-BR e resolução de nomes

**Files:**
- Create: `frontend/src/exercise-names/pt.js`
- Create: `frontend/src/instr/pt.js`
- Modify: `frontend/src/lib/i18n.js`
- Modify: `frontend/src/lib/exercises.js`
- Modify: `scripts/build-instructions.mjs`

**Interfaces:**
- Produces: `exerciseName(ex): string`, `exerciseSearchText(ex): string`, `instrFor(ex): string[]` em pt-BR.

- [ ] Gerar `instr/pt.js` da chave `ptBR` do commit fixado e validar paridade de etapas.
- [ ] Gerar o mapa de nomes por ID, revisar vocabulário de musculação e garantir cobertura exata do catálogo.
- [ ] Carregar locale, nomes e instruções com `Promise.all`, mantendo fallback inglês em qualquer falha.
- [ ] Implementar `exerciseName` e busca bilíngue sem mutar `EXDB`.
- [ ] Executar os testes focados até GREEN.

### Task 3: Aplicar nomes e atribuição na interface

**Files:**
- Modify: `frontend/src/views/Library.jsx`
- Modify: `frontend/src/views/Workout.jsx`
- Modify: `frontend/src/views/RoutineEdit.jsx`
- Modify: `frontend/src/sheets.jsx`
- Modify: `frontend/src/components/Media.jsx`
- Modify: `frontend/src/views/Settings.jsx`
- Modify: `frontend/src/locales/pt.js`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: `exerciseName`, `exerciseSearchText`, `imgSrc`, `gifSrc`.
- Produces: todos os nomes do catálogo renderizados em pt-BR, busca bilíngue e atribuição visível.

- [ ] Substituir leituras visuais de `ex.n` por `exerciseName(ex)` sem alterar dados persistidos.
- [ ] Usar o helper bilíngue em biblioteca e pickers.
- [ ] Adicionar atribuição acessível e fallback de erro de mídia.
- [ ] Rodar testes focados e suíte frontend completa.

### Task 4: Entrega privada da mídia

**Files:**
- Create: `frontend/scripts/copy-exercise-media.mjs`
- Modify: `frontend/package.json`
- Modify: `frontend/.env.mobile`
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `.dockerignore`
- Modify: `README.md`
- Modify: `NOTICE.md`
- Modify: `docs/MOBILE.md`
- Modify: `docs/SELF_HOSTING.md`

**Interfaces:**
- Produces: `dist/media/img`, `dist/media/gif`, volume `first-media` e build web com mídia ativa.

- [ ] Copiar e validar mídia local após o build Vite e antes de `cap sync`.
- [ ] Adicionar init container pinado que povoa atomicamente o volume privado.
- [ ] Montar o volume no nginx em modo read-only e compilar bases same-origin.
- [ ] Documentar tamanho, origem, atribuição e exclusão dos binários do Git público.
- [ ] Executar testes de integridade/deploy, builds web/mobile e Gradle.

### Task 5: Produção e aparelho

**Files:**
- Modify: `docs/testing/exercise-media-ptbr.tdd.md`
- Modify: `docs/FIRST_DIFFERENTIAL_REVIEW_2026-08-29.md`

**Interfaces:**
- Consumes: imagem Docker, APK e aparelho ADB autorizado.
- Produces: produção atualizada e APK instalado/testado.

- [ ] Rodar a suíte completa, cobertura, audits, Compose local e Playwright desktop/mobile.
- [ ] Inspecionar o diff com foco em downloads, CSP, volumes e ausência de binários versionados.
- [ ] Commitar GREEN, enviar `main` e aguardar o deploy Coolify saudável.
- [ ] Instalar o APK com `adb install -r`, abrir `MainActivity`, verificar mídia/nome pt-BR, screenshot e logcat.
- [ ] Registrar comandos/resultados reais no relatório TDD e atualizar o Graphify.

