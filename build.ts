// Builds the browser app into dist/: hashed assets with SRI, and a schema validator compiled at
// build time (Ajv's runtime codegen needs eval, which the CSP forbids).
// --watch: rebuild on ui/ changes, reload open pages, and run the relay, restarting it on api/ or shared/ changes.

import { watch } from "node:fs";
import { cp, rm } from "node:fs/promises";
import Ajv from "ajv/dist/2020";
import standalone from "ajv/dist/standalone";
import schema from "./schema.json";
import { ORIGIN, PAGES, type Page } from "./ui/site/pages";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const SHARE = {
  title: "asku: your agent has questions",
  description: "Answer an AI agent's questions in an end-to-end encrypted form.",
};

// Per-page head for crawlers and link previews. Pages without a path (sessions, not found) are kept out of search.
function head(p: Pick<Page, "title" | "description">, path?: string) {
  const url = path && ORIGIN + path;
  return [
    `<title>${esc(p.title)}</title>`,
    `<meta name="description" content="${esc(p.description)}">`,
    url ? `<link rel="canonical" href="${url}">` : `<meta name="robots" content="noindex">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="asku">`,
    `<meta property="og:title" content="${esc(p.title)}">`,
    `<meta property="og:description" content="${esc(p.description)}">`,
    url && `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${ORIGIN}/og.png">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="asku: your agent asks, you answer from anywhere">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    // JSON-LD is a data block, not a script, so the CSP doesn't block it
    path === "/" &&
      `<script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "asku",
        url: ORIGIN,
        description: p.description,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "macOS, Linux, Windows",
        license: "https://opensource.org/licenses/MIT",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        codeRepository: "https://github.com/maca134/asku",
      })}</script>`,
  ]
    .filter(Boolean)
    .join("\n");
}

// Static copy inside #app, so crawlers and unfurlers see the page; the app replaces it on boot.
function body(p: Page) {
  const links = Object.keys(PAGES)
    .map((href) => `<a href="${href}">${PAGES[href].nav}</a>`)
    .join(" · ");
  const faq = p.faq
    ? `<dl class="faq">${p.faq.map(([q, a]) => `<dt>${esc(q)}</dt><dd>${esc(a)}</dd>`).join("")}</dl>`
    : "";
  return `<main class="sec"><div class="wrap narrow sec-head"><h1>${esc(p.h1)}</h1><p class="lead">${esc(p.lead)}</p>${faq}<p>${links}</p></div></main>`;
}

async function build() {
  const ajv = new Ajv({ code: { source: true, esm: true }, allErrors: true, allowUnionTypes: true, $data: true });
  ajv.addSchema(schema);
  await Bun.write(
    "ui/gen/validate.js",
    standalone(ajv, {
      question: `${schema.$id}#/$defs/question`,
      say: `${schema.$id}#/$defs/say`,
      message: `${schema.$id}#/$defs/message`,
    }),
  );
  await Bun.write(
    "ui/gen/validate.d.ts",
    `import type { ErrorObject } from "ajv";
import type { Message, Question, Say } from "../types";
type Validator<T> = ((data: unknown) => data is T) & { errors?: ErrorObject[] | null };
export const question: Validator<Question>;
export const say: Validator<Say>;
export const message: Validator<Message>;
`,
  );

  await rm("dist", { recursive: true, force: true });
  const out = await Bun.build({
    entrypoints: ["ui/app.tsx"],
    outdir: "dist/assets",
    naming: { entry: "[name]-[hash].[ext]", asset: "[name]-[hash].[ext]", chunk: "[name]-[hash].[ext]" },
    minify: true,
    target: "browser",
  });
  if (!out.success) throw new AggregateError(out.logs, "build failed");
  // the service worker keeps a fixed name: it is registered by URL and its scope is the folder it's served from
  const worker = await Bun.build({
    entrypoints: ["ui/session/worker.ts"],
    outdir: "dist",
    naming: "sw.js",
    minify: true,
    target: "browser",
  });
  if (!worker.success) throw new AggregateError(worker.logs, "build failed");

  const tags = await Promise.all(
    out.outputs.map(async (o) => {
      const src = `/assets/${o.path.split(/[\\/]/).pop()}`;
      const sri = `sha384-${new Bun.CryptoHasher("sha384").update(await o.arrayBuffer()).digest("base64")}`;
      if (o.path.endsWith(".js"))
        return `<script type="module" src="${src}" integrity="${sri}" crossorigin="anonymous"></script>`;
      if (o.path.endsWith(".css"))
        return `<link rel="stylesheet" href="${src}" integrity="${sri}" crossorigin="anonymous">`;
      throw new Error(`unexpected build output ${o.path}`);
    }),
  );
  if (watching) {
    // live reload: index.html changes whenever an asset hash does
    await Bun.write(
      "dist/assets/reload.js",
      `let last;setInterval(async()=>{try{const r=await fetch("/",{cache:"no-store"});if(!r.ok)return;const t=await r.text();if(last&&t!==last)location.reload();last=t}catch{}},1000)`,
    );
    tags.push(`<script src="/assets/reload.js"></script>`);
  }
  const html = (await Bun.file("ui/index.html").text()).replace("<!--assets-->", tags.join("\n"));
  const page = (head: string, body: string) => html.replace("<!--head-->", head).replace("<!--body-->", body);
  for (const [path, p] of Object.entries(PAGES))
    await Bun.write(`dist/${path.slice(1) || "index"}.html`, page(head(p, path), body(p)));
  await Bun.write("dist/app.html", page(head(SHARE), `<p class="boot">Loading…</p>`));
  await Bun.write(
    "dist/sitemap.xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${Object.keys(
      PAGES,
    )
      .map((path) => `<url><loc>${ORIGIN}${path}</loc></url>`)
      .join("\n")}\n</urlset>\n`,
  );
  await cp("ui/static", "dist", { recursive: true });
  for (const [from, to] of [
    ["skill/SKILL.md", "skill.md"],
    ["skill/ask.sh", "ask.sh"],
    ["skill/ask.ps1", "ask.ps1"],
    ["schema.json", "schema.json"],
  ])
    await Bun.write(`dist/${to}`, Bun.file(from));
  console.log(out.outputs.map((o) => `${o.path} ${o.size}`).join("\n"));
}

const watching = process.argv.includes("--watch");
await build();
if (watching) {
  Bun.spawn(["bun", "--watch", "api/relay.ts"], { stdio: ["inherit", "inherit", "inherit"] });
  let timer: Timer | undefined;
  // ponytail: skill/ and schema.json edits still need a restart of the dev script; watch them too if that bites.
  watch("ui", { recursive: true }, (_, file) => {
    if (!file || /^gen[\\/]/.test(file)) return; // build writes ui/gen, don't loop on it
    clearTimeout(timer);
    timer = setTimeout(() => build().catch((e) => console.error(e)), 100);
  });
}
