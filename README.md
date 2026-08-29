<div align="center">

<h1>First</h1>

**Portal de treinos e acompanhamento de alunos, autohospedado e com dados sob seu controle.**

[![Licença: AGPL v3](https://img.shields.io/badge/licenca-AGPL--3.0-a3e635?style=flat-square)](LICENSE)
![React](https://img.shields.io/badge/React-19-38bdf8?style=flat-square&logo=react&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)
[![GitHub issues](https://img.shields.io/github/issues/KowalskiKGB/First?style=flat-square)](https://github.com/KowalskiKGB/First/issues)

### [first.rocketxsistemas.com.br](https://first.rocketxsistemas.com.br) · [Código-fonte](https://github.com/KowalskiKGB/First)

</div>

## Sobre o First

First é uma versão modificada e independente derivada do openGym. O projeto vive no repositório
próprio `KowalskiKGB/First`: não é fork e não possui remote ligado ao projeto de origem. A
atribuição ao openGym, os avisos de terceiros e o histórico da cópia independente estão em
[NOTICE.md](NOTICE.md).

### Portal do aluno

- Rotinas semanais, treinos guiados, timers, superséries, cardio e exercícios personalizados.
- Histórico de peso e treinos, estatísticas, mapa muscular, atividade e 1RM estimado.
- Progressões linear, Greyskull, dupla, por tempo e por peso corporal.
- RIR/RPE opcional, compartilhamento de plano, backup JSON e importação de outros trackers.
- Uso como convidado ou por perfil com passkey e sincronização na API autohospedada.
- Catálogo de 1.324 exercícios com nomes e instruções pt-BR e busca bilíngue.
- Tela de conexões para solicitar, aceitar, recusar ou encerrar o vínculo com um personal.

### Painel do personal

- Contexto profissional no mesmo login, sem duplicar conta ou frontend.
- Carteira de alunos com busca, prioridades, indicadores e próxima atividade.
- Ficha individual com perfil, programa, evolução, medidas, agenda e financeiro.
- Agenda por disponibilidade, horários livres e detecção de conflito.
- Recebíveis por cliente, situação de pagamento, totais e gráficos operacionais.
- Vínculos por consentimento, permissões explícitas, notificações e trilha de auditoria.

O financeiro registra cobranças e recebimentos para organização; não processa pagamentos. O
programa publicado pelo personal ainda não é convertido automaticamente em treino no estado local
do aluno, e a evolução ainda não agrega todo o histórico local. Essas integrações, a programação
percentage/training-max 5/3/1-style, starters upper/lower, full-body e 5×5, notas por exercício e
calculadora de anilhas permanecem no [PLANEJAMENTO.md](PLANEJAMENTO.md).

## Subir em produção

Requer Docker com Compose e um proxy HTTPS para o domínio público:

```bash
git clone https://github.com/KowalskiKGB/First
cd First
cp .env.example .env
docker compose -f docker-compose.yml up -d --build
```

O Compose cria `web`, `api` e o inicializador `media`. Os dados ficam no volume `first-data`, as
demonstrações no volume privado `first-media`, e o serviço web expõe apenas a porta interna 80.
Conecte o proxy TLS à mesma rede Docker. Instruções completas:
[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

## Prévia local

Defina no `.env`:

```dotenv
RP_ID=localhost
ORIGIN=http://localhost:8080
VAPID_SUBJECT=mailto:admin@localhost
WEB_PORT=8080
```

Depois execute:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

Abra <http://localhost:8080>. Para testar passkeys em outro aparelho, use o domínio HTTPS; uma
origem HTTP por IP local não é válida para WebAuthn.

## Arquitetura

```text
navegador / PWA
       │ HTTPS
       ▼
proxy TLS externo
       │
       ▼
web (nginx + React + proxy /api) ── first-media (somente leitura)
       │                                      ▲
       ▼                                      │
api (Node + WebAuthn) ── first-data     inicializador de mídia
```

- `frontend/`: React 19, Vite, React Router e Zustand.
- `api/`: API Node, passkeys, sessões, estado privado e domínio colaborativo.
- `collaboration.json`: papéis, conexões, alunos, programas, medidas, agenda e financeiro, com revisão.
- `state-<uid>.json`: treinos e preferências privadas de cada perfil.
- `docker-compose.yml`: serviços de produção e volumes persistentes.

O armazenamento colaborativo é um documento JSON versionado. Execute apenas **uma réplica da API**;
migre para um banco transacional antes de habilitar múltiplas réplicas.

## Configuração principal

Use [.env.example](.env.example) como base.

| Variável | Finalidade | Exemplo |
|---|---|---|
| `RP_ID` | Host exato associado às passkeys | `first.rocketxsistemas.com.br` |
| `ORIGIN` | Origem pública autorizada | `https://first.rocketxsistemas.com.br` |
| `RP_NAME` | Nome exibido pelo autenticador | `First` |
| `ADMIN_UIDS` | IDs administrativos separados por vírgula | vazio |
| `INVITE_ONLY` | `1` exige convite para novos perfis | `0` |
| `SESSION_DAYS` | Duração de novas sessões | `30` |
| `VAPID_SUBJECT` | Contato usado pelo Web Push | URL pública |
| `WEB_PORT` | Porta do override local | `8080` |

Trocar `RP_ID` invalida as passkeys registradas para o hostname anterior.

## Exercícios e mídia

Metadados e textos vêm do
[`hasaneyldrm/exercises-dataset`](https://github.com/hasaneyldrm/exercises-dataset), sob licença MIT.
As instruções pt-BR usam a
[`contribuição tutods`](https://github.com/tutods/exercises-dataset/commit/93475e2982117339d2cbf88eb900ad2ceb8d97d6).

Imagens e GIFs exigem direitos separados e não são commitados neste repositório. O deploy privado
baixa 1.324 JPGs e 1.324 GIFs do commit upstream fixado e os serve com autenticação. A interface
exibe **© Gym visual**. Operar ou distribuir esses arquivos continua sendo responsabilidade de quem
faz o deploy; veja [NOTICE.md](NOTICE.md).

## App móvel

Os projetos Capacitor Android/iOS são mantidos para builds locais. O APK standalone guarda os
dados no aparelho e não habilita o portal colaborativo do personal. Use a PWA autenticada para o
painel profissional. Build, mídia offline e instalação USB: [docs/MOBILE.md](docs/MOBILE.md).

## Qualidade e documentação

- Evidências desta entrega: [docs/testing/personal-workspace.tdd.md](docs/testing/personal-workspace.tdd.md)
- Autohospedagem: [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)
- App móvel: [docs/MOBILE.md](docs/MOBILE.md)
- Segurança: [SECURITY.md](SECURITY.md)
- Histórico: [CHANGELOG.md](CHANGELOG.md)
- Roadmap: [PLANEJAMENTO.md](PLANEJAMENTO.md)

## Licença

O código permanece sob a [GNU AGPL v3.0](LICENSE). Quem operar uma versão modificada em rede deve
oferecer aos usuários o código correspondente, conforme a seção 13. O código desta versão
independente está em <https://github.com/KowalskiKGB/First>. A AGPL não licencia as imagens e GIFs
de exercícios protegidos separadamente.
