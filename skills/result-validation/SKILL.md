---
name: result-validation
description: Use when analytical or numerical findings need explicit validation against special cases, limit cases, sensitivity, consistency checks, and a first-wave audit before making strong claims.
---

## Use when

Use this skill when a result, trend, numerical finding, or derived conclusion appears promising and now needs structured checks before it is treated as reliable.

Typical signals:

- A result seems correct, but special cases or limit cases have not been checked.
- The conclusion may depend strongly on assumptions, tolerances, parameter choices, or numerical settings.
- Multiple pieces of evidence appear consistent, but overclaiming risk remains.
- The next step is to decide whether the evidence supports a weak claim, a strong claim, or only a tentative observation.

## Inputs

- The claim, conclusion, or finding to validate.
- The derivation, model, experiment outputs, tables, plots, and summary metrics behind that finding.
- The assumptions, definitions, parameter settings, and computational choices used to generate the result.
- Any known anomalies, failed runs, counterexamples, or unresolved caveats.

## Outputs

- A validation record covering special cases, limit cases, sensitivity checks, and consistency checks.
- An explicit statement of which claims remain supported, weakened, contradicted, or still unresolved.
- A completed first-wave audit checklist named `Claim Integrity Audit`.
- A final claim-strength statement that distinguishes tentative observations from strong claims.

## Hard rules

- Check special cases, limit cases, sensitivity, and consistency before endorsing a result as reliable.
- Search for counterexamples and contradictory evidence instead of only confirming the preferred interpretation.
- Complete the `Claim Integrity Audit` before making any strong claim.
- Strong claims require both positive validation findings and a completed `Claim Integrity Audit`.
- If validation exposes instability, assumption drift, or unresolved contradictions, weaken the claim explicitly.
- Keep the first-wave audit gate inside this skill; do not split it into a separate self-audit loop.

## Validation process

1. State the exact claim being validated and the evidence currently supporting it.
2. Check special cases where the answer is known, simpler, symmetric, degenerate, or analytically constrained.
3. Check limit cases such as small or large parameter regimes, boundary conditions, vanishing terms, or asymptotic behavior.
4. Run sensitivity checks on parameters, tolerances, seeds where applicable, discretization choices, and method settings.
5. Run consistency checks across independent derivations, units, monotonicity expectations, conservation properties, or baseline comparisons.
6. Search actively for counterexamples, contradictory runs, or definitions that no longer match the original claim.
7. Complete the audit checklist and only then decide claim strength.

## Claim Integrity Audit

Complete every item explicitly:

- `Overclaiming`: Are any conclusions stated more strongly than the evidence actually supports?
- `Assumption drift`: Did the assumptions used in experiments or derivations shift from the original problem statement?
- `Definition slippage`: Did any key term, metric, variable, or success criterion change meaning during the work?
- `Extrapolation`: Is any conclusion being extended beyond the tested regime, validated domain, or proved conditions?
- `Missing counterexamples`: Have plausible counterexamples, adverse cases, or contradiction-seeking tests been skipped?

## Validation guidance

- Prefer checks that could falsify the claim, not just checks that restate supporting evidence.
- When a result matches one validation axis but fails another, report the tension directly.
- Treat anomalies and failed runs as validation inputs, not as noise to hide.
- If a limit case or special case disagrees with the main conclusion, stop and reconcile the mismatch before escalating the claim.

## Claim-strength guidance

- `Tentative observation`: some evidence supports the finding, but validation is incomplete or mixed.
- `Supported claim`: the result survives the main validation checks within the tested regime, with clear caveats.
- `Strong claim`: validation findings are positive, the `Claim Integrity Audit` is complete, and no unresolved contradiction blocks the conclusion.

## Handoff guidance

- Move back to `numerical-experimentation` when validation shows the evidence set is too thin, too selective, or insufficiently reproducible.
- Move back to `mathematical-modeling` or `derivation-and-proof-checking` when failures point to model mismatch, hidden assumptions, or unsupported analytical steps.
