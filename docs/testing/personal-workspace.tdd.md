# Evidências TDD — painel do personal 1.3.0

Data: 29 de agosto de 2026

## Escopo

Esta rodada cobriu armazenamento colaborativo, papéis e conexões, grants, inbox/Web Push,
programas executáveis, medidas, agenda, financeiro, contexto de personal, Capacitor autenticado e
as telas profissionais. O estado privado de treino do aluno continua separado em
`state-<uid>.json`; a sincronização de programas preserva suas rotinas manuais e histórico.

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
| Web Push de vínculo/programa | `45007fe` | `e3d82f0` |
| Programa executável e Capacitor online/offline | `e384082` | `0cdd1b0`, `e7b1aeb` |
| Passkey Android e Digital Asset Links | `e15bf01` | `48c630a` |
| Backup automático Android desativado | teste de deploy | `008a7e6` |

Os testes de regressão também cobrem papéis inválidos, solicitante malformado, IDOR, grants
revogados, conflitos de revisão, valores monetários em centavos e recuperação segura após 401/403.

## Resultado registrado

| Verificação | Resultado |
|---|---|
| API (`node --test`) | 66/66 testes aprovados |
| Cobertura da API | 99,77% linhas; 82,96% branches; 91,93% funções |
| Frontend (`vitest run`) | 341/341 testes aprovados |
| Playwright (`playwright test`) | 3/3 fluxos completos aprovados em 360×800, 768×1024 e 1440×900 |
| Build Vite | concluído; 134 módulos transformados |
| Docker Compose | imagens `api` e `web` aprovadas; healthcheck e shell verificados |
| APK Android | `build:mobile` validou 2.648 mídias; `assembleDebug` aprovado |
| Auditoria de dependências de produção | 0 vulnerabilidades em frontend e API |
| Smoke visual | 1440×900, 768×1024 e 360×800 aprovados |

O E2E versionado percorre seleção do aluno, medidas, publicação de programa, agenda, cobrança e
revogação de acesso com respostas de API controladas. Também verifica navegação, payloads, overflow,
conteúdo acima da barra inferior, console e capturas dos três viewports.

## Limites desta evidência

- O E2E com API controlada não substitui um fluxo completo com passkey e dados reais de produção.
- Web Push exige inscrição e permissão no navegador; a inbox persistida continua sendo a fonte da
  verdade quando o transporte não está disponível.
- Métricas de evolução ainda não agregam todo o histórico local do aluno.
- O Capacitor carrega conta e colaboração quando autenticado, mas mantém somente o treino local no
  fallback offline; a instalação física final ainda depende do aparelho conectado.
- O armazenamento colaborativo JSON exige uma única réplica da API.

Esses itens permanecem abertos no [PLANEJAMENTO.md](../../PLANEJAMENTO.md).
