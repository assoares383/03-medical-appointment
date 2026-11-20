import {
  getSystemPrompt,
  getUserPromptTemplate,
  MessageSchema,
} from "../../prompts/v1/messageGenerator.ts";
import { OpenRouterService } from "../../services/openRouterService.ts";
import type { GraphState } from "../graph.ts";
import { AIMessage } from "langchain";

function createFallbackMessage(state: GraphState): string {
  if (state.actionError) {
    return `Nao foi possivel concluir a solicitacao: ${state.actionError}`;
  }

  if (state.intent === "cancel") {
    return state.actionSuccess
      ? "Sua consulta foi cancelada com sucesso."
      : "Nao foi possivel cancelar a consulta. Verifique os dados informados.";
  }

  if (state.intent === "schedule") {
    return state.actionSuccess
      ? "Sua consulta foi agendada com sucesso."
      : "Nao foi possivel agendar a consulta. Verifique os dados ou tente outro horario.";
  }

  return "Posso ajudar a agendar ou cancelar consultas medicas.";
}

export function createMessageGeneratorNode(llmClient: OpenRouterService) {
  return async (state: GraphState): Promise<Partial<GraphState>> => {
    console.log(`💬 Generating response message...`);

    try {
      const hasSucceeded = state.actionSuccess ? "success" : "error";
      const scenario = `${state.intent ?? "unknown"}_${hasSucceeded}`;
      const details = {
        professionalName: state.professionalName,
        datetime: state.datetime,
        patientName: state.patientName,
        error: state.actionError ?? state.error,
      };

      const systemPrompt = getSystemPrompt();
      const userPrompt = getUserPromptTemplate({ scenario, details });

      const result = await llmClient.generatedStructured(
        systemPrompt,
        userPrompt,
        MessageSchema as any,
      );

      if (
        !result.success
        || typeof result.data !== "object"
        || result.data === null
        || typeof result.data.message !== "string"
      ) {
        console.log(`Message generation failed: ${result.data}`);
        const fallbackMessage = createFallbackMessage(state);
        return {
          messages: [
            ...state.messages,
            new AIMessage(fallbackMessage),
          ],
        };
      }

        console.log(`✅ Message generated: `, result.data.message);

      return {
        messages: [
          ...state.messages,
            new AIMessage(result.data.message),
        ],
      };
    } catch (error) {
      console.error("❌ Error in messageGenerator node:", error);
      return {
        ...state,
        messages: [
          ...state.messages,
          new AIMessage("An error occurred while processing your request."),
        ],
      };
    }
  };
}
