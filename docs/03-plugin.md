---
layout: home
title: WordPress plugin
nav_order: 3
permalink: /plugin
---

# WordPress plugin

The plugin is the half that runs on WordPress. It adds one front-end endpoint that renders a single registered pattern in isolation, and a manifest listing every pattern available to capture.

## Installing

```bash
composer require humanmade/wp-pattern-library
wp plugin activate wp-pattern-library
```

The Composer package declares `"type": "wordpress-plugin"`, so `composer/installers` routes it to the project's plugin directory. This can be activated as a standard plugin, or in code from mu-plugins.

The plugin belongs in whichever environment you capture *from*. If you only generate locally, a `require-dev` install is fine.

### Enabling it temporarily

Because the plugin is inert unless its query var is present, it's reasonable to activate it on a production site, capture, and deactivate again — for instance to document patterns that were built in the editor rather than committed to the theme. 

Nothing persists when deactivated except the role, and the routes can be switched off without deactivating:

```php
add_filter( 'pattern_library_enabled', '__return_false' );
```

## Choosing which patterns to expose

By default the manifest lists every pattern in the registry, core's included. Limit it to your own:

```php
add_filter( 'pattern_library_namespaces', fn () => [ 'my-theme/', 'my-plugin/' ] );
```

Prefixes are matched literally, so keep the trailing slash. You can also filter on the generator side, but doing it here means the site never serves patterns that are none of the library's business.

## Access control

The routes are gated behind `view_pattern_library`, a custom primitive capability. No built-in role holds it — administrators included. That's the point: the account that reads the library should hold that one capability and nothing else.

```bash
wp pattern-library setup                            # Create the role.
wp pattern-library setup --login=<login>            # ...and a user in it.
wp pattern-library setup --login=<login> --email=<email>
wp pattern-library grant <user>                     # Grant it to an existing user.
```

`<user>` accepts a login, an email address, or a numeric ID. Both commands mint and print an application password when they touch a user; it isn't recoverable, so capture it at the time.

The bundled `pattern_library` role has the `read` and `view_pattern_library` caps and nothing else, so the account can't create or change content.

- **On multisite**, roles are stored per site. Run `setup` with `--url=` for each site you want to capture.
- **Application passwords need HTTPS**, or `WP_ENVIRONMENT_TYPE` set to `local`. WordPress refuses to generate one otherwise.

To grant access through your own role management instead:

```php
add_filter( 'pattern_library_user_can', fn () => current_user_can( 'edit_theme_options' ) );
```

## The endpoints

Both are query vars on `index.php`, on the front end.

| URL                                             | Returns                                   |
| ----------------------------------------------- | ----------------------------------------- |
| `/index.php?pattern-library-preview=__manifest` | JSON manifest of patterns and categories. |
| `/index.php?pattern-library-preview=<name>`     | One pattern, rendered in a bare page.     |

`<name>` is a full pattern name (`my-theme/hero`) or an unambiguous basename (`hero`).

`index.php` is targeted rather than `/` because a site may have proxy or rewrite rules that intercept the root path before WordPress sees the query var.

A pattern renders in a minimal HTML document with `wp_head()` and `wp_footer()` intact, so the theme's real stylesheets, fonts and block styles load — but with no site header, footer or admin bar. The pattern is wrapped in `#pattern-library-preview`, which is what the capture tool crops to.

Every response carries `X-Robots-Tag: noindex, nofollow` and cache-busting headers. An unauthenticated request gets a `401` with a `WWW-Authenticate` challenge.

Three further query vars exist, all set by the CLI rather than by hand:

| Query var                     | Purpose                                                        |
| ----------------------------- | -------------------------------------------------------------- |
| `pattern-library-post-type`   | Wrap the pattern in a one-item query loop over this post type. |
| `pattern-library-placeholder` | Substitute a placeholder featured image.                       |
| `pattern-library-wrapper`     | JSON group-block attributes to wrap the pattern in.            |

## How authentication works

Worth understanding, because both of these fail *silently* — WordPress serves the logged-out page with a `200`, so a broken setup doesn't error. It produces a complete, plausible, entirely wrong pattern library.

Requests authenticate with a standard WordPress application password over HTTP Basic Auth. Two things make that work on a front-end route:

- **`wp_authenticate_application_password()` ignores any request that isn't REST or XML-RPC.** A front-end route authenticates as nobody otherwise. The route opts itself in through the `application_password_is_api_request` filter, scoped to its own query var.
- **Browsers only attach Basic credentials after a `401` carrying `WWW-Authenticate`,** and never send them preemptively. Playwright's `httpCredentials.send: 'always'` looks like it fixes this and doesn't — it applies to Playwright's API request context, not to page navigation. So the route sends a real challenge with its `401`.

As a backstop, the CLI navigates the browser to the manifest URL and requires a `200` before capturing anything.

{: .warning }

> **An origin behind HTTP Basic can't be captured.** The application password needs the `Authorization: Basic` header, and a request can only carry one. Gates that use other headers — Cloudflare Access service tokens, for instance — are supported; see [access proxies]({{ site.baseurl }}/github-action#sites-behind-an-access-proxy).

## The manifest

The manifest is the contract between the two packages: the plugin produces it and the NPM package consumes it.

```json
{
	"manifestVersion": 1,
	"features": [ "variants" ],
	"site": { "name": "Example", "url": "https://example.com/" },
	"categories": [ { "slug": "banner", "label": "Banners" } ],
	"patterns": [
		{
			"name": "my-theme/hero",
			"basename": "hero",
			"title": "Hero",
			"description": "A full-width hero.",
			"categories": [ "banner" ],
			"keywords": [ "masthead" ],
			"blockTypes": [ "core/group" ],
			"postTypes": [],
			"viewportWidth": 1440,
			"inserter": true,
			"source": "theme"
		}
	]
}
```

Pattern markup is deliberately omitted — the library documents patterns visually, and shipping every pattern's content would make the manifest an order of magnitude larger.

`manifestVersion` only moves when the shape changes incompatibly; the CLI refuses a version it doesn't understand rather than misreading it. `features` is additive, so a CLI too old to know a feature never asks for it, and one configured to use a feature can say plainly that the *site* is too old.

Keep the plugin and the CLI on the same version. They ship from one repository under one tag for exactly this reason.

## Filters

| Filter                              | Purpose                                   |
| ----------------------------------- | ----------------------------------------- |
| `pattern_library_enabled`           | Disable the routes entirely.              |
| `pattern_library_namespaces`        | Pattern-name prefixes to expose.          |
| `pattern_library_user_can`          | Override the capability check.            |
| `pattern_library_placeholder_image` | Markup of the placeholder featured image. |
| `pattern_library_wrapper_open`      | Opening markup of a variant wrapper.      |
| `pattern_library_wrapper_close`     | Closing markup of a variant wrapper.      |

Disable the routes outside development:

```php
add_filter( 'pattern_library_enabled', fn () => 'production' !== wp_get_environment_type() );
```

Use a themed placeholder image:

```php
add_filter( 'pattern_library_placeholder_image', function (): string {
	return '<img src="' . esc_url( get_theme_file_uri( 'images/placeholder.svg' ) ) . '" alt="">';
} );
```

Replace the variant wrapper with your own section markup:

```php
add_filter( 'pattern_library_wrapper_open', function ( string $open, array $attributes ): string {
	return '<div class="section section--' . esc_attr( $attributes['className'] ?? 'default' ) . '">';
}, 10, 2 );

add_filter( 'pattern_library_wrapper_close', fn (): string => '</div>' );
```

## Variant wrappers

When the CLI asks for a [section variant]({{ site.baseurl }}/npm-package#section-variants), the plugin builds the wrapper server-side as a real `core/group` block, from JSON attributes in the query var. What travels in the URL is data, never markup.

`className`, `align`, `backgroundColor`, `gradient`, `textColor`, `style` and `layout` are accepted — the attributes of a section group. Anything else is dropped, so a config typo can't quietly become a block attribute nobody meant to set.

Two details make this a real group block rather than a class added in the browser:

- Block stylesheets registered with `wp_enqueue_block_style()` only load when their block actually renders. A pattern containing no group of its own would otherwise be captured without the very CSS the wrapper's style lives in.
- Colour classes are written out in full, because core applies colour supports server-side only to dynamic blocks.

## Troubleshooting

**`wp pattern-library` isn't a command.** The plugin isn't active on the site you're running WP-CLI against. Check `wp plugin list --status=active`, and add `--url=` on multisite.

**`Application passwords are unavailable for this user`.** Set `WP_ENVIRONMENT_TYPE` to `local`, or use HTTPS. The role and user are still created; run `wp pattern-library grant <login>` afterwards to mint the password.

**The manifest returns a WordPress 404 page.** The plugin isn't active on that site.

**The manifest returns an HTML login page.** Something is answering before WordPress — an access proxy, an SSO gateway, or a "coming soon" plugin short-circuiting the front end before `template_redirect`.
