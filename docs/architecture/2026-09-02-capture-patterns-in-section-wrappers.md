# Handle section style variations by capturing multiple screenshots of patterns inside section wrappers

Date: 2026-09-02

## Status

Accepted

## Context

Themes can build patterns to render different inside different section styles. One possible example is a theme that adds a "dark" section style which sets text colors so that a pattern can render correctly both on the page's default background and inside an `is-style-dark` group block.

If the library only documents one screenshot per pattern, a reviewer reading the library has no way to tell whether a pattern supports a different section style, or if a change introduces a regression to a style that wasn't considered.

## Decision

Add a `variants` config option which can be specified in the `pattern-library-config.js`. Each variant names a `slug`, a `label`, a `wrapper` of group block attributes, and an optional conditional `appliesTo` test. 

For all patterns that pass the `appliesTo` condition, the pattern library generator will take one extra screenshot per variant, written `<basename>--<slug>`, and the Markdown page will display that under the plain capture with its label.

## Consequences

A project can document its section treatments without registering a separate pattern per treatment, and a change that cause unintended regression inside a specific section wrapper style will be apparent as a changed image in the next pattern library refresh pull request.

Capture time and repository weight scale with the number of variants times the
patterns they apply to. `appliesTo` is the control for that, and the run reports
the resulting capture count before it starts, so the cost is visible rather than
discovered.

The allowlist is a vocabulary, and vocabularies need extending. A theme whose
wrapper needs an attribute that is not there has the two filters, but the
likelier outcome is that the allowlist grows. Each addition needs the same check
the first pass applied: whether the attribute resolves for a *static* block, and
if not, what this file has to write out on its behalf.
