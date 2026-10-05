import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin.ts";

test("mockup discovery includes visible TSX files in stable order and skips private paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mockup-preview-test-"));
  const mockups = path.join(root, "src/components/mockups");
  const generated = path.join(root, "src/.generated/mockup-components.ts");
  await mkdir(path.join(mockups, "nested"), { recursive: true });
  await mkdir(path.join(mockups, "_internal"), { recursive: true });
  await mkdir(path.join(mockups, ".hidden"), { recursive: true });
  await Promise.all([
    writeFile(path.join(mockups, "zeta.tsx"), "export const Zeta = true;"),
    writeFile(path.join(mockups, "nested", "alpha.tsx"), "export const Alpha = true;"),
    writeFile(path.join(mockups, "_internal", "secret.tsx"), "export const Secret = true;"),
    writeFile(path.join(mockups, "_private.tsx"), "export const Private = true;"),
    writeFile(path.join(mockups, ".hidden", "hidden.tsx"), "export const Hidden = true;"),
    writeFile(path.join(mockups, "ignored.ts"), "export const Ignored = true;"),
  ]);

  try {
    const plugin = mockupPreviewPlugin() as unknown as {
      configResolved: (config: { root: string }) => void;
      buildStart: () => Promise<void>;
    };
    plugin.configResolved({ root });
    await plugin.buildStart();

    const source = await readFile(generated, "utf8");
    const alphaIndex = source.indexOf("./components/mockups/nested/alpha.tsx");
    const zetaIndex = source.indexOf("./components/mockups/zeta.tsx");
    assert.notEqual(alphaIndex, -1);
    assert.notEqual(zetaIndex, -1);
    assert.ok(alphaIndex < zetaIndex, "discovered imports should have stable sorted order");
    assert.doesNotMatch(source, /secret\.tsx|private\.tsx|hidden\.tsx|ignored\.ts/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
