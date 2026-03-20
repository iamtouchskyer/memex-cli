# memex sync — Design Spec

## Goal

Add `memex sync` command for cross-device card synchronization, backed by git. Provide a SyncAdapter interface so future backends (CloudAdapter, S3, etc.) can be swapped in.

## Commands

| Command | Behavior |
|---------|----------|
| `memex sync --init <url>` | Init git repo in `~/.memex`, set remote to `<url>` |
| `memex sync --init` (no URL) | Use `gh repo create memex-cards --private`, auto-bind remote |
| `memex sync` | pull --rebase → add -A → commit → push |
| `memex sync --auto on` | Enable auto sync after write/archive |
| `memex sync --auto off` | Disable auto sync (default) |
| `memex sync --status` | Show sync state: remote, last sync time, auto on/off |

## Architecture

### Files

```
src/commands/sync.ts     — CLI entry, parse args, dispatch to adapter
src/lib/sync.ts          — SyncAdapter interface + GitAdapter implementation
~/.memex/.sync.json      — Config file (remote, adapter, auto)
```

### SyncAdapter Interface

```typescript
interface SyncResult {
  success: boolean;
  message: string;
}

interface SyncStatus {
  configured: boolean;
  remote?: string;
  adapter: string;
  auto: boolean;
  lastSync?: string; // ISO timestamp
}

interface SyncAdapter {
  init(remote?: string): Promise<void>;
  sync(): Promise<SyncResult>;
  status(): Promise<SyncStatus>;
}
```

### GitAdapter

Calls `child_process.execFile("git", [...])` directly. No git library dependency.

Key operations:
- `init()`: `git init`, `git remote add origin <url>`, initial commit + push
- `sync()`: `git add -A` → `git commit -m "memex sync <ISO timestamp>"` → `git pull --rebase` → `git push`
- `status()`: read `.sync.json`, check `git remote -v`

### Config: `~/.memex/.sync.json`

```json
{
  "remote": "git@github.com:user/memex-cards.git",
  "adapter": "git",
  "auto": false,
  "lastSync": "2026-03-20T17:00:00Z"
}
```

## Auto Sync

When `auto: true`:
- `memex write` and `memex archive` call `adapter.sync()` after their main operation
- SessionStart hook runs `memex sync` before `memex read index` (only when auto=on)

Auto sync failures write to stderr but never block the primary operation (write/archive).

## Conflict Strategy

`git pull --rebase`. On rebase conflict (extremely rare — cards are agent-written, near-zero chance of simultaneous edits to same card):
- `git rebase --abort`
- Report error to user with instructions to resolve manually

## Error Handling

| Scenario | Behavior |
|----------|----------|
| git not installed | Error: "git is required for sync. Install git first." |
| gh not installed (no URL given) | Error: "Provide a repo URL or install gh CLI." |
| Network unreachable | Error message, no blocking of local operations |
| Auto sync failure | stderr warning, write/archive still succeeds |
| Not initialized | Error: "Run `memex sync --init` first." |

## Out of Scope

- CloudAdapter / hosted sync service (future work)
- Incremental sync (git handles this natively)
- `.gitignore` management (sync everything in `~/.memex`)
- Encryption at rest (user's repo, user's responsibility)
