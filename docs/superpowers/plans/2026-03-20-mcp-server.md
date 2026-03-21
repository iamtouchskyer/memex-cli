# MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `memex mcp` subcommand that starts a stdio MCP server exposing all 5 CLI commands as MCP tools.

**Architecture:** Thin MCP adapter layer over existing command functions. Single new file `src/mcp/server.ts` handles tool registration and dispatch. CLI entry point gets one new subcommand.

**Tech Stack:** `@modelcontextprotocol/sdk` (stdio transport), existing CardStore + command functions

**Spec:** `docs/superpowers/specs/2026-03-20-mcp-server-design.md`

---

## File Structure

| File | Role |
|------|------|
| `src/mcp/server.ts` | **Create** — MCP server: tool definitions, request handler, startup |
| `src/cli.ts` | **Modify** — add `memex mcp` subcommand |
| `package.json` | **Modify** — add `@modelcontextprotocol/sdk` dependency |
| `tests/mcp/server.test.ts` | **Create** — tests using MCP SDK in-memory transport |

---

### Task 1: Add MCP SDK dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install dependency**

```bash
cd /Users/touchskyer/Code/memex-cli
npm install @modelcontextprotocol/sdk zod
```

- [ ] **Step 2: Verify install**

```bash
node -e "import('@modelcontextprotocol/sdk/server/index.js').then(() => console.log('ok'))"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @modelcontextprotocol/sdk and zod dependencies"
```

---

### Task 2: Implement MCP server

**Files:**
- Create: `src/mcp/server.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/mcp/server.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMemexServer } from "../../src/mcp/server.js";
import { CardStore } from "../../src/lib/store.js";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;
let store: CardStore;
let client: Client;

async function setup(cards: Record<string, string> = {}) {
  tmpDir = await mkdtemp(join(tmpdir(), "memex-mcp-"));
  const cardsDir = join(tmpDir, "cards");
  const archiveDir = join(tmpDir, "archive");
  await mkdir(cardsDir, { recursive: true });
  await mkdir(archiveDir, { recursive: true });

  for (const [slug, content] of Object.entries(cards)) {
    await writeFile(join(cardsDir, `${slug}.md`), content);
  }

  store = new CardStore(cardsDir, archiveDir);
  const server = createMemexServer(store);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
}

async function teardown() {
  await client.close();
  await rm(tmpDir, { recursive: true });
}

describe("MCP server", () => {
  afterEach(teardown);

  it("lists all 5 tools", async () => {
    await setup();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["memex_archive", "memex_links", "memex_read", "memex_search", "memex_write"]);
  });

  it("memex_search lists all cards when no query", async () => {
    await setup({
      "test-card": "---\ntitle: Test Card\ncreated: 2026-01-01\nsource: retro\n---\nHello world",
    });
    const result = await client.callTool({ name: "memex_search", arguments: {} });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("test-card");
    expect(text).toContain("Test Card");
  });

  it("memex_search with query finds matching cards", async () => {
    await setup({
      "alpha": "---\ntitle: Alpha\ncreated: 2026-01-01\nsource: retro\n---\nThis is about authentication",
      "beta": "---\ntitle: Beta\ncreated: 2026-01-01\nsource: retro\n---\nThis is about databases",
    });
    const result = await client.callTool({ name: "memex_search", arguments: { query: "authentication" } });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("alpha");
    expect(text).not.toContain("beta");
  });

  it("memex_read returns card content", async () => {
    await setup({
      "my-card": "---\ntitle: My Card\ncreated: 2026-01-01\nsource: retro\n---\nCard body here",
    });
    const result = await client.callTool({ name: "memex_read", arguments: { slug: "my-card" } });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("My Card");
    expect(text).toContain("Card body here");
  });

  it("memex_read returns error for missing card", async () => {
    await setup();
    const result = await client.callTool({ name: "memex_read", arguments: { slug: "nonexistent" } });
    expect(result.isError).toBe(true);
  });

  it("memex_write creates a new card", async () => {
    await setup();
    const content = "---\ntitle: New Card\ncreated: 2026-01-01\nsource: retro\n---\nNew content";
    const writeResult = await client.callTool({ name: "memex_write", arguments: { slug: "new-card", content } });
    expect(writeResult.isError).toBeFalsy();

    const readResult = await client.callTool({ name: "memex_read", arguments: { slug: "new-card" } });
    const text = (readResult.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("New Card");
  });

  it("memex_write returns error for invalid frontmatter", async () => {
    await setup();
    const result = await client.callTool({ name: "memex_write", arguments: { slug: "bad", content: "no frontmatter" } });
    expect(result.isError).toBe(true);
  });

  it("memex_links returns graph stats", async () => {
    await setup({
      "a": "---\ntitle: A\ncreated: 2026-01-01\nsource: retro\n---\nSee [[b]]",
      "b": "---\ntitle: B\ncreated: 2026-01-01\nsource: retro\n---\nStandalone",
    });
    const result = await client.callTool({ name: "memex_links", arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("a");
    expect(text).toContain("b");
  });

  it("memex_archive moves card", async () => {
    await setup({
      "old-card": "---\ntitle: Old\ncreated: 2026-01-01\nsource: retro\n---\nOld content",
    });
    const archiveResult = await client.callTool({ name: "memex_archive", arguments: { slug: "old-card" } });
    expect(archiveResult.isError).toBeFalsy();

    const readResult = await client.callTool({ name: "memex_read", arguments: { slug: "old-card" } });
    expect(readResult.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/mcp/server.test.ts
```

Expected: FAIL — `createMemexServer` does not exist

- [ ] **Step 3: Implement MCP server**

Create `src/mcp/server.ts`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CardStore } from "../lib/store.js";
import { searchCommand } from "../commands/search.js";
import { readCommand } from "../commands/read.js";
import { writeCommand } from "../commands/write.js";
import { linksCommand } from "../commands/links.js";
import { archiveCommand } from "../commands/archive.js";
import { z } from "zod";

export function createMemexServer(store: CardStore): McpServer {
  const server = new McpServer({
    name: "memex",
    version: "0.1.2",
  });

  server.registerTool("memex_search", {
    description: "Search Zettelkasten memory cards by keyword, or list all cards if no query. Use at the start of a task to recall relevant prior knowledge. Follow [[wikilinks]] in results by calling memex_read.",
    inputSchema: z.object({
      query: z.string().optional().describe("Search keyword. Omit to list all cards."),
      limit: z.number().optional().describe("Max results (default 10)"),
    }),
  }, async ({ query, limit }) => {
    const result = await searchCommand(store, query, { limit });
    return { content: [{ type: "text" as const, text: result.output || "No cards found." }] };
  });

  server.registerTool("memex_read", {
    description: "Read a card's full content including frontmatter and body. Use after memex_search to get full context. Follow [[wikilinks]] to traverse related knowledge.",
    inputSchema: z.object({
      slug: z.string().describe("Card slug (e.g. 'my-card-name')"),
    }),
  }, async ({ slug }) => {
    const result = await readCommand(store, slug);
    if (!result.success) {
      return { content: [{ type: "text" as const, text: result.error! }], isError: true };
    }
    return { content: [{ type: "text" as const, text: result.content! }] };
  });

  server.registerTool("memex_write", {
    description: "Write or update a Zettelkasten card. Use after completing a task to save non-obvious insights. Content must include YAML frontmatter with title, created, and source fields, followed by markdown body with [[wikilinks]].",
    inputSchema: z.object({
      slug: z.string().describe("Card slug in kebab-case (e.g. 'my-insight')"),
      content: z.string().describe("Full card content: YAML frontmatter + markdown body"),
    }),
  }, async ({ slug, content }) => {
    const result = await writeCommand(store, slug, content);
    if (!result.success) {
      return { content: [{ type: "text" as const, text: result.error! }], isError: true };
    }
    return { content: [{ type: "text" as const, text: `Card '${slug}' written successfully.` }] };
  });

  server.registerTool("memex_links", {
    description: "Show link graph statistics for all cards, or inbound/outbound links for a specific card. Useful for understanding card connectivity and finding orphans.",
    inputSchema: z.object({
      slug: z.string().optional().describe("Card slug. Omit for global stats."),
    }),
  }, async ({ slug }) => {
    const result = await linksCommand(store, slug);
    return { content: [{ type: "text" as const, text: result.output || "No cards found." }] };
  });

  server.registerTool("memex_archive", {
    description: "Move a card to the archive. Use for outdated or superseded cards.",
    inputSchema: z.object({
      slug: z.string().describe("Card slug to archive"),
    }),
  }, async ({ slug }) => {
    const result = await archiveCommand(store, slug);
    if (!result.success) {
      return { content: [{ type: "text" as const, text: result.error! }], isError: true };
    }
    return { content: [{ type: "text" as const, text: `Card '${slug}' archived.` }] };
  });

  return server;
}

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/mcp/server.test.ts
```

Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts tests/mcp/server.test.ts
git commit -m "feat: add MCP server with 5 tools (search/read/write/links/archive)"
```

---

### Task 3: Add `memex mcp` CLI subcommand

**Files:**
- Modify: `src/cli.ts:89-97` (add before `program.parse()`)

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/cli.test.ts` (or create a focused test):

Create `tests/mcp/cli-entry.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

describe("memex mcp subcommand", () => {
  it("memex mcp --help shows MCP description", async () => {
    const { stdout } = await exec("node", ["dist/cli.js", "mcp", "--help"]);
    expect(stdout).toContain("MCP");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build && npx vitest run tests/mcp/cli-entry.test.ts
```

Expected: FAIL — `mcp` command not recognized

- [ ] **Step 3: Add mcp subcommand to cli.ts**

Add before `program.parse()` in `src/cli.ts`:

```typescript
program
  .command("mcp")
  .description("Start MCP server (stdio transport)")
  .action(async () => {
    const { createMemexServer } = await import("./mcp/server.js");
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    const store = getStore();
    const server = createMemexServer(store);
    const transport = new StdioServerTransport();
    await server.connect(transport);
  });
```

> Dynamic imports ensure MCP SDK is only loaded when `memex mcp` is invoked — no startup penalty for other commands.

- [ ] **Step 4: Build and run tests**

```bash
npm run build && npx vitest run
```

Expected: ALL tests pass (existing 51 + new MCP tests)

- [ ] **Step 5: Smoke test manually**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | node dist/cli.js mcp
```

Expected: JSON response with server info

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts tests/mcp/cli-entry.test.ts
git commit -m "feat: add 'memex mcp' subcommand for stdio MCP server"
```

---

### Task 4: Full regression + final commit

- [ ] **Step 1: Run full test suite**

```bash
npm run build && npm test
```

Expected: ALL tests pass, no regressions

- [ ] **Step 2: Verify existing CLI commands still work**

```bash
memex search
memex read index
memex links
```

Expected: Same output as before

- [ ] **Step 3: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "chore: fixups from MCP server integration"
```
