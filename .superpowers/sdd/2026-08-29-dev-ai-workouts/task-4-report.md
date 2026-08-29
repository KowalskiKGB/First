# Task 4 — coexistência de agendas de treino

## Resultado

- `S.week` continua exclusivo de rotinas manuais; agendas gerenciadas ficam em `sourceSchedules.ai` e `sourceSchedules.personal`.
- Um resolvedor central e imutável migra estado legado, preserva múltiplas sessões no mesmo dia e é usado em Home, Workout, TabBar, sheets, histórico e lembretes.
- `dayPlan` registra somente a preferência escolhida, sem apagar alternativas do dia.
- Histórico registra `sourceType`, `planId` e `version`; duas sessões no mesmo dia permanecem eventos distintos, enquanto adesão e sequência contam a data uma vez.
- Lembretes descrevem as N opções do dia e carregam a rota de treino.
- Rotinas IA/Personal são somente leitura; copiar remove metadados gerenciados e cria uma rotina manual.

## TDD e commits

- RED: `d029022`, `99bf109`, `cebf39f` reproduzem migração/coexistência, cópia/roteamento e seleção/múltiplas sessões.
- GREEN: `84aa089 feat: support coexisting workout schedules`.
- Review fix 1/5 RED: `54eb995` reproduz a contagem duplicada de adesão e a preferência `rest` ocultando uma sessão gerenciada.
- Review fix 1/5 GREEN: `548de30` reutiliza `trainedDates` para contar datas únicas e deriva o cartão de hoje das opções reais do resolvedor; Home/history/schedule passaram 68/68.
- Review fix 2/5 RED: `06152d0` reproduz `rest` ocultando disponibilidade gerenciada na faixa semanal, calendário, override e helpers efetivos.
- Review fix 2/5 GREEN: `652eb61` remove o veto divergente do helper central; `dayPlan` é somente preferência e `rest` não apaga opções disponíveis. A bateria focada passou 71/71.

## Verificação

- Frontend, excluindo o teste do WIP externo de `ai-plan`: 32 arquivos e 375 testes aprovados após a segunda rodada de correção.
- API: 155 testes aprovados.
- Build Vite: aprovado.
- Playwright de coexistência/cópia: 2 projetos aprovados (390x844 e 1280x900), com teclado e ausência de erros de página.
- Cobertura dos novos módulos frontend: 98,92% statements, 81,06% branches, 96,42% functions e 100% lines.
- Cobertura do helper de lembretes da API: 100% lines/functions e 88,89% branches.
- `node --check api/server.js` e `git diff --check`: aprovados.
- Auditoria da UI nova: ações semânticas em `button`, rótulos acessíveis, foco visível, ícones decorativos ocultos e suporte a movimento reduzido.

## Limites e riscos conhecidos

- A suíte frontend completa mantém 2 falhas preexistentes no WIP não pertencente à Task 4 (`frontend/src/lib/ai-plan.js`): o campo novo `academia` e a grafia `Maquinas articuladas` divergem dos testes antigos. O arquivo e o plano em `docs/superpowers/plans/` foram preservados sem stage.
- O build conserva apenas o aviso existente de chunk acima de 1500 kB.
- Cards legados com `div onClick` em Home/Workout continuam como dívida semântica fora da alteração mínima; os novos seletores usam botões.
- Polimento adicional de i18n permanece para a Task 5.
