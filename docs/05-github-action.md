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

The trade-off is that it only sees what's deployed. The manifest comes from the captured site, so a pattern that exists on your branch and not on that site is absent from the library entirely — it appears for the first time in the run that follows its deployment. If you want previews of in-progress work, run the CLI locally alongside the PR instead.

## Setup

### 1. Deploy the plugin and create an account

The [plugin]({{ site.baseurl }}/plugin) has to be active on whichever site you capture from, and you need a user holding `view_pattern_library`:

```bash
wp pattern-library setup --login=pattern-library-bot
```

### 2. Store the credentials

Under **Settings → Secrets and variables → Actions**:

| Name                              | Kind     | Value                      |
| --------------------------------- | -------- | -------------------------- |
| `PATTERN_LIBRARY_WP_USER`         | Secret   | e.g. `pattern-library-bot` |
| `PATTERN_LIBRARY_WP_APP_PASSWORD` | Secret   | The application password   |
| `PATTERN_LIBRARY_SITE`            | Variable | `https://www.example.com`  |

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

    steps:
      - uses: actions/checkout@v7
        with:
          ref: ${{ inputs.base_branch }}

      - uses: actions/setup-node@v7
        with:
          node-version: 24

      - name: Build the pattern library
        uses: humanmade/wp-pattern-library@v0.4.2
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
| `version`           | no       | Version of the NPM package to run. See below.         |

Leave `version` alone. By default the action runs the package version matching
the ref it was used at, so `@v0.4.2` runs CLI 0.4.2 and the two cannot drift.
Set it only to test an unreleased package against a released action. A branch or
commit ref has no version to read and falls back to `latest`.

Pin the action to a released tag — there's deliberately no moving `@v1` tag
while the package is pre-1.0.

## Chromium

The action installs Chromium itself, matched to the Playwright version the CLI
resolves. Nothing to configure, and nothing that goes stale.

Running the job in `mcr.microsoft.com/playwright` is supported and saves the
system-library half of that install, but it is only ever an optimisation: the
image's own Chromium is used when its Playwright happens to match, and a
matching build is fetched when it doesn't. Pick the image tag to suit the
runner, not the CLI.

## Triggers

The example above illustrates a manual `workflow_dispatch`. This opens a pull request containing images and captures whatever is deployed at that moment.

For a hand-off approach, use any other triggers available in GitHub Actions:

### On a schedule

```yaml
on:
  workflow_dispatch:
  schedule:
    - cron: '0 6 * * 1'   # Mondays, 06:00 UTC
```

### When patterns or styles change

The obvious thing to reach for is a path-filtered `push`:

```yaml
on:
  workflow_dispatch:
  push:
    branches: [ main ]
    paths:
      - 'themes/*/patterns/**'
      - 'themes/*/parts/**'
      - 'themes/*/templates/**'
      - 'themes/*/theme.json'
      - 'themes/*/style.css'
      - 'themes/*/assets/**'
```

{: .warning }

> **A bare `push` trigger races your deploy.** The capture reads the *deployed* site, not the branch that just changed. A push-triggered run starts within seconds of the merge, while the deploy that would put those patterns on the site is still going — so the refresh captures the previous build and reports no changes, or worse, quietly re-commits the old screenshots. Use it only where the merge and the deploy are effectively the same event.

The trigger you usually want is the deploy finishing, not the push starting:

```yaml
on:
  workflow_dispatch:
  workflow_run:
    workflows: [ Deploy ]     # The `name:` of your deploy workflow.
    branches: [ main ]
    types: [ completed ]

concurrency:
  group: pattern-library-refresh
  cancel-in-progress: true

jobs:
  refresh:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
```

`workflow_run` takes no `paths` filter, so the path check moves inside the job — check out the commit the deploy shipped, with its parent, and compare:

```yaml
      - uses: actions/checkout@v7
        with:
          ref: ${{ github.event.workflow_run.head_sha || github.ref }}
          fetch-depth: 2

      - name: Did anything visual change?
        id: touched
        run: |
          set -euo pipefail

          if git diff --quiet HEAD^ HEAD -- \
            'themes/*/patterns/*' 'themes/*/parts/*' 'themes/*/templates/*' \
            'themes/*/theme.json' 'themes/*/style.css' 'themes/*/assets/*'
          then
            echo 'No pattern or style changes in this deploy.'
            echo 'changed=false' >> "$GITHUB_OUTPUT"
          else
            echo 'changed=true' >> "$GITHUB_OUTPUT"
          fi
```

Those pathspecs are not the same strings as the `paths:` filter above, and the difference is easy to lose an afternoon to. A `paths:` filter is matched by Actions, where `*` stops at a `/` and `**` is what recurses. A pathspec is matched by git, where `*` happily crosses `/` — but a pathspec containing a wildcard has to match the *whole* path, so the directory shorthand stops working: `themes/*/patterns` matches nothing at all, while `themes/*/patterns/*` matches every file at any depth beneath it.

Then guard the capture and the pull request with `if: steps.touched.outputs.changed == 'true'`. Leaving `workflow_dispatch` in place gives you a manual override for the times the diff is not the whole story — a plugin update or a content change can move a rendering without touching a file in that list.

The `concurrency` group matters more here than on a schedule: several merges in an afternoon would otherwise start several capture runs against the same site, each spending minutes in a browser to produce a pull request the next one supersedes. Cancelling the in-flight run keeps one refresh going at a time. The pull request itself is safe either way — `create-pull-request` reuses the `pattern-library/refresh` branch, so repeated runs update one pull request rather than opening a pile of them.

### Automatic triggers get no `inputs`

`schedule`, `push` and `workflow_run` all run without the `workflow_dispatch` inputs, so `${{ inputs.output_path }}` evaluates to an empty string. Give every input a default the expression can fall back to, or replace the references with `env:` values the whole workflow shares.

## Which environment to capture

Any environment the plugin is active on and the runner can reach. Production gives the most representative output; a QA or staging site gives live-ish content without depending on a release.

{: .warning }

> **Staging behind HTTP Basic can't be used.** The application password needs the `Authorization: Basic` header, and a request can only carry one. Use header-based access control instead, or capture from an environment that isn't gated that way.

## Sites behind an access proxy

An origin fronted by Cloudflare Access, or anything like it, answers before WordPress does — the manifest request comes back as an HTML login page, and no application password helps, because the request never reached WordPress.

Send the proxy's credentials alongside the application password:

```yaml
      - name: Build the pattern library
        uses: humanmade/wp-pattern-library@v0.4.2
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

The action is a thin wrapper. The CLI is a plain Node program, so GitLab CI, Bitbucket Pipelines, Buildkite or a cron job on a box all work the same way: install Node 24, run `npx playwright install --with-deps chromium` from the same install tree as the package, set the three environment variables, and run `npx @humanmade/wp-pattern-library build`.

## Troubleshooting

**The run captures the wrong site.** `PATTERN_LIBRARY_SITE` is a repository variable, so it's visible in the workflow log — check what the run actually printed.

**Chromium fails to install.** The install needs `apt` and passwordless `sudo` for its system libraries, which GitHub-hosted runners provide and a locked-down self-hosted runner may not. Run the job in the `mcr.microsoft.com/playwright` image, which ships those libraries; the action detects it and skips the `apt` half.

**The pull request is enormous.** Every screenshot changed, which usually means live content in query loops. See [screenshot churn]({{ site.baseurl }}/npm-package#troubleshooting).

**Nothing happens on a schedule trigger.** `schedule` doesn't pass `inputs`, so a workflow that relies on `${{ inputs.output_path }}` gets an empty string. Give the inputs defaults the expressions can fall back to. The same applies to `push` and `workflow_run`.

**An automatic refresh reports no changes after an obvious pattern change.** The run captured the site before the deploy reached it. Trigger the refresh from the deploy finishing rather than from the push — see [triggers](#when-patterns-or-styles-change).
