// Empaqueta cada archivo de src/handlers en api/dist/<función>/index.mjs, que es lo que
// infra/template.yaml usa como CodeUri. Cada función lleva solo el código que importa.
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const handlersDir = path.join(apiDir, "src", "handlers");
const outDir = path.join(apiDir, "dist");

const handlers = (await readdir(handlersDir)).filter(
  (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
);

await rm(outDir, { recursive: true, force: true });

await Promise.all(
  handlers.map((file) =>
    build({
      entryPoints: [path.join(handlersDir, file)],
      outfile: path.join(outDir, path.basename(file, ".ts"), "index.mjs"),
      bundle: true,
      platform: "node",
      target: "node22",
      format: "esm",
      sourcemap: true,
      // El runtime nodejs22.x ya trae el AWS SDK v3.
      external: ["@aws-sdk/*"],
      // Permite empaquetar dependencias CommonJS que usan require dentro de un módulo ESM.
      banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
      logLevel: "warning",
    }),
  ),
);

console.log(`Funciones empaquetadas en api/dist: ${handlers.length}`);
