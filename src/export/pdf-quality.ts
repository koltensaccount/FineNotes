/** Resolution tiers retain the existing iPad-safe canvas caps and JPEG encoding. */
export type PdfQuality = "standard" | "high" | "very-high";
export const PDF_QUALITY_LABELS: Record<PdfQuality, string> = {
  standard: "Standard", high: "High", "very-high": "Very High",
};
export const PDF_QUALITY_FACTORS: Record<PdfQuality, number> = {
  standard: 1, high: 1.25, "very-high": 1.5,
};
export function pdfQuality(value: unknown, fallback: PdfQuality = "high"): PdfQuality {
  return value === "standard" || value === "high" || value === "very-high" ? value : fallback;
}
export function effectivePdfQuality(override: PdfQuality | null | undefined, global: PdfQuality): PdfQuality {
  return pdfQuality(override ?? global);
}
