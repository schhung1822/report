import { FALLBACK_AI_MODEL, PREFERRED_AI_MODEL, type AiModelId } from "@/lib/ai-analysis";
import { KieError, runKie } from "@/lib/kie";

/** Statuses worth retrying on the other model: rate limits, upstream errors and timeouts. */
const FALLBACK_STATUSES = [429, 502, 503, 504];

export type AnalysisRun = { model: AiModelId; raw: string; fallbackFrom?: AiModelId };

/**
 * Runs the requested model. When the preferred model (GPT) fails with a temporary error, the other model answers
 * instead and the result says so; if that fails too, the original error is reported. A model the user chose
 * explicitly other than the preferred one never falls back.
 */
export async function analyzeWithFallback(model: AiModelId, system: string, prompt: string): Promise<AnalysisRun> {
  try {
    return { model, raw: await runKie(model, system, prompt) };
  } catch (error) {
    if (model !== PREFERRED_AI_MODEL || !(error instanceof KieError) || !FALLBACK_STATUSES.includes(error.status)) throw error;
    try {
      return { model: FALLBACK_AI_MODEL, raw: await runKie(FALLBACK_AI_MODEL, system, prompt), fallbackFrom: model };
    } catch {
      throw error;
    }
  }
}
