# Fluxos de funcionamento da aplicação

Este documento explica, passo a passo, o que acontece desde a chegada de uma
requisição HTTP até o fim do workflow. Ele complementa a especificação do
projeto em [`project-specification.md`](./project-specification.md).

## 1. Componentes envolvidos

| Componente | Papel no fluxo |
| --- | --- |
| `src/index.ts` | Inicia o servidor |
| `src/server.ts` | Recebe `POST /chat` e inicia o grafo |
| `src/graph/factory.ts` | Cria os serviços e o grafo |
| `src/graph/graph.ts` | Declara o estado e as transições |
| `identifyIntentNode.ts` | Identifica a intenção com a LLM |
| `schedulerNode.ts` | Valida dados de agendamento |
| `cancellerNode.ts` | Processa o caminho de cancelamento |
| `messageGeneratorNode.ts` | Finaliza o workflow |
| `openRouterService.ts` | Configura e chama o OpenRouter |
| `appointmentService.ts` | Mantém profissionais e consultas em memória |

## 2. Inicialização do processo

Quando o comando `npm start` ou `npm run dev` é executado:

1. O Node carrega `src/index.ts`.
2. `createServer()` é chamado.
3. `buildGraph()` cria um `OpenRouterService`.
4. `buildGraph()` cria um `AppointmentService`.
5. `buildAppointmentGraph()` registra todos os nós e compila o LangGraph.
6. Fastify começa a escutar na porta `3000`.

```text
src/index.ts
    |
    +--> createServer()
             |
             +--> buildGraph()
                      |
                      +--> OpenRouterService
                      +--> AppointmentService
                      +--> StateGraph.compile()
```

O `AppointmentService` usa arrays em memória. Por isso, consultas adicionadas
durante a execução são perdidas quando o processo é encerrado.

## 3. Entrada HTTP

O cliente envia:

```http
POST /chat
Content-Type: application/json
```

```json
{
  "question": "Olá, sou Maria Santos e quero agendar uma consulta com Dr. Alicio da Silva para amanhã às 16h"
}
```

Antes do handler ser executado, Fastify verifica o schema da rota:

- o corpo deve ser um objeto;
- `question` é obrigatório;
- `question` deve ser uma string;
- a string deve possuir pelo menos 10 caracteres.

Se a validação passar, `server.ts` cria:

```ts
const response = await graph.invoke({
  messages: [new HumanMessage(question)],
});
```

Essa é a entrada inicial do grafo. A mensagem original fica no campo
`messages` durante todo o workflow.

## 4. Estado inicial e estado final

### Estado inicial

```json
{
  "messages": [
    {
      "type": "human",
      "content": "pergunta do paciente"
    }
  ]
}
```

### Estado depois da identificação

Exemplo de agendamento:

```json
{
  "messages": ["mensagem original"],
  "patientName": "Maria Santos",
  "intent": "schedule",
  "professionalId": 1,
  "professionalName": "Dr. Alicio da Silva",
  "datetime": "2026-11-18T16:00:00.000Z",
  "reason": "check-up regular"
}
```

O LangGraph combina o objeto parcial retornado por cada nó com o estado
existente.

### Estado final de sucesso

```json
{
  "messages": ["mensagem original"],
  "intent": "schedule",
  "actionSuccess": true,
  "success": true
}
```

O estado final é serializado pelo Fastify e devolvido ao cliente. Atualmente a
API não transforma esse estado em um DTO específico.

## 5. Construção dos prompts

O nó de identificação usa `src/prompts/v1/identifyIntent.ts`.

### Prompt de sistema

`getSystemPrompt(professionals)` transforma em JSON:

- a função do modelo como classificador de intenção;
- a lista de profissionais, IDs e especialidades;
- a data atual;
- as regras para `schedule`, `cancel` e `unknown`;
- as instruções de extração;
- exemplos de entrada e saída.

### Prompt do usuário

`getUserPromptTemplate(question)` transforma a pergunta em JSON e solicita ao
modelo que:

1. determine a intenção;
2. extraia os detalhes disponíveis;
3. converta data e hora para ISO;
4. relacione o nome do profissional ao ID;
5. retorne apenas campos presentes na pergunta.

## 6. Chamada ao OpenRouter

O `OpenRouterService` é criado com `ChatOpenAI` e aponta para:

```text
https://openrouter.ai/api/v1
```

Na chamada `generatedStructured()`:

1. O serviço cria um agente LangChain.
2. O schema recebido é configurado com `providerStrategy`.
3. O prompt de sistema vira `SystemMessage`.
4. O prompt do usuário vira `HumanMessage`.
5. O agente é invocado.
6. `structuredResponse` é retornado ao nó.

Em caso de sucesso:

```ts
{
  success: true,
  data: respostaEstruturada
}
```

Em caso de falha:

```ts
{
  success: false,
  data: mensagemDoErro
}
```

O modelo configurado deve ser compatível com o endpoint
`/chat/completions`. A chave vem de `OPENROUTER_API_KEY`; o modelo pode ser
alterado com `OPENROUTER_MODEL`.

## 7. Fluxo `identifyIntent`

Arquivo: `src/graph/nodes/identifyIntentNode.ts`.

1. O nó registra `Identifying intent...`.
2. Obtém a última mensagem com `state.messages.at(-1)`.
3. Lê o texto da mensagem.
4. Monta os dois prompts.
5. Chama `generatedStructured()`.
6. Se a chamada falhar:
   - registra o erro;
   - retorna `intent: "unknown"`;
   - retorna `error` com a mensagem.
7. Se a chamada tiver sucesso:
   - obtém `result.data`;
   - adiciona os campos de intenção ao estado;
   - permite que o roteador escolha o próximo nó.

O schema da resposta contém:

```text
intent
professionalId
professionalName
datetime
patientName
reason
```

## 8. Roteamento condicional

Depois de `identifyIntent`, o grafo executa uma função de roteamento:

```text
state.error existe?
    sim --> message
    não
state.intent existe?
    não --> message
    sim
state.intent == "unknown"?
    sim --> message
    não --> nó correspondente à intenção
```

As transições válidas são:

```text
schedule --> schedule
cancel   --> cancel
message  --> message
```

Depois dos nós de operação:

```text
schedule --> message --> END
cancel   --> message --> END
message  --> END
```

## 9. Fluxo de agendamento

Entrada esperada:

```text
intent = schedule
professionalId preenchido
datetime preenchido
patientName preenchido
```

O nó `schedulerNode.ts` executa:

1. Registra `Scheduling appointment...`.
2. Valida `professionalId`, `datetime` e `patientName` com Zod.
3. Se a validação for bem-sucedida:
   - registra sucesso;
   - define `actionSuccess: true`;
   - define `success: true`.
4. Se ocorrer uma exceção:
   - define `actionSuccess: false`;
   - define `success: false`;
   - define `actionError`.
5. Encaminha para `message`.

### Campo obrigatório ausente

Se a validação falhar, o nó retorna `actionSuccess: false` e
`actionError`. Nesse caminho específico, o código atual não define
explicitamente `success: false`.

### Operação realizada

O nó chama `AppointmentService.checkAvailability()` por meio de
`bookAppointment()` e cria a consulta em memória. Horários ocupados retornam
`Horário indisponível para este profissional`.

## 10. Fluxo de cancelamento

Entrada esperada:

```text
intent = cancel
professionalId preenchido
datetime preenchido
patientName preenchido
```

O nó `cancellerNode.ts` executa:

1. Registra `Cancelling appointment...`.
2. Retorna o estado recebido.
3. Define `actionSuccess: true`.
4. Define `success: true`.
5. Encaminha para `message`.

O bloco `catch` define `actionSuccess: false`, `success: false` e
`actionError`, mas atualmente não há uma chamada de serviço que possa lançar o
erro de negócio.

### Operação realizada

O nó chama `AppointmentService.cancelAppointment()` e retorna sucesso somente
quando a combinação de profissional, paciente e data/hora encontra uma consulta.

## 11. Fluxo `unknown` e falhas

Uma pergunta como “Qual é a previsão do tempo?” deve resultar em
`intent: "unknown"` segundo as regras do prompt.

O caminho é:

```text
identifyIntent
    |
    +--> intent = unknown
             |
             v
          message
             |
             v
            END
```

Se o OpenRouter falhar, o caminho é semelhante, mas o estado também contém
`error`.

O nó `messageGeneratorNode.ts` preserva as mensagens existentes. Em uma
exceção interna, ele adiciona uma `AIMessage` genérica de erro.

## 12. Fluxo de geração da resposta

O nó `message` é comum a todos os caminhos:

```text
schedule --------\
cancel -----------+--> message --> END
unknown/error ----/
```

No comportamento atual:

1. Registra `Generating response message...`.
2. Seleciona o cenário conforme intenção e sucesso da operação.
3. Monta os prompts e chama o modelo com `MessageSchema`.
4. Preserva o histórico e adiciona uma `AIMessage`.
5. Usa uma mensagem local de contingência quando o provedor falha.

O arquivo `src/prompts/v1/messageGenerator.ts` já possui prompts para:

- agendamento bem-sucedido;
- falha no agendamento;
- cancelamento bem-sucedido;
- falha no cancelamento;
- intenção desconhecida.

Esse módulo está conectado ao fluxo executado.

## 13. Resposta HTTP

Depois de `message`, o grafo retorna o estado para `server.ts`. O handler
retorna esse objeto diretamente:

```ts
return response;
```

Exemplo simplificado:

```json
{
  "messages": [
    {
      "type": "human",
      "content": "Quero agendar..."
    }
  ],
  "patientName": "Maria Santos",
  "intent": "schedule",
  "professionalId": 1,
  "datetime": "2026-11-18T16:00:00.000Z",
  "actionSuccess": true,
  "success": true
}
```

## 14. Fluxo dos testes E2E

`tests/router.e2e.test.ts` cria o servidor e utiliza `app.inject()`.

### Agendamento

1. Envia uma pergunta com paciente, profissional, data, hora e motivo.
2. Espera HTTP `200`.
3. Confirma `intent: "schedule"`.
4. Confirma `success: true`.

### Cancelamento

1. Envia uma requisição de agendamento para preparar o cenário.
2. Envia a requisição de cancelamento.
3. Espera HTTP `200`.
4. As asserções de intenção e sucesso estão comentadas atualmente.

Executar:

```bash
npm run test:e2e
```

## 15. Fluxo de desenvolvimento e depuração

Para executar:

```bash
npm install
npm run dev
```

Para depurar:

1. Abra a pasta do projeto no VS Code.
2. Confirme que `.env` possui `OPENROUTER_API_KEY`.
3. Coloque um breakpoint em um nó, por exemplo `identifyIntentNode.ts`.
4. Pressione `F5`.
5. Escolha `Debug medical appointment`.
6. Envie uma requisição para `POST /chat`.
7. Observe o estado no painel de variáveis.

A configuração em `.vscode/launch.json` usa `--inspect-brk` e
`--env-file=.env`.

## 16. Resumo das limitações atuais

```text
LLM de intenção       implementada
Roteamento LangGraph  implementado
Validação de campos   implementada
Agendamento real       implementado em memória
Disponibilidade        consultada pelo serviço
Cancelamento real      implementado em memória
Mensagem final         gerada pela LLM com fallback
Banco de dados         não implementado
```

Os próximos pontos naturais são conectar os nós ao `AppointmentService`,
implementar a geração da `AIMessage` e retornar um DTO específico para a API.
