# dsh-desc-lang

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

> Tool-call descriptions in your GUI language — every tool-call `description` in [DeepSeek Harness (DSH)](https://www.npmjs.com/package/@deepseek-ai/dsh), including PTC mode's `run_code` `description` (the call card's title), gets written in the language your web GUI is actually showing, instead of always English.

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

- **Detection order** (auto mode): the explicit Settings → General → Language choice > the browser-reported active locale; neither, or English → inject nothing (English is already the default behavior).
- **Channel**: `systemPrompt.context()` — the same per-request runtime-context snapshot as the sandbox/approval policies, rendered near the end of each request so recency beats the English tool-schema guidance. A GUI language switch takes effect on the very next request.
- **Settings card**: Settings → Plugins pairs Host-served namespaces with registered cards automatically; switch behavior (follow GUI language / force a BCP 47 tag like `zh`, `ja` / off) and inspect the detection chain.

## Install

```bash
dsh plugin --profile web add dsh-desc-lang
```

Plain JS, no build step, no installed dependencies (schemastery is a peer resolved through the profile). Restart DSH after installing.

## Verify

1. Install, restart DSH, open the Web GUI (browser language or setting on Chinese);
2. `~/.dsh/settings.yaml` gains a `desc-lang:` section (`uiLocale: zh`) once a page loaded;
3. Any new session: tool-call descriptions come out in Chinese;
4. Switch the GUI language in Settings → General — descriptions switch on the next request;
5. Settings → Plugins → Tool Description Language: force `ja`, switch off, etc.

## Known limits

- `minimal` is sealed by design (see table).
- Without a browser page (pure CLI deployments) only the explicit choice is detectable.
- The GUI language is one global value; the most recently loaded page's report wins.
- Subagents / workflow models see the directive too (their descriptions are user-facing as well).

## License

MIT
