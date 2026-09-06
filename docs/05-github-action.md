---
layout: home
title: GitHub Action
nav_order: 5
permalink: /github-action
---

# GitHub Action

The repository ships a composite action that wraps the NPM package, so running the generator in CI is a few lines rather than a build script.

This is how you keep a library current without anyone remembering to update it — run it after a release, on a schedule, or on demand, and let it open a pull request with whatever changed.

## What CI adds

Running from a workflow rather than a local environment gets you two things:

- **Captures against a deployed site**, with real content, real images and real fonts, on code that's actually shipped.
- **A reviewable diff.** Screenshots are only rewritten when their bytes change, so the pull request contains exactly the patterns whose appearance changed. That doubles as a rough visual regression check — a screenshot that changes in a release nobody expected to touch the front end is worth a look.

The trade-off is that it only sees what's deployed. A pattern that exists on your branch and not on the captured site renders as *"Preview pending"* until it ships. If you want previews of in-progress work, run the CLI locally alongside the PR instead.

## Setup

### 1. Deploy the plugin and create an account

The [plugin]({{ site.baseurl }}/plugin) has to be active on whichever site you capture from, and you need a user holding `view_pattern_library`:

```bash
wp pattern-library setup --login=pattern-library-bot
```

### 2. Store the credentials

Under **Settings → Secrets and variables → Actions**:

| Name                              | Kind     | Value                     |
| --------------------------------- | -------- | ------------------------- |
| `PATTERN_LIBRARY_WP_USER`         | Secret   | `pattern-library-bot`     |
| `PATTERN_LIBRARY_WP_APP_PASSWORD` | Secret   | The application password  |
| `PATTERN_LIBRARY_SITE`            | Variable | `https://www.example.com` |

The site URL is a variable rather than a secret because it isn't one, and having it visible in the workflow log is useful when a run captures the wrong environment.

### 3. Check the credentials from your machine first

```bash
export PATTERN_LIBRARY_SITE="https://www.example.com"
export PATTERN_LIBRARY_WP_USER="pattern-library-bot"
export PATTERN_LIBRARY_WP_APP_PASSWORD="xxxx xxxx xxxx xxxx"

npx @humanmade/wp-pattern-library build --dry-run
```

A dry run makes no captures and writes nothing, but it does authenticate and fetch the manifest — which is where credential problems show up. Much faster to debug here than through CI logs.

## The workflow

Copy [`examples/refresh-pattern-library.yml`](https://github.com/humanmade/wp-pattern-library/blob/main/examples/refresh-pattern-library.yml) into `.github/workflows/` and adjust:

```yaml
name: Refresh pattern library

on:
  workflow_dispatch:
    inputs:
      base_branch:
        description: Branch to open the pull request against.
        required: true
        default: main
      output_path:
        description: Directory to write the pattern library into.
        required: true
        default: docs/pattern-library

permissions:
  contents: write
  pull-requests: write

jobs:
  refresh:
    runs-on: ubuntu-latest
    # Ships Chromium and its system dependencies preinstalled, which saves a
    # minute or so of apt traffic on every run.
    container: mcr.microsoft.com/playwright:v1.62.1-noble

    steps:
      - uses: actions/checkout@v7
        with:
          ref: ${{ inputs.base_branch }}

      - uses: actions/setup-node@v7
        with:
          node-version: 24

      - name: Build the pattern library
        uses: humanmade/wp-pattern-library@v0.3.0
        with:
          site-url: ${{ vars.PATTERN_LIBRARY_SITE }}
          username: ${{ secrets.PATTERN_LIBRARY_WP_USER }}
          app-password: ${{ secrets.PATTERN_LIBRARY_WP_APP_PASSWORD }}
          output-path: ${{ inputs.output_path }}

      - name: Open a pull request
        uses: peter-evans/create-pull-request@v8
        with:
          base: ${{ inputs.base_branch }}
          branch: pattern-library/refresh
          title: Refresh the pattern library
          commit-message: Refresh the pattern library
          add-paths: ${{ inputs.output_path }}
          delete-branch: true
```

To commit directly to a branch instead of opening a pull request, drop the last step and commit the `output_path` yourself.

## Action inputs

| Input               | Required | Purpose                                               |
| ------------------- | -------- | ----------------------------------------------------- |
| `site-url`          | yes      | Origin of the site to capture from.                   |
| `username`          | yes      | Login holding `view_pattern_library`.                 |
| `app-password`      | yes      | That user's application password.                     |
| `output-path`       | no       | Overrides `outputDir` from the config file.           |
| `working-directory` | no       | Where `pattern-library.config.js` lives. Default `.`. |
| `extra-headers`     | no       | Headers for an origin behind an access proxy.         |
| `version`           | no       | Version of the NPM package to run. Default `latest`.  |

Pin `version` to the same release as the action reference, so a run can't mix versions. Consuming workflows should pin the action to a released tag — there's deliberately no moving `@v1` tag while the package is pre-1.0.

## Triggers

The example is `workflow_dispatch` on purpose. A refresh opens a pull request containing images and captures whatever is deployed at that moment, so it's usually best run when you know what state the site is in.

On a schedule instead:

```yaml
on:
  workflow_dispatch:
  schedule:
    - cron: '0 6 * * 1'   # Mondays, 06:00 UTC
```

Note that `schedule` triggers don't receive `inputs`, so give the workflow defaults that stand on their own.

## Which environment to capture

Any environment the plugin is active on and the runner can reach. Production gives the most representative output; a QA or staging site gives live-ish content without depending on a release.

{: .warning }

> **Staging behind HTTP Basic can't be used.** The application password needs the `Authorization: Basic` header, and a request can only carry one. Use header-based access control instead, or capture from an environment that isn't gated that way.

## Sites behind an access proxy

An origin fronted by Cloudflare Access, or anything like it, answers before WordPress does — the manifest request comes back as an HTML login page, and no application password helps, because the request never reached WordPress.

Send the proxy's credentials alongside the application password:

```yaml
      - name: Build the pattern library
        uses: humanmade/wp-pattern-library@v0.3.0
        with:
          site-url: ${{ vars.PATTERN_LIBRARY_SITE }}
          username: ${{ secrets.PATTERN_LIBRARY_WP_USER }}
          app-password: ${{ secrets.PATTERN_LIBRARY_WP_APP_PASSWORD }}
          extra-headers: |
            CF-Access-Client-Id: ${{ secrets.CF_ACCESS_CLIENT_ID }}
            CF-Access-Client-Secret: ${{ secrets.CF_ACCESS_CLIENT_SECRET }}
```

Locally, the same thing as one `Name: value` per line:

```bash
export PATTERN_LIBRARY_EXTRA_HEADERS="CF-Access-Client-Id: <id>.access
CF-Access-Client-Secret: <secret>"
```

Non-secret headers can live in the config file instead, and merge underneath:

```js
extraHeaders: { 'X-Environment': 'production' },
```

These headers go on the manifest request and on every browser request made **to the site's own origin**. They're withheld from third-party requests a theme makes — fonts, analytics, CDNs — so a service token is never handed to a host that merely happens to be referenced by a pattern. If a font host sits behind the same gate it will fail to load, and the run will report it as a missing resource.

## Running it elsewhere

The action is a thin wrapper. The CLI is a plain Node program, so GitLab CI, Bitbucket Pipelines, Buildkite or a cron job on a box all work the same way: install Node 24 and Chromium, set the three environment variables, run `npx @humanmade/wp-pattern-library build`.

## Troubleshooting

**The run captures the wrong site.** `PATTERN_LIBRARY_SITE` is a repository variable, so it's visible in the workflow log — check what the run actually printed.

**Chromium fails to install.** Use the `mcr.microsoft.com/playwright` container image, which ships it. The action skips its own install when it detects one.

**The pull request is enormous.** Every screenshot changed, which usually means live content in query loops. See [screenshot churn]({{ site.baseurl }}/npm-package#troubleshooting).

**Nothing happens on a schedule trigger.** `schedule` doesn't pass `inputs`, so a workflow that relies on `${{ inputs.output_path }}` gets an empty string. Give the inputs defaults the expressions can fall back to.
