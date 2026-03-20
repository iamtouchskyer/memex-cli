import { parseFrontmatter } from "../lib/parser.js";
import { CardStore } from "../lib/store.js";
import matter from "gray-matter";

const REQUIRED_FIELDS = ["title", "created", "source"];

interface WriteResult {
  success: boolean;
  error?: string;
}

export async function writeCommand(store: CardStore, slug: string, input: string): Promise<WriteResult> {
  const { data, content } = parseFrontmatter(input);

  const missing = REQUIRED_FIELDS.filter((f) => !(f in data));
  if (missing.length > 0) {
    return { success: false, error: `Missing required fields: ${missing.join(", ")}` };
  }

  // Normalize all date fields to YYYY-MM-DD strings
  const today = new Date().toISOString().split("T")[0];
  data.modified = today;
  if (data.created instanceof Date) {
    data.created = data.created.toISOString().split("T")[0];
  }

  const output = matter.stringify(content, data);
  await store.writeCard(slug, output);
  return { success: true };
}
