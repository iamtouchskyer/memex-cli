import matter from "gray-matter";

export interface ParsedCard {
  data: Record<string, unknown>;
  content: string;
}

export function parseFrontmatter(raw: string): ParsedCard {
  const { data, content } = matter(raw);
  return { data, content };
}

export function extractLinks(body: string): string[] {
  const re = /\[\[([^\]]+)\]\]/g;
  const links = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    links.add(match[1]);
  }
  return [...links];
}
