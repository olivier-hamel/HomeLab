import {documentUrl} from "./documents.js";

let libraryPromise;
const thumbnails = new Map();
async function thumbnail(id) {
  libraryPromise ??= import("../vendor/pdfjs/pdf.min.mjs").then(library => {
    library.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
    return library;
  }).catch(error => {libraryPromise = null; throw error;});
  const library = await libraryPromise;
  const loading = library.getDocument({url: documentUrl(id), withCredentials: true, isEvalSupported: false, enableXfa: false,
    cMapUrl: new URL("../vendor/pdfjs/cmaps/", import.meta.url).href, cMapPacked: true,
    standardFontDataUrl: new URL("../vendor/pdfjs/standard_fonts/", import.meta.url).href,
    wasmUrl: new URL("../vendor/pdfjs/wasm/", import.meta.url).href});
  try {
    const pdf = await loading.promise;
    const page = await pdf.getPage(1);
    const original = page.getViewport({scale: 1});
    const viewport = page.getViewport({scale: Math.min(2, 640 / original.width, 1000 / original.height)});
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    await page.render({canvas, canvasContext: canvas.getContext("2d"), viewport}).promise;
    return {url: canvas.toDataURL("image/png"), pages: pdf.numPages};
  } finally {await loading.destroy();}
}
export async function renderPdfPreview(content) {
  const root = content.querySelector("[data-pdf-preview]");
  if (!root) return;
  const id = root.dataset.pdfPreview;
  if (!thumbnails.has(id)) {
    if (thumbnails.size >= 12) thumbnails.delete(thumbnails.keys().next().value);
    thumbnails.set(id, thumbnail(id).catch(error => {thumbnails.delete(id); throw error;}));
  }
  try {
    const result = await thumbnails.get(id);
    if (!root.isConnected) return;
    const image = new Image(); image.src = result.url; image.alt = "Aperçu de la première page du PDF"; image.className = "pdf-preview-image";
    root.querySelector(".pdf-preview-loading")?.replaceWith(image);
    const count = document.createElement("span"); count.className = "pdf-page-count"; count.textContent = `1 / ${result.pages}`; root.append(count);
  } catch {
    if (!root.isConnected) return;
    const loading = root.querySelector(".pdf-preview-loading");
    if (loading) {loading.classList.add("pdf-preview-unavailable"); loading.textContent = "Aperçu indisponible. Ouvre le PDF original pour le consulter.";}
  }
}
