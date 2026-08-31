# First — diretório de academias e console Dev

## Decisão de produto

O catálogo de exercícios do First será a fonte única para qualquer seleção de aparelhos. A aba Exercícios, o inventário de uma academia, as preferências da IA e a revisão do Personal usarão a mesma busca, os mesmos filtros, as mesmas imagens e os mesmos IDs. Não haverá um segundo catálogo de máquinas criado à mão.

Academias cadastradas pela comunidade começam como `unverified`, com monograma, endereço e aviso de que não existe vínculo comercial. Uma sugestão nunca altera dados publicados diretamente: ela entra na fila privada do Dev e só passa a compor o diretório depois de aprovada. Perfis `verified` e `partner` ficam previstos no contrato, sem logos de terceiros nesta fase.

O visitante pode pesquisar, abrir e selecionar uma academia sem conta. A escolha fica apenas no aparelho até o login. Para enviar uma sugestão, o app pede login; isso mantém autoria, limite de abuso e moderação sem introduzir captcha ou um serviço externo.

## Experiência

### Início e academia

- Card compacto de academia logo após a semana.
- Estado vazio: `Selecione sua academia`, com ação visível.
- Estado selecionado: monograma, nome, município/UF, status e quantidade de exercícios disponíveis.
- Diretório em duas etapas: UF/município, depois busca por nome/endereço.
- Detalhe da unidade com dias/horários e inventário renderizado pelo navegador compartilhado de exercícios.
- `Não encontrou seu aparelho?` abre uma sugestão vinculada à unidade e selecionada pelo mesmo catálogo.

### Configuração de IA

- Objetivo principal vira escolha única por botões: ganhar massa, perder peso, recomposição, força, condicionamento e saúde geral.
- Academia selecionada pode preencher o wizard; o inventário continua editável antes de gerar.
- Equipamentos, favoritos, exercícios evitados e máquinas específicas usam o catálogo compartilhado.
- O snapshot enviado à IA contém somente IDs aprovados da unidade. A IA não ganha acesso a uma categoria inteira por causa de uma única máquina.

### Console `/devadmin`

- Navegação por `APIs`, `Solicitações` e `Usuários`.
- `APIs` mostra uma lista compacta dos três provedores e um único editor por vez.
- `Solicitações` mostra academia/aparelho, autor, data, estado e ações de aprovar/rejeitar.
- `Usuários` mostra presença e resumo; o detalhe é somente Dev e não depende da sessão Admin do app.
- Chaves continuam criptografadas e nunca retornam ao navegador.

## Direção visual

Paleta preservada: `Carvão #000000`, `Painel #1c1c1e`, `Controle #2c2c2e`, `Verde treino #30d158`, `Texto #ffffff` e `Texto auxiliar rgba(235,235,245,.60)`. Tipografia continua usando a pilha nativa do sistema, com pesos 400/600 e números tabulares.

O elemento de assinatura é a “estante de equipamentos”: linhas de exercício com miniatura, nome, grupo, equipamento e estado de seleção. Ela reaparece sem mudar de linguagem visual em Exercícios, academia e IA. O restante fica silencioso: superfícies sólidas, hairlines, sem gradientes e animações restritas a `opacity` e `transform`, com `prefers-reduced-motion` respeitado.

## Contrato de dados

```text
gymDirectory[]
  id, name, state, city, address
  status: unverified | verified | partner
  openingHours[{ day, open, close, closed }]
  exerciseIds[]
  createdAt, updatedAt

gymRequests[]
  id, kind: gym | equipment | correction
  status: pending | approved | rejected
  gymId?, submittedByUserId
  payload (validado por tipo)
  createdAt, reviewedAt?, reviewedBy?
```

Ao escolher uma unidade, o perfil do aluno recebe um snapshot com `directoryGymId`, dados de exibição e os IDs de exercício aprovados. A geração usa o snapshot, não uma leitura mutável do diretório.

## Segurança e limites

- Leitura pública retorna apenas dados aprovados e nenhum identificador de autor/moderador.
- Escrita de sugestão exige sessão, origem confiável, limites de tamanho e rate limit.
- Aprovação/rejeição exige sessão Dev; nenhuma rota reutiliza o cookie Admin do aluno.
- O Dev vê metadados de geração e códigos de falha sanitizados, nunca prompt, resposta ou segredo.
- Resultados públicos são paginados e limitados; no máximo 200 exercícios por unidade nesta primeira versão.

