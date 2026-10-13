import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize, Minus, Plus } from "lucide-react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;
export default function PdfViewer({ url, name }: { url: string; name: string }) {
  const stage = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null), [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1), [width, setWidth] = useState(600), [error, setError] = useState("");
  const [rendered, setRendered] = useState(false), [text, setText] = useState("");
  useEffect(() => {
    const node = stage.current; if (!node) return;
    const observer = new ResizeObserver(entries => { setWidth(entries[0].contentRect.width); }); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const loading = getDocument({ url, enableXfa: false, cMapUrl: "/library-pdf/cmaps/", cMapPacked: true,
      standardFontDataUrl: "/library-pdf/standard_fonts/", wasmUrl: "/library-pdf/wasm/" });
    let disposed = false;
    void loading.promise.then(pdf => { if (!disposed) setDocument(pdf); }).catch(() => { if (!disposed) setError("Ce document ne peut pas être affiché. Télécharge l’original pour l’ouvrir."); });
    return () => { disposed = true; void loading.destroy(); };
  }, [url]);
  useEffect(() => {
    if (!document || !canvas.current || width < 30) return;
    let disposed = false; let task: RenderTask | undefined;
    const node = canvas.current;
    void document.getPage(pageNumber).then(async page => {
      if (disposed) return;
      const size = page.getViewport({ scale: 1 });
      const scale = Math.min((width - (width < 500 ? 24 : 48)) / size.width, 1.4) * zoom;
      const ratio = Math.min(window.devicePixelRatio || 1, 2), viewport = page.getViewport({ scale: scale * ratio });
      node.width = Math.ceil(viewport.width); node.height = Math.ceil(viewport.height);
      node.style.width = `${viewport.width / ratio}px`; node.style.height = `${viewport.height / ratio}px`;
      task = page.render({ canvas: node, canvasContext: node.getContext("2d")!, viewport });
      await task.promise;
      if (!disposed) { setRendered(true); const content = await page.getTextContent(); if (!disposed) setText(content.items.map(item => "str" in item ? item.str : "").join(" ")); }
    }).catch(error => { if (!disposed && error?.name !== "RenderingCancelledException") setError("Cette page ne peut pas être affichée. Télécharge l’original pour l’ouvrir."); });
    return () => { disposed = true; task?.cancel(); };
  }, [document, pageNumber, width, zoom]);
  return <div className="library-pdf-viewer"><div className="library-pdf-tools"><div><button aria-label="Page précédente" disabled={!document || pageNumber <= 1} onClick={() => setPageNumber(n => n - 1)}><ChevronLeft size={17} /></button><span>Page {pageNumber} / {document?.numPages ?? "…"}</span><button aria-label="Page suivante" disabled={!document || pageNumber >= document.numPages} onClick={() => setPageNumber(n => n + 1)}><ChevronRight size={17} /></button></div><div><button aria-label="Réduire le zoom" disabled={zoom <= .5} onClick={() => setZoom(n => Math.max(.5, n - .25))}><Minus size={16} /></button><span>{Math.round(zoom * 100)} %</span><button aria-label="Augmenter le zoom" disabled={zoom >= 2.5} onClick={() => setZoom(n => Math.min(2.5, n + .25))}><Plus size={16} /></button><button aria-label="Ajuster à la largeur" title="Ajuster à la largeur" onClick={() => setZoom(1)}><Maximize size={15} /></button></div></div><div className="library-pdf-stage" ref={stage}>
    {error ? <p role="alert" className="library-pdf-error">{error}</p> : <><canvas ref={canvas} aria-label={`${name} — page ${pageNumber}`} role="img" className={rendered ? "is-rendered" : ""} />{!rendered && <span className="library-spinner" role="status" aria-label="Chargement de la page" />}<p className="sr-only">{text}</p></>}
  </div></div>;
}
