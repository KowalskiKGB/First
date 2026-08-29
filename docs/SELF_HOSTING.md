# Autohospedagem do First

First usa três serviços no Docker Compose:

- `web`: nginx com o React estático e proxy de `/api`;
- `api`: Node com passkeys, sessões, estado dos perfis e domínio colaborativo;
- `media`: inicializador que valida ou popula o volume privado de mídia.

O código desta versão independente está em <https://github.com/KowalskiKGB/First>. O deploy padrão
compila `web` e `api` a partir deste checkout; não depende de uma imagem First pré-publicada.

## Produção

```bash
git clone https://github.com/KowalskiKGB/First
cd First
cp .env.example .env
docker compose -f docker-compose.yml up -d --build
```

O `docker-compose.yml` expõe `web:80` somente para redes Docker. Conecte o proxy HTTPS à mesma rede
e direcione `first.rocketxsistemas.com.br` para `web:80`.

As passkeys exigem hostname e origem exatos:

```dotenv
RP_ID=first.rocketxsistemas.com.br
ORIGIN=https://first.rocketxsistemas.com.br
RP_NAME=First
```

Trocar `RP_ID` invalida passkeys registradas no hostname anterior.

## Prévia local

Use no `.env`:

```dotenv
RP_ID=localhost
ORIGIN=http://localhost:8080
VAPID_SUBJECT=mailto:admin@localhost
WEB_PORT=8080
```

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.local.yml up -d --build
curl http://localhost:8080/api/health
```

Uma resposta saudável contém `"ok": true`. Para encerrar:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml down
```

## Persistência e escala

Os volumes são:

```yaml
volumes:
  first-data:
  first-media:
```

`first-data` guarda `db.json`, `state-<uid>.json`, `collaboration.json`, o segredo de sessão e as
chaves VAPID. `collaboration.json` usa escrita atômica e revisão otimista para papéis, conexões,
grants, notificações, alunos, programas, medidas, agenda e financeiro. `first-media` contém os
visuais e é montado como somente leitura no nginx.

Mantenha **uma única réplica de `api`** enquanto o armazenamento for JSON. Controle de revisão
evita sobrescritas silenciosas, mas não transforma o arquivo em armazenamento compartilhado entre
processos ou hosts.

## Backup e atualização

Antes de atualizar, faça snapshot do volume `first-data` no provedor ou no Coolify. Para uma cópia
local consistente, pause a API e exporte o conteúdo do volume:

```bash
docker compose stop api
docker compose run --rm --no-deps --entrypoint tar api -C /data -czf - . > first-data-backup.tgz
docker compose start api
```

Guarde o arquivo fora do servidor. Teste a restauração em uma instância separada antes de usá-la em
produção; ela deve repor o volume inteiro, não somente `db.json`, pois os vínculos do personal ficam
em `collaboration.json`.

Depois do backup:

```bash
git pull --ff-only
docker compose -f docker-compose.yml up -d --build
curl https://first.rocketxsistemas.com.br/api/health
```

Para rollback, volte o checkout para o commit aprovado anterior — ou fixe a imagem anterior, se o
deploy usar registry — e reconstrua o Compose. Se a entrega alterou dados persistidos, restaure
também o snapshot compatível de `first-data`, sempre com a API parada; não reverta somente o código
contra arquivos JSON de uma versão incompatível.

## Primeira conta

O bootstrap inicial usa:

```dotenv
INVITE_ONLY=0
ADMIN_UIDS=
FIRST_BASIC_AUTH_USERS=first-bootstrap:{SHA}<hash-gerado>
FIRST_BOOTSTRAP_MIDDLEWARE=,first-bootstrap-auth
```

Essas variáveis ativam a proteção Basic Auth de alta prioridade no Coolify. Depois de criar o
primeiro perfil, obtenha seu `id` no `db.json`, configure `ADMIN_UIDS`, habilite convites e remova
somente o middleware global:

```dotenv
INVITE_ONLY=1
ADMIN_UIDS=<id-do-proprietário>
FIRST_BASIC_AUTH_USERS=first-bootstrap:{SHA}<mantenha-o-hash>
FIRST_BOOTSTRAP_MIDDLEWARE=
```

`FIRST_BASIC_AUTH_USERS` continua obrigatório para proteger `/media/`; não o remova enquanto a mídia
do servidor estiver habilitada.

## Portal do personal

O portal colaborativo funciona para perfis web autenticados. O usuário ativa o papel de personal e
alterna o contexto no mesmo login. Aluno e personal podem iniciar uma solicitação por código; o
vínculo só fica ativo após aceite e os grants são validados pelo servidor.

Os dados compartilhados são separados do estado privado de treino. Nesta versão, publicar um
programa não o injeta automaticamente nas rotinas locais do aluno, e a evolução ainda não combina
todo o histórico local com medidas e peso.

## Mídia de exercícios

Metadados e textos do `hasaneyldrm/exercises-dataset` permanecem sob licença MIT. First inclui
nomes e instruções pt-BR para os 1.324 exercícios; as instruções vêm da
[`contribuição tutods`](https://github.com/tutods/exercises-dataset/commit/93475e2982117339d2cbf88eb900ad2ceb8d97d6).

O serviço `media` baixa exatamente 1.324 JPGs e 1.324 GIFs do commit upstream
[`7455efa`](https://github.com/hasaneyldrm/exercises-dataset/commit/7455efae41b330c265e7cd4b78dfa848e7ce5ebd),
valida contagem, caminhos e conteúdo e grava no volume privado. Reinicializações repetem a
verificação antes de reutilizar o volume.

Os binários não fazem parte do Git. Imagens e GIFs exigem direitos separados; operar ou redistribuir
os arquivos é responsabilidade do deployer. A interface exibe **© Gym visual**. Veja
[NOTICE.md](../NOTICE.md).

## Licença

First permanece sob GNU AGPL v3.0 e preserva a atribuição ao openGym. Quem operar uma versão
modificada em rede deve oferecer o código correspondente conforme a seção 13 da AGPL.
