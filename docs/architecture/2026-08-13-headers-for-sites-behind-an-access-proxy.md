# Send configurable request headers for sites behind an access proxy

Date: 2026-08-13

## Status

Accepted

## Context

Authentication so far has been one mechanism: a WordPress application password
sent over HTTP Basic, by Node for the manifest and by the browser for each
capture. That assumes requests reach WordPress.

Increasingly they do not. A consuming project runs its environments behind
Cloudflare Access, which answers at the edge: an unauthenticated request is
redirected to an identity provider, so the manifest fetch returns an HTML login
page and the run fails on "expected JSON". No application password can help,
because WordPress never sees the request.

Cloudflare's non-interactive path for this is a service token — a client ID and
secret presented as the `CF-Access-Client-Id` and `CF-Access-Client-Secret`
request headers. Other proxies differ in header name but not in shape.

Two properties of the problem shape the design:

- The credential is a bearer secret in a header. Anything that receives the
  request receives the secret.
- Both request paths need it. Node fetches the manifest; Playwright renders the
  patterns. Solving only one leaves the other failing, and the browser-side
  failure is the one that produces a run's worth of wrong screenshots.

## Decision

Add an `extraHeaders` config option: a map of header names to values, merged
from the config file and from `PATTERN_LIBRARY_EXTRA_HEADERS` in the
environment, which carries `Name: value` lines. Secrets stay in the environment;
the config file is for headers a project is willing to commit. The GitHub Action
exposes the same thing as an `extra-headers` input, passed through as an
environment variable rather than interpolated into the shell.

The headers are attached to the manifest fetch, and to browser requests **whose
origin matches the site**. Playwright's context-level `extraHTTPHeaders` would
have been one line, but it attaches headers to every request the page makes,
including the fonts, analytics and CDN assets a theme pulls from third parties.
Origin scoping is instead implemented with `context.route()`, which rewrites
headers per request.

## Consequences

Gated environments become capturable, which was previously true only of
environments open to the internet. HTTP Basic gates remain unsupported, for the
unchanged reason: two `Authorization: Basic` headers cannot coexist on one
request, and the application password needs that header.

The service token is never handed to a third-party host, which matters because
the set of hosts a pattern touches is a property of the pattern, not of the
configuration — an editor adding an embed should not widen who holds the
credential. This is the same reasoning that scopes `httpCredentials` to the
site's origin.

The cost is route interception on every browser request when headers are
configured, which bypasses the browser cache for those requests and adds a small
per-request overhead. Captures are already dominated by page load and settle
time, and the interception is skipped entirely when `extraHeaders` is empty.

An empty header value is dropped rather than sent. A workflow composing the
block from CI secrets leaves a bare `Name:` behind when a secret is unset, and a
header sent empty reads to the proxy as a failed credential rather than an
absent one.
