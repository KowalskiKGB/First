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
| Prioridades e consentimento | `5860270` | `363b2da` |
| Atualização, erros e fuso da agenda | `cb754dd`, `1db9398`, `d57df44` | `7645fdf`, `2b6f607`, `360d8f9` |
| Pacote Docker da API | `89e9ac1` | `5adcb3f` |

Os testes de regressão também cobrem papéis inválidos, solicitante malformado, IDOR, grants
revogados, conflitos de revisão, valores monetários em centavos e recuperação segura após 401/403.

## Resultado registrado

| Verificação | Resultado |
|---|---|
| API (`node --test`) | 61/61 testes aprovados |
| Cobertura da API | 99,77% linhas; 82,35% branches; 90,87% funções |
| Frontend (`vitest run`) | 332/332 testes aprovados |
| Playwright (`playwright test`) | 3/3 fluxos completos aprovados em 360×800, 768×1024 e 1440×900 |
| Build Vite | concluído; 134 módulos transformados |
| Auditoria de dependências de produção | 0 vulnerabilidades em frontend e API |
| Smoke visual | 1440×900, 768×1024 e 360×800 aprovados |

O E2E versionado percorre seleção do aluno, medidas, publicação de programa, agenda, cobrança e
revogação de acesso com respostas de API controladas. Também verifica navegação, payloads, overflow,
conteúdo acima da barra inferior, console e capturas dos três viewports.

## Limites desta evidência

- O E2E com API controlada não substitui um fluxo completo com passkey e dados reais de produção.
- Programas publicados ainda não são convertidos automaticamente em treinos no estado local do
  aluno.
- Métricas de evolução ainda não agregam todo o histórico local do aluno.
- O app Capacitor standalone não carrega o domínio colaborativo; o painel do personal é web/PWA.

Esses itens permanecem abertos no [PLANEJAMENTO.md](../../PLANEJAMENTO.md).
