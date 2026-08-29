# App móvel do First

First mantém projetos Capacitor para Android e iOS. Este guia cobre o APK Android de depuração;
após `npm run build:mobile`, use Xcode no macOS para um build iOS de desenvolvimento.

A versão 1.3.0 usa `versionCode 7` no Android. Quando há rede, o app permite login por passkey,
sincroniza o estado da conta, carrega vínculos e programas publicados e habilita o portal do
personal para perfis autorizados. Sem sessão ou sem servidor, o treino local continua disponível
como guest; recursos colaborativos aguardam a próxima conexão. Não há telemetria.

## Build Android

Forneça a mídia de licença separada nestes diretórios locais ignorados pelo Git:

```text
media/img/   # 1.324 arquivos .jpg
media/gif/   # 1.324 arquivos .gif
```

O bundle contém 2.648 mídias offline. Os nomes devem corresponder exatamente ao catálogo.
`npm run build:mobile` valida os arquivos, copia-os para `frontend/dist/media/` e sincroniza o
bundle com o Capacitor.

```bash
cd frontend
npm ci
npm run build:mobile
cd android
./gradlew assembleDebug
```

APK gerado:

```text
frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

O build de release foi validado com `build:mobile` e `assembleDebug`. O Android usa
`android:allowBackup="false"`: dados locais de treino não são enviados ao backup automático do
sistema. Antes de desinstalar ou limpar os dados do app, sincronize uma conta online ou exporte um
backup manual.

## Passkey e associação ao domínio

O WebView Android usa a origem virtual `https://first.rocketxsistemas.com.br` e habilita WebAuthn
for Apps. O servidor publica `/.well-known/assetlinks.json` sem Basic Auth para associar essa origem
ao pacote `com.kowalskikgb.first`; o arquivo atual contém a impressão digital do certificado de
depuração usado neste APK.

Antes de assinar um APK/AAB de produção, adicione ao Digital Asset Links a impressão SHA-256 do
certificado de release. No servidor, mantenha `FIRST_BOOTSTRAP_MIDDLEWARE=` vazio para que o app
nativo alcance o shell e a API; `FIRST_BASIC_AUTH_USERS` continua protegendo somente `/media/`.
As mídias do APK já são locais e não dependem dessa rota protegida.

## Instalação USB

Com a depuração USB habilitada:

```bash
adb devices
adb install -r frontend/android/app/build/outputs/apk/debug/app-debug.apk
adb shell monkey -p com.kowalskikgb.first 1
```

`adb devices` deve listar um aparelho como `device`. Se aparecer `unauthorized`, desbloqueie o
telefone e aceite a chave RSA antes de repetir a instalação.

## Mídia e licença

Metadados e textos do `hasaneyldrm/exercises-dataset` permanecem sob licença MIT. As instruções
pt-BR vêm da
[`contribuição tutods`](https://github.com/tutods/exercises-dataset/commit/93475e2982117339d2cbf88eb900ad2ceb8d97d6).

Imagens e GIFs exigem direitos separados, permanecem em `media/` e nunca são adicionados ao Git. O
APK local inclui 2.648 mídias — 1.324 JPGs e 1.324 GIFs — para uso offline e exibe **© Gym visual**. Fornecer,
compilar ou distribuir esses arquivos é responsabilidade de quem realiza o build; nem a licença
MIT do dataset nem a AGPL do First concede direitos sobre a mídia.

O código continua sob GNU AGPL v3.0. Preserve a atribuição ao openGym e disponibilize o código
correspondente ao distribuir o app. Veja [NOTICE.md](../NOTICE.md).

## Smoke da IA no Android

O plano de IA usa a mesma API do servidor. Sem provedor ativo, sem sessão ou sem servidor, o treino
local continua disponível como guest e recursos colaborativos/IA aguardam a próxima conexão.

Depois de instalar o APK, valide: shell sem tela branca, login por passkey, Plano com card de IA,
rotina manual preservada, seletor de sessão quando houver plano manual/IA ou Personal no mesmo dia,
e ausência de erro visível ao voltar para Home.
