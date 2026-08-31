# Evidências TDD — First 1.4

Data: 31 de agosto de 2026

## Escopo

Esta rodada cobre a rotação isolada da credencial Dev, URL canônica `/devadmin`, mensagens de
autenticação, localização automática e transitória no diretório de academias, navegação do aluno,
nova identidade visual, acessibilidade de ações e os builds web/Android 1.4.0.

## RED → GREEN

- Commit RED `9c104e2`: contratos falharam para `--scope dev`, URL de `/devadmin`, versão Android,
  localização automática, concorrência com escolha manual, navegação e hierarquia da Home.
- O primeiro Playwright completo após o GREEN encontrou 3 regressões: seletor Dev largo no celular
  e 2 seletores E2E antigos para o aviso de localização. O recorte corrigido passou 15/15 e a suíte
  final passou 36/36.
- A auditoria de interface encontrou ações com `div/onClick`, alvos de 36 px e tabela financeira
  larga no celular. Testes de contrato foram registrados antes das correções; ações passaram a usar
  botões nativos, alvos passaram a 44 px e a tabela ganhou layout compacto.
- O tema claro passou a usar verde escuro para texto e mantém `#B7F34A` somente como sinal de ação.

## Resultado de release

| Verificação | Resultado |
|---|---|
| API | 271/271 testes aprovados |
| Cobertura da API | 84,01% linhas; 81,02% branches; 81,19% funções |
| Frontend | 597/597 testes aprovados |
| Playwright | 36/36 fluxos em mobile, tablet e desktop |
| Scripts de release críticos | 19/19 testes aprovados |
| Auditoria npm | 0 vulnerabilidades na API e no frontend |
| Build web | aprovado; aviso não bloqueante de chunk legado grande |
| Build Android | `versionCode 8`, `versionName 1.4.0`, 1.324 imagens + 1.324 GIFs |

O V8 global do frontend permanece em 64,94% de linhas por incluir telas legadas extensas. Os fluxos
alterados de maior risco também são exercitados no Playwright real; o relatório diferencial registra
esse limite sem representar cobertura global como 80%.
