# Evidências TDD — painel do personal 1.3.0

Data: 29 de agosto de 2026

## Escopo

Esta rodada cobriu armazenamento colaborativo, papéis e conexões, grants, notificações, programas,
medidas, agenda, financeiro, contexto de personal e as telas profissionais. O estado privado de
treino do aluno continua separado em `state-<uid>.json`.

## Ciclo RED → GREEN

Os testes foram adicionados antes das respectivas implementações. Exemplos do histórico:

| Área | RED | GREEN/correção |
|---|---|---|
| Store JSON versionado | `6df3df8` | `5702a9b` |
| Contexto do personal | `eafd150` | `30076cb` |
| Hardening da API | `19cc398` | `11f05a8` |
| Formulários controlados | `8a0f88b` | `6bc5b6c` |
| Revogação e fail-closed | `5353742`, `cd689de` | `a7c9d3d`, `7b356e2` |
| Consentimento de conexão | `689d393`, `972f07f` | `0e7bdfb`, `eb4bf41` |
| Painel profissional | `0a54e39` | `846a337` |

Os testes de regressão também cobrem papéis inválidos, solicitante malformado, IDOR, grants
revogados, conflitos de revisão, valores monetários em centavos e recuperação segura após 401/403.

## Resultado registrado

| Verificação | Resultado |
|---|---|
| API (`node --test`) | 58/58 testes aprovados |
| Cobertura da API | 99,77% linhas; 81,62% branches; 89,95% funções |
| Frontend (`vitest run`) | 326/326 testes aprovados |
| Build Vite | concluído; 134 módulos transformados |
| Auditoria de dependências de produção | 0 vulnerabilidades em frontend e API |
| Smoke visual | 1440×900, 768×1024 e 360×800 aprovados |

O smoke visual percorreu o painel, alunos, ficha, agenda, financeiro e conexões com respostas de API
controladas, verificando navegação, overflow, conteúdo acima da barra inferior e console do
navegador.

## Limites desta evidência

- O smoke visual não substitui um E2E completo com passkey e dados reais de produção.
- Programas publicados ainda não são convertidos automaticamente em treinos no estado local do
  aluno.
- Métricas de evolução ainda não agregam todo o histórico local do aluno.
- O app Capacitor standalone não carrega o domínio colaborativo; o painel do personal é web/PWA.

Esses itens permanecem abertos no [PLANEJAMENTO.md](../../PLANEJAMENTO.md).
