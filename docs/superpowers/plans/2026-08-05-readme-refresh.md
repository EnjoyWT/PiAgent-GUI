# README Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the repository README with a concise, Chinese-first open-source project homepage and move acknowledgements to the end.

**Architecture:** The README is the sole product-facing artifact. It will prioritize positioning, quick start, capability groups, configuration and extension paths, architecture, contribution, license, then acknowledgements.

**Tech Stack:** Markdown, pnpm scripts, Electron, Vue 3, TypeScript.

---

### Task 1: Rewrite the repository homepage

**Files:**
- Modify: `README.md`
- Test: `README.md`

- [ ] **Step 1: Replace the legacy outline**

Write a Chinese-first README with these ordered headings:

```markdown
# PiAgent-GUI
## 界面预览
## 为什么是 PiAgent-GUI
## 快速开始
## 核心能力
## 配置与扩展
## 架构概览
## 开发与验证
## 项目状态与参与贡献
## License
## 致谢
```

- [ ] **Step 2: Verify Markdown facts before writing**

Run:

```bash
node -e "const p=require('./package.json'); console.log(p.version, Object.keys(p.scripts))"
test -f assets/screenshots/chat-workspace.png || true
```

Expected: version and the documented scripts are present; unavailable screenshots are not referenced.

- [ ] **Step 3: Keep only verifiable content**

Document `pnpm install`, `pnpm dev`, `pnpm run typecheck`, `pnpm test:logic`, and the supported build scripts. Remove the obsolete UI ordering known-issue statement and implementation-level exhaustive tool lists. Put attribution after the License heading.

- [ ] **Step 4: Validate the final document**

Run:

```bash
rg -n '^## ' README.md
rg -n 'UI事件流设计不合理|已知问题' README.md && exit 1 || true
git diff --check
```

Expected: the heading order is clear, the obsolete claim is absent, and whitespace validation exits 0.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: refresh project README"
```
