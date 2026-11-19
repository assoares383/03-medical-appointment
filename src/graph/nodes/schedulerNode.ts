import type { GraphState } from '../graph.ts';
import { z } from 'zod/v3';

const ScheduleRequiredFieldsSchema = z.object({
  professionalId: z.number({ required_error: 'Professional ID is required' }),
  datetime: z.string({ required_error: 'Appointment datetime is required' }),
  patientName: z.string({ required_error: 'Patient name is required' }),
})

export function createSchedulerNode() {
  return async (state: GraphState): Promise<Partial<GraphState>> => {
    console.log(`📅 Scheduling appointment...`);

    try {
      const validation = ScheduleRequiredFieldsSchema.safeParse(state);

      if (!validation.success) {
        const errorMessages = validation.error.errors.map(e => e.message).join(', ');

        console.log(`Validation failed ${errorMessages}`);

        return {
          actionSuccess: false,
          actionError: errorMessages,
        }
      }

      console.log(`✅ Appointment scheduled successfully`);

      return {
        ...state,
        actionSuccess: true,
        success: true,
      };
    } catch (error) {
      console.log(`❌ Scheduling failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        ...state,
        actionSuccess: false,
        success: false,
        actionError: error instanceof Error ? error.message : 'Scheduling failed',
      };
    }
  };
}
