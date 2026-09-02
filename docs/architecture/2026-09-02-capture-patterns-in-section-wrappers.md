# Capture patterns a second time inside a section wrapper

Date: 2026-09-02

## Status

Accepted

## Context

Themes increasingly build one pattern to work on more than one background. A
consuming project has refactored its patterns so that a single section renders
correctly both on the page's default background and inside a group carrying a
`is-style-dark` block style, which overrides text, link and card colours for
everything beneath it.

The library documents one screenshot per pattern, so it can only show one of
those. This means that a reviewer reading the library has no way to tell
whether a pattern supports a different section style, or if a change introduces
a regression to a style that wasn't considered.

Duplicating the patterns — a light and a dark registration of each — would
document both.

Three constraints shaped the design:

- **The wrapper is not cosmetic.** Block stylesheets registered with
  `wp_enqueue_block_style()` load only when their block actually renders, so a
  pattern containing no group block of its own would be captured without the
  stylesheet the wrapper's style lives in.
- **Static blocks carry most of their own classes.** Core applies the colour
  supports server-side only to dynamic blocks, so a wrapper serialized into the
  pattern markup gets no `has-*-background-color` class for free and has to
  write its own. Layout is the exception: it resolves through a `render_block`
  filter that runs for static blocks too.
- **Variants are not free.** Each one doubles the captures, the run time and the
  committed images for every pattern it covers, and some patterns — whole-page
  references that already contain their own sections — have no second treatment
  worth showing.

## Decision

Add a `variants` config option. Each variant names a `slug`, a `label`, a
`wrapper` of group block attributes, and an optional `appliesTo` predicate. The
capture step takes one extra screenshot per applicable pattern, written to
`<basename>--<slug>`, and the Markdown places it under the plain capture with
its label.

The wrapper is built **on the site**, not in the browser and not by sending
markup. A new `pattern-library-wrapper` query var carries the attributes as
JSON; `render_pattern()` reduces them to an allowlist — `className`, `align`,
`backgroundColor`, `gradient`, `textColor`, `style` — sanitizes each, and
serializes both a `wp:group` block comment and the `<div>` with the resolved
presentation classes. The block comment is what triggers block-style enqueueing;
the resolved classes are what make a static wrapper render correctly. Both are
built from the same sanitized values, and the JSON is encoded with
`JSON_HEX_TAG` so no attribute value can close the block comment early.

`style` and `layout` pass through to core untouched — the style engine resolves
one into inline CSS, the layout support resolves the other into classes and
container CSS as the pattern renders. That container CSS is collected into the
style engine's store rather than emitted inline, which works here only because
`render_pattern()` already runs `do_blocks()` before `wp_head()`; the ordering is
now load-bearing rather than incidental.

`pattern_library_wrapper_open` and `pattern_library_wrapper_close` are the escape
hatch for a theme whose section treatment genuinely needs more than the
allowlist.

Support is advertised through a new `features` array in the manifest rather than
a manifest version bump. The array is additive, so an old CLI reading a new site
is unaffected; what it buys is the other direction, where a CLI configured for
variants can say that the *site* is too old instead of capturing every variant
as a duplicate of the pattern it varies.

## Consequences

A project can document its section treatments without registering a pattern per
treatment, and a change that breaks a pattern on a dark ground now shows up as a
changed image in the refresh pull request.

Capture time and repository weight scale with the number of variants times the
patterns they apply to. `appliesTo` is the control for that, and the run reports
the resulting capture count before it starts, so the cost is visible rather than
discovered.

The allowlist is a vocabulary, and vocabularies need extending. A theme whose
wrapper needs an attribute that is not there has the two filters, but the
likelier outcome is that the allowlist grows. Each addition needs the same check
the first pass applied: whether the attribute resolves for a *static* block, and
if not, what this file has to write out on its behalf.
