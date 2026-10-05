# Claude Code identity evidence: 2.1.285

Registry: https://registry.npmjs.org, queried 2026-10-06 Asia/Shanghai.
`npm view @anthropic-ai/claude-code dist-tags version dist.tarball --json --registry=https://registry.npmjs.org`
returned stable=2.1.285, latest=next=2.1.289. Stable was selected explicitly.
Both the wrapper and linux-x64 packages were downloaded with `npm pack --ignore-scripts`.

## Offline capture

The official linux-x64 binary ran with a fresh HOME/CLAUDE_CONFIG_DIR, an explicit
minimal environment, a dummy API key, nonessential traffic disabled, and
ANTHROPIC_BASE_URL pointing to a loopback HTTP stub. No real credentials were read.
Invocation: `claude -p "Reply OK" --model claude-sonnet-4-5 --tools "" --no-session-persistence`.
The stub returned HTTP 400 intentionally after capturing the request; CLI exit 1
is expected and is not a live upstream compatibility test.

Observed identity:
- User-Agent: claude-cli/2.1.285 (external, sdk-cli)
- x-stainless-package-version: 0.127.0
- x-stainless-runtime: node; x-stainless-runtime-version: v26.3.0
- x-stainless-os: Linux; x-stainless-arch: x64
- x-stainless-lang: js; x-stainless-timeout: 600; x-stainless-retry-count: 0
- x-app: cli; anthropic-dangerous-direct-browser-access: true
- billing: x-anthropic-billing-header: cc_version=2.1.285.3f4; cc_entrypoint=sdk-cli;

Explicit CLAUDE_CODE_ENTRYPOINT=cli did not override sdk-cli in print mode.
The defaults use the observed noninteractive profile, not an invented interactive
profile. The existing fingerprint algorithm is preserved: this capture proves
billing format, not byte-for-byte equivalence of the fingerprint algorithm.
Authentication, client recognition, beta selection, and risk controls are unchanged.

## Verification

`node node_modules/jest/bin/jest.js --runInBand --runTestsByPath tests/claudeCodeEmulationVersion.test.js tests/claudeRelayServiceToolsCache.test.js`
passed 2 suites / 34 tests. Coverage includes unified UA on/off, higher/lower/same
version caches, mismatched same-version SDK/entrypoint, exact matching cache,
case-insensitive stale headers, real clients/non-emulation, and both stream flags
on the shared preparation method. No real upstream request was tested.

`git diff --check` passed. Targeted ESLint passed for the new identity module,
header service, OAuth/test helpers, account services, browser fallback and tests.
`npm run lint:check` has one pre-existing securityHardening.js formatting error.
Explicit lint of the deeply nested relay files also finds 17 Claude relay and 15
Console relay errors. HEAD was checked with ESLint --stdin --stdin-filename;
rule/message multisets match the working files exactly (no new lint errors).
No stash or unrelated lint cleanup was performed.

Release: 2.0.13. Existing SSE diagnostic WIP is excluded from the commit.
Production was not restarted; a separately authorized restart is required.
