# memex-cli Design Spec

## Problem

Agent 是无状态的，每次醒来是白纸。它需要一种方式来积累和检索跨 session 的经验和知识。现有方案（mem0、Letta）依赖 vector DB，不可解释、不可调试、不可人工干预。

## Solution

基于 Luhmann Zettelkasten 方法论的 agent memory 系统。用 LLM 自身的理解能力替代 embedding 做语义匹配，用 markdown 双链替代 vector similarity 做 graph traversal。

核心 trade-off：多花一点 LLM token，换取完全的可解释性、可调试性和零基础设施依赖。

## Architecture Overview

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ Claude Code  │  │ Python Agent│  │   Human     │
│              │  │             │  │ (terminal/  │
│              │  │             │  │  Obsidian)  │
└──────┬───────┘  └──────┬──────┘  └──────┬──────┘
       │                 │                │
       │  ┌──────────────┤                │
       │  │  Skills      │                │
       │  │  (recall /   │                │
       │  │   retro /    │                │
       │  │   organize)  │                │
       │  └──────┬───────┘                │
       │         │                        │
       └────┬────┴────────────────┬───────┘
            │                     │
     ┌──────▼──────┐              │
     │  memex CLI  │◄─────────────┘
     │ search/read │
     │   /write    │
     └──────┬──────┘
            │
     ┌──────▼────────┐
     │ ~/.memex/cards/│
     │  *.md files    │
     │  (Zettelkasten)│
     └────────────────┘
```

CLI 是纯数据层，无 LLM 依赖。所有 LLM 智能在 skill 层，用 agent 自身的能力。

## Storage Layer

### Location

`~/.memex/cards/` — flat directory by default. CLI 递归扫描所有 `.md` 文件，用户可手动整理子目录，CLI 不 opinionated。

`~/.memex/archive/` — 归档目录。被 organize skill merge 或标记过时的卡片移到这里。CLI search 只扫描 `cards/`，不扫 `archive/`。人可以在 Obsidian 里看到归档卡片但 agent 不会检索到。

### Card Schema

```markdown
---
title: JWT 迁移的坑
created: 2026-03-18
source: retro
---

JWT 迁移最大的坑不是实现，是 revocation。Stateless token 天然不支持即时 revoke。

这个问题的本质和 [[stateless-auth]] 里讨论的一样 — 把 state 从 server 移到 client 就意味着 server 失去了控制权。

最终我们用了 [[redis-session-store]] 里的 Redis 做 blacklist，算是在 stateless 架构上打了个补丁。
```

**Frontmatter 字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| title | string | 人类可读的完整标题 |
| created | date | 创建日期 (YYYY-MM-DD) |
| source | string | 创建来源：`retro` / `manual` / `organize` |

**正文规则：**
- 一张卡片一个原子 insight
- `[[链接]]` 嵌在句子里，上下文自然语言说明为什么链
- 不用 tags、category、link type — 所有语义信息靠正文承载
- 文件名是 slug（英文 kebab-case）：`jwt-migration-pitfalls.md`

**Slug 规则：**
- 由调用方（LLM / 人）传入，CLI 不做自动转换
- 英文 kebab-case，如 `jwt-migration-pitfalls`
- `[[链接]]` 里的值就是 slug（不含 `.md`）
- Slug 冲突时 write 覆盖（last write wins），v1 不做锁

## CLI Layer

Node.js / TypeScript 实现。三个命令，纯数据操作，无 LLM 依赖：

### `memex search [query]`

全文搜索所有卡片（底层用 ripgrep）。Query 可选 — 无参时返回所有卡片的 slug + title 列表（供 organize skill 枚举使用）。

**有 query 时的输出格式：**
```
## jwt-migration-pitfalls
JWT 迁移的坑
JWT 迁移最大的坑不是实现，是 revocation。Stateless token 天然不支持即时 revoke。
> 匹配行: ...stateless token 天然不支持即时 revoke...
Links: [[stateless-auth]], [[redis-session-store]]
```

每张匹配卡片返回：slug（作为 heading）、title、第一段摘要、匹配行（如果不在第一段则额外显示）、直接链接的 slug 列表。

**无 query 时的输出格式：**
```
jwt-migration-pitfalls  JWT 迁移的坑
caching-strategy        缓存策略选型
stateless-auth          Stateless 认证架构
```

LLM 拿到摘要后自己决定 `read` 哪些卡片。

**Error handling：**
- 无匹配：输出空，exit code 0
- 卡片目录不存在：stderr 提示，exit code 1

### `memex read <card-slug>`

读取一张卡片的完整内容（含 frontmatter）。card-slug 是文件名去掉 `.md`。支持递归查找（用户可能手动把卡片移到了子目录）。

**Error handling：**
- 卡片不存在：stderr 提示 "Card not found: <slug>"，exit code 1

### `memex write <card-slug>`

写入一张卡片。通过 stdin 传入完整 markdown（含 frontmatter）。

- 文件已存在则覆盖（last write wins）
- 自动校验 frontmatter 必须有 title、created、source
- 校验失败：stderr 提示缺失字段，exit code 1

## Skill Layer

三个 skill，所有 LLM 智能在这里。Skill 通过调用 `memex` CLI 与存储层交互。

### memex-recall（任务开始时触发）

```dot
digraph recall {
    "Task received" -> "Generate 2-3 search queries from task context";
    "Generate 2-3 search queries from task context" -> "memex search <query>";
    "memex search <query>" -> "Review summaries";
    "Review summaries" -> "Relevant cards found?" [shape=diamond];
    "Relevant cards found?" -> "memex read <card>" [label="yes"];
    "Relevant cards found?" -> "More queries to try?" [label="no"];
    "memex read <card>" -> "See [[links]] in content";
    "See [[links]] in content" -> "Links worth following?" [shape=diamond];
    "Links worth following?" -> "memex read <linked-card>" [label="yes"];
    "Links worth following?" -> "Enough context?" [label="no"];
    "memex read <linked-card>" -> "See [[links]] in content";
    "Enough context?" -> "More queries to try?" [label="no"];
    "More queries to try?" -> "Generate new query" [label="yes"];
    "Generate new query" -> "memex search <query>";
    "More queries to try?" -> "Summarize findings, proceed with task" [label="no"];
    "Enough context?" -> "Summarize findings, proceed with task" [label="yes"];
}
```

Flow 描述：
1. 从任务描述生成 2-3 个搜索关键词
2. 对每个关键词 `memex search`，拿到摘要列表
3. 看到感兴趣的卡片 → `memex read` 拿完整内容
4. 读到正文里的 `[[链接]]` → 判断要不要 follow → 要就继续 `memex read`
5. 觉得上下文够了 → 停，总结 findings，开始执行任务
6. 觉得不够但当前路径走完了 → 换个关键词再 search

退出条件：LLM 自己判断"够了"或所有 query 都试完。

### memex-retro（任务完成后触发）

```dot
digraph retro {
    "Task completed" -> "Distill: what insights came from this task?";
    "Distill: what insights came from this task?" -> "Any insights worth keeping?" [shape=diamond];
    "Any insights worth keeping?" -> "Done, no card written" [label="no"];
    "Any insights worth keeping?" -> "For each insight: draft atomic card" [label="yes"];
    "For each insight: draft atomic card" -> "memex search for related existing cards";
    "memex search for related existing cards" -> "memex read candidates";
    "memex read candidates" -> "Write card with [[links]] to related cards in prose";
    "Write card with [[links]] to related cards in prose" -> "memex write <card>";
    "memex write <card>" -> "More insights?" [shape=diamond];
    "More insights?" -> "For each insight: draft atomic card" [label="yes"];
    "More insights?" -> "Done" [label="no"];
}
```

Flow 描述：
1. 判断任务有没有值得记录的 insight（不是每次都写）
2. 每个 insight 一张原子卡片
3. 写之前先 search 已有卡片，找到该链谁
4. 链接写在正文里，自然语言说明关联

### memex-organize（定期触发，cron skill）

用 agent 自身的 LLM 能力，调 CLI 的 search/read/write 完成卡片网络维护。

```dot
digraph organize {
    "Scan all cards via search" -> "Detect orphans (no inbound links)";
    "Detect orphans (no inbound links)" -> "For each orphan: search related cards";
    "For each orphan: search related cards" -> "LLM decides: append links / mark stale / leave alone";
    "Scan all cards via search" -> "Detect hubs (too many inbound links)";
    "Detect hubs (too many inbound links)" -> "LLM decides: split into smaller cards or leave alone";
    "Scan all cards via search" -> "Detect contradictions";
    "Detect contradictions" -> "LLM decides: merge / archive old card";
}
```

三个检测：
1. **孤岛检测** — 没有任何 inbound link 的卡片 → 补链接（追加到正文末尾，不修改已有内容）或标记 stale
2. **Hub 检测** — 被过多卡片链接 → 考虑拆分成更原子的概念
3. **矛盾/过时检测** — 内容矛盾或过时 → merge 或 archive

**操作规则：**
- 补链接：只追加到正文末尾，不修改已有内容
- Merge：将源卡片内容追加到目标卡片，源卡片移到 `~/.memex/archive/`
- Archive：将过时卡片移到 `~/.memex/archive/`
- Organize 通过 `memex search`（无参）枚举所有卡片，再 `memex read` 逐张分析

## Integration

| Agent 环境 | 接入方式 |
|------------|---------|
| Claude Code | skill 调 `memex` CLI |
| Python agent | subprocess 调 CLI |
| 其他 LLM agent | subprocess 调 CLI |
| 人类 | 终端直接用 CLI / Obsidian 打开 `~/.memex/cards/` |
| 未来 | MCP server 封装（v2 scope） |

## Tech Stack

| 组件 | 选型 |
|------|------|
| Runtime | Node.js / TypeScript |
| CLI 框架 | commander |
| Frontmatter | gray-matter |
| 搜索 | ripgrep (@vscode/ripgrep) |
| 分发 | npm (npx memex-cli / npm install -g) |

## Project Structure

```
memex-cli/
  src/
    cli.ts              # 入口，解析命令
    commands/
      search.ts         # 全文搜索，返回摘要
      read.ts           # 读卡片完整内容
      write.ts          # 写卡片，校验 frontmatter
    lib/
      parser.ts         # 解析 frontmatter + 提取 [[links]]
      store.ts          # 文件系统操作（递归扫描、读写）
  skills/
    memex-recall/       # recall skill
    memex-retro/        # retro skill
    memex-organize/     # organize skill
  package.json
  tsconfig.json
```

## Design Principles

1. **Zettelkasten 原样照搬** — 原子卡片、自然语言链接、上下文即语义、不做分类
2. **LLM 是 semantic search engine** — 不需要 embedding / vector DB
3. **双链是 graph traversal engine** — 显式关系替代 vector similarity
4. **CLI 是纯数据层** — 三个命令，无 LLM 依赖，任何环境都能调
5. **Skill 是智能层** — 所有 LLM 逻辑在 skill，用 agent 自身能力
6. **人可干预** — Obsidian 打开就能看、改、补
7. **零基础设施** — 纯文件系统，不需要数据库，不需要 API key
