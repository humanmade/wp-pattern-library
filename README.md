# WP Pattern Library

Generate a browsable Markdown pattern library — with screenshots — from a
WordPress site's registered block patterns.

The site serves a manifest of its registered patterns and renders each one in
isolation; a Node CLI captures them with Playwright and writes an index plus one
page per pattern category. A GitHub Action runs the whole thing and opens a pull
request with the refreshed docs.

Two packages ship from this repository:

| Package                         | Install                                          |
|---------------------------------|--------------------------------------------------|
| `humanmade/wp-pattern-library`  | `composer require humanmade/wp-pattern-library`   |
| `@humanmade/wp-pattern-library` | `npm install -D @humanmade/wp-pattern-library`    |

## Install

### 1. The plugin

```bash
composer require humanmade/wp-pattern-library
```

The Composer package declares `"type": "wordpress-plugin"`, so `composer/installers`
routes it to the project's plugin directory — `content/plugins/` on Altis,
`plugins/` on WordPress VIP — without any `installer-paths` change.

Activate it as you would any other plugin: through wp-admin, `wp plugin activate
wp-pattern-library`, or your platform's code-activation helper.

```php
// VIP: in client-mu-plugins/plugin-loader.php
wpcom_vip_load_plugin( 'wp-pattern-library' );
```

It belongs in the deployed environment, not in `require-dev`: the library is
captured from the running production site, so the route has to be live there.
What it adds to that site is one front-end route behind a dedicated capability,
plus a WP-CLI command — no admin UI, no front-end assets, nothing on the
request path for ordinary visitors.

Limit it to your own patterns, so core and plugin patterns stay out of the
library:

```php
add_filter( 'pattern_library_namespaces', fn () => [ 'my-theme/' ] );
```

### 2. A service account

The routes require a dedicated capability, `view_pattern_library`. The bundled
WP-CLI command creates a role holding that capability and `read` — and nothing
else, so the account cannot create or edit content:

```bash
wp pattern-library setup --login=pattern-library-bot
```

It prints an application password. Store it, along with the login, as CI secrets;
it is not recoverable.

> On multisite, roles are stored per site. Run the command with `--url=` for each
> site whose patterns you want to capture.

To use an existing user instead, run `wp pattern-library setup` and then
`wp pattern-library grant <user>`.

### 3. Configuration

Create `pattern-library.config.js` in your project root:

```js
export default {
	title: 'My Pattern Library',
	namespaces: [ 'my-theme/' ],
	outputDir: 'docs/pattern-library',
};
```

Credentials come from the environment, never the config file:

```bash
export PATTERN_LIBRARY_SITE="https://example.com"
export PATTERN_LIBRARY_WP_USER="pattern-library-bot"
export PATTERN_LIBRARY_WP_APP_PASSWORD="xxxx xxxx xxxx xxxx"
```

Sites behind an access proxy also need its headers — see
[Sites behind an access proxy](#sites-behind-an-access-proxy).

## Usage

```bash
npx pattern-library build            # capture screenshots, then write Markdown
npx pattern-library build --dry-run  # report what would be included, write nothing
npx pattern-library capture hero     # screenshots only, for patterns matching "hero"
npx pattern-library generate         # Markdown only, from existing screenshots
npx pattern-library manifest         # print the filtered manifest as JSON
```

Screenshots are written only when their bytes change, so re-running against a
live site does not churn images whose content merely shifted underneath them.

The run summary flags patterns that rendered empty, failed outright, or
referenced resources — images, fonts — that no longer exist, so broken previews
are caught at generation time rather than in review.

## Configuration reference

| Key               | Default                       | Notes                                                    |
|-------------------|-------------------------------|----------------------------------------------------------|
| `title`           | `Pattern Library`             | Index heading.                                           |
| `namespaces`      | `[]` (all)                    | Pattern-name prefixes to include.                        |
| `outputDir`       | `docs/pattern-library`        | Where pages and screenshots are written.                  |
| `indexFile`       | `<outputDir>/README.md`       | Index path.                                              |
| `screenshotsDir`  | `<outputDir>/screenshots`     | Screenshot path.                                         |
| `imageFormat`     | `webp`                        | `webp`, `avif`, `jpeg` or `png`.                          |
| `imageQuality`    | `80`                          | Ignored for `png`.                                       |
| `defaultViewport` | `1440`                        | Used when a pattern declares no `Viewport Width`.        |
| `exclude`         | see below                     | What to leave out of the library.                        |
| `postTypeContext` | `{}`                          | Basename to post type, for `core/post-template` patterns. |
| `classify`        | flat                          | Category placement. See below.                            |
| `animations`      | `[ 'aos' ]`                   | Animation libraries to settle before capture. See below.  |
| `extraFields`     | `[]`                          | Extra metadata lines per pattern. See below.              |
| `variants`        | `[]`                          | Extra captures inside a wrapper. See below.               |
| `includeSkipped`  | `true`                        | List excluded patterns, with reasons, on the index page.  |
| `placeholderImages` | `true`                      | Placeholder featured image for posts that have none.      |
| `extraHeaders`    | `{}`                          | Headers sent with every request to the site. See below.   |

`exclude` defaults to skipping patterns hidden from the inserter and those scoped
to `wp_template` / `wp_template_part`, since template parts render meaninglessly
in isolation:

```js
exclude: {
	inserterHidden: true,
	postTypes: [ 'wp_template', 'wp_template_part' ],
	patterns: [], // Exact pattern names.
}
```

### Patterns that render empty

A pattern built as a query-loop *item template* has nothing to bind to when
rendered alone. Give it a post type, keyed by basename:

```js
postTypeContext: { 'person-card': 'person' }
```

The CLI reports any pattern that rendered empty, so these are easy to find.

### Animation libraries

Scroll-triggered animation libraries hide content until it scrolls into view, so
a capture must force everything to its finished state first. `animations` lists
what to settle: built-in library names (currently `aos`), or custom
`{ css, settle }` objects for project-specific conventions:

```js
animations: [
	'aos',
	{
		// Optional: CSS injected before capture, overriding the hidden state.
		css: '.js-reveal { opacity: 1 !important; transform: none !important; }',
		// Optional: runs in the browser to flip elements to "done". Serialized
		// into the page, so it must not close over config-file variables.
		settle: () => {
			document
				.querySelectorAll( '.js-reveal' )
				.forEach( ( el ) => el.classList.add( 'is-revealed' ) );
		},
	},
]
```

A handler that proves generally useful belongs in `src/animations.mjs` as a new
built-in, so other projects can list it by name.

### Extra metadata fields

Each pattern's section shows its description, categories, keywords, block types
and post types by default. `extraFields` appends further lines: `value` is a
manifest property name, or a function receiving the pattern:

```js
extraFields: [
	{ label: 'Source', value: 'source' },
	{ label: 'Namespace', value: ( pattern ) => pattern.name.split( '/' )[ 0 ] },
]
```

### Variants

A theme whose patterns are built to work on more than one ground — the same
section used plain, and again inside a dark wrapper — can document both without
duplicating the patterns. Each entry in `variants` captures every pattern it
applies to a second time, rendered inside a `core/group` block carrying the
attributes in `wrapper`:

```js
variants: [
	{
		slug: 'dark',
		label: 'Dark section',
		wrapper: { className: 'is-style-dark', backgroundColor: 'shark' },
		appliesTo: ( pattern ) => ! pattern.categories.includes( 'my-theme/pages' ),
	},
]
```

| Key         | Required | Purpose                                                             |
|-------------|----------|---------------------------------------------------------------------|
| `slug`      | yes      | Kebab-case. Becomes the `--slug` filename suffix.                    |
| `wrapper`   | yes      | Group block attributes. See the accepted attributes below.           |
| `label`     | no       | Caption above the image. Defaults to a title-cased `slug`.           |
| `appliesTo` | no       | Predicate receiving the manifest pattern. Defaults to every pattern. |

`wrapper` accepts `className`, `align`, `backgroundColor`, `gradient`,
`textColor`, `style` and `layout` — the attributes of a section group. Anything
else is dropped, so a typo cannot quietly become an attribute nobody meant to
set. The site builds the block from them, so what travels in the URL is data,
never markup. A theme whose section treatment needs more can replace the markup
through `pattern_library_wrapper_open` and `pattern_library_wrapper_close`.

The wrapper is a real group block rather than a class added in the browser,
because block stylesheets registered with `wp_enqueue_block_style()` load only
when their block actually renders — a pattern containing no group of its own
would otherwise be captured without the stylesheet the wrapper's style lives in.
Its colour classes are written out in full by the site, because core applies the
colour supports server-side only to dynamic blocks; `layout` needs no such help,
being resolved by a `render_block` filter that runs for static blocks too.

Use `appliesTo` deliberately. A variant doubles the captures, the capture time
and the committed images for every pattern it covers, and some patterns have no
second treatment worth showing — a whole-page reference already contains its own
sections.

Variants need a site running a plugin version that advertises the feature; an
older one is reported as an error rather than silently capturing duplicates.

### Grouping categories

By default every registered category becomes one page in the output root. A
project with a richer taxonomy can supply a `classify()` function, called once per
category, returning where it belongs — or nothing, to drop it from the library:

```js
classify: ( { slug, label } ) => {
	// A cross-cutting category of whole-page references, which should also lead
	// each section page rather than sitting in the list.
	if ( slug === 'full-page' ) {
		return { kind: 'reference', dir: 'references', label: 'Full page', leadsIn: 'section' };
	}
	if ( label.startsWith( 'Component - ' ) ) {
		return { kind: 'component', dir: 'components', label: label.slice( 12 ) };
	}
	return { kind: 'section', dir: 'sections', label };
}
```

`kind` groups pages under headings on the index, `dir` places the page, `label`
sets its title, and `leadsIn` promotes its patterns to the top of every page of
the named kind.

## GitHub Action

Copy [`examples/refresh-pattern-library.yml`](examples/refresh-pattern-library.yml)
into `.github/workflows/`. It is `workflow_dispatch`-triggered, takes a base
branch and output path, and opens a pull request with the refreshed docs.

Capture from **production**. Screenshots reflect deployed code, so a pattern that
exists only on the branch being documented renders as "preview pending" until it
ships. Staging environments sitting behind their own HTTP Basic gate cannot be
used: two `Authorization: Basic` headers cannot coexist on one request. Gates
that use headers rather than Basic — Cloudflare Access, say — are supported
through `extra-headers`; see
[Sites behind an access proxy](#sites-behind-an-access-proxy).

## How authentication works

Requests authenticate with a standard WordPress application password over HTTP
Basic. Two details are worth knowing, because both fail *silently* otherwise —
WordPress serves the logged-out page with a `200`, which would yield a run's worth
of plausible but wrong screenshots:

- `wp_authenticate_application_password()` ignores any request that is not REST or
  XML-RPC. The preview route opts itself in through the
  `application_password_is_api_request` filter, scoped to its own query var.
- Browsers only attach Basic credentials after a `401` carrying
  `WWW-Authenticate`, and never send them preemptively. Playwright's
  `httpCredentials.send: 'always'` does not change this — it applies only to its
  API request context, not to page navigation. The route therefore sends a proper
  challenge with its `401`.

As a backstop, before capturing anything the CLI navigates the browser to the
manifest URL and requires a `200` — a probe that authenticates through the same
browser path the captures use, yet cannot be brought down by a single pattern
that fails to render.

## Sites behind an access proxy

An origin fronted by Cloudflare Access, or anything like it, answers before
WordPress does: the manifest request comes back as an HTML login page rather than
JSON, and no application password will help, because the request never reached
WordPress.

`extraHeaders` sends the proxy's credentials alongside the application password.
Values are secrets, so they belong in the environment, as one `Name: value` per
line:

```bash
export PATTERN_LIBRARY_EXTRA_HEADERS="CF-Access-Client-Id: <id>.access
CF-Access-Client-Secret: <secret>"
```

Config-file headers, if a project has non-secret ones, merge underneath:

```js
extraHeaders: { 'X-Environment': 'production' },
```

The headers are attached to Node's manifest request and to every browser request
made **to the site's own origin**. They are deliberately withheld from
third-party requests a theme makes — fonts, analytics, CDNs — so a service token
is never handed to a host that merely happens to be referenced by a pattern.

This is the supported way to capture from a gated environment. An origin behind
HTTP Basic still is not: two `Authorization: Basic` headers cannot coexist on one
request, and the application password needs that header.

## Filters

| Filter                                | Purpose                                              |
|---------------------------------------|------------------------------------------------------|
| `pattern_library_enabled`             | Disable the routes entirely.                          |
| `pattern_library_namespaces`          | Pattern-name prefixes to expose.                      |
| `pattern_library_user_can`            | Override the capability check.                        |
| `pattern_library_placeholder_image`   | Markup of the placeholder featured image.             |
| `pattern_library_wrapper_open`        | Opening markup of a variant wrapper.                  |
| `pattern_library_wrapper_close`       | Closing markup of a variant wrapper.                  |

## Requirements

PHP 8.1+, WordPress 6.0+, Node 24+.

The PHP side runs on the WordPress site; the Node side runs wherever the library
is generated, which in practice is CI or a developer machine. They do not need to
be the same host, and the site does not need Node.

## Contributing and releases

Both published packages — the Composer package and the npm package — are built
from this one repository, from the same tree. There is no separate source for the
Node CLI: `bin/` and `src/` are what npm publishes, `inc/` and `plugin.php` are
what Packagist serves, and `action.yml` wraps the npm package for GitHub Actions.

One tag drives all three, so a given version means the same code everywhere:

1. Bump `version` in `package.json`, and the `Version:` header in `plugin.php`.
   Keep them equal — the plugin header is what shows in wp-admin, and a manifest
   served by one version being read by another is the failure mode this
   convention exists to prevent.
2. Tag the release `vX.Y.Z` and push the tag.
3. `npm publish --access public` publishes `@humanmade/wp-pattern-library`.
   Packagist picks up `humanmade/wp-pattern-library` from the same tag via its
   GitHub hook.

Consuming workflows pin the action to a released tag
(`humanmade/wp-pattern-library@vX.Y.Z`). There is deliberately no moving `@v1`
tag while the package is pre-1.0.

The two halves are coupled by the manifest: `inc/manifest.php` produces it and
`src/manifest.mjs` consumes it. A change to either shape is a change to both, in
one commit, released under one tag.

## License

GPL-2.0-or-later
