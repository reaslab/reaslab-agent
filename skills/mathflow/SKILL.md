---
name: mathflow
description: Use when mathematical research work needs stage-aware guidance before proceeding.
---

## Use when

Use this skill when a task involves mathematical research, derivations, mathematical modeling, simulation, numerical experiments, theorem exploration, or conclusion-building across multiple stages of analysis.

## Inputs

- The problem statement, known constraints, and current evidence.
- Any existing model, equations, assumptions, datasets, or intermediate results.
- The current stage if the user already knows it, otherwise enough context to assess the stage.

## Outputs

- A brief stage assessment that identifies the current stage and why it fits.
- One required next stage by default.
- A short ranked candidate set only when stages genuinely overlap and there is real ambiguity.
- A clear handoff describing what to do in the selected next stage.

## Hard rules

- Always assess the current stage before choosing the next step.
- Route mathematical research tasks into the correct stage instead of jumping directly to calculations or conclusions.
- Choose exactly one required next stage by default.
- Return a short ranked candidate set only when stages genuinely overlap.
- Start open-ended work in `problem-analysis`.
- Require `mathematical-modeling` before introducing new equations or assumptions.
- Require `derivation-and-proof-checking` when analytical claims depend on a derivation, proof attempt, or justification audit.
- Require `research-planning` before numerical work.
- Require `numerical-experimentation` for simulation, solver, sweep, or computational execution work.
- Require `result-validation` before making strong claims.
- Require `result-validation` to complete its embedded `Claim Integrity Audit` before final conclusions.
- Route validated final writeups to `report-writing` instead of skipping directly from validation to polished conclusions.

## Behavior

1. Read the task and identify whether the work is open-ended, model-building, numerical, interpretive, or near-conclusion.
2. Produce a short stage assessment before naming any next action.
3. If the task is open-ended or underspecified, route it to `problem-analysis`.
4. If new equations, abstractions, or assumptions are needed, require `mathematical-modeling` first.
5. If the work depends on checking or extending a derivation, proof, or mathematical argument, route it to `derivation-and-proof-checking`.
6. If the user wants computation, simulation, estimation, or parameter sweeps, require `research-planning` first unless that stage is already complete.
7. After planning is complete, route execution work to `numerical-experimentation`.
8. Before endorsing a result, require `result-validation`.
9. Before any final takeaway, require `result-validation` to complete its embedded `Claim Integrity Audit` for assumptions, limitations, and evidentiary gaps.
10. After validation supports the claims strongly enough for communication, route final writeup work to `report-writing`.

## Stages

- `problem-analysis`: clarify the question, constraints, success criteria, and missing information.
- `mathematical-modeling`: define variables, assumptions, structures, and candidate mathematical representations.
- `derivation-and-proof-checking`: review derivations, proofs, and mathematical arguments so justified results stay separated from heuristics, conjecture, or unsupported steps.
- `research-planning`: choose experiment objectives, baselines, metrics, stop rules, and fallback branches before numerical execution.
- `numerical-experimentation`: run reproducible simulations, sweeps, solvers, or computational studies while retaining anomalies and report-ready evidence.
- `result-validation`: test sensitivity, consistency, edge cases, special cases, limit cases, and alternative explanations, then complete the embedded `Claim Integrity Audit` before any final conclusion.
- `report-writing`: turn staged outputs into a final report that preserves claim strength, caveats, and evidence boundaries.

## Routing and handoffs

- A typical first-wave path is `problem-analysis` -> `mathematical-modeling` -> `derivation-and-proof-checking` or `research-planning` -> `numerical-experimentation` -> `result-validation` -> `report-writing`, but only the stages required by the actual task should be used.
- `derivation-and-proof-checking` may follow `mathematical-modeling` directly when the next need is analytical justification rather than numerical execution.
- `research-planning` feeds `numerical-experimentation`; do not collapse planning and execution into one stage.
- `result-validation` remains the first-wave gate for strong claims and keeps the audit embedded inside that stage rather than splitting it into a separate stage.
- If `result-validation` finds instability, contradictions, thin evidence, or unresolved assumptions, return to `derivation-and-proof-checking`, `research-planning`, or `numerical-experimentation` based on the source of the problem.
- Use `report-writing` only after the necessary validation work is complete and the evidence is ready to be communicated honestly.
