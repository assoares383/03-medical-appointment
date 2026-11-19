# Assistente de Consultas Médicas

## 1. Objetivo do documento

Este documento especifica o projeto `03-medical-appointment` com base no
código-fonte atual. Ele descreve a arquitetura implementada, o comportamento
pretendido do assistente expresso pelos prompts e testes, e as lacunas
conhecidas entre ambos.

O projeto é um exemplo educacional de LangGraph e LangChain. Ele expõe uma
pequena API HTTP que recebe uma solicitação em linguagem natural e a encaminha
por um fluxo de consultas médicas.

## 2. Escopo

O assistente foi projetado para oferecer suporte a:

- Agendamento de consultas médicas.
- Cancelamento de consultas médicas existentes.
- Identificação de solicitações não suportadas e resposta informando que o
  assistente trata apenas de consultas.
- Extração de paciente, profissional, data/hora e motivo da consulta a partir
  de linguagem natural.
- Retorno de uma resposta amigável no idioma utilizado pelo paciente,
  preferencialmente português.

A implementação atual utiliza uma lista de consultas em memória e um catálogo
estático de profissionais. Ela não oferece autenticação, persistência,
integração com calendários, notificações ou interface de usuário.

## 3. Status atual da implementação

O projeto contém o esqueleto do workflow e a camada HTTP, mas as operações de
negócio ainda não estão completamente conectadas:

1. O nó de identificação de intenção lê a mensagem mais recente, mas não
   chama uma LLM nem preenche os campos extraídos.
2. O nó de agendamento informa sucesso, mas não chama o
   `AppointmentService`.
3. O nó de cancelamento informa sucesso, mas não chama o
   `AppointmentService`.
4. O nó de geração de mensagens preserva as mensagens existentes e não gera
   uma `AIMessage`.
5. Os módulos de prompts definem schemas e builders de prompts, mas atualmente
   não são utilizados pelos nós do grafo.
6. O serviço de consultas está implementado em memória, mas atualmente não é
   utilizado pelo grafo.
7. O README anterior descrevia um gerador de artigos técnicos e não este
   projeto de consultas médicas.

Portanto, a estrutura do workflow representa o design pretendido, enquanto o
comportamento observável da aplicação atual está apenas parcialmente
implementado.

## 4. Usuários e casos de uso principais

### 4.1 Paciente agenda uma consulta

O paciente envia uma solicitação em linguagem natural contendo, quando
possível:

- Nome do paciente.
- Nome do profissional.
- Data e horário.
- Motivo da consulta.

Exemplo:

> Olá, sou Maria Santos e quero agendar uma consulta com Dr. Alicio da Silva
> para amanhã às 16h para um check-up regular.

Comportamento de negócio esperado:

1. Classificar a solicitação como `schedule`.
2. Resolver o nome do profissional para um ID do catálogo.
3. Converter expressões relativas de data/hora para um timestamp ISO.
4. Verificar se o horário está disponível.
5. Criar a consulta.
6. Confirmar a consulta com uma mensagem clara.

### 4.2 Paciente cancela uma consulta

O paciente envia uma solicitação contendo o profissional, a data/hora e o nome
do paciente.

Exemplo:

> Cancele minha consulta com Dra. Ana Pereira que tenho hoje às 14h, me chamo
> Joao da Silva.

Comportamento de negócio esperado:

1. Classificar a solicitação como `cancel`.
2. Resolver o profissional.
3. Encontrar a consulta correspondente.
4. Removê-la quando encontrada.
5. Confirmar o cancelamento.

### 4.3 Solicitação não suportada

Solicitações não relacionadas a agendamento ou cancelamento devem ser
classificadas como `unknown`. O assistente deve explicar que trata de
agendamento e cancelamento de consultas médicas.

## 5. Arquitetura do sistema

```text
Cliente HTTP
    |
    v
Fastify POST /chat
    |
    v
Estado LangGraph
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

### 5.1 Componentes de execução

| Componente | Responsabilidade |
| --- | --- |
| `src/server.ts` | Cria a aplicação Fastify e expõe `/chat`. |
| `src/index.ts` | Inicia o servidor HTTP na porta `3000`. |
| `src/graph/graph.ts` | Define o estado tipado da consulta e o workflow LangGraph. |
| `src/graph/factory.ts` | Expõe o grafo compilado utilizado pelo LangGraph e pelo servidor. |
| `identifyIntentNode` | Deve classificar a intenção e extrair os campos da consulta. |
| `schedulerNode` | Deve validar a disponibilidade e criar consultas. |
| `cancellerNode` | Deve encontrar e cancelar consultas. |
| `messageGeneratorNode` | Deve produzir a resposta final para o paciente. |
| `appointmentService.ts` | Catálogo de profissionais e operações de consulta em memória. |
| `prompts/v1/identifyIntent.ts` | Schema de intenção e builders de prompt do classificador. |
| `prompts/v1/messageGenerator.ts` | Schema de resposta e builders de prompt do recepcionista. |
| `config.ts` | Configuração do OpenRouter/modelo. |

## 6. Especificação da API HTTP

### 6.1 `POST /chat`

Aceita uma requisição JSON:

```json
{
  "question": "Quero agendar uma consulta com Dr. Alicio da Silva"
}
```

Requisitos da requisição:

- Content type: `application/json`.
- `question` é obrigatório.
- `question` deve ser uma string com pelo menos 10 caracteres.

As respostas bem-sucedidas atualmente retornam o estado bruto do LangGraph
serializado pelo Fastify. A resposta pretendida deve expor a mensagem gerada
para o paciente e pode incluir metadados estruturados da operação, como
intenção, status de sucesso e dados da consulta.

### 6.2 Respostas de erro

A rota retorna HTTP `500` com o formato abaixo quando o processamento do grafo
lança uma exceção:

```json
{
  "error": "An error occurred while processing your request."
}
```

O Fastify trata falhas de validação do schema. A aplicação ainda não define um
formato personalizado para erros de validação.

## 7. Contrato de estado do LangGraph

O estado do grafo é definido com Zod e contém:

| Campo | Tipo | Significado |
| --- | --- | --- |
| `messages` | `BaseMessage[]` | Mensagens da conversa; a mensagem mais recente é a solicitação do usuário. |
| `patientName` | `string?` | Nome extraído do paciente. |
| `intent` | `schedule \| cancel \| unknown` | Intenção classificada do usuário. |
| `professionalId` | `number?` | ID do profissional selecionado no catálogo. |
| `professionalName` | `string?` | Nome do profissional extraído ou resolvido. |
| `datetime` | `string?` | Data/hora da consulta representada como string ISO. |
| `reason` | `string?` | Motivo da consulta agendada. |
| `actionSuccess` | `boolean?` | Indica se o agendamento ou cancelamento foi bem-sucedido. |
| `actionError` | `string?` | Erro legível da operação. |
| `appointmentData` | `any?` | Resultado de uma operação de consulta. |
| `error` | `string?` | Erro do workflow ou do processamento da intenção. |

Os nós retornam um objeto completo compatível com o estado, espalhando o estado
recebido e substituindo os campos que atualizam.

## 8. Requisitos de classificação de intenção

O classificador de intenção deve retornar um objeto estruturado compatível com:

```json
{
  "intent": "schedule",
  "professionalId": 1,
  "professionalName": "Dr. Alicio da Silva",
  "datetime": "2026-02-12T16:00:00.000Z",
  "patientName": "Maria Santos",
  "reason": "check-up"
}
```

Intenções suportadas:

- `schedule`: o paciente deseja agendar uma nova consulta.
- `cancel`: o paciente deseja remover uma consulta existente.
- `unknown`: a solicitação não tem relação com consultas ou não pôde ser
  classificada.

O prompt exige correspondência aproximada de nomes de profissionais,
interpretação de datas relativas como “hoje” e “amanhã”, e uso da data atual
como referência. Campos ausentes não devem ser inventados; somente campos
presentes na pergunta devem ser retornados.

## 9. Catálogo de profissionais

O catálogo atual é:

| ID | Nome | Especialidade |
| ---: | --- | --- |
| 1 | Dr. Alicio da Silva | Cardiologia |
| 2 | Dra. Ana Pereira | Dermatologia |
| 3 | Dra. Carol Gomes | Neurologia |

O catálogo é exportado pelo serviço de consultas e utilizado pelos testes de
integração para construir as solicitações.

## 10. Comportamento do serviço de consultas

O serviço armazena as consultas em um array em memória no nível do módulo. Os
dados iniciais incluem:

- Joao da Silva com o profissional `1`, hoje às `11:00 UTC`.
- Luana Costa com o profissional `2`, amanhã às `14:00 UTC`.

### 10.1 Disponibilidade

Uma consulta é considerada indisponível quando o mesmo profissional já possui
uma consulta no timestamp exato. A disponibilidade atualmente não considera
duração, sobreposição de intervalos, horário de funcionamento, finais de
semana, fusos horários ou datas passadas.

### 10.2 Agendamento

`bookAppointment`:

1. Verifica a disponibilidade do horário exato.
2. Lança `Horário indisponível para este profissional` se o horário estiver
   ocupado.
3. Adiciona e retorna a nova consulta quando o horário está disponível.

### 10.3 Cancelamento

`cancelAppointment` compara o ID do profissional, o timestamp exato e o nome
do paciente. Lança `Agendamento não encontrado para cancelamento` quando não
encontra uma consulta correspondente; caso contrário, remove a consulta.

### 10.4 Persistência e concorrência

O serviço é local ao processo. Os dados são perdidos quando o processo é
reiniciado, e o array não é adequado para múltiplas instâncias do servidor ou
uso durável em produção.

## 11. Requisitos de geração de respostas

O gerador de respostas deve utilizar uma resposta estruturada:

```json
{
  "message": "Sua consulta foi confirmada..."
}
```

As mensagens devem ser:

- Amigáveis, profissionais, concisas e empáticas.
- Escritas em linguagem simples e não técnica.
- Personalizadas com os detalhes relevantes do paciente, profissional, data e
  horário.
- Escritas no mesmo idioma da pergunta, preferencialmente em português.

Os cenários obrigatórios são:

- Agendamento bem-sucedido.
- Falha no agendamento.
- Cancelamento bem-sucedido.
- Falha no cancelamento.
- Intenção desconhecida.

## 12. Configuração e execução

### 12.1 Variáveis de ambiente

A aplicação espera:

- `OPENROUTER_API_KEY`: credencial do OpenRouter utilizada pela integração
  pretendida com LLM.

A configuração atual também define no código valores de modelo e roteamento,
incluindo o modelo gratuito `upstage/solar-pro-3:free`, roteamento por
throughput e temperatura `0.7`.

A chave de API é validada na inicialização do módulo. O código atual ainda não
instancia um cliente OpenRouter.

### 12.2 Comandos

Instalar dependências:

```bash
npm install
```

Iniciar o servidor:

```bash
npm start
```

Executar todos os testes:

```bash
npm test
```

Executar o servidor de desenvolvimento LangGraph:

```bash
npm run langgraph:serve
```

A configuração do LangGraph expõe o grafo chamado
`medical_appointments`, baseado em `src/graph/factory.ts`.

## 13. Requisitos de testes

A suíte atual de testes end-to-end utiliza injeção do Fastify e cobre:

- Uma solicitação de agendamento retornando HTTP `200`.
- Uma solicitação de cancelamento retornando HTTP `200` após uma solicitação
  de agendamento.

As asserções de intenção e sucesso da operação estão comentadas. Quando a
implementação se tornar funcional, os testes devem verificar pelo menos:

1. Classificação correta de solicitações de agendamento, cancelamento e
   desconhecidas.
2. Extração de paciente, profissional, data/hora e motivo.
3. Agendamento bem-sucedido de um horário disponível.
4. Rejeição de um horário ocupado.
5. Cancelamento bem-sucedido de uma consulta correspondente.
6. Falha quando os detalhes do cancelamento não correspondem.
7. Geração de uma mensagem para cada cenário suportado.
8. Validação de requisições sem pergunta ou com pergunta muito curta.

Os testes não devem depender da data ou do fuso horário reais atuais. A
resolução de datas deve ser injetada ou controlada para que os testes de datas
relativas sejam determinísticos.

## 14. Requisitos não funcionais

### Confiabilidade

- Dados extraídos inválidos ou incompletos não devem ser utilizados para criar
  ou cancelar uma consulta.
- Erros de negócio devem ser representados explicitamente no estado do grafo
  e na resposta final.
- Falhas da LLM e do serviço não devem ser convertidas em falso sucesso.

### Segurança de tipos

- Preservar a verificação estrita do TypeScript.
- Validar a saída da LLM com Zod antes de utilizá-la.
- Substituir campos `any` sem restrição por schemas explícitos à medida que o
  contrato se estabilizar.

### Observabilidade

Os nós atuais registram as etapas do workflow no console. Um logging adequado
para produção deve manter o contexto da etapa e do erro, evitando dados
pessoais dos pacientes e credenciais.

### Privacidade

Nomes de pacientes e detalhes de consultas são dados pessoais. Eles não devem
ser registrados sem necessidade, expostos em saídas de debug ou enviados a
provedores externos sem uma política apropriada de privacidade e retenção.

## 15. Inconsistências e riscos conhecidos

- O README anterior era copiado de um projeto diferente de geração de artigos
  com prompt chaining.
- O título configurado ainda diz “Prompt Chaining Article Generator”.
- Os exemplos de prompts contêm datas fixas que podem ficar desatualizadas.
- O tratamento de datas mistura operações com data local e construção de
  timestamps UTC.
- Os nós de agendamento e cancelamento atualmente reportam sucesso sem executar
  as operações correspondentes no serviço.
- O teste de integração de cancelamento espera sucesso HTTP, mas não verifica
  se a consulta foi realmente removida.
- O grafo retorna as mensagens do estado em vez de um DTO específico para a
  resposta da API.
- O serviço não possui persistência, limite transacional, autorização ou
  proteção contra escritas concorrentes.

## 16. Sequência de implementação recomendada

1. Reconciliar metadados do projeto, README, versões do Node e nomes de
   configuração.
2. Introduzir uma abstração de cliente LLM utilizando os módulos de prompts
   existentes e validar a saída do classificador com `IntentSchema`.
3. Implementar a extração de intenção em `identifyIntentNode`.
4. Analisar e validar a data/hora ISO antes de invocar as operações de negócio.
5. Injetar `AppointmentService` nos nós de agendamento e cancelamento.
6. Implementar a geração de respostas com `MessageSchema`, incluindo cenários
   de erro e intenção desconhecida.
7. Definir um DTO estável para a resposta da API em vez de expor todo o estado
   do grafo.
8. Substituir o serviço em memória por um repositório persistente se o projeto
   deixar de ser apenas uma demonstração.
9. Reativar e ampliar as asserções comentadas nos testes end-to-end.

## 17. Definição de pronto do MVP pretendido

O MVP estará completo quando:

- Uma solicitação válida de agendamento criar uma consulta e retornar uma
  confirmação localizada.
- Um horário ocupado for rejeitado sem criar uma duplicata.
- Um cancelamento válido remover exatamente a consulta correspondente e retornar
  uma confirmação.
- Um cancelamento sem correspondência retornar uma mensagem clara de falha.
- Solicitações desconhecidas não invocarem agendamento ou cancelamento.
- Dados obrigatórios ausentes resultarem em pedido de esclarecimento ou
  mensagem explícita de validação, em vez de uma operação inventada.
- Todos os testes de API, grafo e serviço passarem de forma determinística.
