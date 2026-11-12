# dsh-agent-lang

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

[简体中文](README.md) | English | [日本語](README_JA.md) | [한국어](README_KO.md)

> Agent language control — three independently configured channels for [DeepSeek Harness (DSH)](https://www.npmjs.com/package/@deepseek-ai/dsh) model output: **tool-call descriptions** (including PTC mode's `run_code` `description`, the call card title), **model thinking**, and **replies** — each follows the GUI language, forces a fixed language, or turns off, with one-click sync-all / off-all shortcuts. By default only the descriptions channel is on.

## Why

Every tool call in DSH carries a required `description` argument that is displayed verbatim as the call's UI label. The tool schemas describe that field with English wording and English examples ("5-10 words … Examples: 'Count TODO markers…'"), so models default to English descriptions regardless of the GUI language.

This plugin changes only the PROMPT side: one global dynamic runtime-context directive states the GUI's display language and instructs the model to write every tool-call description in it. No preset, persona, or tool schema is modified — those are deployment-owned assets an upgrade overwrites anyway.

## Coverage

| Mode / preset | Supported | Notes |
|---|---|---|
| `standard` | ✅ | |
| `ptc` (PTC mode, formerly `code`) | ✅ | `run_code`'s `description` included |
| `cordis` (Creation mode) | ✅ | |
| User presets (incl. `ptc-cordis`, dsh-gitbash-shell variants) | ✅ | Host-plane registration covers every unsealed preset in the process |
| Agent-Team teammates / ordinary subagents (v0.8.0) | ✅ **on by default** | Teammate and subagent requests carry the same directive; Settings can switch to "main agent only". A **forked** teammate still inherits the main agent's completed-turn history snapshot (which carries the directive already committed there) — no switch rewrites history |
| `minimal` | ❌ (by design) | minimal mounts a complete persona and suppresses runtime context — its prompt is sealed against every late contributor; no prompt-level plugin can reach it |

## How it works

- **Detection order** (auto mode): the explicit Settings → General → Language choice > the browser-reported active locale. **English is a regular target too** (v0.3.0+): some models mix languages inside thinking/replies, and an explicit English directive pins them; only a fully undetected language injects nothing.
- **Channel**: `systemPrompt.context()` — the same per-request runtime-context snapshot as the sandbox/approval policies, rendered near the end of each request so recency beats the English tool-schema guidance. A GUI language switch takes effect on the very next request.
- **Settings card**: the Plugins panel → this plugin's bundle detail page hosts the card. It reads this plugin's row `Config` and the `locale` row through `configForms`; switch behavior (follow GUI language / force a BCP 47 tag — pick from the dropdown or type one, e.g. `zh`, `ja` / off) and inspect the detection chain.

## Install

```bash
dsh plugin --profile web add dsh-agent-lang
```

Plain JS, no build step, no installed dependencies (schemastery is a peer resolved through the profile). Restart DSH after installing.

## Verify

1. Install, restart DSH, open the Web GUI (browser language or setting on Chinese);
2. The current profile's `cordis.patch.yml` user layer gains `- id: agent-lang` and `config.uiLocale: zh` once a page loaded;
3. Any new session: tool-call descriptions come out in Chinese;
4. Switch the GUI language in Settings → General — descriptions switch on the next request;
5. Plugins panel → this plugin's bundle detail page → Tool Description Language: pick `ja` from the force-language dropdown (or type any tag), switch off, etc.

## Version compatibility

**Supports dsh >= 0.2.2-rc.1 only** (single-generation baseline since v0.13.0; stay on v0.12.1 for older hosts):

- There is one settings surface: the row `Config` (row id `agent-lang`) plus the client `configForms`. dsh 0.2.2 no longer has `settings.register(ns, schema)`, `settingsScope`, or `settings.get(ns)`, so no legacy probe remains.
- Every `Config` field declares `.volatile()`; the browser half writes only `uiLocale`, while the card writes `mode` / `forceLocale` / `thinkMode` / `outMode` / `subagents`. `.volatile()` requires schemastery 3.19.0, so both peer and dev floors are `^3.19.0`.
- The `systemPrompt.context()` contract is unchanged: `PromptContext` is still `{ name, order, text, interpolate }`, and order 130 sits between `SUBAGENT_DELEGATION 120` and `HARNESS_SOURCE 200` (rc.2 removed `TEAM_IDENTITY 125`). The injected text is BCP47-validated and sets `interpolate: false`, so `{{...}}` interpolation cannot apply.
- Card chrome uses the official design tokens (radius / focus ring) directly, with no old-literal fallbacks; the page card itself has no collapsible header (its sections still fold with a text `▸`). All 21 dictionaries still ship.
- The compatibility gate is decided solely by `engines.dsh >=0.2.2-rc.1` (`app-boot` ignores peers when `engines.dsh` exists); `peerDependencies["@deepseek-ai/dsh"]` mirrors it and stays optional so package managers never auto-install a prerelease-only host. No ceiling.
- **Checked against 0.2.2-rc.1**: the official system-prompt only adds `TOOL_APPLY_PATCH: 1350` / `TOOL_SCHEDULE: 2500` in the tool section, leaving order 130 free; the single `plugins.bundle.config` seat, all 21 dictionaries, and live loading were verified.
- **Checked against 0.2.2-rc.2**: `CONTEXT_ORDERS` drops `TEAM_IDENTITY: 125`, so order 130 still sits after `SUBAGENT_DELEGATION 120` and before `HARNESS_SOURCE 200`; the `systemPrompt.context` contract, the single settings seat, and all 21 dictionaries are unchanged; `npm test` is 47/47.

## Relation to dsh's description-first tool wording (complementary, zero conflict)

The `bash` / `pwsh` tool schemas carry the "Provide `description` before `command` in the arguments" guidance, so the UI renders an arrived description already during a call's preparing phase. This is orthogonal to this plugin and complementary:

- **the host owns the order**: nudging the model to send the description first, so the preparing-phase card has a title to render;
- **this plugin owns the language**: the same runtime-context directive decides which language those descriptions (preparing-phase titles included) are written in.

The official English example wording in the schemas is unchanged, so the "Chinese UI, English descriptions" gap is still this plugin's description channel to close. The channel is global and keys off the call's `description` argument, independent of tool-list churn. Re-verified against dsh 0.2.2-rc.2: the `systemPrompt.context` signature is unchanged; `CONTEXT_ORDERS` dropped `TEAM_IDENTITY 125`, so order 130 sits between `SUBAGENT_DELEGATION 120` and `HARNESS_SOURCE 200`.

## Known limits

- `minimal` is sealed by design (see table).
- Without a browser page (pure CLI deployments) only the explicit choice is detectable.
- The GUI language is one global value; the most recently loaded page's report wins.
- Subagents / workflow models see the directive by default too (their descriptions are user-facing as well); the card's subagent switch can narrow it to the main agent only. Two boundaries: (1) a forked subagent inherits the main agent's committed prefix, and the switch does not rewrite that history; (2) external providers with their own prompt (codex / claude-code / acp / sdk) and `minimal`'s sealed prompt never pass through the host `systemPrompt`, so the switch does not affect them.

## License

MIT
