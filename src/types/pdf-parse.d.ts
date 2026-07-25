// pdf-parse ships no types, and we import the inner lib entry to avoid its
// index.js debug shim (see document-reader.ts). Minimal ambient declaration.
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    text: string;
    numpages: number;
    info?: unknown;
    metadata?: unknown;
    version?: string;
  }
  function pdfParse(data: Buffer | Uint8Array, options?: unknown): Promise<PdfParseResult>;
  export default pdfParse;
}
