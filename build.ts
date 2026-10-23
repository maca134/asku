// Builds the browser app into dist/: hashed assets with SRI, and a schema validator compiled at
// build time (Ajv's runtime codegen needs eval, which the CSP forbids).
import Ajv from "ajv/dist/2020";
import standalone from "ajv/dist/standalone";
import { rm } from "node:fs/promises";
import schema from "./schema.json";

const ajv = new Ajv({ code: { source: true, esm: true }, allErrors: true, allowUnionTypes: true });
ajv.addSchema(schema);
await Bun.write("web/gen/validate.js", standalone(ajv, { question: `${schema.$id}#/$defs/question` }));

await rm("dist", { recursive: true, force: true });
const out = await Bun.build({
  entrypoints: ["web/app.ts"],
  outdir: "dist/assets",
  naming: { entry: "[name]-[hash].[ext]", asset: "[name]-[hash].[ext]", chunk: "[name]-[hash].[ext]" },
  minify: true,
  target: "browser",
});
if (!out.success) throw new AggregateError(out.logs, "build failed");

const tags = await Promise.all(out.outputs.map(async (o) => {
  const src = `/assets/${o.path.split(/[\\/]/).pop()}`;
  const sri = `sha384-${new Bun.CryptoHasher("sha384").update(await o.arrayBuffer()).digest("base64")}`;
  if (o.path.endsWith(".js")) return `<script type="module" src="${src}" integrity="${sri}" crossorigin="anonymous"></script>`;
  if (o.path.endsWith(".css")) return `<link rel="stylesheet" href="${src}" integrity="${sri}" crossorigin="anonymous">`;
  throw new Error(`unexpected build output ${o.path}`);
}));
const html = (await Bun.file("web/index.html").text()).replace("<!--assets-->", tags.join("\n"));
await Bun.write("dist/index.html", html);
for (const [from, to] of [["skill/SKILL.md", "skill.md"], ["skill/ask.sh", "ask.sh"], ["skill/ask.ps1", "ask.ps1"], ["schema.json", "schema.json"]])
  await Bun.write(`dist/${to}`, Bun.file(from));
console.log(out.outputs.map((o) => `${o.path} ${o.size}`).join("\n"));
