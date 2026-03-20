import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

// ---- Types ----

export interface SyncConfig {
  remote?: string;
  adapter: string;
  auto: boolean;
  lastSync?: string;
}

export interface SyncResult {
  success: boolean;
  message: string;
}

export interface SyncStatus {
  configured: boolean;
  remote?: string;
  adapter: string;
  auto: boolean;
  lastSync?: string;
}

export interface SyncAdapter {
  init(remote?: string): Promise<void>;
  sync(): Promise<SyncResult>;
  status(): Promise<SyncStatus>;
}

// ---- Config ----

const CONFIG_FILE = ".sync.json";

export async function readSyncConfig(home: string): Promise<SyncConfig> {
  try {
    const raw = await readFile(join(home, CONFIG_FILE), "utf-8");
    return JSON.parse(raw);
  } catch {
    return { adapter: "git", auto: false };
  }
}

export async function writeSyncConfig(
  home: string,
  config: SyncConfig
): Promise<void> {
  await mkdir(home, { recursive: true });
  await writeFile(
    join(home, CONFIG_FILE),
    JSON.stringify(config, null, 2),
    "utf-8"
  );
}

// ---- Git helpers ----

async function gitAvailable(): Promise<boolean> {
  try {
    await execFile("git", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function ghAvailable(): Promise<boolean> {
  try {
    await execFile("gh", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

// ---- GitAdapter ----

export class GitAdapter implements SyncAdapter {
  constructor(private home: string) {}

  async init(remote?: string): Promise<void> {
    if (!(await gitAvailable())) {
      throw new Error("git is required for sync. Install git first.");
    }

    let url = remote;

    if (!url) {
      if (!(await ghAvailable())) {
        throw new Error(
          "Provide a repo URL or install gh CLI (https://cli.github.com)."
        );
      }
      const { stdout } = await execFile("gh", [
        "repo",
        "create",
        "memex-cards",
        "--private",
      ]);
      url = stdout.trim();
    }

    // Init git repo if not already
    try {
      await execFile("git", ["-C", this.home, "rev-parse", "--git-dir"]);
    } catch {
      await execFile("git", ["init", this.home]);
    }

    // Set remote
    try {
      await execFile("git", ["-C", this.home, "remote", "add", "origin", url]);
    } catch {
      await execFile("git", [
        "-C",
        this.home,
        "remote",
        "set-url",
        "origin",
        url,
      ]);
    }

    // Initial commit and push
    await execFile("git", ["-C", this.home, "add", "-A"]);
    try {
      await execFile("git", [
        "-C",
        this.home,
        "commit",
        "-m",
        "memex: initial sync",
      ]);
    } catch {
      // Nothing to commit is OK
    }
    await execFile("git", ["-C", this.home, "push", "-u", "origin", "HEAD"]);

    await writeSyncConfig(this.home, {
      remote: url,
      adapter: "git",
      auto: false,
    });
  }

  async sync(): Promise<SyncResult> {
    const config = await readSyncConfig(this.home);
    if (!config.remote) {
      return {
        success: false,
        message: "Not initialized. Run `memex sync --init` first.",
      };
    }

    // Stage all changes
    await execFile("git", ["-C", this.home, "add", "-A"]);

    // Commit if there are changes
    try {
      const ts = new Date().toISOString();
      await execFile("git", [
        "-C",
        this.home,
        "commit",
        "-m",
        `memex sync ${ts}`,
      ]);
    } catch {
      // Nothing to commit — that's fine
    }

    // Pull rebase
    try {
      await execFile("git", [
        "-C",
        this.home,
        "pull",
        "--rebase",
        "origin",
        "HEAD",
      ]);
    } catch {
      // Rebase conflict — abort and report
      try {
        await execFile("git", ["-C", this.home, "rebase", "--abort"]);
      } catch {
        /* ignore */
      }
      return {
        success: false,
        message: "Rebase conflict. Resolve manually in " + this.home,
      };
    }

    // Push
    await execFile("git", ["-C", this.home, "push", "origin", "HEAD"]);

    config.lastSync = new Date().toISOString();
    await writeSyncConfig(this.home, config);

    return { success: true, message: "Synced." };
  }

  async status(): Promise<SyncStatus> {
    const config = await readSyncConfig(this.home);
    return {
      configured: !!config.remote,
      remote: config.remote,
      adapter: config.adapter,
      auto: config.auto,
      lastSync: config.lastSync,
    };
  }
}

// ---- Auto-sync helper ----

export async function autoSync(home: string): Promise<void> {
  const config = await readSyncConfig(home);
  if (!config.auto || !config.remote) return;
  try {
    const adapter = new GitAdapter(home);
    await adapter.sync();
  } catch (err) {
    process.stderr.write(`sync warning: ${(err as Error).message}\n`);
  }
}
