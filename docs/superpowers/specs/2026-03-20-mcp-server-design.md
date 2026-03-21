# MCP Server for memex-cli

## Summary

Add `memex mcp` subcommand that starts a stdio-based MCP server, exposing all existing CLI commands as MCP tools. This enables any MCP-compatible client (Cursor, VS Code/Copilot, Windsurf, Codex, etc.) to use memex as an agent memory system.

## Architecture

```
Client (Cursor/Copilot/Windsurf/Codex)
  ↕ stdio (JSON-RPC)
MCP Server (src/mcp/server.ts)
  ↓ direct function calls
Command functions (searchCommand, readCommand, writeCommand, linksCommand, archiveCommand)
  ↓
CardStore (filesystem: ~/.memex/cards/)
```

The MCP server is a thin adapter over existing command functions. No business logic duplication.

**Return value mapping**: Command functions have varying return types. The MCP server maps them uniformly:
- `searchCommand` / `linksCommand` → use `result.output` as text content
- `readCommand` → use `result.content` on success, MCP error on failure
- `writeCommand` / `archiveCommand` → confirmation message on success, MCP error on failure

Errors are returned as MCP tool error responses (`isError: true`), not thrown exceptions.

**stdio constraint**: MCP uses stdio for JSON-RPC transport. Command functions are safe (they return data structures, not write to stdout). The MCP server must not write anything to stdout/stderr outside the JSON-RPC protocol.

## MCP Tools (1:1 CLI mapping)

### memex_search

- **Description**: Search Zettelkasten memory cards by keyword, or list all cards if no query. Use at the start of a task to recall relevant prior knowledge. Follow [[wikilinks]] in results by calling memex_read.
- **Input**: `{ query?: string, limit?: number }`
- **Output**: Card list with slugs, titles, and snippets

### memex_read

- **Description**: Read a card's full content including frontmatter and body. Use after memex_search to get full context. Follow [[wikilinks]] to traverse related knowledge.
- **Input**: `{ slug: string }`
- **Output**: Full card content (YAML frontmatter + markdown body)

### memex_write

- **Description**: Write or update a Zettelkasten card. Use after completing a task to save non-obvious insights. Content must include YAML frontmatter with title, created, and source fields.
- **Input**: `{ slug: string, content: string }`
- **Output**: Success/error message

### memex_links

- **Description**: Show link graph statistics for all cards, or inbound/outbound links for a specific card. Useful for understanding card connectivity and finding orphans.
- **Input**: `{ slug?: string }`
- **Output**: Link stats or per-card link details

### memex_archive

- **Description**: Move a card to the archive. Use for outdated or superseded cards.
- **Input**: `{ slug: string }`
- **Output**: Success/error message

## File Changes

| File | Change |
|------|--------|
| `src/mcp/server.ts` | **New** — MCP server implementation |
| `src/cli.ts` | **Modify** — add `memex mcp` subcommand |
| `package.json` | **Modify** — add `@modelcontextprotocol/sdk` dependency |
| `tests/mcp/server.test.ts` | **New** — MCP server tests |

## Dependencies

- `@modelcontextprotocol/sdk` — official MCP TypeScript SDK (stdio transport)

## Configuration (client-side)

Users configure their MCP client to start memex:

```json
{
  "mcpServers": {
    "memex": {
      "command": "memex",
      "args": ["mcp"]
    }
  }
}
```

Or via npx for users who haven't installed globally:

```json
{
  "mcpServers": {
    "memex": {
      "command": "npx",
      "args": ["@touchskyer/memex", "mcp"]
    }
  }
}
```

Custom data directory via `MEMEX_HOME` environment variable (default: `~/.memex`):

```json
{
  "mcpServers": {
    "memex": {
      "command": "memex",
      "args": ["mcp"],
      "env": { "MEMEX_HOME": "/custom/path" }
    }
  }
}
```

## What This Does NOT Change

- Existing CLI commands — untouched
- Claude Code plugin (hooks/skills) — continues to work via CLI
- CardStore / parser / formatter — no changes
- Data format (markdown + YAML frontmatter + wikilinks) — no changes

## Trade-offs

- **Tool descriptions carry workflow hints** (e.g., "use at start of task") but cannot replicate the full skill prompt richness. For best experience, pair MCP with client-side instruction files (AGENTS.md, .cursor/rules, etc.).
- **No SessionStart equivalent** in MCP — the LLM won't automatically see the index on session start. It must proactively call memex_search or memex_read to discover context.
