import { describe, it, expect } from "vitest";
import { parseFrontmatter, extractLinks } from "../../src/lib/parser.js";

describe("parseFrontmatter", () => {
  it("parses valid frontmatter with all fields", () => {
    const content = `---
title: Test Card
created: 2026-03-18
modified: 2026-03-18
source: retro
---

Body content here.`;

    const result = parseFrontmatter(content);
    expect(result.data.title).toBe("Test Card");
    expect(result.data.source).toBe("retro");
    expect(result.content).toContain("Body content here.");
  });

  it("returns empty data for content without frontmatter", () => {
    const result = parseFrontmatter("Just plain text.");
    expect(result.data).toEqual({});
    expect(result.content).toBe("Just plain text.");
  });
});

describe("extractLinks", () => {
  it("extracts wikilinks from content", () => {
    const content = "See [[stateless-auth]] and also [[redis-session-store]] for details.";
    const links = extractLinks(content);
    expect(links).toEqual(["stateless-auth", "redis-session-store"]);
  });

  it("returns empty array when no links", () => {
    const links = extractLinks("No links here.");
    expect(links).toEqual([]);
  });

  it("deduplicates links", () => {
    const content = "See [[foo]] and then [[foo]] again.";
    const links = extractLinks(content);
    expect(links).toEqual(["foo"]);
  });

  it("extracts links only from body, not frontmatter", () => {
    const content = `---
title: "About [[not-a-link]]"
---

Real link to [[actual-link]].`;

    const { content: body } = parseFrontmatter(content);
    const links = extractLinks(body);
    expect(links).toEqual(["actual-link"]);
  });
});
