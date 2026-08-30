# Revisão diferencial de segurança — Painel Dev e treinos com IA

Data: 2026-08-30

Baseline: `2658eb57a1d8c44b64e0498e7f8f270d49591e79`

Código revisado até: `5512cd0cd24bf799db88c70f3c14c3dbca29ec6b`

## Resumo executivo

**Aprovado para o deploy privado de instância única, sem achados críticos ou importantes abertos.** O diferencial tem 110 arquivos, 14.332 adições e 1.056 remoções. A revisão foi classificada como alta criticidade por alterar autenticação Dev, criptografia de chaves, chamadas externas, autorização entre aluno e Personal, aplicação automática de planos e recuperação do volume.

O protótipo inseguro que persistia `initialPassword` foi removido. A configuração atual exige credencial Dev via ambiente, guarda somente hash scrypt, criptografa chaves comerciais com AES-256-GCM e só ativa uma combinação provedor/modelo depois de teste estruturado real.

## O que mudou

- Segunda camada do Painel Dev: conta administradora por passkey mais sessão Dev assinada de quatro horas (`api/dev-auth.js:3-68`, `api/server.js:447-568`).
- Slots globais OpenAI, Gemini e Anthropic, sem base URL customizada e sem fallback automático (`api/ai-providers.js:42-245`).
- Chaves cifradas com chave mestra externa de 32 bytes; DTO público contém apenas fingerprint e estado (`api/ai-providers.js:11-94`).
- Fila persistida e idempotente, validação semântica antes da aplicação, recuperação conservadora após reinício e rollback (`api/ai-jobs.js:111-325`).
- Perfis, academia, medidas, permissões `trainingProfileWrite`/`aiPlanRead`, planos e uso migrados para o armazenamento colaborativo (`api/domain/schema.js:1-277`, `api/personal.js`).
- Agendas manual, Personal e IA coexistem, com origem e versão no histórico; o frontend recebeu wizard, estados de job, Painel Dev e aba IA do Personal.
- Backup/restore agora param e confirmam o único writer, copiam a origem para um inode 0600 sem pathname mantido por descritor de leitura em `TMPDIR` canônico privado, rejeitam links/tipos especiais antes da troca, verificam falhas de traversal, mantêm recovery e só fazem rollback após nova confirmação de parada. O gerador Dev publica por link exclusivo a partir de diretórios 0700 e, em falha, limpa os inodes próprios pelos descritores sem remover pathnames finais ou substituições externas (`scripts/backup-first-data.sh`, `scripts/restore-first-data.sh`, `scripts/generate-release-credentials.mjs`).
- Volumes legados com `secret` e `collaboration.json`, mas ainda sem `db.json`, são aceitos pelo recovery sem afrouxar tipos/links. No primeiro startup novo, o banco primário ausente é publicado exclusivamente a partir de temporário aleatório 0600 com `fsync`; corrupção, erro de I/O ou remoção em runtime continuam fail-closed (`api/server.js`, `scripts/backup-first-data.sh`, `scripts/restore-first-data.sh`).
- Mídia licenciada separadamente exige a sessão assinada do app via `auth_request`; anônimos são negados e o Cloudflare não armazena os arquivos. As duas configurações Nginx são mantidas equivalentes por teste, e `sw.js` usa `no-store`/`max-age=0` para não reter comportamento antigo (`api/server.js`, `web/nginx.conf`, `nginx.conf`, `scripts/deployment.test.mjs`).

## Análise por superfície

### Autenticação e sessão Dev

- `DEV_PANEL_USER` e `DEV_PANEL_PASSWORD_HASH` são obrigatórios em produção; o usuário precisa começar por `first_dev_` e o hash precisa cumprir o formato scrypt (`api/dev-auth.js:20-27`).
- A sessão `firstdev` é HMAC, `HttpOnly`, `SameSite=Strict`, `Secure` sob HTTPS e expira em quatro horas (`api/dev-auth.js:35-65`).
- O login Dev só ocorre depois de `requireAdmin`, exige origem exata e limita oito tentativas por IP/usuário em quinze minutos (`api/server.js:447-480`).
- Escritas novas Dev/IA exigem origem exata. O cliente Capacitor pode usar `X-First-Client: capacitor` somente sem `Origin` (`api/dev-auth.js:67-71`).

### Segredos e chamadas externas

- `AI_CONFIG_MASTER_KEY` aceita somente 64 hexadecimais e nunca é derivada do segredo de sessão (`api/ai-providers.js:4-16`).
- Cada chave usa IV aleatório de 12 bytes e tag GCM; a chave em claro só existe durante a montagem da requisição (`api/ai-providers.js:18-32`).
- O frontend nunca recebe `apiKeyEnc`; `providerSlotsDto` expõe apenas configuração, fingerprint parcial, teste, modelo e métricas (`api/ai-providers.js:42-56`).
- OpenAI usa `store:false`; Gemini envia `x-goog-api-key` no header; Anthropic usa structured output. Os destinos são fixos e `baseUrl`/`baseURL` são rejeitados (`api/ai-providers.js:58-145`).
- Sem chave mestra válida, salvar, testar, listar modelos e ativar respondem `503`; o health e os módulos sem IA continuam disponíveis (`api/server.js:291-309`, `api/server.js:495-560`, `api/server.js:724-741`).

### Dados, autorização e IA

- O Personal só lê o plano IA com vínculo ativo e `aiPlanRead`; só altera perfil/academia com `trainingProfileWrite` (`api/personal.js:5-21`, `api/personal.js:870-905`, `api/personal.js:1130-1164`).
- O contexto não inclui nome, e-mail, telefone, financeiro ou notas privadas. O identificador enviado é HMAC efêmero; limitações são marcadas como dado não confiável (`api/ai.js:245-324`).
- A shortlist é determinística e limitada a 120 IDs. O servidor rejeita ID ausente, equipamento incompatível, duplicidade, dia indisponível, campos extras, faixa inválida, carga absoluta, recusa e truncamento (`api/ai.js:117-146`, `api/ai.js:397-480`).
- Risco agudo e restrição médica bloqueiam a chamada. Menores exigem consentimento de responsável e recebem limites conservadores (`api/ai.js:245-270`, `api/ai.js:370-395`).
- Jobs exigem idempotência, têm limite de seis solicitações por aluno/hora e só substituem o plano vigente na transação de aplicação (`api/ai-jobs.js:111-253`).
- Migração e gravação em runtime retêm dez versões IA por aluno e dois mil jobs/usos; `stage` é enum fechado com fallback seguro para legado (`api/domain/schema.js:1-19`, `api/domain/schema.js:216-275`, `api/ai-providers.js:263-276`).

## Modelagem adversarial

| Cenário | Controle observado | Resultado |
| --- | --- | --- |
| Visitante tenta configurar uma chave | As rotas exigem passkey de admin, sessão Dev e, para escrita, origem exata | Bloqueado antes da leitura do corpo |
| Site externo tenta reutilizar cookies | Cookie Dev `SameSite=Strict`; mutações novas validam `Origin`; cookie de usuário é `SameSite=Lax` | Sem caminho prático de CSRF nas superfícies novas |
| Operador informa URL maliciosa para exfiltrar a chave | Base URL customizada é rejeitada e os três hosts são constantes | SSRF/exfiltração por configuração bloqueada |
| Texto de limitação contém prompt injection | Conteúdo é delimitado como não confiável; o modelo não possui ferramentas; saída passa por allowlist e validação fechada | Não alcança ação privilegiada nem exercício fora do catálogo |
| Modelo inventa exercício, carga ou dia | IDs são cruzados com a shortlist; campos/ranges/dias são validados antes da troca de plano | Plano anterior é preservado |
| Processo reinicia durante geração | Job `running` vira `failed`; não há retry nem fallback automático | Sem aplicação parcial ou cobrança duplicada pelo app |
| Personal tenta acessar aluno sem autorização | Vínculo ativo, cliente correspondente e grant específico são verificados no servidor | Resposta negada/sem projeção sensível |

## Achados e riscos aceitos

### LOW-01 — Verificação de usuário da passkey continua opcional

`requireUserVerification:false` permanece no registro e login (`api/server.js:350`, `api/server.js:396`). Isso preserva compatibilidade com os aparelhos atuais, mas não exige PIN/biometria do autenticador. A segunda credencial Dev reduz o impacto sobre chaves de IA. Recomenda-se testar `preferred`/`required` nos aparelhos suportados e migrar depois.

### INFO-01 — Retestar o provedor ativo o desativa

`testProvider` sempre retorna o slot testado com `active:false`, inclusive em sucesso (`api/ai-providers.js:216-234`). É fail-closed e não expõe dados, mas exige reativação manual e pode causar indisponibilidade temporária da geração.

### INFO-02 — Limites são locais ao processo

Login Dev e geração usam contadores em memória. Isso é coerente com a arquitetura declarada de uma única réplica; múltiplas réplicas invalidariam tanto o limite quanto a consistência do JSON. O runbook proíbe escalar horizontalmente.

### INFO-03 — Profundidade desigual nos testes de wiring HTTP

Os módulos críticos possuem unitários e integração, e os fluxos principais têm Playwright. Parte da verificação de montagem de rotas ainda usa assertivas contra o fonte em `api/test/dev-ai-contract.test.js`; uma futura suíte HTTP autenticada pode reduzir esse acoplamento.

## Testes e cobertura

- API: 192/192; cobertura total 88,56% de linhas, 82,48% de branches e 82,14% de funções. `ai-usage.js` ficou com 98,41% de linhas, 89,66% de branches e 100% de funções.
- Frontend: 481/481. `ai-job-flow.js`, incluindo a migração de planos legados, ficou com 100% de linhas e 89,44% de branches.
- Playwright: 21/21, incluindo wizard/aplicação/rollback, retomada e reconciliação de job, Dev sem vazamento de chave, Personal, agendas coexistentes e foco de modais em mobile, tablet e desktop.
- `npm audit` completo e produção: zero vulnerabilidades em API e frontend.
- Build Vite, build das imagens `first-api`/`first-web`, Compose config e APK debug passaram.
- Release operacional: 44 testes passaram e dois testes específicos de Linux foram ignorados no Windows; 31/31 também passaram em Docker/Linux. Deployment, sintaxe Bash e comportamento de backup/restore/credenciais foram validados, inclusive layout legado, lock, diretório 0700, arquivo 0600, troca da origem, falha de `find`, API ainda ativa após `stop`, links, FIFO e device.

## Blast radius e histórico

- Estratégia focada para repositório médio: todos os 110 arquivos alterados foram triados; auth, crypto, chamadas externas, job, schema, autorização, mídia e recovery tiveram leitura profunda.
- Ocorrências por arquivo: `createDevAuth` 3, `isTrustedMutation` 3, `encryptProviderKey` 2, `runStructuredOutput` 4, `createAiJobService` 3, `saveTrainingProfile` 2, `saveGymProfile` 2 e `buildAiContext` 2.
- O histórico mostra a remoção explícita de `initialPassword`, geração automática em `/data`, fallback para qualquer provedor configurado, retenção excessiva de uso e restore destrutivo. Os commits de endurecimento relevantes incluem `bef5b4d`, `7db2f1f`, `c72737d`, `4671d35`, `b33fe54`, `e1dd575`, `60babb2`, `1007c28`, `4232e78`, `c5dafb7`, `0389e3c`, `bf3dae8`, `a944ee6`, `f50f5d0`, `0ebfa58`, `7f24175`, `2f78055` e `e1736c2`.
- Nenhum acesso removido de um commit de segurança foi encontrado sem controle substituto.

## Limitações e confiança

Confiança **alta** para o checkout e a produção privada de instância única. Não houve chave comercial nem chamada real a provedor; os adapters foram exercitados com mocks determinísticos. O volume real foi copiado e verificado local/remotamente antes do deploy, e a nova versão passou por smoke público de API, cache, mídia e navegador. O build iOS exige macOS/Xcode e não foi produzido no Windows.
