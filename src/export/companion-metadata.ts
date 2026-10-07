/** Ownership travels inside the PDF as well as its human-readable filename. */
import { PDFDocument } from "pdf-lib";
import { validCompanionId } from "../model/companion-pdf";
const PREFIX = "FineNotes companion ";
export function companionPdfSubject(id: string): string {
  if (!validCompanionId(id)) throw new Error("Invalid companion identity");
  return PREFIX + id;
}
export async function companionPdfIdentity(bytes: ArrayBuffer): Promise<string | null> {
  try {
    const pdf = await PDFDocument.load(bytes);
    const id = pdf.getSubject()?.slice(PREFIX.length);
    return pdf.getSubject()?.startsWith(PREFIX) && validCompanionId(id) ? id : null;
  } catch {
    return null;
  }
}
