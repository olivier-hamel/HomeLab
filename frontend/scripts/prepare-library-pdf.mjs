import { cp, mkdir } from 'node:fs/promises';
const source=new URL('../node_modules/pdfjs-dist/',import.meta.url);
const target=new URL('../public/library-pdf/',import.meta.url);
await mkdir(target,{recursive:true});
for(const folder of ['cmaps','standard_fonts','wasm'])await cp(new URL(folder,source),new URL(folder,target),{recursive:true});
