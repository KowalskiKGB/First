# Mídia completa e catálogo pt-BR — desenho

## Objetivo

Entregar no First os 1.324 exercícios com nomes, aparelhos e instruções em português do Brasil, além das 1.324 imagens JPG e 1.324 animações GIF autorizadas pelo proprietário para uso pessoal.

## Limites

- IDs dos exercícios continuam sendo a identidade persistida em planos, histórico e sincronização.
- Nomes originais em inglês continuam disponíveis internamente e na busca.
- Os 2.648 binários de mídia não entram no Git, em GitHub Releases nem em imagem Docker pública.
- A mídia continua em 180×180 e exibe a atribuição `© Gym visual — https://gymvisual.com/`.
- Exercícios personalizados mantêm o nome informado pelo usuário e não exigem mídia.
- O módulo personal continua fora desta entrega; ele permanece no roadmap principal.

## Fontes fixadas

- Catálogo e mídia: `hasaneyldrm/exercises-dataset`, commit `7455efae41b330c265e7cd4b78dfa848e7ce5ebd`.
- Instruções pt-BR: contribuição `tutods/exercises-dataset`, commit `93475e2982117339d2cbf88eb900ad2ceb8d97d6`, chave `ptBR`.
- Mídia local autorizada: `media/img` e `media/gif`, já ignoradas pelo Git.

## Tradução

Um pack `exercise-names/pt.js`, indexado por ID, contém exatamente 1.324 nomes. Um pack `instr/pt.js` contém exatamente 1.324 arrays e 7.710 etapas. `i18n.js` carrega locale, nomes e instruções em paralelo; `exerciseName(ex)` usa o nome traduzido e cai para `ex.n` quando não houver tradução.

A busca combina nome pt-BR, nome inglês, descrição personalizada e taxonomia nos dois idiomas. Equipamentos, regiões e músculos continuam usando as chaves estáveis em inglês com tradução por `t()`; isso evita alterar filtros, importações e históricos.

## Mídia web

O build web ativa `VITE_EXERCISE_MEDIA=1` e usa caminhos relativos `media/img/` e `media/gif/`. Um serviço de inicialização do Compose baixa uma cópia fixada do dataset para um volume nomeado privado, valida 1.324 JPGs e 1.324 GIFs e só então publica o volume no nginx em modo somente leitura. O cache e a CSP permanecem de mesma origem.

## Mídia Android

`npm run build:mobile` constrói o frontend, valida o catálogo local e copia `media/img` e `media/gif` para `dist/media` antes de `cap sync`. Assim o APK pessoal funciona offline e não depende do Basic Auth ou do servidor para exibir animações. Diretórios gerados continuam ignorados.

## Interface

O layout existente é preservado. A mídia volta aos cards, detalhes e treino. O painel grande recebe um link discreto de atribuição; a tela de configurações também registra a fonte. Imagens têm nome traduzido no texto alternativo e falha de carregamento retorna ao placeholder sem quebrar a tela.

## Verificação

- Testes unitários: cobertura integral dos IDs, nomes, instruções, busca bilíngue e fallback.
- Teste de integridade: correspondência exata catálogo ↔ 1.324 JPGs ↔ 1.324 GIFs.
- Teste de deploy: build args, volume privado, init fixado e montagem somente leitura.
- E2E: biblioteca e detalhe em pt-BR com thumbnail/GIF, desktop e viewport móvel, sem erros de console.
- Android: build Gradle, instalação via ADB, abertura no Galaxy conectado, screenshot e logcat sem crash.

