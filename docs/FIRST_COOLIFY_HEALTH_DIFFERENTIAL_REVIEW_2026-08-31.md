# First — revisão diferencial do healthcheck no Coolify

## Resumo executivo

| Severidade | Quantidade |
|---|---:|
| Crítica | 0 |
| Alta | 0 |
| Média | 0 |
| Baixa | 0 |

**Risco geral:** baixo

**Recomendação:** aprovar

- Arquivos analisados: 2/2.
- Alteração: 41 adições e 3 remoções.
- Regressões de segurança encontradas: 0.
- Lacunas bloqueadoras de teste: 0.

## O que mudou

**Base:** `44624bb`

**Escopo:** árvore de trabalho que corrige o estado agregado `exited:unhealthy` no Coolify.

| Arquivo | Alteração | Risco | Alcance |
|---|---|---|---|
| `docker-compose.yml` | Mantém o inicializador de mídia ativo, adiciona healthchecks e espera por `service_healthy` | Médio, operacional | `media` e `web`; API não alterada |
| `scripts/deployment.test.mjs` | Valida o Compose renderizado, não apenas texto-fonte | Baixo | Pipeline de implantação |

O serviço `media` já validava commit, quantidade, nomes e conteúdo dos 2.648 arquivos antes de liberar o `web`. A mudança preserva essas verificações e substitui apenas a saída bem-sucedida pelo processo ocioso `tail -f /dev/null`, com reinício controlado e healthcheck. O `web` também passa a declarar sua saúde ao orquestrador.

## Achados críticos

Nenhum. Não houve alteração de autenticação, autorização, cookies, criptografia, variáveis secretas, rotas públicas ou montagem do volume de dados. A mídia continua em volume separado, montado como somente leitura no Nginx e protegida pela sessão do aplicativo.

## Cobertura de testes

O teste de regressão em `scripts/deployment.test.mjs` executa `docker compose config --format json` e falha se:

- `media` voltar a ser um job one-shot;
- qualquer healthcheck novo for removido;
- `web` deixar de aguardar a saúde de `media`.

Evidência local: `node --test scripts/deployment.test.mjs` passou com 6/6 testes. No host de produção, as imagens efetivamente usadas confirmaram `/usr/bin/tail` em `alpine:3.22` e `/usr/bin/wget` em `nginx:alpine`.

## Alcance e análise adversarial

- Containers afetados: 2 de 3 (`media` e `web`).
- Endpoints afetados: 0.
- Bancos, volumes de usuário e credenciais afetados: 0.
- Novo acesso de rede de entrada: nenhum; `media` não publica porta.

Um usuário externo não possui caminho HTTP até o sidecar. Um administrador já capaz de executar processos dentro do host também já controla o volume e os demais containers; a permanência do processo não cria uma nova elevação de privilégio. O risco residual é limitado à existência contínua de um container Alpine mínimo com escrita somente no volume `first-media`, necessária para reconstrução automática da mídia.

## Contexto histórico

O desenho one-shot foi introduzido em `2d1d4d7` para popular e verificar o volume antes de iniciar o Nginx. Esse contrato continua intacto. A correção apenas adapta o ciclo de vida ao modo como o Coolify agrega estados de aplicações Compose: uma saída esperada com código zero ainda fazia o recurso aparecer como encerrado.

Nenhum código adicionado anteriormente por correção de segurança foi removido. As variáveis sensíveis continuam obrigatórias/fail-secure, e os hashes do pacote de mídia permanecem fixos.

## Recomendações

Não há ação bloqueadora. Manter o teste de implantação no gate de release e confirmar, após o deploy, os três containers em execução, os healthchecks e os endpoints `/api/health` e `/api/ready`.

## Metodologia

**Estratégia:** revisão focada de mudança operacional pequena em repositório médio.

- leitura das versões base e alterada;
- histórico e `git blame` das linhas removidas;
- análise do raio de impacto e das fronteiras de confiança;
- busca por defaults inseguros e exposição de segredos;
- teste de regressão RED/GREEN;
- validação do Compose renderizado e dos binários nas imagens do host;
- revisão independente sem achados.

**Limitação:** a validação completa do estado agregado depende do novo deploy no Coolify.

**Confiança:** alta para o diff analisado.
