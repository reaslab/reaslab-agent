# Tool Output And Plan UI Frontend Contract

## Verified Backend Guarantees

The following backend guarantees are implemented and covered by tests in `reaslab-agent`:

- `session/update(plan)` is the canonical live plan signal
- live plan updates do not depend on the assistant agent name being `plan`
- `session/new(...).result.plan.entries` exists and is an empty array for new sessions
- `session/load(...).result.plan.entries` exists and is rehydrated from persisted todos
- `tool_call_update` supports additive `structured` payloads while preserving legacy `rawOutput` and text content
- user-visible ACP path fields prefer relative or shortened display paths
- internal absolute paths remain available where required for diff/debug behavior

## Current Reference Frontend Observations

The following observations are based on the reference-only files under `reaslab-uni` and are descriptive, not normative:

- `reaslab-uni/reaslab-fe/reaslab-ide/lib/acp/schema.ts` defines plan-update shapes and ACP tool update shapes
- `reaslab-uni/reaslab-fe/reaslab-ide/components/ide/sidebar/reaslingo-group.tsx` does not by itself prove current consumption of backend `sessionUpdate: "plan"` for the new contract path
- `reaslab-uni/reaslab-fe/reaslab-ide/components/ide/sidebar/reaslingo/utils/plan-utils.ts` still reflects plan extraction patterns tied to existing message/tool shapes
- inspected frontend files do not prove that the additive backend `structured` field is already consumed today
- inspected frontend files do not prove that `session/load(...).result.plan.entries` is already wired into current reload/rehydration state

## Frontend Adoption Requirements

If a frontend wants to consume the new backend contract, it should:

- treat `session/update(plan)` as the canonical live PLAN update event
- use `session/load(...).result.plan.entries` for PLAN rehydration on reload/reconnect
- prefer `tool_call_update.structured` for richer tool-card rendering when present
- fall back to `rawOutput` / text content when `structured` is absent
- use relative or shortened display path fields in user-visible UI by default

## Fixed Comparison Checklist

This checklist was used for the backend-to-reference comparison:

- live PLAN trigger exists without agent-name gating
- bootstrap `plan.entries` shape exists for `session/new` / `session/load`
- additive structured tool payload shape is stable beside legacy fields
- visible path fields are suitable for relative/shortened display
- no frontend code in `reaslab-uni` was modified during this work
