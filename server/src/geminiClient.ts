import { GoogleGenAI } from "@google/genai";

// GEMINI_MODEL is an env var, not hardcoded — spec: pick whatever current
// Flash-tier model is available at build/deploy time (Gemini 1.5 is
// retired). Set it in the Cloud Run service's environment.
const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

/**
 * Structured-output schema per field, e.g.
 * { type: "object", properties: {...}, required: [...] } — passed straight
 * through to responseSchema (spec §7.3: responseMimeType "application/json"
 * + responseSchema, not free-text parsing).
 *
 * NOTE: written against my best understanding of the current @google/genai
 * SDK surface (GoogleGenAI -> .models.generateContent({model, contents,
 * config: {systemInstruction, responseMimeType, responseSchema}}) ->
 * response.text). This package's API has moved before and I can't verify
 * it against a live key in this environment — if the SDK has since changed
 * shape, this is the first place to check.
 */
export async function generateJson(
  systemInstruction: string,
  userContent: string,
  responseSchema: object,
): Promise<unknown> {
  const ai = getClient();
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: userContent,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema,
    },
  });

  const text = response.text;
  if (!text) throw new Error("empty response from Gemini");
  return JSON.parse(text);
}
