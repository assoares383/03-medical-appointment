# Assistente de Consultas Médicas

Exemplo educacional de um assistente de consultas médicas construído com
[LangGraph](https://langchain-ai.github.io/langgraphjs/) e
[Fastify](https://fastify.dev/).

A aplicação recebe solicitações em linguagem natural e foi projetada para
agendar ou cancelar consultas médicas por meio de um fluxo baseado em grafo.

## Funcionalidades

- Solicitações de consultas em linguagem natural.
- Categorias de intenção: `schedule`, `cancel` e `unknown`.
- Catálogo estático de profissionais médicos.
- Serviço em memória para disponibilidade e cancelamento de consultas.
- Roteamento condicional com LangGraph.
- API HTTP com Fastify.
- Configuração do OpenRouter e schemas de prompts preparados para integração
  com LLM.
- Testes end-to-end usando injeção de requisições do Fastify.

## Status atual

Este é um projeto educacional de workflow. A identificação de intenção já
invoca uma LLM do OpenRouter e o LangGraph roteia as intenções `schedule`,
`cancel` e `unknown`. Agendamento e cancelamento chamam o
`AppointmentService`. Há uma mensagem local de contingência para manter a
experiência funcional quando o provedor de IA estiver indisponível ou sem
crédito.

Consulte a análise completa da implementação e o comportamento planejado do
MVP em [`docs/project-specification.md`](./docs/project-specification.md).

## Arquitetura

```text
POST /chat
    |
    v
identifyIntent
    |
    +-- schedule --> schedule --> message --> END
    |
    +-- cancel ----> cancel ----> message --> END
    |
    +-- unknown/error ---------> message --> END
```

### Estrutura do projeto

```text
src/
├── config.ts                         # Configuração do OpenRouter/modelo
├── index.ts                          # Ponto de entrada do servidor HTTP
├── server.ts                         # Aplicação Fastify e rota /chat
├── graph/
│   ├── factory.ts                    # Factory do grafo e export LangGraph
│   ├── graph.ts                      # Schema de estado e workflow
│   └── nodes/
│       ├── cancellerNode.ts          # Etapa de cancelamento
│       ├── identifyIntentNode.ts     # Etapa de extração de intenção
│       ├── messageGeneratorNode.ts   # Etapa de geração da resposta
│       └── schedulerNode.ts          # Etapa de agendamento
├── prompts/
│   └── v1/
│       ├── identifyIntent.ts         # Schema de intenção e builders de prompt
│       └── messageGenerator.ts       # Schema de mensagem e builders de prompt
└── services/
    └── appointmentService.ts         # Profissionais e consultas em memória

tests/
└── router.e2e.test.ts                # Testes de integração HTTP
```

## Requisitos

- Node.js `>= 24.10.0`
- npm
- Uma chave de API do OpenRouter quando a integração com LLM estiver habilitada

## Instalação

```bash
npm install
```

## Configuração

Crie um arquivo `.env` na raiz do projeto:

```env
OPENROUTER_API_KEY=sua-chave-do-openrouter
OPENROUTER_MODEL=openai/gpt-4o-mini
```

As configurações atuais de modelo e roteamento estão definidas em
[`src/config.ts`](./src/config.ts).

## Execução da aplicação

Inicie o servidor HTTP:

```bash
npm start
```

O servidor ficará disponível em:

```text
http://localhost:3000
```

Modo de desenvolvimento:

```bash
npm run dev
```

## Uso da API

### `POST /chat`

Requisição:

```bash
curl \
  -X POST \
  -H 'Content-Type: application/json' \
  --data '{"question":"Quero agendar uma consulta com Dr. Alicio da Silva para amanhã às 16h"}' \
  http://localhost:3000/chat
```

O corpo da requisição deve conter uma string `question` com pelo menos 10
caracteres:

```json
{
  "question": "Quero agendar uma consulta com Dr. Alicio da Silva para amanhã às 16h"
}
```

Se ocorrer uma falha no processamento, a API retorna HTTP `500`:

```json
{
  "error": "An error occurred while processing your request."
}
```

## Profissionais disponíveis

| ID | Nome | Especialidade |
| ---: | --- | --- |
| 1 | Dr. Alicio da Silva | Cardiologia |
| 2 | Dra. Ana Pereira | Dermatologia |
| 3 | Dra. Carol Gomes | Neurologia |

As consultas são armazenadas em memória e são perdidas quando o processo é
encerrado.

## Testes

Execute todos os testes:

```bash
npm test
```

Execute apenas os testes end-to-end:

```bash
npm run test:e2e
```

Verifique a tipagem TypeScript:

```bash
npm run type-check
```

Execute a análise de dependências com Snyk:

```bash
npm run security:snyk
```

## Code review automatizado

Execute as verificações principais do projeto em sequência:

```bash
npm run code-review
```

O script executa:

1. Type-check do TypeScript.
2. Testes automatizados.
3. Análise de vulnerabilidades com Snyk.

O SonarQube é opcional porque depende de um servidor local ativo:

```bash
npm run code-review -- --sonar
```

Para executar apenas verificações específicas durante o desenvolvimento:

```bash
npm run code-review -- --skip-tests --skip-snyk
```

O processo para na primeira verificação que falhar e retorna código de saída
diferente de zero, podendo ser usado em CI/CD ou como etapa de revisão antes
de um pull request.

Para enviar o snapshot de dependências ao Snyk, use:

```bash
npm run security:snyk:monitor
```

## Qualidade com SonarQube

O projeto possui configuração em
[`sonar-project.properties`](./sonar-project.properties) e um Compose para
executar o SonarQube localmente:

```bash
docker compose -f docker-compose.sonarqube.yml up -d
```

Aguarde o SonarQube ficar disponível em
<http://localhost:9000>. No primeiro acesso, o login padrão é `admin` e a senha
inicial é `admin`; altere-a quando solicitado e gere um token em
**My Account > Security**.

Execute o scanner no diretório do projeto:

```bash
SONAR_TOKEN=seu-token npm run sonar
```

O projeto será analisado com a chave `medical-appointment`. O resultado pode
ser consultado em <http://localhost:9000>.

Os testes atuais verificam respostas HTTP e o resultado do fluxo de
agendamento. O teste de cancelamento prepara uma requisição anterior e valida
o status HTTP e o estado da operação.

## Próximas funcionalidades sugeridas

- Persistência das consultas em PostgreSQL ou MongoDB.
- Autenticação de pacientes e profissionais.
- Horários disponíveis por duração, período de atendimento e profissional.
- Notificação por e-mail no agendamento e no cancelamento.
- Link seguro de reagendamento no e-mail de cancelamento.
- Lembrete automático antes da consulta e confirmação de presença.
- Histórico de consultas e cancelamentos.
- Integração com Google Calendar ou Microsoft Outlook.
- Painel administrativo para profissionais gerenciarem a agenda.
- Busca de consultas por paciente, profissional e período.

Para o fluxo de e-mail sugerido:

1. Ao concluir um agendamento, enviar confirmação com data, horário,
   profissional e opção de cancelar.
2. Ao cancelar, enviar confirmação e um link temporário para reagendar.
3. Ao abrir o link, apresentar horários disponíveis e criar o novo
   agendamento após validação.
4. Registrar o status do envio e permitir nova tentativa em caso de falha,
   sem reverter uma consulta que já tenha sido confirmada.

## Servidor de desenvolvimento LangGraph

O grafo é exposto como `medical_appointments` por meio de
[`langgraph.json`](./langgraph.json).

Execute o servidor de desenvolvimento LangGraph:

```bash
npm run langgraph:serve
```

## Documentação

Para consultar a especificação completa do projeto, incluindo arquitetura,
contratos de estado, regras de negócio, riscos conhecidos e critérios de
aceitação do MVP, veja
[`docs/project-specification.md`](./docs/project-specification.md).

Para entender passo a passo todos os fluxos executados pela aplicação, veja
[`docs/application-flows.md`](./docs/application-flows.md).

## Licença

MIT
