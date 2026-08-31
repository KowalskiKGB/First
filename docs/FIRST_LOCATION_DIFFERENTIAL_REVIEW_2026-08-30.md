# First - Revisao diferencial de UF e municipio

## Escopo

Revisao do diff local que adiciona o fluxo publico de UF/municipio em "Encontre sua academia":

- `api/brazil-locations.js`
- `api/server.js`
- `frontend/src/lib/gym-directory.js`
- `frontend/src/views/GymDirectory.jsx`
- `frontend/src/index.css`
- testes unitarios, comportamento e E2E do diretorio de academias

Gemini e provedores de IA ficaram fora do escopo desta rodada.

## Achados

Nenhum achado critico ou alto aberto.

## Pontos verificados

- A chamada de municipios usa apenas o endpoint oficial fixo do IBGE por UF, sem base URL customizada.
- A UF e validada contra 27 codigos conhecidos antes de qualquer requisicao externa.
- A resposta publica de erro para falha/timeout do IBGE nao expoe corpo upstream.
- A lista de municipios e normalizada, limitada e copiada defensivamente antes de sair do backend.
- O app nao mostra academia antes da escolha de UF e municipio.
- A busca por academia fica desabilitada ate haver localidade completa.
- Se municipios falharem, o campo muda para entrada manual e nao exibe "nenhuma academia" antes do preenchimento.
- A solicitacao de academia herda UF/municipio ja escolhidos e continua exigindo login.
- A solicitacao de aparelho segue usando o catalogo real de exercicios.

## Testes executados

- `node --test api/test/brazil-locations.test.js api/test/gym-directory.test.js`
- `npm run test -- --run src/lib/gym-directory.test.js src/views/GymDirectory.test.jsx src/views/GymDirectory.behavior.test.jsx`
- `npx playwright test e2e/gym-directory.spec.js`
- `npm test` em `api`
- `npm run test -- --run` em `frontend`
- `npm run build` em `frontend`
- `npm audit --audit-level=high` em `api`
- `npm audit --audit-level=high` em `frontend`
- `npx playwright test` em `frontend`

## Risco residual

O endpoint depende da disponibilidade publica do IBGE para a primeira carga de cada UF. Quando o servico falha, o app preserva o fluxo com digitacao manual do municipio.
