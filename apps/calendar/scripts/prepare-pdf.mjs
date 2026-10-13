import {cp, mkdir} from "node:fs/promises";
const source = new URL("../node_modules/pdfjs-dist/", import.meta.url);
const target = new URL("../dist/vendor/pdfjs/", import.meta.url);
await mkdir(target, {recursive: true});
for (const name of ["build/pdf.min.mjs", "build/pdf.worker.min.mjs", "cmaps", "standard_fonts", "wasm", "LICENSE"]) {
  await cp(new URL(name, source), new URL(name.replace(/^build\//, ""), target), {recursive: true});
}
