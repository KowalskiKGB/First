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
# Preencha as variáveis obrigatórias antes de continuar.
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

Toda atualização começa com snapshot consistente do volume inteiro `first-data`, nunca somente
`db.json`. O procedimento verificável de backup, restore, deploy e rollback está em
[Backup, restore e deploy](#backup-restore-e-deploy).

## Primeira conta e acesso nativo

O bootstrap inicial usa:

```dotenv
INVITE_ONLY=0
ADMIN_UIDS=
FIRST_BASIC_AUTH_USERS=first-bootstrap:{SHA}<hash-gerado>
FIRST_BOOTSTRAP_MIDDLEWARE=
DEV_PANEL_USER=<first_dev_mais_sufixo_aleatorio>
DEV_PANEL_PASSWORD_HASH=<hash-scrypt>
```

`FIRST_BASIC_AUTH_USERS` protege exclusivamente `/media/`. Mantenha
`FIRST_BOOTSTRAP_MIDDLEWARE=` vazio: o app Capacitor precisa alcançar o shell, o Digital Asset
Links e a API antes de possuir uma sessão e não envia credenciais Basic Auth. Para controlar novos
cadastros, use `INVITE_ONLY` e convites da aplicação, não Basic Auth no host inteiro.

Depois de criar o primeiro perfil, obtenha seu `id` no `db.json`, configure `ADMIN_UIDS` e habilite
convites:

```dotenv
INVITE_ONLY=1
ADMIN_UIDS=<id-do-proprietário>
FIRST_BASIC_AUTH_USERS=first-bootstrap:{SHA}<mantenha-o-hash>
FIRST_BOOTSTRAP_MIDDLEWARE=
```

`FIRST_BASIC_AUTH_USERS` continua obrigatório para proteger `/media/`; não o remova enquanto a mídia
do servidor estiver habilitada. A rota `/.well-known/assetlinks.json` também deve permanecer pública
para a verificação do app Android.

## Portal do personal

O portal colaborativo funciona para perfis autenticados na web/PWA e no Capacitor. O usuário ativa
o papel de personal e alterna o contexto no mesmo login. Aluno e personal podem iniciar uma
solicitação por código; o vínculo só fica ativo após aceite e os grants são validados pelo servidor.

Os dados compartilhados são separados do estado privado de treino. Um programa publicado é
projetado para o aluno vinculado e sincronizado como rotina semanal executável. Atualizações
substituem somente rotinas marcadas como gerenciadas pelo personal; rotinas manuais, treino em
andamento e histórico local são preservados. A evolução ampliada que combina todo o histórico de
treinos, medidas e peso continua no roadmap.

Solicitação, resposta e encerramento de vínculo, além de publicação ou atualização de programa,
geram uma entrada persistida na inbox. Quando o usuário possui inscrição Web Push, o mesmo evento é
enviado ao navegador/PWA; falha no transporte não desfaz a alteração persistida.

## Mídia de exercícios

Metadados e textos do `hasaneyldrm/exercises-dataset` permanecem sob licença MIT. First inclui
nomes e instruções pt-BR para os 1.324 exercícios; as instruções vêm da
[`contribuição tutods`](https://github.com/tutods/exercises-dataset/commit/93475e2982117339d2cbf88eb900ad2ceb8d97d6).

O serviço `media` baixa exatamente 2.648 mídias — 1.324 JPGs e 1.324 GIFs — do commit upstream
[`7455efa`](https://github.com/hasaneyldrm/exercises-dataset/commit/7455efae41b330c265e7cd4b78dfa848e7ce5ebd),
valida contagem, caminhos e conteúdo e grava no volume privado. Reinicializações repetem a
verificação antes de reutilizar o volume.

Os binários não fazem parte do Git. Imagens e GIFs exigem direitos separados; operar ou redistribuir
os arquivos é responsabilidade do deployer. A interface exibe **© Gym visual**. Veja
[NOTICE.md](../NOTICE.md).

## Licença

First permanece sob GNU AGPL v3.0 e preserva a atribuição ao openGym. Quem operar uma versão
modificada em rede deve oferecer o código correspondente conforme a seção 13 da AGPL.

## Painel Dev e arquitetura de IA

O Painel Dev usa duas camadas: sessão normal de uma conta administradora por passkey e uma segunda
credencial exclusiva. Em produção, o processo exige `DEV_PANEL_USER` iniciado por `first_dev_` e
`DEV_PANEL_PASSWORD_HASH` no formato aceito por `api/dev-auth.js`:

```text
scrypt:<salt-base64url>:<hash-base64url-de-32-bytes>
```

A senha em texto puro nunca entra no ambiente. `AI_CONFIG_MASTER_KEY` é opcional para o núcleo do
First e deve conter exatamente 32 bytes aleatórios codificados em 64 caracteres hexadecimais. Sem
ela, `/api/health`, planos manuais e planos do Personal continuam funcionando; cadastro, teste,
listagem de modelos e ativação de provedor falham fechados.

As chaves BYOK ficam em três slots fixos (`openai`, `gemini` e `anthropic`) e são cifradas em
AES-256-GCM antes de entrar em `db.json`. O navegador recebe somente modelo selecionado,
fingerprint parcial, estado/data do teste, ativação e métricas. Base URL customizada não é aceita.
Somente um slot testado pode ficar ativo e não existe fallback automático.

O documento `collaboration.json` usa schema v2 e guarda `trainingProfiles`, `gymProfiles`,
`aiPlans`, `aiJobs` e `aiUsage` junto do domínio colaborativo. Os grants
`trainingProfileWrite` e `aiPlanRead` são verificados no servidor para cada vínculo ativo. Jobs são
idempotentes, persistem `queued|running|applied|failed` e as etapas públicas fechadas
`organizing|generating|validating|applying`; um job encontrado em `running` após reinício passa
para falha, sem retry nem troca de provedor.

Antes da chamada, o servidor forma uma shortlist determinística de até 120 exercícios do catálogo
pt-BR de 1.324 itens. O prompt contém perfil anonimizado, medidas atuais, objetivo,
disponibilidade, limitações como texto não confiável, resumo agregado de 28 dias e os IDs
permitidos. Nome, telefone, e-mail, financeiro, notas privadas e histórico bruto não são enviados.
A resposta fechada `AIWorkoutPlanV1` é filtrada novamente antes de receber IDs do servidor e ser
aplicada.

Planos manuais, do Personal e de IA mantêm agendas independentes. `S.week` é somente manual;
`dayPlan` registra preferência, não apaga opções. O armazenamento conserva no máximo dez versões
de plano IA por aluno e dois mil registros de uso sem prompt ou resposta completos.

Limites desta fase: uma única réplica da API e armazenamento JSON; sem cobrança, checkout,
fallback de provedor ou chave comercial embutida. Não aumente réplicas da API até migrar o store
para um banco com coordenação entre processos.

## Variáveis de release no Coolify

Revise no recurso Compose, sem registrar valores em logs:

- `RP_ID`, `ORIGIN` e `RP_NAME`;
- `ADMIN_UIDS`, `INVITE_ONLY`, `SESSION_DAYS` e `VAPID_SUBJECT`;
- `DEV_PANEL_USER` e `DEV_PANEL_PASSWORD_HASH`;
- `AI_CONFIG_MASTER_KEY` (pode ficar vazio enquanto nenhum provedor for configurado);
- `FIRST_BASIC_AUTH_USERS` e `FIRST_BOOTSTRAP_MIDDLEWARE`.

`INVITE_ONLY` deve ser informado explicitamente. Use `0` apenas durante um bootstrap controlado e
volte para `1` antes de expor o host. `FIRST_BASIC_AUTH_USERS` protege `/media/`; mantenha
`FIRST_BOOTSTRAP_MIDDLEWARE` vazio para o app Capacitor alcançar shell, API e Digital Asset Links.

Use o gerador versionado, que reutiliza `hashDevPassword()` de `api/dev-auth.js`. Ele cria um
usuário `first_dev_<24 hex>`, uma senha de 32 bytes em base64url, um hash scrypt compatível e uma
master key independente de 32 bytes. Os dois caminhos de saída são obrigatórios e absolutos; o
handoff é recusado se apontar para dentro do repositório. Arquivos existentes nunca são
sobrescritos e o stdout contém somente um status genérico, sem valores ou caminhos dos artefatos.

Linux/macOS:

```bash
first_repo_dir=$(pwd -P)
first_handoff_dir=$(mktemp -d "${TMPDIR:-/tmp}/first-release-handoff.XXXXXX")
node scripts/generate-release-credentials.mjs \
  --url https://first.rocketxsistemas.com.br \
  --credentials-out "$first_repo_dir/CREDENCIAIS_TESTE.md" \
  --handoff-out "$first_handoff_dir/coolify.json"
```

PowerShell:

```powershell
$firstRepoDir = (Resolve-Path '.').Path
$firstHandoffDir = Join-Path ([IO.Path]::GetTempPath()) ('first-release-handoff-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $firstHandoffDir | Out-Null
$firstCredentials = Join-Path $firstRepoDir 'CREDENCIAIS_TESTE.md'
$firstHandoff = Join-Path $firstHandoffDir 'coolify.json'
node scripts/generate-release-credentials.mjs `
  --url https://first.rocketxsistemas.com.br `
  --credentials-out $firstCredentials `
  --handoff-out $firstHandoff
```

`CREDENCIAIS_TESTE.md` contém somente URL, usuário, senha, data e instruções de troca. Nunca contém
hash, master key, chave de provedor, Coolify ou Cloudflare. O JSON separado contém somente
`DEV_PANEL_USER`, `DEV_PANEL_PASSWORD_HASH` e `AI_CONFIG_MASTER_KEY` e é um handoff efêmero.

Passe **o caminho** desse JSON ao cliente programático/API autorizada do Coolify, carregue-o em
memória sem imprimir o conteúdo, instale exatamente as três variáveis e confirme os nomes na
resposta. Não copie valores pelo terminal. Imediatamente após a confirmação, apague o handoff:

```bash
rm -- "$first_handoff_dir/coolify.json"
rmdir -- "$first_handoff_dir"
unset first_handoff_dir
```

```powershell
Remove-Item -LiteralPath $firstHandoff
Remove-Item -LiteralPath $firstHandoffDir
$firstHandoff = $null
$firstHandoffDir = $null
```

Mantenha `CREDENCIAIS_TESTE.md` somente na máquina do operador e em um gerenciador de senhas. Para
rotacionar, preserve a credencial necessária no gerenciador, remova conscientemente o arquivo local
e execute o gerador novamente. Ele nunca cria ou recebe chave comercial de IA.

## Backup, restore e deploy

Os scripts abaixo exigem Bash, `realpath`, `awk`, `curl` e um `tar` cuja listagem detalhada identifica
o tipo do item no primeiro caractere (GNU tar e BusyBox tar atendem) e devem ser executados na raiz
do checkout que contém o Compose.
Escolha um diretório absoluto em disco/volume de backup, fora do repositório. O script recusa
caminhos relativos ou internos ao checkout, detecta se a API estava ativa, para o único writer JSON
e usa uma trap para reiniciá-lo em sucesso, erro ou interrupção. O arquivo só aparece com o nome
final depois de ser gravado como `.partial` e validado por `tar -tzf`:

```bash
export FIRST_BACKUP_DIR=/srv/first-backups
bash scripts/backup-first-data.sh
```

Copie o `.tgz` validado para outro host/objeto protegido e teste o restore em uma instância
separada. Não use `./backups`: além de misturar dados com código, uma limpeza do checkout pode
eliminar a única cópia.

O restore resolve o próprio arquivo com `realpath`, exige que o destino canônico fique fora do
checkout e exige a URL HTTPS de health. O diretório externo do backup precisa permitir a criação de
um snapshot temporário: o script copia a origem uma única vez para um nome aleatório 0600 ao lado
do backup e usa somente essa cópia para listar, validar e extrair. A trap remove o snapshot em
sucesso, erro ou interrupção; trocar o caminho original durante a operação não muda os bytes usados.
Antes de parar a API, ele valida as duas listagens do snapshot, rejeita caminhos
absolutos/traversal, symlinks e hardlinks, tipos especiais e exige `db.json` e `secret`. A parada do
writer só é considerada confirmada quando `docker compose stop api` termina
com sucesso e `api` deixa de aparecer entre os serviços ativos. Com a API parada, o script extrai
tudo em staging e aceita somente diretórios ou arquivos regulares com link count igual a um; FIFO,
device, socket, symlink ou hardlink abortam antes da troca. Depois cria uma cópia completa de
recovery do `/data` atual. Só então move os dados atuais e instala o staging.

Cada tentativa de health usa `curl --connect-timeout 5 --max-time 10`. Erro de troca, startup ou
health aciona rollback para a cópia retida, mas o rollback só toca `/data` depois de confirmar
novamente a parada do writer. Se essa confirmação falhar, o script não altera mais os dados, não
declara rollback bem-sucedido, preserva a recovery e termina diferente de zero com instrução de
recuperação manual. Falha na mutação do próprio rollback mantém a API parada para intervenção.

```bash
export FIRST_RESTORE_ARCHIVE=/srv/first-backups/first-data-AAAAmmddTHHMMSSZ.tgz
export FIRST_HEALTH_URL=https://first.rocketxsistemas.com.br/api/health
bash scripts/restore-first-data.sh
```

Restore só é aceito quando o script termina com código zero depois de `/api/health` responder 2xx.
Ainda preserve o diretório `.first-recovery-*` informado pelo script até confirmar login, `/dev`,
Plano, Personal, job/rollback e dados anteriores. Qualquer divergência nesse smoke reprova o restore:
reexecute o script com o backup anterior validado. Remova a recovery somente depois da aceitação e
de um novo backup; nunca durante a janela de rollback.

Checklist de deploy:

1. Confirme o backup íntegro e registre o commit anterior e o novo.
2. Instale/rotacione as variáveis necessárias e faça deploy do SHA aprovado.
3. Verifique `/api/health`, carregamento do shell, hash dos bundles, `sw.js` com revalidação e
   ausência de assets antigos no cache; se necessário, remova o service worker antigo e recarregue.
4. Entre como admin, destrave `/dev`, confirme três slots sem chave exposta e mantenha geração
   indisponível enquanto não houver chave comercial cadastrada e testada.
5. Verifique console/rede no navegador e os fluxos de Plano, Personal, rollback e seletor de
   sessões em celular, tablet e desktop.
6. Gere o APK conforme [MOBILE.md](MOBILE.md), instale com `adb install -r` e faça o smoke móvel.

Rollback de código não reverte dados. Se o schema persistido não for compatível com o commit
anterior, restaure também o backup completo com a API parada. Para revogar imediatamente uma
sessão Dev sem derrubar todas as sessões do app, troque **usuário e hash** (novo sufixo), faça
redeploy e encerre a sessão normal do admin; trocar somente a senha não invalida um cookie Dev já
emitido até o limite de quatro horas.
