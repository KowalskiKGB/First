# Revisão diferencial da primeira entrega — First

Data: 2026-08-29  
Base revisada: snapshot independente `79ca473` até a árvore preparada para publicação  
Escopo: isolamento Git, identidade, tradução, frontend, WebAuthn/API, Docker/Nginx, documentação, Android e iOS

## Recomendação

**Aprovar para o primeiro deploy protegido.** Nenhum achado crítico, alto ou médio permanece aberto após as correções. O único risco operacional aceito é a janela de bootstrap do primeiro perfil, mitigada por um router Traefik prioritário com Basic Auth temporário e fechamento imediato de cadastros depois da criação do proprietário.

## Achados fechados durante a revisão

| Severidade | Evidência | Resultado |
|---|---|---|
| Alto | `web/nginx.conf:3-18`, espelhado em `nginx.conf` | O rate limit agora restaura o endereço do cliente somente a partir do proxy privado, evitando um balde global de autenticação. |
| Médio | `frontend/src/lib/api.js:2-11`, `frontend/src/views/Login.jsx` | O texto de biometria segue `getLang()` e inicia em pt-BR mesmo quando o navegador está em inglês. |
| Médio | `frontend/ios/App/App.xcodeproj/project.pbxproj`, `frontend/ios/App/App/Info.plist` | Bundle ID e nome iOS foram isolados como `com.kowalskikgb.first` e `First`. |
| Médio | `api/server.js:13-21`, `api/server.js:256` | Produção falha sem RP/origin explícitos e o health público não enumera usuários. |
| Médio | `web/nginx.conf:19-67` | CSP, `nosniff`, proteção contra frames e referrer policy são preservados também nas locations estáticas. |
| Baixo | `.dockerignore`, `api/.dockerignore`, `frontend/src/lib/exercises.js` | Segredos/dados/artefatos ficam fora do contexto; mídia sem licença separada não é baixada nem servida por padrão. |
| Baixo | `frontend/src/lib/demo.js`, `frontend/src/sheets.jsx`, `frontend/src/lib/mobile.js` | URL, repositório, bundle e nomes de exportação apontam apenas para First. |

## Riscos residuais e limites conhecidos

- Bootstrap: `INVITE_ONLY=0` é temporário e só pode ficar público com `FIRST_BASIC_AUTH_USERS` e `FIRST_BOOTSTRAP_MIDDLEWARE=,first-bootstrap-auth`. O fechamento exige `ADMIN_UIDS`, `INVITE_ONLY=1` e limpar apenas `FIRST_BOOTSTRAP_MIDDLEWARE`; a credencial permanece para proteger `/media/`.
- Persistência: a API atual usa JSON atômico em um único volume e processo. É adequada a esta fase, não a múltiplas réplicas; a migração está planejada em `PLANEJAMENTO.md`.
- Cobertura herdada: linhas atingem 81,79%, mas statements/branches/funções ainda estão abaixo de 80%. Nenhum módulo do personal deve ser aceito futuramente sem 80% em todas as métricas do código novo.
- A base contém elementos clicáveis herdados implementados como `div`; os fluxos alterados nesta entrega receberam nomes de campo, autocomplete, foco visível e toast com live region, mas a conversão integral para controles semânticos fica como débito de acessibilidade.
- O projeto iOS foi sincronizado e teve a identidade validada estaticamente; o build iOS não pode ser executado no host Windows.

## Evidência de verificação

- 208/208 testes Vitest e 2/2 testes de deploy.
- 11 pacotes de idioma, 628 chaves cada, sincronizados.
- Build web e mobile concluídos; APK debug gerado e inspecionado.
- Imagens Docker reconstruídas; API saudável e executando como usuário `node`.
- Auditoria de dependências de produção: zero vulnerabilidades em frontend e API.
- Playwright desktop e mobile: pt-BR, branding First, sem overflow, erro de página, resposta HTTP inesperada ou carregamento de mídia.
- `git diff --check` sem erros; nenhum segredo versionado; nenhum remote do projeto original.
