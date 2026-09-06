# WP Pattern Library

Generate a browsable Markdown pattern library — with screenshots — from a WordPress site's registered block patterns.

**📖 [Documentation](https://humanmade.github.io/wp-pattern-library/)**
- [Getting started](https://humanmade.github.io/wp-pattern-library/getting-started)
- [WordPress plugin](https://humanmade.github.io/wp-pattern-library/plugin)
- [NPM package](https://humanmade.github.io/wp-pattern-library/npm-package)
- [GitHub Action](https://humanmade.github.io/wp-pattern-library/github-action)

---

A block theme of any size is going to end up with dozens or hundreds of patterns. That is a design system, and it has the design system problem: the names live in `patterns/*.php`, the appearance lives in the block inserter behind a login, and neither is somewhere you can point at.

This generates the missing artifact. The site serves a manifest of its registered patterns and renders each one in isolation; a Node CLI captures them with Playwright and writes an index plus one page per category. The result is Markdown and images you commit — so it renders on GitHub, it is searchable, and when a pattern's appearance changes, the changed screenshot shows up in review.

It works against your local environment or a live site. A GitHub Action can run the whole thing and open a pull request with the refreshed docs.

## Install

Two packages ship from this repository, from the same tag:

| Package | Install |
|---|---|
| `humanmade/wp-pattern-library` | `composer require humanmade/wp-pattern-library` |
| `@humanmade/wp-pattern-library` | `npm install -D @humanmade/wp-pattern-library` |

The Composer package is the WordPress plugin, and belongs on the site you capture from. The npm package is the CLI, and runs wherever you generate the library — your machine, or CI. The site does not need Node.

## Quick start

```bash
# 1. On the site you want to capture from.
composer require humanmade/wp-pattern-library
wp plugin activate wp-pattern-library
```

```php
// 2. Limit it to your own patterns, so core's stay out of the library.
add_filter( 'pattern_library_namespaces', fn () => [ 'my-theme/' ] );
```

```bash
# 3. Create an account for the generator. Prints an application password once.
wp pattern-library setup --login=pattern-library-bot
```

```js
// 4. pattern-library.config.js, in your project root.
export default {
	title: 'My Theme Pattern Library',
	namespaces: [ 'my-theme/' ],
	outputDir: 'docs/pattern-library',
};
```

```bash
# 5. Credentials come from the environment, never the config file.
export PATTERN_LIBRARY_SITE="http://localhost:8888"
export PATTERN_LIBRARY_WP_USER="pattern-library-bot"
export PATTERN_LIBRARY_WP_APP_PASSWORD="xxxx xxxx xxxx xxxx"

npx @humanmade/wp-pattern-library build --dry-run   # Look first.
npx @humanmade/wp-pattern-library build             # Then capture.
```

Full walkthrough, including the things that catch people out: **[Getting started](https://humanmade.github.io/wp-pattern-library/getting-started)**.

## Commands

```bash
pattern-library build            # Capture screenshots, then write Markdown.
pattern-library build --dry-run  # Report what would be included; write nothing.
pattern-library capture hero     # Screenshots only, for patterns matching "hero".
pattern-library generate         # Markdown only, from existing screenshots.
pattern-library manifest         # Print the filtered manifest as JSON.
```

Screenshots are written only when their bytes change, so re-running does not churn images whose content merely shifted underneath them. The run summary flags patterns that rendered empty, failed outright, or referenced resources that no longer load.

## What you get

```
docs/pattern-library/
├── README.md          Index: every category, with counts
├── banner.md          One page per pattern category
├── testimonials.md
└── screenshots/
```

Each pattern gets its screenshot, description, categories, keywords, block and post types, and the viewport it was captured at.

Beyond the basics, the generator can capture [section variants](https://humanmade.github.io/wp-pattern-library/npm-package#section-variants) (the same pattern on a second ground), give [query-loop item templates a post to bind to](https://humanmade.github.io/wp-pattern-library/npm-package#patterns-that-render-empty), settle [scroll-triggered animations](https://humanmade.github.io/wp-pattern-library/npm-package#animation-libraries) before capturing, and [group categories](https://humanmade.github.io/wp-pattern-library/npm-package#grouping-categories) into a multi-level taxonomy.

## Requirements

WordPress 6.0+ · PHP 8.1+ · Node 24+

## Documentation

| | |
|---|---|
| [About](https://humanmade.github.io/wp-pattern-library/) | What it does, and what it deliberately does not. |
| [Getting started](https://humanmade.github.io/wp-pattern-library/getting-started) | Install and first capture, against a local site. |
| [WordPress plugin](https://humanmade.github.io/wp-pattern-library/plugin) | What it adds to a site, access control, endpoints, filters. |
| [NPM package](https://humanmade.github.io/wp-pattern-library/npm-package) | Every config option, CLI commands, output. |
| [GitHub Action](https://humanmade.github.io/wp-pattern-library/github-action) | Running it in CI against a live site. |

Design decisions are recorded as ADRs in [`docs/architecture/`](docs/architecture).

## Contributing

Bug reports, ideas and pull requests are all welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup — `npm run env:start` gives you a WordPress with sixty patterns to capture against — and [`docs/roadmap.md`](docs/roadmap.md) for things that have been thought about but not built.

## License

GPL-2.0-or-later
