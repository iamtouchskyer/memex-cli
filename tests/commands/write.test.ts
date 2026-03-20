import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeCommand } from "../../src/commands/write.js";
import { CardStore } from "../../src/lib/store.js";
import { parseFrontmatter } from "../../src/lib/parser.js";

describe("writeCommand", () => {
  let tmpDir: string;
  let store: CardStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-test-"));
    store = new CardStore(join(tmpDir, "cards"), join(tmpDir, "archive"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes a valid card", async () => {
    const input = `---
title: Test Card
created: 2026-03-18
source: retro
---

Body here.`;

    const result = await writeCommand(store, "test-card", input);
    expect(result.success).toBe(true);

    const written = await readFile(join(tmpDir, "cards", "test-card.md"), "utf-8");
    expect(written).toContain("title: Test Card");
    expect(written).toContain("modified:");
  });

  it("rejects card missing required frontmatter", async () => {
    const input = `---
title: Missing Source
---

Body.`;

    const result = await writeCommand(store, "bad-card", input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("created");
  });

  it("auto-sets modified date", async () => {
    const input = `---
title: Test
created: 2026-03-18
source: manual
---

Body.`;

    await writeCommand(store, "test", input);
    const written = await readFile(join(tmpDir, "cards", "test.md"), "utf-8");
    const { data } = parseFrontmatter(written);
    const today = new Date().toISOString().split("T")[0];
    expect(String(data.modified).startsWith(today)).toBe(true);
  });

  it("normalizes created date to YYYY-MM-DD string", async () => {
    const input = `---
title: Date Test
created: 2026-03-18
source: retro
---

Body.`;

    await writeCommand(store, "date-test", input);
    const written = await readFile(join(tmpDir, "cards", "date-test.md"), "utf-8");
    // Should NOT contain ISO datetime format
    expect(written).not.toContain("2026-03-18T00:00:00.000Z");
    // Should contain clean YYYY-MM-DD
    expect(written).toContain("created: '2026-03-18'");
  });
});
