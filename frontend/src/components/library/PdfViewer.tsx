import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize, Minus, Plus } from "lucide-react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;
type PageSize = { number: number; width: number; height: number };
type Pdf = { document: PDFDocumentProxy; pages: PageSize[] };

function PdfPage({ pdf, page, width, nearby, name }: { pdf: PDFDocumentProxy; page: PageSize; width: number; nearby: boolean; name: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<{ width: number; text: string; error?: string } | null>(null);
  useEffect(() => {
    const parent = container.current;
    if (!nearby || !parent || width < 1) return;
    // Each render owns its canvas, so a cancelled zoom cannot draw over a newer render.
    const canvas = window.document.createElement("canvas");
    let disposed = false, task: RenderTask | undefined;
    void pdf.getPage(page.number).then(async source => {
      if (disposed) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (width * width * page.height / page.width)));
      const viewport = source.getViewport({ scale: width / page.width * ratio });
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      canvas.style.width = "100%"; canvas.style.height = "100%";
      canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", `${name} — page ${page.number}`);
      task = source.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport });
      await task.promise;
      if (disposed) return;
      parent.replaceChildren(canvas); canvas.className = "is-rendered";
      const content = await source.getTextContent();
      if (!disposed) setResult({ width, text: content.items.map(item => "str" in item ? item.str : "").join(" ") });
    }).catch(error => {
      if (!disposed && error?.name !== "RenderingCancelledException") setResult({ width, text: "", error: "Cette page ne peut pas être affichée. Télécharge l’original pour l’ouvrir." });
    });
    return () => { disposed = true; task?.cancel(); canvas.remove(); canvas.width = 0; canvas.height = 0; };
  }, [pdf, page, width, nearby, name]);
  const current = nearby && result?.width === width ? result : null;
  return <section className="library-pdf-page" data-page-number={page.number} aria-label={`Page ${page.number}`} style={{ width, height: width * page.height / page.width }}>
    <div className="library-pdf-canvas" ref={container} />
    {current?.error ? <p role="alert" className="library-pdf-error">{current.error}</p> : nearby && !current && <span className="library-spinner" role="status" aria-label={`Chargement de la page ${page.number}`} />}
    <p className="sr-only">{current?.text}</p>
  </section>;
}

export default function PdfViewer({ url, name, initialPage = 1 }: { url: string; name: string; initialPage?: number }) {
  const stage = useRef<HTMLDivElement>(null), pages = useRef<HTMLDivElement>(null);
  const anchor = useRef({ number: initialPage, fraction: 0 }), scrollFrame = useRef(0);
  const [pdf, setPdf] = useState<Pdf | null>(null), [pageNumber, setPageNumber] = useState(initialPage);
  const [zoom, setZoom] = useState(1), [width, setWidth] = useState(600), [error, setError] = useState("");
  const [nearby, setNearby] = useState<Set<number>>(new Set());
  useEffect(() => {
    const node = stage.current; if (!node) return;
    const observer = new ResizeObserver(entries => { setWidth(entries[0].contentRect.width); }); observer.observe(node);
    return () => { observer.disconnect(); cancelAnimationFrame(scrollFrame.current); };
  }, []);
  useEffect(() => {
    const loading = getDocument({ url, enableXfa: false, cMapUrl: "/library-pdf/cmaps/", cMapPacked: true,
      standardFontDataUrl: "/library-pdf/standard_fonts/", wasmUrl: "/library-pdf/wasm/" });
    let disposed = false;
    void loading.promise.then(async document => {
      // Reserve every page's actual dimensions; only nearby pages allocate bitmap canvases.
      const sizes = await Promise.all(Array.from({ length: document.numPages }, async (_, index) => {
        const page = await document.getPage(index + 1), viewport = page.getViewport({ scale: 1 });
        return { number: index + 1, width: viewport.width, height: viewport.height };
      }));
      if (!disposed) { const number = Math.max(1, Math.min(initialPage, document.numPages)); anchor.current = { number, fraction: 0 }; setPageNumber(number); setPdf({ document, pages: sizes }); }
    }).catch(() => { if (!disposed) setError("Ce document ne peut pas être affiché. Télécharge l’original pour l’ouvrir."); });
    return () => { disposed = true; void loading.destroy(); };
  }, [url, initialPage]);
  useLayoutEffect(() => {
    const node = stage.current, page = pages.current?.children[anchor.current.number - 1] as HTMLElement | undefined;
    if (node && page) node.scrollTop = page.offsetTop - 20 + anchor.current.fraction * page.offsetHeight;
  }, [pdf, width, zoom]);
  useEffect(() => {
    const root = stage.current, list = pages.current;
    if (!root || !list || !pdf) return;
    const observer = new IntersectionObserver(entries => {
      setNearby(previous => {
        const next = new Set(previous);
        for (const entry of entries) { const number = Number((entry.target as HTMLElement).dataset.pageNumber); if (entry.isIntersecting) next.add(number); else next.delete(number); }
        return next;
      });
    }, { root, rootMargin: "800px 0px" });
    for (const page of list.children) observer.observe(page);
    return () => observer.disconnect();
  }, [pdf]);
  const trackScroll = () => {
    cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(() => {
      const node = stage.current, list = pages.current;
      if (!node || !list?.children.length) return;
      const pageAt = (offset: number) => {
        let low = 0, high = list.children.length - 1;
        while (low < high) { const middle = Math.floor((low + high) / 2), page = list.children[middle] as HTMLElement; if (page.offsetTop + page.offsetHeight < offset) low = middle + 1; else high = middle; }
        return list.children[low] as HTMLElement;
      };
      const top = pageAt(node.scrollTop + 20);
      anchor.current = { number: Number(top.dataset.pageNumber), fraction: Math.max(0, (node.scrollTop + 20 - top.offsetTop) / top.offsetHeight) };
      setPageNumber(Number(pageAt(node.scrollTop + node.clientHeight * .35).dataset.pageNumber));
    });
  };
  const goToPage = (number: number) => {
    const node = stage.current, page = pages.current?.children[number - 1] as HTMLElement | undefined;
    if (!node || !page) return;
    anchor.current = { number, fraction: 0 }; setPageNumber(number); node.scrollTop = page.offsetTop - 20;
  };
  const pageWidth = Math.max(1, width) * zoom;
  return <div className="library-pdf-viewer"><div className="library-pdf-tools"><div><button aria-label="Page précédente" disabled={!pdf || pageNumber <= 1} onClick={() => goToPage(pageNumber - 1)}><ChevronLeft size={17} /></button><span>Page {pageNumber} / {pdf?.pages.length ?? "…"}</span><button aria-label="Page suivante" disabled={!pdf || pageNumber >= pdf.pages.length} onClick={() => goToPage(pageNumber + 1)}><ChevronRight size={17} /></button></div><div><button aria-label="Réduire le zoom" disabled={zoom <= .5} onClick={() => setZoom(n => Math.max(.5, n - .25))}><Minus size={16} /></button><span>{Math.round(zoom * 100)} %</span><button aria-label="Augmenter le zoom" disabled={zoom >= 2.5} onClick={() => setZoom(n => Math.min(2.5, n + .25))}><Plus size={16} /></button><button aria-label="Ajuster à la largeur" title="Ajuster à la largeur" onClick={() => setZoom(1)}><Maximize size={15} /></button></div></div><div className="library-pdf-stage" ref={stage} onScroll={trackScroll} tabIndex={0} aria-label="Pages du document">
    {error ? <p role="alert" className="library-pdf-error">{error}</p> : pdf ? <div className="library-pdf-pages" ref={pages} style={{ width: Math.max(width, pageWidth) }}>{pdf.pages.map(page => <PdfPage key={page.number} pdf={pdf.document} page={page} width={pageWidth} nearby={nearby.has(page.number)} name={name} />)}</div> : <span className="library-spinner" role="status" aria-label="Chargement du document" />}
  </div></div>;
}
