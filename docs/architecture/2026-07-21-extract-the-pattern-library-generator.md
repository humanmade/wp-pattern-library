# Extract the pattern library generator into a distributable package

Date: 2026-07-21

## Status

Accepted

## Context

This package began as a set of project-local scripts that generated a browsable
Markdown pattern library from a WordPress theme's registered block patterns:

- A front-end route, gated to local development, rendering a single registered
  pattern in a chrome-free shell, plus a JSON manifest of every pattern to
  capture.
- A Playwright script that read the manifest, visited each pattern at its
  declared viewport width, forced animated blocks to their end state, waited for
  lazy media, and cropped to the pattern.
- A standalone PHP script that regex-parsed pattern file headers and the theme's
  `register_block_pattern_category()` calls, then wrote an index plus one
  Markdown page per category.

The result is genuinely useful — on the originating project, 170 patterns across
27 pages, each with a screenshot, description, keywords and viewport — and other
projects want it. This ADR records how it becomes an installable package.

Three projects are in scope as initial consumers. They differ in ways that
constrain the design:

|   | Platform | Category slugs                | Labels                       | Kinds | Patterns |
|---|----------|-------------------------------|------------------------------|-------|----------|
| A | Altis    | unnamespaced (`hero`)         | two kind-prefixes on labels  | 3     | 170      |
| B | VIP      | namespaced (`my-theme/hero`)  | flat (`Hero`, `Cards`)       | 0     | 212      |
| C | VIP      | namespaced (`my-theme/hero`)  | flat                         | 0     | 4        |

Project A is where the scripts originated, and it is the outlier: it is the only
one with a multi-kind category taxonomy, and the only one on Altis.

## Decision

### The manifest is the entire data contract

The generator no longer reads the filesystem. It consumes a JSON manifest served
by the WordPress site, built from `WP_Block_Patterns_Registry` and the registered
pattern-category list.

This removes both of the original generator's brittle inputs — globbing a
hardcoded `patterns/` directory and regex-scraping
`register_block_pattern_category()` out of a hardcoded PHP file — neither of which
survives contact with a second project. It also means patterns registered from
plugins and mu-plugins are included for free, and the Node CLI needs no PHP
runtime, which is what lets it run on a plain Node container in CI.

WordPress core already serves almost exactly this at
`/wp/v2/block-patterns/patterns` and `/wp/v2/block-patterns/categories`. We do not
use it, for three reasons:

1. Its permission check is hardcoded to `current_user_can( 'edit_posts' )`
   (`WP_REST_Block_Patterns_Controller::get_items_permissions_check()`) with no
   filter, which is incompatible with the least-privilege capability below.
2. `get_items()` calls `_load_remote_block_patterns()`, making outbound
   wordpress.org requests on every call and returning pattern-directory entries
   mixed in with the project's own.
3. It ties the package to core's REST schema across WordPress versions.

Our own route filters by namespace server-side, which matters on any site where
the registry also holds patterns from core or from plugins such as Gutenberg.

### Access is an application password plus a dedicated capability

Authentication uses WordPress's own application passwords rather than a bespoke
shared-secret token, so credentials are minted, listed and revoked through core UI
and WP-CLI, and the request runs through the normal authentication and capability
stack.

Authorization uses a new capability, `view_pattern_library`, and nothing else. The
package ships a WP-CLI command that creates a `pattern_library` role holding
exactly `read` and `view_pattern_library` — no `edit_posts`, no upload, no
publish. A service account for taking screenshots should not be able to create
draft content, which is what reusing `edit_posts` would have required.

Role creation is a WP-CLI command rather than an activation hook because
provisioning also mints an application password, which must be surfaced to an
operator once and cannot be recovered afterwards. On multisite the command must
be run per site, since roles are stored per blog — so activation, which fires on
one site, would provision only that one.

#### The route must opt in to application-password authentication

`wp_authenticate_application_password()` returns early unless the request is an
API request — by default only `XMLRPC_REQUEST` or `REST_REQUEST`
(`wp-includes/user.php:398`). A front-end route authenticates as nobody, and,
because WordPress serves the unauthenticated page with a `200`, this fails
*silently*: the capture run produces plausible-looking logged-out screenshots.

The preview route must therefore opt itself in via the
`application_password_is_api_request` filter, narrowly scoped to its own query
var. This widens application-password auth to exactly one front-end URL that
serves only already-registered pattern markup; the same credential already grants
the whole REST API, so the marginal exposure is nil.

The route stays a front-end route rather than becoming a REST route because
Playwright needs to navigate to a real HTML page, and because a front-end request
gives patterns the same theme context they get in production.

#### The 401 must carry a WWW-Authenticate challenge

Opting in is necessary but not sufficient. A *browser* only attaches HTTP Basic
credentials to a navigation after receiving a `401` carrying `WWW-Authenticate`;
it never sends them preemptively. Playwright's `httpCredentials.send = 'always'`
does not help here — per its own API documentation that option "only applies to
the requests sent from corresponding APIRequestContext and does not affect
requests sent from the browser."

WordPress does not send `WWW-Authenticate` on its own. Since the preview route
issues its own `401`, it sends the challenge itself, which is also what RFC 7235
requires of any `401` response. Credentials are then handled by the browser's
native Basic-auth machinery and scoped to the origin, so they are never attached
to third-party requests a theme makes for fonts, analytics or CDN assets. The
capture context additionally pins `httpCredentials.origin` to the site.

Both failure modes above are silent — WordPress serves the logged-out page with a
`200` — so the rendered shell carries a marker that only the authenticated path
emits, and the CLI asserts on it in the browser before starting the capture loop.
Verifying via the manifest fetch is not enough: Node's `fetch` and the browser
authenticate through entirely different paths, and in testing the first worked
while the second did not.

### The category taxonomy is a function, not a schema

The package's default output is **flat**: one Markdown page per registered pattern
category, plus an index. That is what most projects need, and it requires no
configuration beyond a namespace.

A multi-kind taxonomy — for example, functional categories and section categories
distinguished by a label prefix, plus a catalog-only kind lifted out by slug — is
expressed as an optional `classify()` function in project config, mapping a
category to a kind, a directory and a display label.

A declarative `labelPrefix` schema was considered and rejected: it describes one
project's convention and no other, and any second convention (slug namespaces, an
explicit allowlist, ordering rules) would need a new config key. A ten-line
function in one project's config is smaller than a schema in every project's.

### One repository, two published packages

| Artifact                          | Registry  | Contents                                  |
|-----------------------------------|-----------|-------------------------------------------|
| `humanmade/wp-pattern-library`    | Packagist | Preview route, capability, WP-CLI command |
| `@humanmade/wp-pattern-library`   | npm       | CLI: fetch, capture, generate             |
| `humanmade/wp-pattern-library@vX.Y.Z` | GitHub | Composite action wrapping the CLI      |

They ship from one repository so the manifest contract and its only consumer are
versioned together; the failure mode of two repositories is an endpoint change
silently breaking the CLI. One tag drives all three publications, so a version
number means the same code in every registry.

The composer package declares `"type": "wordpress-plugin"`. Both target platforms
route that type by type rather than by name — Altis to `content/plugins/{$name}/`,
VIP to `plugins/{$name}/` — so it installs to the right place on both with no
`installer-paths` edit, and is then activated like any other plugin.

A regular plugin rather than an mu-plugin because nothing here needs to load
unconditionally on every request: the package is a capture-time tool, and a
project that has stopped generating a library should be able to deactivate it
from the admin. mu-plugins cannot be turned off without a deploy, and in
subdirectories are not even auto-loaded, so they buy a loader edit in every
consuming project in exchange for a guarantee this package does not need.

### Screenshots are WebP, and only written when changed

On the originating project the committed screenshots are ~96 MB across 170 PNGs,
in a repository whose `.git` is already ~600 MB; another consumer has 212
patterns. Regenerating everything on each run and committing the result is not
viable at that weight.

Screenshots are therefore encoded as WebP, and a capture is only written when its
bytes differ from what is on disk. The second rule matters more than it looks:
capturing against production means query-loop patterns render real, changing
content, so a naive run rewrites dozens of images that are visually identical.

## Consequences

- Generating the library requires a reachable, authenticated site. This was
  already true for screenshots; it is now also true for the Markdown.
- Authenticated requests bypass the page cache on both Altis and VIP, so a full
  run is a few hundred uncached origin renders. The capture loop stays serial.
- Screenshots reflect *deployed* code. A pattern that exists only on the branch
  being documented renders as "preview pending" until it ships.
- Staging environments behind their own HTTP Basic gate cannot be used as a
  capture source: two `Authorization: Basic` headers cannot coexist. Production is
  the default source.
- The originating project migrates off its local scripts. That migration is
  verified by regenerating its docs byte-for-byte against the committed files,
  which doubles as proof that the generalized engine plus a `classify()` function
  reproduces the original special case exactly.
- Build order is C, then B, then A — the outlier last, so its assumptions do not
  get baked into the engine.

## Revisions

**2026-07-31** — The Composer package was originally typed
`wordpress-muplugin`, carried over from boilerplate rather than chosen. Review of
the first consuming integration surfaced it: that project wanted the package in
`plugins/`, and had to add an `installer-paths` override to undo the type. Since
nothing in the package needs to load on every request, and being deactivatable is
an advantage for a capture-time tool, the type is now `wordpress-plugin` and the
override is unnecessary. The "One repository, two published packages" and role
provisioning sections above reflect the corrected decision.
