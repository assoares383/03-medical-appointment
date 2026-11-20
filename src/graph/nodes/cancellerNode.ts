import { AppointmentService } from "../../services/appointmentService.ts";
import type { GraphState } from "../graph.ts";
import { z } from "zod/v3";

const CancelRequiredFieldsSchema = z.object({
  professionalId: z.number({ required_error: "Informe o profissional da consulta." }),
  datetime: z.string({ required_error: "Informe a data e o horário da consulta." }),
  patientName: z.string({ required_error: "Informe o nome do paciente." }),
});

export function createCancellerNode(appointmentService: AppointmentService) {
  return async (state: GraphState): Promise<Partial<GraphState>> => {
    console.log(`❌ Cancelling appointment...`);

    try {
      const validation = CancelRequiredFieldsSchema.safeParse(state);

      if (!validation.success) {
        const errorMessages = validation.error.errors
          .map((e) => e.message)
          .join(", ");

        console.log(`Validation failed ${errorMessages}`);

        return {
          ...state,
          actionSuccess: false,
          success: false,
          actionError: errorMessages,
        };
      }

      const cancelledAppointment = appointmentService.cancelAppointment(
        validation.data.professionalId,
        validation.data.patientName,
        new Date(validation.data.datetime),
      );

      return {
        ...state,
        actionSuccess: true,
        success: true,
        appointmentData: cancelledAppointment,
      };
    } catch (error) {
      console.log(
        `❌ Cancellation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );

      return {
        ...state,
        actionSuccess: false,
        success: false,
        actionError:
          error instanceof Error ? error.message : "Cancellation failed",
      };
    }
  };
}
