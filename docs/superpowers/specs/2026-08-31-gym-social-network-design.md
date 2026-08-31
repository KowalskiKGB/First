# First — rede social de academias

## Objetivo

Transformar o diretório de academias existente em uma camada social do First. Visitantes encontram e selecionam academias; alunos autenticados favoritam, avaliam, comentam e contribuem com academias, correções, aparelhos e indicações de fechamento. O Dev valida alterações estruturais e modera conteúdo. A academia escolhida continua alimentando o inventário permitido para treinos e IA.

## Decisões de produto

- A experiência inicial é uma lista inteligente, rápida e responsiva, inspirada no fluxo de descoberta do Google Maps. Não haverá mapa incorporado nesta entrega; cada academia terá coordenadas e ação “Abrir rota”, permitindo um mapa futuro sem migração de dados.
- A localização é sempre iniciada pelo botão “Usar minha localização”. Não há solicitação ao abrir a tela, rastreamento em segundo plano ou persistência das coordenadas do aluno.
- Visitantes podem pesquisar, abrir detalhes e selecionar academia. Login é exigido para favoritar, avaliar, comentar ou contribuir.
- “Não encontrou a academia? Crie aqui” abre um cadastro completo. O autor vê a contribuição como “Em verificação”; o restante do público só vê a academia depois da aprovação Dev.
- Aparelhos são sempre selecionados pelo catálogo oficial de 1.324 exercícios do First. Não existe catálogo paralelo de máquinas.
- Exclusões Dev são arquivamentos auditáveis: o item some do público, mas pode ser restaurado e não perde o histórico de moderação.

## Jornadas

### Descoberta

1. O usuário abre Academias e pode permitir uma leitura única de localização.
2. O app preenche UF e município por geocodificação reversa e mantém fallback manual.
3. A lista ordena favoritas, distância e relevância; busca nome, rede, bairro e endereço.
4. O card mostra nome, rede, distância, aberto/fechado, média, votos e tags.
5. O detalhe mostra horários, endereço, rota, aparelhos, avaliações e contribuições.

### Comunidade

- Favorito é privado por aluno; o total público só é agregado.
- Cada aluno mantém no máximo uma avaliação ativa por academia, com nota de 1 a 5 e comentário opcional de até 600 caracteres.
- O autor pode atualizar a própria avaliação. O público recebe somente nome de exibição reduzido, nunca e-mail ou ID interno.
- Conteúdo com URL, telefone ou dado pessoal entra como `pending`; conteúdo comum pode ser publicado imediatamente e depois ocultado pelo Dev.
- Criação, correção, aparelho e fechamento sempre entram na fila Dev antes de alterar dados públicos.
- Uma indicação de fechamento nunca encerra a academia automaticamente.

### Moderação Dev

O `/devadmin` terá uma área `Academias` com três visões compactas:

- `Contribuições`: comparação antes/depois e aprovar/rejeitar academia, correção, aparelho ou fechamento.
- `Diretório`: pesquisar, arquivar, restaurar e inspecionar fonte/status.
- `Avaliações`: filtrar publicadas, pendentes e removidas; publicar, ocultar ou restaurar.

Toda ação registra `reviewedBy`, `reviewedAt`, decisão e motivo curto. Rotas Dev continuam isoladas das sessões Admin/Aluno.

## Contrato de dados

```text
gymDirectory[]
  id, name, networkName?, state, city, address, neighborhood?, postalCode?
  latitude, longitude
  status: unverified | verified | partner | closed | archived
  visibility: public | hidden
  openingHours[], openingHoursNote, exerciseIds[]
  source { label, url, confidence: high | medium, verifiedAt }
  approvedAt?, createdAt, updatedAt

gymRequests[]
  id, kind: gym | equipment | correction | closure
  status: pending | approved | rejected
  gymId?, submittedByUserId, payload
  createdAt, reviewedAt?, reviewedBy?, reviewReason?

gymReviews[]
  id, gymId, userId, rating, comment
  status: pending | published | removed
  demo, createdAt, updatedAt, moderatedAt?, moderatedBy?, moderationReason?

gymFavorites[]
  gymId, userId, createdAt

gymSeedVersion
```

As médias, votos, favoritos e tags são derivados na projeção pública, não persistidos como contadores mutáveis.

## Ranking e tags

- `Preferida`: academia favoritada pelo usuário atual.
- `Perto de você`: uma das três menores distâncias válidas do resultado, limitada à localidade filtrada.
- `Nova`: aprovada nos últimos 60 dias.
- `Em alta`: ao menos cinco avaliações reais recentes e desempenho recente acima da média histórica.
- `Em baixa`: ao menos dez avaliações reais divididas em duas janelas, com queda mínima de 0,6 ponto; a interface explica o critério.
- `Rede <nome>`: rede confirmada no cadastro ou pela moderação.

Comentários e votos `demo: true` nunca entram em média, votos, ranking ou tags.

## Localização e privacidade

- Web/Capacitor usa `navigator.geolocation.getCurrentPosition` por ação explícita.
- Android/iOS recebem apenas permissões de localização em uso.
- O frontend conserva latitude/longitude somente em memória para calcular Haversine e envia uma leitura ao endpoint de geocodificação reversa.
- O backend usa endpoint Nominatim fixo/configurável, `User-Agent` identificável, cache por coordenada reduzida, limite inferior a uma chamada por segundo e atribuição OpenStreetMap na interface.
- O endpoint retorna apenas `state`, `city` e atribuição. Coordenadas pessoais não entram no JSON colaborativo, nos logs, na IA ou em analytics.
- Negativa, timeout ou indisponibilidade mantêm UF/município manuais plenamente funcionais.

## Seed Macapá/AP

O seed é aplicado uma única vez por versão e respeita tombstones, para uma academia arquivada pelo Dev não reaparecer no reinício. Entradas iniciais:

1. Smart Fit Macapá — Rua Leopoldo Machado, 2334, Central.
2. Maioral Tucuju Academia — Rua Tancredo Neves, 224, São Lázaro.
3. Academia Energy Zona Norte — Rua Adílson José Pinto Pereira, 1919, Infraero.
4. Energy Sport — Avenida Almirante Barroso, 1756, Central.
5. Box Cross Macapá — Avenida Henrique Galucio, 2467, Santa Rita.
6. Box Tucuju — Avenida Anhanguera, 1246A, Buritizal.
7. T30 Intensity — Avenida Henrique Galucio, 769, Central.
8. Life Fit Academia — Rua Paraná, 602, Santa Rita.
9. Best Gym — Avenida Décima Quinta, 2087, Marabaixo.
10. Academia Iron Men — Avenida Tupiniquins, 84, Beirol.
11. Academia Shape Fitness — Rua São Paulo, 723, Pacoval.

Cada registro guarda URL da fonte, confiança e data. Dados de demonstração usam autores e textos explicitamente rotulados “Demonstração” e aparecem separados das avaliações reais.

## Direção visual

- Preto, grafite e verde existentes; campos sólidos, sem gradientes.
- Cabeçalho enxuto com busca e ação de localização.
- Chips roláveis para `Próximas`, `Favoritas`, `Em alta`, rede e modalidade.
- Cards com hierarquia clara, uma única borda, distância e avaliação na primeira leitura.
- Detalhe em tela própria/modal navegável, com foco restaurado ao voltar.
- Estrelas em `fieldset` com rádios, favoritos com `aria-pressed`, alvos de toque de 44 px e estados em `aria-live`.
- Animações apenas em `opacity` e `transform`, respeitando `prefers-reduced-motion`.

## Segurança e limites

- Todas as escritas exigem sessão, origem confiável, validação de esquema e rate limit por usuário mais endereço de origem confiável.
- Uma avaliação ativa por usuário/academia; no máximo 20 contribuições estruturais e 30 avaliações/edições por hora.
- Projeções públicas nunca retornam `userId`, `submittedByUserId`, e-mail, IP, histórico corporal, financeiro ou notas privadas.
- URLs de fontes são permitidas apenas no seed/Dev e validadas para `https`.
- Nenhuma contribuição pública pode definir `status`, `visibility`, contadores, tags ou coordenadas persistidas sem revisão.
- Strings são renderizadas como texto React; nenhuma rota aceita HTML.

## Critérios de aceite

- Seed de Macapá aparece em produção sem duplicar após reinícios.
- Localização permitida preenche AP/Macapá quando aplicável e ordena por distância; negada mantém o fluxo manual.
- Visitante seleciona academia; aluno autenticado favorita, avalia e contribui.
- Academia nova, correção, aparelho e fechamento só alteram o público após ação Dev.
- Dev arquiva/restaura academia e remove/restaura comentário.
- Avaliações demo são claramente identificadas e não afetam métricas.
- Testes unitários, integração e E2E cobrem autorização, moderação, ranking, privacidade e fluxos móveis.

