import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { MediaError } from "../media/core.ts";
import { MAX_FILE_BYTES } from "./model.ts";

let active = 0;
export async function powerpointPreview(name: string, bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  if (active >= 2) throw new MediaError("preview_busy", "Deux aperçus sont déjà en préparation. Réessaie dans un instant.", 429);
  active++;
  const directory = await mkdtemp(join(tmpdir(), "homelab-preview-")).catch(error => { active--; throw error; });
  try {
    const profile = join(directory, "profile"); await mkdir(profile);
    await writeFile(join(profile, "registrymodifications.xcu"), '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>');
    const input = join(directory, /\.pptx$/i.test(name) ? "presentation.pptx" : "presentation.ppt");
    await writeFile(input, bytes);
    await new Promise<void>((resolve, reject) => execFile(/* turbopackIgnore: true */ process.env.LIBRARY_SOFFICE_PATH || "soffice", [
      `-env:UserInstallation=${pathToFileURL(profile).href}`, "--headless", "--nologo", "--nodefault", "--nofirststartwizard", "--convert-to", "pdf", "--outdir", directory, input,
    ], { timeout: 90_000, maxBuffer: 128 * 1024 }, error => error ? reject(error) : resolve()));
    const pdf = await readFile(join(directory, "presentation.pdf"));
    if (!pdf.length || pdf.length > MAX_FILE_BYTES || !pdf.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new Error("Invalid preview");
    return new Uint8Array(pdf);
  } catch {
    throw new MediaError("preview", "L’aperçu PowerPoint est indisponible. Tu peux télécharger et ouvrir le fichier original.", 503);
  } finally { active--; await rm(directory, { recursive: true, force: true }); }
}
