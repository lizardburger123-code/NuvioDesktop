// Builds the desktop web UI into ../resources/app-ui (committed, so CI needs no Node step).
//
//   node build.mjs            production bundle
//   node build.mjs --watch    rebuild on change
//
// Dependencies (react, react-dom, react-icons, esbuild) are resolved from NODE_PATH or a sibling
// node_modules; GSAP and the React Bits components are vendored in src/.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../resources/app-ui");
const watch = process.argv.includes("--watch");
const nodePaths = [
  ...(process.env.NODE_PATH ? process.env.NODE_PATH.split(":") : []),
  join(here, "node_modules"),
  "/opt/npm-tools/node_modules",
].filter(existsSync);

const require = createRequire(import.meta.url);
const resolveFrom = name => {
  for (const base of nodePaths) {
    try {
      return require.resolve(name, { paths: [base] });
    } catch {
      // next
    }
  }
  throw new Error(`Cannot resolve ${name}; set NODE_PATH`);
};

const { build, context } = require(resolveFrom("esbuild"));

const aliasPlugin = {
  name: "nuvio-alias",
  setup(b) {
    b.onResolve({ filter: /^gsap$/ }, () => ({ path: join(here, "src/lib/gsap.js") }));
    b.onResolve({ filter: /^gsap\/ScrollTrigger$/ }, () => ({ path: join(here, "src/lib/scrolltrigger.js") }));
    b.onResolve({ filter: /^(react|react-dom|react-dom\/client|react\/jsx-runtime|scheduler)$/ }, args => ({
      path: resolveFrom(args.path),
    }));
    // The ESM entry, so esbuild keeps only the icons actually used.
    b.onResolve({ filter: /^react-icons\// }, args => ({ path: resolveFrom(args.path).replace(/index\.js$/, "index.mjs") }));
    b.onResolve({ filter: /^react-icons$/ }, () => ({ path: resolveFrom("react-icons").replace(/index\.js$/, "index.mjs") }));
  },
};

const options = {
  entryPoints: { app: join(here, "src/main.jsx") },
  bundle: true,
  outdir: out,
  format: "iife",
  target: ["chrome120"],
  jsx: "automatic",
  minify: !watch && !process.env.NO_MINIFY,
  sourcemap: watch ? "inline" : false,
  legalComments: "none",
  define: { "process.env.NODE_ENV": watch ? '"development"' : '"production"' },
  loader: { ".js": "jsx", ".svg": "text" },
  nodePaths,
  external: ["fonts/*"],
  plugins: [aliasPlugin],
  logLevel: "info",
};

const copyStatic = () => {
  mkdirSync(out, { recursive: true });
  cpSync(join(here, "public"), out, { recursive: true });
  const html = readFileSync(join(here, "src/index.html"), "utf8").replace("__BUILD__", String(Date.now()));
  writeFileSync(join(out, "index.html"), html);
};

if (!watch) rmSync(out, { recursive: true, force: true });
copyStatic();
if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
  // The app installs the page from its resources using this index (files are not listable in a jar).
  const files = readdirSync(out, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath ?? entry.path, entry.name).slice(out.length + 1).split("\\").join("/"))
    .filter(name => name !== "files.txt")
    .sort();
  writeFileSync(join(out, "files.txt"), files.join("\n") + "\n");
}
