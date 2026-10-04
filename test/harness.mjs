// 业务规则冒烟测试：用 esbuild 注入 $app/environment 的 browser=true 垫片
import { build } from "esbuild";
import { randomUUID } from "node:crypto";

// 浏览器 API 垫片（store 是前端 localStorage store）
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};
if (!globalThis.crypto) globalThis.crypto = { randomUUID };
else if (!globalThis.crypto.randomUUID) globalThis.crypto.randomUUID = randomUUID;
if (!globalThis.structuredClone) globalThis.structuredClone = (v) => JSON.parse(JSON.stringify(v));

const shimPlugin = {
  name: "shim",
  setup(b) {
    b.onResolve({ filter: /^\$app\/environment$/ }, () => ({ path: "env-shim", namespace: "shim" }));
    b.onLoad({ filter: /.*/, namespace: "shim" }, () => ({ contents: `export const browser = true;`, loader: "js" }));
  }
};

const result = await build({
  entryPoints: ["test/smoke.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  plugins: [shimPlugin]
});

const code = result.outputFiles[0].text;
const mod = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
await mod.run().catch((err) => { console.error(err); process.exit(1); });
