# Evidências TDD — academias, catálogo e Painel Dev

Data: 30 de agosto de 2026

## Escopo

Esta rodada cobre diretório moderado de academias, seleção exata pelo catálogo de 1.324 exercícios,
solicitações de aparelhos, objetivos de IA em botões, Painel Dev compacto, usuários cadastrados e a
correção de respostas truncadas na geração de treino. A busca pública agora começa pelas 27 UFs e
carrega os municípios da API oficial do IBGE, sem depender da existência prévia de academias no banco.

## RED → GREEN

- Commit RED `2cf941b`: contratos de schema, diretório, catálogo, moderação e console.
- A geração real reproduziu uma resposta OpenAI interrompida exatamente no teto antigo de 4.000
  tokens; o adapter passou a reservar 8.000 tokens para GPT-5, usar raciocínio mínimo e tratar
  truncamento sem expor conteúdo do provedor.
- Playwright reproduziu o bloqueio de provedores quando o índice auxiliar de usuários falhava; o
  carregamento foi isolado e o formulário de API permanece disponível.
- Um teste de contrato reproduziu a rota destrutiva de exclusão fora da especificação; ela foi
  removida antes do release.
- O navegador reproduziu os seletores de UF e município vazios quando o servidor não possuía
  academias aprovadas. A UF passou a ser uma lista local estável, o município vem do IBGE e uma
  entrada manual segura mantém o fluxo utilizável quando o serviço externo falha.

## Resultado de release

| Verificação | Resultado |
|---|---|
| API com cobertura | 242 testes; 82,73% linhas e 80,87% branches no conjunto |
| Frontend com cobertura | 562 testes; diretório com 87,91% e módulo de localidades com 93,10% de linhas |
| Playwright | 31 fluxos aprovados, incluindo mobile, tablet e desktop |
| Auditoria npm | 0 vulnerabilidades na API e no frontend |
| Segredos no diff | 0 candidatos; credenciais locais continuam ignoradas |

O E2E cobre geração/aplicação/rollback, coexistência de agendas, cadastro/login sem confirmação,
Personal, configuração e troca de provedor, moderação Dev, diretório público e solicitação de
aparelho com ID real do catálogo. O diretório também cobre as 27 UFs, carregamento e falha de
municípios, digitação manual, herança da localidade no cadastro e ausência de overflow em celular.
