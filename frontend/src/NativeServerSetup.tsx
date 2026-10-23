import { useEffect, useState, type FormEvent } from "react";
import { saveNativeServer } from "./native";

export default function NativeServerSetup() {
  const [value, setValue] = useState("https://192.168.1.50:3443");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const failed = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message;
      setError(message || "Could not open HomeLab. Check the server address and try again.");
      setBusy(false);
    };
    window.addEventListener("homelab:server-error", failed);
    return () => window.removeEventListener("homelab:server-error", failed);
  }, []);

  useEffect(() => {
    if (!busy) return;
    const timeout = window.setTimeout(() => {
      setError("Could not open HomeLab. Check the server address, network connection, and HTTPS certificate, then try again.");
      setBusy(false);
    }, 15_000);
    return () => window.clearTimeout(timeout);
  }, [busy]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      await saveNativeServer(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enter a valid HomeLab address.");
      setBusy(false);
    }
  };

  return <main className="flex min-h-screen items-center justify-center bg-neutral-950 p-8 text-white">
    <form onSubmit={submit} aria-busy={busy} className="w-full max-w-2xl space-y-6 rounded-2xl border border-neutral-700 bg-neutral-900 p-8">
      <div className="space-y-2">
        <p className="text-sm tracking-[0.2em] text-orange-400">HOMELAB TV</p>
        <p className="text-sm text-orange-300">BUILD 2026.10.14-connect-1</p>
        <h1 className="text-3xl font-semibold">Connect to your server</h1>
        <p className="leading-relaxed text-neutral-300">Enter the same dashboard address that works in a browser on your home network or tailnet.</p>
      </div>
      <label className="block space-y-2 text-lg">
        <span>HomeLab address</span>
        <input autoFocus value={value} disabled={busy} onChange={event => setValue(event.target.value)} inputMode="url" spellCheck={false} className="h-16 w-full rounded-lg border border-neutral-600 bg-neutral-950 px-4 text-xl outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-500/30" />
      </label>
      {error && <p role="alert" className="text-orange-300">{error}</p>}
      <button type="submit" disabled={busy} className="h-16 w-full rounded-lg bg-orange-600 px-6 text-xl font-semibold hover:bg-orange-500 focus:outline-none focus:ring-4 focus:ring-orange-400 disabled:opacity-60">{busy ? "Connecting…" : "Connect"}</button>
      <p className="text-sm text-neutral-400">Use the HomeLab HTTPS address and trust its certificate on this Fire TV, as for Mémo.</p>
    </form>
  </main>;
}
