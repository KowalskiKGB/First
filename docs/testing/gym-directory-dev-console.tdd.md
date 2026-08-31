# Evidências TDD — academias, catálogo e Painel Dev

Data: 30 de agosto de 2026

## Escopo

Esta rodada cobre diretório moderado de academias, seleção exata pelo catálogo de 1.324 exercícios,
solicitações de aparelhos, objetivos de IA em botões, Painel Dev compacto, usuários cadastrados e a
correção de respostas truncadas na geração de treino.

## RED → GREEN

- Commit RED `2cf941b`: contratos de schema, diretório, catálogo, moderação e console.
- A geração real reproduziu uma resposta OpenAI interrompida exatamente no teto antigo de 4.000
  tokens; o adapter passou a reservar 8.000 tokens para GPT-5, usar raciocínio mínimo e tratar
  truncamento sem expor conteúdo do provedor.
- Playwright reproduziu o bloqueio de provedores quando o índice auxiliar de usuários falhava; o
  carregamento foi isolado e o formulário de API permanece disponível.
- Um teste de contrato reproduziu a rota destrutiva de exclusão fora da especificação; ela foi
  removida antes do release.

## Resultado de release

| Verificação | Resultado |
|---|---|
| API com cobertura | 232 testes; 82,42% linhas e 80,58% branches no conjunto |
| Frontend com cobertura | 551 testes; módulos principais novos/alterados acima de 80% de linhas |
| Playwright | 29 fluxos aprovados, incluindo mobile, tablet e desktop |
| Auditoria npm | 0 vulnerabilidades na API e no frontend |
| Segredos no diff | 0 candidatos; credenciais locais continuam ignoradas |

O E2E cobre geração/aplicação/rollback, coexistência de agendas, cadastro/login sem confirmação,
Personal, configuração e troca de provedor, moderação Dev, diretório público e solicitação de
aparelho com ID real do catálogo.
