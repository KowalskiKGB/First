# Plano de implementação — rede social de academias

**Spec:** `docs/superpowers/specs/2026-08-31-gym-social-network-design.md`

**Objetivo:** entregar no First um diretório social de academias com seed real de Macapá/AP, localização opt-in, favoritos, estrelas, comentários, contribuições moderadas e ferramentas Dev.

## Restrições globais

- Preservar o JSON store de instância única e migrações idempotentes.
- Não persistir coordenadas do usuário nem enviar localização para IA.
- Dados demo devem ser rotulados e excluídos de média, votos, ranking e tags.
- Uma avaliação ativa por usuário/academia.
- Criação, correção, equipamento e fechamento só alteram o público após aprovação Dev.
- Exclusão Dev é arquivamento auditável e restaurável.
- O catálogo de exercícios existente é a única fonte de aparelhos.
- Sem gradientes; animações apenas `opacity`/`transform`; acessibilidade móvel obrigatória.
- TDD em cada tarefa e cobertura mínima de 80% nos módulos novos/alterados.
- Nenhum segredo, PII de autoria ou coordenada pessoal pode aparecer em resposta pública ou log.

## Task 1 — Domínio, migração, seed e ranking

**Arquivos:**

- Criar `api/gym-social.js` e `api/data/macapa-gyms.js`.
- Alterar `api/domain/schema.js` e `api/personal.js` somente onde necessário.
- Criar/alterar `api/test/gym-social.test.js` e testes de migração.

**RED:** cobrir normalização estrita, migração idempotente, seed único/tombstone, cálculo Haversine, favoritos, média/votos sem demo, tags determinísticas, uma avaliação por usuário e projeção sem PII.

**GREEN:** implementar funções puras de domínio, coleções `gymReviews`/`gymFavorites`, campos ampliados e seed versionado. Coordenadas do seed precisam ser números válidos e cada entrada precisa de fonte HTTPS/confiança/data.

**Verificação:** `npm test -- --test-name-pattern="gym social|gym migration|Macapá"` e cobertura focada >=80%.

## Task 2 — APIs sociais, contribuições e localização

**Arquivos:**

- Alterar `api/gym-directory.js`, `api/brazil-locations.js`, `api/server.js`.
- Alterar/criar `api/test/gym-directory.test.js`, `api/test/brazil-locations.test.js` e testes HTTP.

**RED:** cobrir leitura pública enriquecida, favorito, criar/editar avaliação, moderação suspeita, rate limit, correção realmente aplicada, fechamento aprovado, arquivar/restaurar, review ocultar/restaurar, autoria isolada e geocodificação reversa segura/cacheada.

**GREEN:** manter endpoints existentes e adicionar contratos mínimos:

- `PUT /api/gym/favorite`
- `PUT /api/gym/review`
- `GET /api/dev/gyms`
- `PUT /api/dev/gym`
- `GET /api/dev/gym-reviews`
- `PUT /api/dev/gym-review`
- `GET /api/location/reverse`

Ampliar `POST /api/gym-requests` e seu review para `closure` e correções estruturadas. Nominatim deve ter host fixo/configurável, timeout, cache, User-Agent próprio, no máximo uma chamada concorrente por chave e erro público fixo.

**Verificação:** testes API focados, suíte completa API e auditoria de respostas públicas.

## Task 3 — Diretório social e detalhe no app

**Arquivos:**

- Reformular `frontend/src/views/GymDirectory.jsx` e estilos relacionados.
- Criar componentes focados sob `frontend/src/components/gym/` se reduzirem duplicação real.
- Alterar `frontend/src/App.jsx`, `frontend/src/lib/mobile.js`, `frontend/src/store/useStore.js` e i18n quando necessário.
- Criar/alterar testes Vitest e `frontend/e2e/gym-directory.spec.js`.

**RED:** cobrir ordenação/filtros, localização permitida/negada, busca, favorito, estrelas acessíveis, comentário, detalhe, criação “Crie aqui”, contribuição de correção/aparelho/fechamento, login obrigatório e restauração de foco/voltar.

**GREEN:** entregar lista social clean, chips, cards compactos, detalhe, formulário de avaliação e wizard de contribuição. Usar catálogo visual existente para aparelhos. Distância é calculada no cliente com coordenadas em memória. Exibir atribuição OpenStreetMap quando a geocodificação for usada.

**Verificação:** unitários, E2E mobile/desktop, console sem erros e screenshots em 390×844 e 1440×900.

## Task 4 — Moderação Dev e permissões móveis

**Arquivos:**

- Alterar `frontend/src/views/DevPanel.jsx`, estilos e testes/E2E Dev.
- Alterar `frontend/android/app/src/main/AndroidManifest.xml` e `frontend/ios/App/App/Info.plist`.
- Não adicionar plugin de localização se a API web do Capacitor atender aos testes reais.

**RED:** cobrir tabs de contribuições/diretório/avaliações, comparação antes/depois, ações com motivo, arquivar/restaurar e moderar/restaurar comentário. Cobrir permissão negada e retorno Android.

**GREEN:** criar console compacto, estados claros e confirmações seguras. Adicionar apenas permissões de localização em uso e textos justificativos.

**Verificação:** Vitest, E2E `/devadmin`, build web e `build:mobile`.

## Task 5 — Integração, documentação e entrega

**Arquivos:**

- Atualizar `SECURITY.md`, `PLANEJAMENTO.md`, `docs/MOBILE.md` e changelog somente com fatos implementados.
- Atualizar `graphify-out` local sem commit, se o grafo já existir.

**Verificação obrigatória:**

1. `npm test` e cobertura em `api/`.
2. `npm test`, `npm run build`, `npm run build:mobile` e E2E focados em `frontend/`.
3. `npm audit --audit-level=high` nos dois pacotes.
4. Revisão diferencial de segurança e UI/acessibilidade.
5. Backup do volume antes de deploy.
6. Merge da branch validada em `main`, push e deploy Coolify.
7. Smoke de produção: seed, localização/fallback, favoritos, avaliação, criação/moderação e ausência de erros no console.
8. Instalar APK com `adb install -r` se o celular estiver conectado no momento da entrega.
