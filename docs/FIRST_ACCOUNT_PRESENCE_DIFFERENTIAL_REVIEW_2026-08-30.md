# Revisão diferencial — cadastro, presença e Início

Data: 2026-08-30  
Base revisada: `744755d`  
Escopo: cadastro do aluno, sessão, presença de conta, painel Admin e card semanal da Home.

## Resultado

| Severidade | Encontrados | Abertos |
| --- | ---: | ---: |
| Crítico | 0 | 0 |
| Alto | 0 | 0 |
| Médio | 3 | 0 |
| Baixo | 2 | 0 |

**Recomendação:** aprovar para a instância privada de uma única API após o smoke Android e o smoke do deploy. Os achados do diferencial foram corrigidos e possuem cobertura automatizada.

## Mudanças e alcance

- O cadastro passou a exigir confirmação local da senha e continua enviando ao servidor apenas a senha original.
- O cadastro cria a sessão imediatamente; o cliente confirma que a sessão pertence ao e-mail recém-cadastrado e usa login transparente somente se o cookie não tiver sido adotado.
- A API persiste `lastAccessAt` e `lastLoginAt` na conta, mantém presença recente em memória e entrega ao Admin estado online, último acesso e último login.
- O Admin separa conta online de treino em andamento e usa o relógio retornado pela API para calcular o tempo offline.
- O card semanal da Home ficou compacto: uma única legenda, sem contador semanal duplicado e sem faixa verde decorativa.

`readSession` é um ponto de alto alcance, usado por rotas de estado, IA, Personal, mídia e Admin. A revisão confirmou que assinatura HMAC, expiração, existência do usuário, bloqueio de conta e versão de sessão continuam sendo validados antes de registrar presença.

## Achados corrigidos

### Médio — resposta de cadastro não deveria depender do formato do corpo

O protótipo podia criar a conta, receber um corpo incompleto e exibir uma mensagem incorreta de confirmação. O frontend agora valida `/api/me` depois do cadastro, confere o e-mail da sessão e, se necessário, faz login com as credenciais que o próprio aluno acabou de fornecer. O teste HTTP também prova que o cookie real emitido por `/api/auth/register` autentica `/api/me` imediatamente.

### Médio — cookie antigo podia voltar a funcionar após reativar conta

Desativar uma conta bloqueava a sessão enquanto `disabled=true`, mas reativá-la poderia tornar o cookie antigo válido outra vez. A desativação agora incrementa `sv`; a sessão anterior permanece revogada mesmo depois da reativação.

### Médio — persistência excessiva por heartbeat

Registrar cada requisição autenticada diretamente no JSON ampliaria escrita em disco e contenção. A presença online é mantida em memória e `lastAccessAt` é persistido no máximo uma vez a cada cinco minutos por conta; login e cadastro continuam sendo persistidos imediatamente.

### Baixo — tempo offline dependia do relógio do celular

Um aparelho com hora incorreta exibiria um intervalo incorreto. A listagem e o detalhe Admin agora recebem `now` da API e o usam nos cálculos relativos.

### Baixo — controle de copiar convite não era semântico

O código de convite clicável era um `span`. Ele foi trocado por `button` com nome acessível, preservando cópia e feedback.

## Análise adversarial

- **Pessoa não autenticada:** não acessa a lista de contas; `/api/admin/*` continua exigindo uma sessão Admin válida.
- **Aluno autenticado:** não consegue enumerar e-mails, presença ou datas de outras contas.
- **Cookie antigo ou roubado:** desativação incrementa a versão de sessão e impede reutilização após reativar a conta.
- **Cookie residual de outra conta no cadastro:** o cliente compara o e-mail de `/api/me` com o cadastro e não adota silenciosamente uma sessão diferente.
- **Heartbeat abusivo:** o acesso exige cookie assinado e a persistência é limitada por intervalo; o painel não usa o heartbeat de treino como substituto da presença da conta.
- **Dados sensíveis:** senha e hash não entram nas respostas Admin nem no frontend; o campo de confirmação não integra o payload.

## Evidências de verificação

- API: 215 testes aprovados, incluindo cookie pós-cadastro, persistência de acesso, autorização Admin e revogação por desativação.
- Frontend: 519 testes unitários aprovados.
- Navegador: 25 cenários Playwright aprovados em layouts mobile, tablet e desktop, incluindo cadastro, senhas divergentes e card semanal.
- Auditoria visual: sem overflow horizontal, sem erros no console, calendário em coluna, apenas uma legenda "Esta semana" e foco no campo de confirmação inválido.
- Dependências: auditorias de API e frontend sem vulnerabilidades conhecidas.

## Risco residual

- O estado online tem janela deliberada de cinco minutos; portanto, representa atividade recente, não uma conexão WebSocket instantânea.
- O armazenamento JSON exige uma única réplica de API. Aumentar réplicas antes de migrar o armazenamento quebraria a consistência da presença e das escritas.
- Recuperação automática de senha ainda não faz parte desta fase.

## Metodologia

Revisão focada de alto risco com diff completo desde `744755d`, inspeção do histórico de autenticação, mapeamento dos consumidores de `readSession`, cenários adversariais, testes unitários/HTTP/E2E e verificação visual responsiva. O código atual foi tratado como fonte da verdade; o grafo estrutural foi apenas índice auxiliar.
