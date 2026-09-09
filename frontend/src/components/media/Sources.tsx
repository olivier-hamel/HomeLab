import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { bytes, mediaApi, sortSources, type SearchIntent, type SearchResults, type Source } from "../../lib/media";
import { useMediaTask } from "./useMediaTask";

export default function Sources({ intent, choose, disabled }: { intent: SearchIntent; choose: (source: Source | string, search?: SearchIntent) => void; disabled: boolean }) {
  const [q, setQuery] = useState(intent.query);
  const [useIds, setUseIds] = useState(!!intent.context);
  const [result, setResult] = useState<SearchResults | null>(null);
  const [resultIntent, setResultIntent] = useState<SearchIntent>();
  const [sort, setSort] = useState("seeders");
  const [page, setPage] = useState(1);
  const [magnet, setMagnet] = useState("");
  const task = useMediaTask();
  const search = (batch = 1) => {
    const searchIntent = { query: q, ...(useIds && q === intent.query ? { context: intent.context } : {}) };
    setResult(null); setPage(1);
    void task.run(s => mediaApi<SearchResults>("search", s, { ...searchIntent, batch }), data => { setResult(data); setResultIntent(searchIntent); });
  };
  const sorted = sortSources(result?.results ?? [], sort);
  const pages = Math.max(1, Math.ceil(sorted.length / 25));
  return <div className="space-y-5">
    {intent.label && <div className="rounded border border-orange-500/30 bg-orange-500/5 p-4 text-sm"><p>Looking for <strong className="text-white">{intent.label}</strong></p><p className="mt-1 text-neutral-400">S = Seeders. For faster download speeds, select the option with the highest number of seeders.</p></div>}
    <form onSubmit={e => { e.preventDefault(); search(); }} className="space-y-3">
      <label htmlFor="source-query" className="block text-sm text-neutral-300">Search your Prowlarr indexers</label>
      <div className="flex flex-wrap gap-3"><Input id="source-query" required maxLength={250} value={q} onChange={e => { setQuery(e.target.value); setUseIds(false); }} placeholder="Title, year, S01E01, or any search text…" className="h-11 min-w-40 flex-1 border-neutral-600 bg-neutral-950" /><Button disabled={task.busy || !q.trim()} className="h-11 bg-orange-600 text-white hover:bg-orange-700"><Search />Search sources</Button>{task.busy && <Button type="button" variant="outline" onClick={task.cancel}>Cancel search</Button>}</div>
      {intent.context && q === intent.query && <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked={useIds} onChange={e => setUseIds(e.target.checked)} className="h-4 w-4 accent-orange-500" />Prefer external IDs where supported; use the displayed title query elsewhere.</label>}
    </form>
    {task.busy && <p role="status" className="text-orange-400">Searching indexers…</p>}
    {task.error && <div role="alert" className="rounded border border-orange-500/40 p-4"><p>{task.error}</p><Button variant="outline" className="mt-3" onClick={() => search()}>Retry search</Button></div>}
    {result && <>
      {result.warning && <p role="status" className="text-orange-400">{result.warning}</p>}
      {result.reports.some(r => r.error) && <ul className="space-y-2 rounded border border-orange-500/40 p-4 text-sm" aria-label="Indexer errors">{result.reports.filter(r => r.error).map(r => <li key={r.indexer}><strong>{r.indexer}:</strong> {r.error}</li>)}</ul>}
      <details className="text-xs text-neutral-400"><summary className="cursor-pointer py-2">Queries sent to indexers</summary><ul className="space-y-2 pt-2">{result.reports.map(r => <li key={r.indexer} className="break-words">{r.indexer} · {r.strategy}: {r.query}</li>)}</ul></details>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-neutral-300">{sorted.length} results in batch {result.batch}</p><label className="flex items-center gap-2 text-xs">Sort loaded batch<select aria-label="Sort sources" className="h-10 rounded border border-neutral-600 bg-neutral-950 px-3" value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}><option value="seeders">Most seeders</option><option value="size">Largest size</option><option value="title">Title A–Z</option></select></label></div>
      {!sorted.length && <p className="rounded border border-neutral-700 p-6 text-sm text-neutral-400">No sources returned. Try the title query without IDs, another spelling, or a season pack. Check any indexer errors above.</p>}
      <div className="space-y-3">{sorted.slice((page - 1) * 25, page * 25).map(source => <article key={source.id} className="flex flex-col gap-4 rounded-lg border border-neutral-700 bg-neutral-900 p-4 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1 space-y-2"><h3 className="break-words text-sm font-semibold text-white">{source.title}</h3><p className="text-xs text-neutral-400">{source.indexer} · {bytes(source.size)} · S: {source.seeders ?? "Unknown"} · Leechers: {source.leechers ?? "Unknown"}{source.peers !== null && ` · Peers: ${source.peers}`}</p><div className="flex flex-wrap gap-2">{source.quality.map(hint => <span key={hint} className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300">{hint}</span>)}</div><p className="text-xs text-neutral-500">{source.match}</p></div>
        <Button className="shrink-0 border border-orange-500/40 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20" disabled={disabled} onClick={() => choose(source, resultIntent)}>Choose source</Button>
      </article>)}</div>
      <div className="flex flex-wrap items-center justify-center gap-3"><Button variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button><span className="text-xs text-neutral-400">Page {page} / {pages}</span><Button variant="outline" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</Button>{result.more && <Button variant="outline" disabled={task.busy} onClick={() => search(result.batch + 1)}>Next indexer batch</Button>}</div>
      <p className="text-xs text-neutral-500">Up to 50 results per indexer per batch. Pagination depends on each indexer. Source choices expire after 10 minutes.</p>
    </>}
    <details className="rounded-lg border border-neutral-700 bg-neutral-900 p-4"><summary className="cursor-pointer text-sm text-neutral-300">Have an authorized magnet link?</summary><form className="mt-4 space-y-3" onSubmit={e => { e.preventDefault(); choose(magnet.trim()); }}><p className="text-xs text-neutral-400">Paste a magnet for publisher-authorized or public-domain content. Only your chosen torrent is sent to TorrServer.</p><label htmlFor="manual-magnet" className="sr-only">Magnet link</label><Input id="manual-magnet" required maxLength={8192} value={magnet} onChange={e => setMagnet(e.target.value)} placeholder="magnet:?xt=urn:btih:…" className="border-neutral-600 bg-neutral-950" /><Button disabled={disabled || !magnet.startsWith("magnet:?")} variant="outline">Use magnet</Button></form></details>
  </div>;
}
