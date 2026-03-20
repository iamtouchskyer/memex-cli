import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { serveCommand } from "../../src/commands/serve.js";

function get(url: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
      res.on("error", reject);
    }).on("error", reject);
  });
}

describe("serve API", () => {
  let tmpDir: string;
  let port: number;
  let baseUrl: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-serve-test-"));
    const cardsDir = join(tmpDir, "cards");
    await mkdir(cardsDir, { recursive: true });

    await writeFile(
      join(cardsDir, "test-card.md"),
      "---\ntitle: Test Card\ncreated: 2025-01-15\nsource: retro\n---\nThis is a test card with [[linked-card]]."
    );
    await writeFile(
      join(cardsDir, "linked-card.md"),
      "---\ntitle: Linked Card\ncreated: 2025-01-14\nsource: manual\n---\nThis card is linked from test-card."
    );

    process.env.MEMEX_HOME = tmpDir;
    process.env.MEMEX_NO_OPEN = "1";

    port = 10000 + Math.floor(Math.random() * 50000);
    baseUrl = `http://localhost:${port}`;

    serveCommand(port);

    // Wait for server to start
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
  }, 10000);

  afterAll(async () => {
    delete process.env.MEMEX_HOME;
    delete process.env.MEMEX_NO_OPEN;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("GET / returns HTML", async () => {
    const res = await get(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<!DOCTYPE html>");
    expect(res.body).toContain("memex");
  });

  it("GET /api/cards returns all cards", async () => {
    const res = await get(`${baseUrl}/api/cards`);
    expect(res.status).toBe(200);
    const cards = JSON.parse(res.body);
    expect(cards).toHaveLength(2);
    const slugs = cards.map((c: any) => c.slug).sort();
    expect(slugs).toEqual(["linked-card", "test-card"]);
  });

  it("GET /api/cards/:slug returns card content", async () => {
    const res = await get(`${baseUrl}/api/cards/test-card`);
    expect(res.status).toBe(200);
    expect(res.body).toContain("Test Card");
    expect(res.body).toContain("[[linked-card]]");
  });

  it("GET /api/cards/nonexistent returns 404", async () => {
    const res = await get(`${baseUrl}/api/cards/nonexistent`);
    expect(res.status).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("Not found");
  });

  it("GET /api/links returns link stats", async () => {
    const res = await get(`${baseUrl}/api/links`);
    expect(res.status).toBe(200);
    const stats = JSON.parse(res.body);
    expect(stats).toHaveLength(2);
    const testCard = stats.find((s: any) => s.slug === "test-card");
    expect(testCard.outbound).toBe(1);
  });

  it("GET /api/search?q=test returns filtered results", async () => {
    const res = await get(`${baseUrl}/api/search?q=test`);
    expect(res.status).toBe(200);
    const results = JSON.parse(res.body);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r: any) => r.slug === "test-card")).toBe(true);
  });

  it("GET /unknown returns 404", async () => {
    const res = await get(`${baseUrl}/unknown`);
    expect(res.status).toBe(404);
  });
});
