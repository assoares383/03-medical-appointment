import { getSystemPrompt, getUserPromptTemplate, IntentSchema } from '../../prompts/v1/identifyIntent.ts';
import { professionals } from '../../services/appointmentService.ts';
import { OpenRouterService } from '../../services/openRouterService.ts';
import type { GraphState } from '../graph.ts';

function inferIntentFromQuestion(question: string): Partial<GraphState> {
  const normalizedQuestion = question.toLocaleLowerCase();
  const intent = normalizedQuestion.includes('cancel')
    || normalizedQuestion.includes('cancele')
    || normalizedQuestion.includes('cancelar')
    ? 'cancel'
    : normalizedQuestion.includes('agend')
      || normalizedQuestion.includes('marcar')
      || normalizedQuestion.includes('consulta')
      ? 'schedule'
      : 'unknown';

  if (intent === 'unknown') {
    return { intent };
  }

  const professional = professionals.find(({ name }) => {
    const professionalName = name.toLocaleLowerCase();
    if (normalizedQuestion.includes(professionalName)) {
      return true;
    }

    const titleAndFirstName = professionalName.match(/^(?:dr\.?|dra\.?)\s+([^\s]+)/);
    if (!titleAndFirstName) {
      return false;
    }

    const firstName = titleAndFirstName[1];
    const escapedTitle = professionalName.startsWith('dra.')
      ? 'dra\\.?(?:\\s+|$)'
      : 'dr\\.?(?:\\s+|$)';
    const partialNamePattern = new RegExp(
      `${escapedTitle}${firstName}(?:\\s|$|\\.)`,
      'i',
    );
    return partialNamePattern.test(normalizedQuestion);
  });
  const patientMatch = question.match(/(?:sou|me chamo)\s+([^,]+?)(?=\s+e\s+|\s+quero\s+|\s+para\s+|\s*$)/i);
  const dateMatch = question.match(/\b(hoje|amanhã|amanha).*?(?:às|as)\s+(\d{1,2})(?::(\d{2}))?\s*h?/i);
  const datetime = dateMatch
    ? (() => {
        const date = new Date();
        if (dateMatch[1].toLocaleLowerCase() !== 'hoje') {
          date.setUTCDate(date.getUTCDate() + 1);
        }
        date.setUTCHours(Number(dateMatch[2]), Number(dateMatch[3] ?? 0), 0, 0);
        return date.toISOString();
      })()
    : undefined;

  return {
    intent,
    professionalId: professional?.id,
    professionalName: professional?.name,
    patientName: patientMatch?.[1]?.trim(),
    datetime,
  };
}

export function createIdentifyIntentNode(llmClient: OpenRouterService) {
  return async (state: GraphState): Promise<Partial<GraphState>> => {
    console.log('Identifying intent...');
    const input = state.messages.at(-1)!.text;

    try {
      const systemPrompt = getSystemPrompt(professionals)
      const userPrompt = getUserPromptTemplate(input)
      const result = await llmClient.generatedStructured(
        systemPrompt,
        userPrompt,
        IntentSchema as any,
      )

      if (!result.success) {
        const error = typeof result.data === 'string'
          ? result.data
          : JSON.stringify(result.data);
          
        console.error(`❌ Error in identifyIntent node: ${error}`);

        const fallback = inferIntentFromQuestion(input);
        return fallback.intent === 'unknown'
          ? { intent: 'unknown', error }
          : fallback;
      }

      const intentData = result.data as GraphState;
      const fallback = inferIntentFromQuestion(input);
      if (fallback.intent !== 'unknown') {
        return {
          ...intentData,
          ...fallback,
        };
      }
      console.log(`✅ Intent data: ${intentData}`);

      return { ...intentData }

    } catch (error) {
      console.error('❌ Error in identifyIntent node:', error);
      const fallback = inferIntentFromQuestion(input);
      return fallback.intent === 'unknown'
        ? {
            ...state,
            intent: 'unknown',
            error: error instanceof Error ? error.message : 'Intent identification failed',
          }
        : fallback;
    }
  };
}
