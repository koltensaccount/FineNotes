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
import { type KirchhoffCircuit, validateAndNormalizeCircuit } from "./ir";

export interface ConvertCircuitInput {
  elements: PageElements;
  bounds: Bounds;
  keyStore: KeyStore;
  modelOverride?: string;
}

const CIRCUIT_SYSTEM_PROMPT = `You are an expert electrical engineer and schematic recognition system.
Analyze the provided handwritten electrical circuit diagram and convert it into a structured netlist following the kirchhoff-ir/1.0 schema.

Supported component types:
- resistor (ports: p1, p2)
- variable_resistor (ports: p1, p2)
- capacitor (ports: p1, p2)
- polarized_capacitor (ports: pos, neg)
- variable_capacitor (ports: p1, p2)
- inductor (ports: p1, p2)
- vsource (AC voltage source, ports: pos, neg)
- vsource_dc (DC voltage source, ports: pos, neg)
- battery (ports: pos, neg)
- isource (current source, ports: out, in)
- diode (ports: anode, cathode)
- zener_diode (ports: anode, cathode)
- led (ports: anode, cathode)
- transistor_npn (ports: base, collector, emitter)
- transistor_pnp (ports: base, collector, emitter)
- transistor_nmos (ports: gate, drain, source)
- transistor_pmos (ports: gate, drain, source)
- opamp (ports: in_inv, in_noninv, out, vcc, vee)
- ground (ports: gnd)
- earth (ports: earth)
- switch_spst (ports: p1, p2)
- lamp (ports: p1, p2)

Layout guidelines:
- Coordinates should be integers or half-integers on a regular grid (typical circuit scale: 0 to 20 units).
- Align connected component terminals with connection nodes.
- Horizontal two-terminal components have rotation 0. Vertical components pointing downward or upward have rotation 90 or 270.
- Recognize component reference labels (e.g., R1, C1, V_in, V_out) and values (e.g., 10k, 100uF, 5V, 1kHz).
- Identify all electrical junctions and wire connections.

Respond ONLY with valid JSON matching the schema below. No markdown fences, no explanation text:
{
  "version": "kirchhoff-ir/1.0",
  "title": "Circuit",
  "nodes": {
    "n1": { "id": "n1", "x": 0, "y": 0, "junction": false }
  },
  "components": {
    "r1": {
      "id": "r1",
      "type": "resistor",
      "label": "R1",
      "value": "10kΩ",
      "x": 3,
      "y": 0,
      "rotation": 0,
      "ports": { "p1": "n1", "p2": "n2" }
    }
  },
  "wires": [
    { "id": "w1", "fromNode": "n1", "toNode": "n2" }
  ]
}`;

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

  const body = {
    systemInstruction: {
      parts: [{ text: CIRCUIT_SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            inline_data: {
              mime_type: "image/png",
              data: base64Data,
            },
          },
          {
            text: "Extract all electrical components, labels, values, nodes, and wire connections from this handwritten circuit diagram into kirchhoff-ir/1.0 JSON format. Output only the structured JSON immediately.",
          },
        ],
      },
    ],
    generationConfig: {
      maxOutputTokens,
      responseMimeType: "application/json",
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
    if (typeof part.text === "string") {
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
  if (Object.keys(normalized.components).length === 0) {
    throw new Error("No electrical components were recognized in the selection.");
  }

  return normalized;
}
