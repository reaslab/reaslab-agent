# AGENTS.md — reaslab-agent 子项目

> ACP Agent 框架（Bun + TypeScript），ACP stdio 通信，含 Skill 系统。

## 在 Normal 栈中的角色

- 仅作 `agent_configs.reaslab-agent` 行的镜像源（`ghcr.io/reaslab/reaslab-agent`）
- compose **不常驻** — 用户在 UI 选 "ReasLab Agent" 时由 reaslab-be 临时 spawn
- 跟 paper-agent / mma 是不同产品（同样走 ACP 但用不同的协议适配 + Skill 机制）

## 你能 push 哪

- ✅ `test_normal`（部署分支，2026-04-28 由 reaslab-kb setup 流程建立）— 自由 push
- ❌ `main`（参考主版本）— 绝对不许直接 push
- ⚠️ 上游有 `unified-tools` 分支（Advanced 用），这是 Advanced 的事，不动

## 你刚进来时干啥

```bash
# 1. reaslab-agent 不常驻，得手 spawn 测试
# 浏览器 http://localhost:3001 → 选 "ReasLab Agent" → 发消息
# 然后看 docker exec normal-dind docker ps 确认有 reaslab-agent 容器起来

# 2. 改 src/ 代码 → build + DinD 同步
docker build -t ghcr.io/reaslab/reaslab-agent:test_normal .
docker save ghcr.io/reaslab/reaslab-agent:test_normal | \
  docker exec -i normal-dind docker load
docker exec normal-dind docker ps --filter name=reaslab-agent --format '{{.Names}}' \
  | xargs -r -I{} docker exec normal-dind sh -c 'docker stop {} && docker rm {}'
```

## 三个常踩坑

1. **Skill 机制跟 OpenClaw 不一样** — 改 Skill loader 前先读 [docs/comparison-skill-mechanism.md](./docs/comparison-skill-mechanism.md)
2. **ACP `_meta` 协议跟 paper-agent / mma 共享同一份契约** — 改协议必须看 [二级规范/ACP 子agent 展示契约.md](../docs/规范/ACP%20子agent%20展示契约.md)，不要单独改
3. **Bun 不是 Node** — `bun install` 不是 `pnpm install`；锁文件 `bun.lockb`；TypeScript 直接跑无需 build

## 改完怎么验

```bash
# 1. typecheck
bun run typecheck

# 2. 单元测试（如果有）
bun test

# 3. 端到端：浏览器 spawn agent 发消息看 ACP _meta 是否符合契约
# Grafana service="reaslab-agent" 看 ACP send/recv
```

## 常用文档

- 内部 Skill 机制对比：[docs/INDEX.md](./docs/INDEX.md)（速查表 + 推荐阅读顺序）
- ACP 协议契约：[../docs/规范/ACP 子agent 展示契约.md](../docs/规范/ACP%20子agent%20展示契约.md)
- Tool output / Plan UI 契约：[docs/superpowers/contracts/2026-03-26-tool-output-and-plan-ui-frontend-contract.md](./docs/superpowers/contracts/2026-03-26-tool-output-and-plan-ui-frontend-contract.md)
