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
| `minimal` | ❌ (by design) | minimal mounts a complete persona and suppresses runtime context — its prompt is sealed against every late contributor; no prompt-level plugin can reach it |

## How it works

- **Detection order** (auto mode): the explicit Settings → General → Language choice > the browser-reported active locale. **English is a regular target too** (v0.3.0+): some models mix languages inside thinking/replies, and an explicit English directive pins them; only a fully undetected language injects nothing.
- **Channel**: `systemPrompt.context()` — the same per-request runtime-context snapshot as the sandbox/approval policies, rendered near the end of each request so recency beats the English tool-schema guidance. A GUI language switch takes effect on the very next request.
- **Settings card**: Settings → Plugins pairs Host-served namespaces with registered cards automatically; switch behavior (follow GUI language / force a BCP 47 tag — pick from the dropdown or type one, e.g. `zh`, `ja` / off) and inspect the detection chain.

## Install

```bash
dsh plugin --profile web add dsh-agent-lang
```

Plain JS, no build step, no installed dependencies (schemastery is a peer resolved through the profile). Restart DSH after installing.

## Verify

1. Install, restart DSH, open the Web GUI (browser language or setting on Chinese);
2. `~/.dsh/settings.yaml` gains a `agent-lang:` section (`uiLocale: zh`) once a page loaded;
3. Any new session: tool-call descriptions come out in Chinese;
4. Switch the GUI language in Settings → General — descriptions switch on the next request;
5. Settings → Plugins → Tool Description Language: pick `ja` from the force-language dropdown (or type any tag), switch off, etc.

## Version compatibility

**dsh 0.1.7-rc.1 was checked item by item on a real isolated instance and needs no code change** (record: CHANGELOG v0.7.0); the same holds for 0.1.6-alpha.1 (CHANGELOG v0.4.3):

- The `systemPrompt.context()` contract is unchanged: `PromptContext` is still `{ name, order, text }`, with order 125 still after the official CONTEXT_ORDERS. The `interpolate: false` flag applies to **sections** only, which this plugin does not use.
- The injected text carries no `{{...}}` interpolation risk: every language source (forced tag, explicit setting, browser report) passes BCP47 validation before it reaches the text.
- The settings surface still splits at 0.1.7 (row `Config` + `configForms` above it, the registered namespace below), and the settings card still ships both seats: `settings.plugin.item` (hosts ≤ 0.1.6, where it silently waits on 0.1.7+) and `plugins.bundle.config` keyed by the package name (0.1.6-alpha.2+, live on 0.1.7).
- The manifest declares the compatibility peer dsh 0.1.7-rc.1 enforces — `"@deepseek-ai/dsh": ">=0.1.0"` (optional, so package managers never auto-install a prerelease-only package). The declaration puts this plugin under the gate (it carried no such peer before, so it was never validated) while leaving the range open-ended: the plugin adapts to host changes by runtime detection, so a future dsh upgrade never disables it silently.

## Known limits

- `minimal` is sealed by design (see table).
- Without a browser page (pure CLI deployments) only the explicit choice is detectable.
- The GUI language is one global value; the most recently loaded page's report wins.
- Subagents / workflow models see the directive too (their descriptions are user-facing as well).

## License

MIT
