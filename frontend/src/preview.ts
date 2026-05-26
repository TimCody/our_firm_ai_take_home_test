/**
 * In-browser PDF preview using pdfjs-dist.
 *
 * For PDFs we render each page to its own canvas inside the container.
 * That gives the user instant visual feedback while the backend is
 * still extracting (rendering happens client-side, no round trip).
 *
 * For non-PDF inputs (DOCX, images) we fall back to showing the
 * server-returned page-preview data URLs.
 */
import * as pdfjs from "pdfjs-dist";
// Vite turns the ?url suffix into a string path that pdfjs can use as
// its worker source.
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export async function renderPdfPreview(
  file: File,
  container: HTMLElement,
): Promise<void> {
  container.innerHTML = "";
  const arrayBuffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise;

  // Cap preview at 8 pages to keep the UI snappy on long documents.
  const maxPages = Math.min(doc.numPages, 8);

  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1.2 });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    container.appendChild(canvas);
    await page.render({ canvasContext: ctx, viewport }).promise;
  }

  if (doc.numPages > maxPages) {
    const note = document.createElement("p");
    note.style.color = "var(--text-dim)";
    note.style.fontSize = "12px";
    note.style.textAlign = "center";
    note.textContent = `Preview truncated. Showing ${maxPages} of ${doc.numPages} pages.`;
    container.appendChild(note);
  }
}

export function renderImagePreviews(
  dataUrls: string[],
  container: HTMLElement,
): void {
  container.innerHTML = "";
  for (const url of dataUrls) {
    const img = document.createElement("img");
    img.src = url;
    img.style.width = "100%";
    img.style.borderRadius = "6px";
    img.style.marginBottom = "12px";
    container.appendChild(img);
  }
}
