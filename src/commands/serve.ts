import { createServer } from "node:http";
import { join } from "node:path";
import { homedir } from "node:os";
import { CardStore } from "../lib/store.js";
import { parseFrontmatter, extractLinks } from "../lib/parser.js";

export async function serveCommand(port: number): Promise<void> {
  const home = process.env.MEMEX_HOME || join(homedir(), ".memex");
  const store = new CardStore(join(home, "cards"), join(home, "archive"));

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://localhost:${port}`);

      if (url.pathname === "/api/cards") {
        const cards = await store.scanAll();
        const result = await Promise.all(
          cards.map(async (c) => {
            const raw = await store.readCard(c.slug);
            const { data, content } = parseFrontmatter(raw);
            const links = extractLinks(content);
            const firstLine = content.trim().split("\n")[0]?.trim() || "";
            return {
              slug: c.slug,
              title: String(data.title || c.slug),
              created: String(data.created || ""),
              modified: String(data.modified || ""),
              source: String(data.source || ""),
              firstLine,
              links,
            };
          })
        );
        result.sort((a, b) => b.created.localeCompare(a.created));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return;
      }

      if (url.pathname.startsWith("/api/cards/")) {
        const slug = decodeURIComponent(url.pathname.slice("/api/cards/".length));
        try {
          const raw = await store.readCard(slug);
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(raw);
        } catch {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
        }
        return;
      }

      if (url.pathname === "/api/links") {
        const cards = await store.scanAll();
        const outMap = new Map<string, string[]>();
        const inMap = new Map<string, string[]>();
        for (const c of cards) inMap.set(c.slug, []);
        for (const c of cards) {
          const raw = await store.readCard(c.slug);
          const { content } = parseFrontmatter(raw);
          const links = extractLinks(content);
          outMap.set(c.slug, links);
          for (const l of links) {
            const arr = inMap.get(l) || [];
            arr.push(c.slug);
            inMap.set(l, arr);
          }
        }
        const stats = cards.map((c) => ({
          slug: c.slug,
          outbound: (outMap.get(c.slug) || []).length,
          inbound: (inMap.get(c.slug) || []).length,
        }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(stats));
        return;
      }

      if (url.pathname === "/api/search") {
        const q = (url.searchParams.get("q") || "").toLowerCase();
        const cards = await store.scanAll();
        const results = [];
        for (const c of cards) {
          const raw = await store.readCard(c.slug);
          const { data, content } = parseFrontmatter(raw);
          const title = String(data.title || c.slug);
          if (
            title.toLowerCase().includes(q) ||
            content.toLowerCase().includes(q)
          ) {
            const links = extractLinks(content);
            const firstLine = content.trim().split("\n")[0]?.trim() || "";
            results.push({
              slug: c.slug,
              title,
              created: String(data.created || ""),
              modified: String(data.modified || ""),
              source: String(data.source || ""),
              firstLine,
              links,
            });
          }
        }
        results.sort((a, b) => b.created.localeCompare(a.created));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(results));
        return;
      }

      if (url.pathname === "/" || url.pathname === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(getHTML());
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    } catch (err) {
      console.error("Server error:", err);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal server error");
    }
  });

  server.listen(port, () => {
    console.log(`memex is running at http://localhost:${port}`);
  });
}

function getHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>memex</title>
<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --blue: #007aff;
  --green: #34c759;
  --label: rgba(0,0,0,0.85);
  --label-2: rgba(0,0,0,0.55);
  --label-3: rgba(0,0,0,0.3);
  --surface: rgba(255,255,255,0.72);
  --surface-border: rgba(255,255,255,0.8);
  --spring: cubic-bezier(0.34,1.2,0.64,1);
}

html, body {
  height: 100%;
  font-family: -apple-system, 'SF Pro Text', 'SF Pro Display', 'Helvetica Neue', sans-serif;
  background: linear-gradient(180deg, #f5f5f7 0%, #e8e8ed 100%);
  color: var(--label);
  -webkit-font-smoothing: antialiased;
  scrollbar-width: none;
}
body::-webkit-scrollbar { display: none; }

.topbar {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: rgba(236,236,236,0.72);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border-bottom: 1px solid rgba(0,0,0,0.12);
  gap: 16px;
}

.topbar-title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.3px;
  color: var(--label);
  white-space: nowrap;
}

.search-wrap {
  flex: 1;
  max-width: 400px;
}

.search-input {
  width: 100%;
  padding: 7px 12px;
  font-size: 13px;
  font-family: inherit;
  background: rgba(255,255,255,0.9);
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 8px;
  outline: none;
  color: var(--label);
  transition: border-color 0.2s, box-shadow 0.2s;
}
.search-input:focus {
  border-color: var(--blue);
  box-shadow: 0 0 0 3px rgba(0,122,255,0.15);
}
.search-input::placeholder {
  color: var(--label-3);
}

.stats {
  font-size: 11px;
  font-weight: 400;
  color: var(--label-3);
  white-space: nowrap;
}

.main {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}

.card {
  background: var(--surface);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 1px solid var(--surface-border);
  box-shadow: 0 2px 8px rgba(0,0,0,0.08), 0 12px 32px rgba(0,0,0,0.10);
  border-radius: 16px;
  padding: 16px 20px;
  margin-bottom: 12px;
  cursor: pointer;
  transition: transform 0.35s var(--spring), box-shadow 0.3s ease;
  will-change: transform;
}
.card:hover {
  transform: scale(1.008);
  box-shadow: 0 4px 12px rgba(0,0,0,0.10), 0 16px 40px rgba(0,0,0,0.13);
}
.card.expanded {
  cursor: default;
}

.card-date {
  font-size: 11px;
  font-weight: 400;
  color: var(--label-3);
  margin-bottom: 4px;
}

.card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--label);
  margin-bottom: 2px;
}

.card-preview {
  font-size: 13px;
  font-weight: 400;
  line-height: 1.55;
  color: var(--label-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 8px;
}

.card-links {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  display: inline-block;
  font-size: 11px;
  font-weight: 500;
  color: var(--blue);
  background: rgba(0,122,255,0.08);
  padding: 2px 8px;
  border-radius: 6px;
  cursor: pointer;
  text-decoration: none;
  transition: background 0.15s;
}
.chip:hover {
  background: rgba(0,122,255,0.16);
}

.card-body {
  overflow: hidden;
  max-height: 0;
  opacity: 0;
  transition: max-height 0.45s var(--spring), opacity 0.3s ease, margin 0.3s ease;
  margin-top: 0;
}
.card.expanded .card-body {
  max-height: 2000px;
  opacity: 1;
  margin-top: 12px;
}
.card.expanded .card-preview {
  display: none;
}

.card-body-inner {
  font-size: 13px;
  font-weight: 400;
  line-height: 1.55;
  color: var(--label);
  border-top: 1px solid rgba(0,0,0,0.06);
  padding-top: 12px;
}
.card-body-inner p { margin-bottom: 8px; }
.card-body-inner code {
  background: rgba(0,0,0,0.05);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
}
.card-body-inner pre {
  background: rgba(0,0,0,0.04);
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
  margin-bottom: 8px;
  scrollbar-width: none;
}
.card-body-inner pre::-webkit-scrollbar { display: none; }
.card-body-inner pre code {
  background: none;
  padding: 0;
}

.card-highlight {
  animation: highlight-pulse 1s ease;
}
@keyframes highlight-pulse {
  0% { box-shadow: 0 0 0 3px rgba(0,122,255,0.4), 0 2px 8px rgba(0,0,0,0.08), 0 12px 32px rgba(0,0,0,0.10); }
  100% { box-shadow: 0 2px 8px rgba(0,0,0,0.08), 0 12px 32px rgba(0,0,0,0.10); }
}

.empty {
  text-align: center;
  padding: 60px 20px;
  color: var(--label-3);
  font-size: 13px;
}

@media (max-width: 600px) {
  .topbar { padding: 10px 16px; }
  .main { padding: 16px 12px 60px; }
  .card { padding: 14px 16px; }
}
</style>
</head>
<body>

<div class="topbar">
  <div class="topbar-title">memex</div>
  <div class="search-wrap">
    <input type="text" class="search-input" placeholder="Search cards..." id="search">
  </div>
  <div class="stats" id="stats"></div>
</div>

<div class="main" id="timeline"></div>

<script>
(function() {
  let allCards = [];
  let expandedSlug = null;
  let bodyCache = {};

  const timeline = document.getElementById('timeline');
  const searchInput = document.getElementById('search');
  const statsEl = document.getElementById('stats');

  async function loadCards() {
    const res = await fetch('/api/cards');
    allCards = await res.json();
    const totalLinks = allCards.reduce((s, c) => s + c.links.length, 0);
    statsEl.textContent = allCards.length + ' cards \\u00b7 ' + totalLinks + ' links';
    renderCards(allCards);
  }

  function renderCards(cards) {
    if (cards.length === 0) {
      timeline.innerHTML = '<div class="empty">No cards found</div>';
      return;
    }
    timeline.innerHTML = cards.map(c => cardHTML(c)).join('');
    timeline.querySelectorAll('.card').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.chip')) return;
        toggleCard(el, el.dataset.slug);
      });
    });
    timeline.querySelectorAll('.chip').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        navigateToCard(el.dataset.link);
      });
    });
  }

  function cardHTML(c) {
    const date = c.created ? c.created.slice(0, 10) : '';
    const chips = c.links.map(l =>
      '<span class="chip" data-link="' + esc(l) + '">[[' + esc(l) + ']]</span>'
    ).join('');
    const isExpanded = expandedSlug === c.slug;
    return '<div class="card' + (isExpanded ? ' expanded' : '') + '" data-slug="' + esc(c.slug) + '" id="card-' + esc(c.slug) + '">'
      + '<div class="card-date">' + esc(date) + '</div>'
      + '<div class="card-title">' + esc(c.title) + '</div>'
      + '<div class="card-preview">' + esc(c.firstLine) + '</div>'
      + (chips ? '<div class="card-links">' + chips + '</div>' : '')
      + '<div class="card-body"><div class="card-body-inner" id="body-' + esc(c.slug) + '">'
      + (isExpanded && bodyCache[c.slug] ? renderMarkdown(bodyCache[c.slug]) : '')
      + '</div></div>'
      + '</div>';
  }

  async function toggleCard(el, slug) {
    if (el.classList.contains('expanded')) {
      el.classList.remove('expanded');
      expandedSlug = null;
      return;
    }
    // Collapse any other
    const prev = timeline.querySelector('.card.expanded');
    if (prev) prev.classList.remove('expanded');

    expandedSlug = slug;
    el.classList.add('expanded');

    const bodyEl = document.getElementById('body-' + slug);
    if (!bodyCache[slug]) {
      bodyEl.innerHTML = '<span style="color:var(--label-3)">Loading...</span>';
      const res = await fetch('/api/cards/' + encodeURIComponent(slug));
      const raw = await res.text();
      // Strip frontmatter
      const stripped = raw.replace(/^---[\\s\\S]*?---\\n?/, '').trim();
      bodyCache[slug] = stripped;
    }
    bodyEl.innerHTML = renderMarkdown(bodyCache[slug]);
    // Attach chip listeners inside body
    bodyEl.querySelectorAll('.chip').forEach(c => {
      c.addEventListener('click', (e) => {
        e.stopPropagation();
        navigateToCard(c.dataset.link);
      });
    });
  }

  function navigateToCard(slug) {
    const el = document.getElementById('card-' + slug);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('card-highlight');
      setTimeout(() => el.classList.remove('card-highlight'), 1100);
      if (!el.classList.contains('expanded')) {
        toggleCard(el, slug);
      }
    }
  }

  function renderMarkdown(text) {
    // Simple markdown → HTML
    let html = esc(text);
    // Code blocks
    html = html.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>');
    // Inline code
    html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
    // Bold
    html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
    // [[links]] → chips
    html = html.replace(/\\[\\[([^\\]]+)\\]\\]/g, '<span class="chip" data-link="$1">[[$1]]</span>');
    // Paragraphs
    html = html.split('\\n\\n').map(p => '<p>' + p + '</p>').join('');
    html = html.replace(/\\n/g, '<br>');
    return html;
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // Search
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase();
    if (!q) {
      renderCards(allCards);
      return;
    }
    const filtered = allCards.filter(c =>
      c.title.toLowerCase().includes(q) ||
      c.firstLine.toLowerCase().includes(q) ||
      c.slug.toLowerCase().includes(q)
    );
    renderCards(filtered);
  });

  loadCards();
})();
</script>
</body>
</html>`;
}
