# Allow unauthenticated access in local environments

Date: 2026-10-01

## Status

Proposed

## Context

Currently the preview routes require authentication and a specific capability. Capturing a library therefore takes four steps before the first screenshot: create the role, create or grant a user, mint an application password, and export the login and password into the shell.

This is unnecessary on a developer's own machine, and we'd like to remove friction from the set up process so that it's easier to trial the plugin and see if it will be useful on a project.

## Decision

The plugin will allow unauthenticated requests when the environment type is
`local`. The decision is made by a new filter, `pattern_library_allow_unauthenticated`,
whose default is `'local' === wp_get_environment_type()`. Its result is
combined with the capability check before the existing `pattern_library_user_can`
filter runs, so that filter keeps the final word.

The CLI stops requiring credentials. It sends the `Authorization` header and
Playwright's `httpCredentials` only when both a login and a password are
configured; one without the other is a configuration error. When a site answers
401 to a request that carried no credentials, the error says the site requires
them, rather than reporting an authentication failure for a user that was never
named.

The decision stays on the server. The CLI does not try to detect a local site,
and has no flag that skips authentication; it only declines to send credentials
it does not have. A deployed site answers exactly as it did before.

The GitHub Action keeps `username` and `app-password` as required inputs. It
exists to capture deployed environments, where the credentials are needed, and
making them optional would turn a forgotten secret into a confusing 401 rather
than an immediate input error.

## Consequences

A local capture needs only the site URL: `wp pattern-library setup`, the
application password and the credential exports move out of the getting-started
path and into the section on capturing a deployed site.

The routes are open on any environment whose type is `local`, including one a
developer exposes through a tunnel such as ngrok, or a deployed environment that
is misconfigured as `local`. The exposure is bounded — the routes are read-only,
render only patterns the site already registers, and send `noindex` and
no-cache headers — and the same misconfiguration already relaxes core's HTTPS
requirement for application passwords. A project that wants authentication
everywhere returns false from `pattern_library_allow_unauthenticated`.

Unauthenticated local requests render as a logged-out visitor, which is what a
pattern looks like to most of its audience. The authenticated path already
suppresses the admin bar, so the two differ only where a theme or block varies
its output for logged-in users — and the bot account a deployed capture uses
holds no capability beyond `read`, so it sees close to the logged-out page too.

The filter exists partly so the behaviour can be tested. The test suite runs in
wp-env with `WP_ENVIRONMENT_TYPE` set to `local`, and core caches the
environment type for the life of the process, so the tests cannot switch it per
case. They control the filter instead.
