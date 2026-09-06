---
layout: home
title: Getting started
nav_order: 2
permalink: /getting-started
---

# Getting started

The quickest way to see what this does is point it at the site you already have running locally. Nothing is deployed, no CI involved, and if you don't like the result you delete a directory.

These steps are the ones the project's own test environment runs, so they work as written.

You need a WordPress site running locally with a block theme that registers patterns, Node 24+, and WP-CLI access to that site. Any local environment works — `wp-env`, Altis, VIP, Local, Studio, MAMP, a plain `wp server`. The tool talks to the site over HTTP and doesn't care what is serving it.

WP-CLI commands below are written as plain `wp`. Run them however your environment expects.

## 1. Install the plugin

```bash
composer require humanmade/wp-pattern-library
wp plugin activate wp-pattern-library
```

The package declares `"type": "wordpress-plugin"`, so `composer/installers` routes it to the project's plugin directory without any `installer-paths` change.

Not using Composer? Clone the repository into your plugins directory and activate it. There is no build step.

## 2. Limit it to your own patterns

WordPress registers a lot of patterns you didn't write. Tell the plugin which namespace is yours:

```php
add_filter( 'pattern_library_namespaces', fn () => [ 'my-theme/' ] );
```

Put this in your theme's `functions.php` or a small mu-plugin. The prefix is matched literally, so keep the trailing slash.

## 3. Create an account for the generator

The routes are gated behind a dedicated capability, `view_pattern_library`. A bundled WP-CLI command creates a role that holds it, plus a user in that role:

```bash
wp pattern-library setup --login=pattern-library-bot
```

It prints an application password once:

```
Store these as CI secrets — the password is not recoverable:
  PATTERN_LIBRARY_WP_USER=pattern-library-bot
  PATTERN_LIBRARY_WP_APP_PASSWORD=ExsLVnKTz0aSHpwTXGwBlTC7
```

Copy it now.

{: .warning }

> **Your own admin account won't work without a grant.** `view_pattern_library` is a custom capability, so no built-in role holds it — administrator included. To use an existing user instead of a bot account, run `wp pattern-library setup` and then `wp pattern-library grant <user>`.

{: .note }

> **Application passwords need HTTPS, or a local environment.** If the command warns that they're unavailable, set `WP_ENVIRONMENT_TYPE` to `local` in `wp-config.php`. Most local environments already do.

## 4. Configure the generator

In your project root — the repository, not the WordPress install — create `pattern-library.config.js`:

```js
export default {
	title: 'My Theme Pattern Library',
	namespaces: [ 'my-theme/' ],
	outputDir: 'docs/pattern-library',
};
```

Credentials never go in this file. They come from the environment:

```bash
export PATTERN_LIBRARY_SITE="http://localhost:8888"
export PATTERN_LIBRARY_WP_USER="pattern-library-bot"
export PATTERN_LIBRARY_WP_APP_PASSWORD="ExsLVnKTz0aSHpwTXGwBlTC7"
```

Use whatever URL you actually browse the site at. Plain HTTP and a port number are fine.

## 5. Look before you leap

```bash
npx @humanmade/wp-pattern-library build --dry-run
```

This fetches the pattern list and reports what a real run would do, without writing anything or starting a browser:

```
My Theme — http://localhost:8888
62 patterns in the library, 47 skipped, 62 targeted.
Skipped: 11 outside configured namespaces, 28 hidden from the inserter, 8 scoped to wp_template.

Dry run — nothing written.
```

A large "skipped" number is usually correct — patterns hidden from the inserter and template parts are excluded by default. See [exclusions]({{ site.baseurl }}/npm-package#exclusions).

## 6. Capture a few patterns

Before committing to a full run, try one. A bare argument filters by pattern basename:

```bash
npx @humanmade/wp-pattern-library build hero
```

```
Capturing to /path/to/project/docs/pattern-library/screenshots
  write  hero-book (1440px, 792px tall)
  write  hero-full-width-image (1440px, 840px tall)
  write  hero-podcast (1440px, 648px tall)

3 written, 0 unchanged, 0 empty, 0 failed.

Wrote /path/to/project/docs/pattern-library/README.md and 15 category pages.
```

Open `docs/pattern-library/README.md` and click through. This is the moment to check that fonts loaded, images resolved, and nothing is cut off.

## 7. Run the whole thing

```bash
npx @humanmade/wp-pattern-library build
```

Expect this to take a while on a large library — it's a real browser loading a real page per capture. A hundred patterns is a few minutes.

Screenshots are only written when their bytes change, so re-running doesn't churn images whose content merely shifted underneath them. That's what makes the output reviewable in a pull request.

## Adding it to your project

Install the CLI as a dev dependency so everyone runs the same version:

```bash
npm install -D @humanmade/wp-pattern-library
```

```json
{
	"scripts": {
		"patterns": "pattern-library build"
	}
}
```

## Next

- [WordPress plugin]({{ site.baseurl }}/plugin) — what it adds to a site, access control, filters.
- [NPM package]({{ site.baseurl }}/npm-package) — every config option, CLI commands, output.
- [GitHub Action]({{ site.baseurl }}/github-action) — running it in CI against a live site.
