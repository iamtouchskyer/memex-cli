import { CardStore } from "../lib/store.js";
import { autoSync } from "../lib/sync.js";
import { dirname } from "node:path";

interface ArchiveResult {
  success: boolean;
  error?: string;
}

export async function archiveCommand(store: CardStore, slug: string): Promise<ArchiveResult> {
  try {
    await store.archiveCard(slug);
    await autoSync(dirname(store.cardsDir));
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
