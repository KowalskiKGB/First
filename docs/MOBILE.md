# App móvel do First

First mantém projetos Capacitor para Android e iOS. Este guia cobre o APK Android de depuração;
após `npm run build:mobile`, use Xcode no macOS para um build iOS de desenvolvimento.

A versão 1.3.0 usa `versionCode 7` no Android. O app standalone não usa passkeys, sincronização com
o servidor ou telemetria: seus dados permanecem no aparelho. Por isso, o painel colaborativo do
personal funciona na web/PWA autenticada, não no APK standalone.

## Build Android

Forneça a mídia de licença separada nestes diretórios locais ignorados pelo Git:

```text
media/img/   # 1.324 arquivos .jpg
media/gif/   # 1.324 arquivos .gif
```

Os nomes devem corresponder exatamente ao catálogo. `npm run build:mobile` valida os arquivos,
copia-os para `frontend/dist/media/` e sincroniza o bundle com o Capacitor.

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
APK local inclui 1.324 JPGs e 1.324 GIFs para uso offline e exibe **© Gym visual**. Fornecer,
compilar ou distribuir esses arquivos é responsabilidade de quem realiza o build; nem a licença
MIT do dataset nem a AGPL do First concede direitos sobre a mídia.

O código continua sob GNU AGPL v3.0. Preserve a atribuição ao openGym e disponibilize o código
correspondente ao distribuir o app. Veja [NOTICE.md](../NOTICE.md).
