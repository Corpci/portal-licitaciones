import { GoogleGenAI, Type } from "@google/genai";
import { PortalSummary } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function scanPortal(portalUrl: string, portalId: string): Promise<PortalSummary> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: `Visita y analiza el siguiente portal en busca de nuevas licitaciones o convocatorias públicas: ${portalUrl}.
      Extrae un resumen de las oportunidades actuales y una lista de licitaciones específicas encontradas.
      TODA la respuesta (resumen, títulos, descripciones) DEBE estar en ESPAÑOL.
      Si no puedes acceder a la página directamente, explica por qué en español pero intenta proporcionar cualquier información general que puedas tener sobre la estructura típica de este portal específico o su actividad reciente si es relevante.`,
      config: {
        systemInstruction: "Eres un experto en licitaciones gubernamentales. Tu tarea es analizar portales web y extraer información relevante sobre convocatorias. Debes responder siempre en español de forma profesional y concisa.",
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            portalId: { type: Type.STRING },
            summary: { type: Type.STRING, description: "A brief summary of what was found on the portal." },
            tenders: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING, description: "The title of the tender." },
                  description: { type: Type.STRING, description: "A short description of the tender." },
                  url: { type: Type.STRING, description: "The direct URL to the tender if available, or the portal URL if not." },
                  date: { type: Type.STRING, description: "The publication or deadline date if found." }
                },
                required: ["title", "description", "url"]
              }
            }
          },
          required: ["portalId", "summary", "tenders"]
        }
      }
    });

    const result = JSON.parse(response.text);
    return {
      ...result,
      portalId // Ensure we keep the correct ID
    };
  } catch (error) {
    console.error("Error scanning portal:", error);
    throw error;
  }
}
