import {createServer} from "node:http";
import {readFile, stat} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root = fileURLToPath(new URL("../dist/", import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml"};
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, {Allow: "GET, HEAD"});
      response.end("Method not allowed");
      return;
    }
    if (pathname === "/healthz") {
      response.writeHead(200, {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"});
      response.end(request.method === "HEAD" ? undefined : "ok");
      return;
    }
    const file = path.resolve(root, "." + pathname, pathname.endsWith("/") ? "index.html" : "");
    if (!file.startsWith(root) || !(await stat(file)).isFile()) throw new Error("Not found");
    const body = request.method === "HEAD" ? undefined : await readFile(file);
    response.writeHead(200, {"Content-Type": (types[path.extname(file)] || "application/octet-stream") + "; charset=utf-8", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"});
    response.end(body);
  } catch {response.writeHead(404); response.end("Not found");}
}).listen(port, "0.0.0.0", () => console.log(`Tempo est prêt. Adresse locale : http://localhost:${port}`));
