/**
 * Asynchronous AI handwriting-to-circuit conversion via Google Gemini.
 *
 * Captures selected handwritten strokes, sends a high-resolution white-composited
 * image to Gemini with structured schema instructions, and validates the returned
 * Kirchhoff IR netlist.
 */

import { postJson } from "../recognition/http";
import { type KeyStore } from "../recognition/key-store";
import { defaultModelFor, extractLlmErrorMessage, jsonEndpoint } from "../recognition/llm-request";
import { type Bounds } from "../model/document";
import { type PageElements } from "../model/selection-commands";
import { renderSelectionToPng } from "../view/selection-clipboard";
import { cloneCircuit, type KirchhoffCircuit, validateAndNormalizeCircuit } from "./ir";
import { CIRCUIT_SYSTEM_PROMPT, CIRCUIT_RESPONSE_SCHEMA, circuitTopologySignature, cleanRecognizedLabelValues } from "./recognition-contract";
import { autoLayoutCircuit } from "./layout";

export interface ConvertCircuitInput {
  elements: PageElements;
  bounds: Bounds;
  keyStore: KeyStore;
  modelOverride?: string;
  pageImageBase64?: string;
  onReviewReady?: (review: CircuitRecognitionReview) => void;
}

/** Held in memory for review; copied locally only on an explicit editor action. */
export interface CircuitRecognitionReview {
  originalImage: string;
  model: string;
  rawText: string;
  normalized: KirchhoffCircuit;
  laidOut: KirchhoffCircuit;
}

/** Converts a Blob to a Base64 data string */
async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Converts selected handwritten ink into a validated KirchhoffCircuit via Gemini */
export async function convertSelectionToCircuit(
  input: ConvertCircuitInput,
): Promise<KirchhoffCircuit> {
  const apiKey = input.keyStore.get("google");
  if (!apiKey || !apiKey.trim()) {
    throw new Error(
      "Google Gemini API key not found. Please set your Gemini API key in FineNotes settings.",
    );
  }

  // 1. Render ink selection to white-composited PNG
  const pngBlob = await renderSelectionToPng(input.elements, input.bounds, {
    backgroundColor: "#ffffff",
    padding: 16,
    pressure: true,
  });

  const base64Data = await blobToBase64(pngBlob);

  // 2. Prepare Google Gemini generateContent payload
  const model = input.modelOverride || defaultModelFor("google");
  const endpoint = jsonEndpoint({
    vendor: "google",
    model,
    apiKey: apiKey.trim(),
  });

  const isGemini15 = model.includes("1.5");
  const maxOutputTokens = isGemini15 ? 8192 : 32768;

  const userParts: Array<{ inline_data?: { mime_type: string; data: string }; text?: string }> = [
    {
      inline_data: {
        mime_type: "image/png",
        data: base64Data,
      },
    },
  ];

  if (input.pageImageBase64) {
    userParts.push({
      inline_data: {
        mime_type: "image/png",
        data: input.pageImageBase64,
      },
    });
    userParts.push({
      text: "Image 1 is the selected handwritten electrical circuit (primary source of truth). Image 2 is the surrounding notebook page providing context (notes, formulas, headings). Analyze the circuit drawing and use the notebook page context to resolve any ambiguity in component types, labels, or values. Do NOT invent components not present in the drawing. Extract all electrical components, labels, values, nodes, and wire connections into kirchhoff-ir/1.0 JSON format. If any part of the circuit is ambiguous, add notes to the 'uncertainties' list. Output only the structured JSON immediately.",
    });
  } else {
    userParts.push({
      text: "Extract all electrical components, labels, values, nodes, and wire connections from this handwritten circuit diagram into kirchhoff-ir/1.0 JSON format. Output only the structured JSON immediately.",
    });
  }

  const body = {
    systemInstruction: {
      parts: [{ text: CIRCUIT_SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: "user",
        parts: userParts,
      },
    ],
    generationConfig: {
      maxOutputTokens,
      responseMimeType: "application/json",
      ...(isGemini15 ? {} : { responseJsonSchema: CIRCUIT_RESPONSE_SCHEMA }),
    },
  };

  // 3. Send request over Obsidian requestUrl
  const response = await postJson(endpoint.url, endpoint.headers, body);
  if (response.status !== 200) {
    let detail = "";
    try {
      detail = extractLlmErrorMessage(response.json);
    } catch {
      /* ignore */
    }
    throw new Error(
      `Gemini circuit recognition failed (HTTP ${response.status})${detail ? `: ${detail}` : "."}`,
    );
  }

  // 4. Extract generated text
  const replyJson = response.json as Record<string, unknown>;
  const candidates = replyJson?.candidates as Array<Record<string, unknown>> | undefined;
  if (!candidates || candidates.length === 0) {
    throw new Error("Gemini returned an empty response with no candidates.");
  }

  const firstCandidate = candidates[0];
  const finishReason = firstCandidate?.finishReason;

  const content = firstCandidate?.content as Record<string, unknown> | undefined;
  const parts = content?.parts as Array<Record<string, unknown>> | undefined;
  if (!parts || parts.length === 0) {
    throw new Error("Gemini returned no content parts.");
  }

  let rawText = "";
  for (const part of parts) {
    if (typeof part.text === "string" && part.thought !== true) {
      rawText += part.text;
    }
  }

  if (!rawText.trim()) {
    throw new Error("Gemini returned no text content.");
  }

  // 5. Parse and normalize structured JSON
  let cleanJsonText = rawText.trim();
  if (cleanJsonText.startsWith("```")) {
    cleanJsonText = cleanJsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  const firstBrace = cleanJsonText.indexOf("{");
  const lastBrace = cleanJsonText.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleanJsonText = cleanJsonText.slice(firstBrace, lastBrace + 1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanJsonText);
  } catch (err) {
    if (finishReason === "MAX_TOKENS") {
      throw new Error("Gemini hit output token limits before completing the circuit representation.");
    }
    throw new Error(`Failed to parse circuit JSON from Gemini output: ${String(err)}`);
  }

  const normalized = validateAndNormalizeCircuit(parsed);
  cleanRecognizedLabelValues(normalized);
  if (Object.keys(normalized.components).length === 0) {
    throw new Error("No electrical components were recognized in the selection.");
  }

  // Automatic clean layout, grid snapping, and orthogonal routing
  const laidOut = autoLayoutCircuit(normalized);
  if (circuitTopologySignature(normalized, true) !== circuitTopologySignature(laidOut, true)) {
    throw new Error("Automatic layout changed circuit connections. Original handwriting has been preserved.");
  }
  input.onReviewReady?.({
    originalImage: `data:image/png;base64,${base64Data}`,
    model,
    rawText,
    normalized: cloneCircuit(normalized),
    laidOut: cloneCircuit(laidOut),
  });

  return laidOut;
}
