# Contributing

Thanks for looking. This is a small package with a fairly unusual shape — two
languages, three published artifacts, one repository — so this document is
mostly about the things that are not obvious from reading the code.

- [What lives where](#what-lives-where)
- [Setting up](#setting-up)
- [Running the tests](#running-the-tests)
- [Code style](#code-style)
- [The manifest contract](#the-manifest-contract)
- [Making a change](#making-a-change)
- [Documentation](#documentation)
- [Releasing](#releasing)
- [Good first issues](#good-first-issues)

## What lives where

```
plugin.php          WordPress plugin bootstrap
inc/                The PHP half — routes, manifest, rendering, WP-CLI
bin/                The Node CLI entry point
src/                The Node half — config, manifest, capture, Markdown
action.yml          GitHub Action wrapper around the npm package
tests/php/          PHPUnit, run against a real WordPress
tests/js/           node:test
docs/               The Jekyll documentation site
docs/architecture/  ADRs — why things are the way they are
examples/           A workflow consuming projects can copy
```

Three artifacts ship from this one tree, from the same tag:

| Artifact | Built from | Published to |
|---|---|---|
| `humanmade/wp-pattern-library` | `plugin.php`, `inc/` | Packagist |
| `@humanmade/wp-pattern-library` | `bin/`, `src/` | npm |
| `humanmade/wp-pattern-library` action | `action.yml` | GitHub |

There is no separate source for the Node CLI and no build step. What is in the
repository is what is published.

## Setting up

You need **Node 24+**, **PHP 8.1+**, **Composer**, and **Docker** (for the
WordPress test environment).

```bash
git clone https://github.com/humanmade/wp-pattern-library.git
cd wp-pattern-library

composer install
npm install
```

Then bring up a WordPress to work against:

```bash
npm run env:start
```

This is [`wp-env`](https://developer.wordpress.org/block-editor/reference-guides/packages/packages-env/).
It gives you a site at `http://localhost:8888` with this plugin active and
Twenty Twenty-Five as the theme — which is convenient, because Twenty
Twenty-Five registers about sixty patterns, so there is something real to
capture.

```bash
npm run env:stop      # Stop it.
npm run env:destroy   # Throw it away, including the database.
```

### Capturing against the local site

To exercise the whole thing end to end:

```bash
# Provision an account on the local site.
npm run env:cli -- pattern-library setup --login=pattern-library-bot

# Point the CLI at it, using the application password that printed.
export PATTERN_LIBRARY_SITE="http://localhost:8888"
export PATTERN_LIBRARY_WP_USER="pattern-library-bot"
export PATTERN_LIBRARY_WP_APP_PASSWORD="<the password>"

# Somewhere outside the repository, so you do not commit the output.
mkdir -p /tmp/pattern-library-scratch && cd $_
cat > pattern-library.config.js <<'EOF'
export default {
	title: 'Twenty Twenty-Five',
	namespaces: [ 'twentytwentyfive/' ],
	outputDir: 'out',
};
EOF

node /path/to/wp-pattern-library/bin/pattern-library.mjs build hero
```

`--dry-run` first is a good habit; it authenticates and fetches the manifest
without starting a browser.

## Running the tests

```bash
npm test          # Both suites.
npm run test:js   # node:test — config, manifest, Markdown.
npm run test:php  # PHPUnit, inside wp-env. Needs `npm run env:start` first.
```

### Why the PHP tests need Docker

The plugin is thin glue over the block pattern registry, the block renderer, the
style engine and the roles API. Mocking that surface would test the mocks, so
the suite runs against a real WordPress. `wp-env` provides it, and
`npm run test:php` executes PHPUnit inside the `tests-cli` container.

Two things routinely trip people up when writing PHP tests here:

- **`$_GET` has to be slashed.** WordPress runs `wp_magic_quotes()` over the
  superglobals before any plugin code sees them, and the route calls
  `wp_unslash()` to undo it. A test that assigns `$_GET` directly has to
  `wp_slash()` the value, or a JSON payload containing a quote arrives
  malformed in the test and correctly in production. See
  `Render_Test::request_wrapper()`.
- **Custom capabilities are not implied by any role.** `view_pattern_library` is
  a primitive capability; administrators do not hold it. Tests grant it
  explicitly.

### Why the JS tests write to disk

`generate()` is tested by writing into a temporary directory and reading the
result back, because the files are the product. A unit test of the string
builders would not catch a page written to the wrong path or a relative link
that does not resolve.

## Code style

All three linters run in CI, and all three are clean on `main`.

```bash
npm run lint         # Everything.
npm run lint:js      # ESLint.
npm run lint:js:fix  # ...and fix what it can.
npm run lint:php     # PHPCS and PHPStan.
composer lint:fix    # PHPCBF.
```

- **PHP** follows [Human Made's standards](https://github.com/humanmade/coding-standards)
  (`HM-Minimum`), plus PHPStan at level 5 with the WordPress stubs. Namespaced
  procedural code, not classes, unless there is an object to model.
- **JavaScript** follows `@wordpress/eslint-plugin`'s
  `recommended-with-formatting` — WordPress conventions, tabs, spaces inside
  parentheses. Note that Prettier is deliberately *not* used: WordPress' paren
  spacing needs the `wp-prettier` fork, and that is a large dependency for a
  package that ships no build.

`composer.json` pins `platform.php` to `8.1`, the minimum this package supports,
so dev dependencies resolve to versions that actually run on it regardless of
what PHP you have locally.

### Comments

Comments here explain *why*, not *what*. There are a number of places in this
codebase where the obvious implementation is wrong for a non-obvious reason —
the `WWW-Authenticate` challenge, the group-block wrapper, the `?? ''` on the
style engine's output — and each carries a comment saying so. Please keep that
up; those comments are load-bearing.

## The manifest contract

`inc/manifest.php` produces the manifest and `src/manifest.mjs` consumes it.
This is the seam between the two halves, and the one place where a change can
break a site and a CLI that are on different versions.

- **A change to the manifest's shape is a change to both sides, in one commit,
  released under one tag.**
- Adding a field is safe. Removing or retyping one is not: bump
  `MANIFEST_VERSION`, and the CLI will refuse a site it does not understand
  rather than misread it.
- A new *optional* capability of the route goes in `MANIFEST_FEATURES` instead.
  That is additive, so it does not move `MANIFEST_VERSION`: a CLI too old to
  know a feature never asks for it, and a CLI configured to use one can say
  plainly that the site is too old. `variants` works this way.

## Making a change

1. Branch from `main`.
2. Make the change, with tests. New behaviour in `src/` or `inc/` should come
   with coverage; a bug fix should come with a test that failed before it.
3. Run `npm run lint && npm test`.
4. Update the documentation in `docs/` if you changed anything a user sees.
5. Open a pull request describing what changed and why.

For anything architectural — a change to the manifest, to how authentication
works, to what the route accepts — write an ADR in `docs/architecture/` as part
of the pull request. Follow the format of the existing ones: context, decision,
consequences, in prose. They are the reason this codebase is legible a year
later.

### Adding an animation library handler

`src/animations.mjs` holds the built-in handlers that force scroll-triggered
animation libraries into their finished state before a capture. If you write a
handler for a library other projects use, it belongs there as a new built-in
rather than in your project's config — so somebody else can list it by name.

A handler is `{ css, settle }`. Both are optional. `settle` is serialized into
the browser, so it must not close over anything from the config file.

### Adding a wrapper attribute

`WRAPPER_ATTRIBUTES` in `inc/render.php` is deliberately narrow — a wrapper
exists to put a pattern on a different ground, so the vocabulary stops at what a
section group needs. Anything outside the list is dropped, which is what stops a
config typo becoming a block attribute nobody meant to set.

Widening it is possible but wants justification: what section treatment cannot
be expressed with the current list, and can it be done through
`pattern_library_wrapper_open` instead?

## Documentation

The site in `docs/` is [Just the HM Docs](https://github.com/humanmade/just-the-hm-docs),
a Jekyll theme. It deploys to GitHub Pages on every push to `main` that touches
`docs/`.

To work on it locally:

```bash
cd docs
bundle install
bundle exec jekyll serve
```

Then open <http://localhost:4000/wp-pattern-library/>. Note the base path — the
site is configured for a project Pages URL, so the root will 404.

Pages are numbered (`01-index.md`, `02-getting-started.md`) so the file order
matches the navigation order, which is set by `nav_order` in each file's front
matter. Keep the two in step.

## Releasing

Releases are cut from `main`. One tag drives all three artifacts, so the
versions have to agree before the tag exists.

1. **Bump the version in two places, in one commit:** `version` in
   `package.json`, and the `Version:` header in `plugin.php`. CI fails the pull
   request if they disagree.
2. **Merge to `main`.**
3. **Run the [Tag and Release](../../actions/workflows/tag-and-release.yml)
   workflow**, giving it the tag (`v0.4.0`). It re-checks that the tag,
   `package.json` and `plugin.php` all agree, refuses to overwrite an existing
   tag, creates the tag, and publishes a GitHub release with generated notes.
4. **Publishing happens automatically.** The `Publish to npm` workflow runs when
   that release is published. Packagist picks the tag up through its GitHub
   hook.

Publishing to npm needs an `NPM_TOKEN` repository secret — an automation token
for an account that can publish to the `@humanmade` scope — exposed to the `npm`
environment.

Consuming workflows pin the action to a released tag. There is deliberately no
moving `@v1` tag while the package is pre-1.0.

## Good first issues

Some things that would be genuinely useful and do not require deep knowledge of
the codebase:

- **More built-in animation handlers.** GSAP ScrollTrigger, Framer Motion,
  Lenis, `@wordpress/interactivity`-driven reveals. One handler, one test.
- **More `imageFormat` coverage.** `avif` and `jpeg` are supported but only
  `webp` is exercised in the tests.
- **Better empty-pattern diagnosis.** The CLI reports which patterns rendered
  empty; it could say more about *why* by inspecting what blocks they contain.

[`docs/roadmap.md`](docs/roadmap.md) has a longer list of ideas, including
larger ones. If you want to take something on, open an issue first so we can
agree on the shape before you build it.

## Reporting a bug

Include the command you ran, the full error, and the plugin and CLI versions.
These two are almost always the first thing anyone will ask for:

```bash
pattern-library manifest
pattern-library build --dry-run
```

## License

By contributing, you agree that your contributions will be licensed under the
GPL-2.0-or-later license that covers this project.
