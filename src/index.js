/**
 * dsh-agent-lang — host half (plain JavaScript, no build step).
 *
 * WHY: every tool call in DSH carries a required `description` argument that
 * is the call's always-visible UI label — the bash `description` precedent,
 * and for PTC mode the `run_code` `description` (the call card's title).
 * The product's tool schemas describe that field with English wording and
 * English examples ("5-10 words … Examples: 'Count TODO markers…'"), so every
 * model defaults to English descriptions no matter what language the user's
 * GUI is showing. This plugin changes only the PROMPT side: it registers ONE
 * global dynamic runtime-context entry (`systemPrompt.context`) that states
 * the GUI's display language and instructs the model to write every
 * tool-call description in that language. No preset, persona, tool schema,
 * or shipped file is modified — those are deployment-owned assets an upgrade
 * overwrites anyway.
 *
 * WHY context() and not section(): the directive rides the same
 * per-request runtime-context snapshot as the sandbox/approval policies
 * (rendered near the END of each request, so recency works FOR overriding
 * the English tool-schema guidance that sits earlier in the prompt), and a
 * language switch in the GUI takes effect on the very next request because
 * the text provider is evaluated at every assembly.
 *
 * COVERAGE: the context is registered on the HOST plane, so every agent
 * preset that does not seal its own prompt merges it — the four built-ins
 * standard / ptc / cordis, user presets, and the presets materialized by
 * companion plugins (dsh-ptc-cordis-preset's ptc-cordis, the gitbash
 * variants from dsh-gitbash-shell). The one exception is by design:
 * `minimal` mounts a complete persona AND suppresses runtime context, so
 * its prompt is sealed against every late contributor — no prompt-level
 * plugin can reach it; that needs product-side change.
 *
 * HOW the language is detected (priority order, resolved at EVERY
 * assembly — no re-registration, no restart):
 *
 *   1. mode 'off'    → contribute nothing (escape hatch).
 *   2. mode 'force'  → the configured forceLocale.
 *   3. mode 'auto' (default):
 *        a. the durable `locale.preference` the built-in locale plugin
 *           owns (Settings → General → Language — the user's explicit
 *           choice, persisted by DSH itself on loopback pages); read-only
 *           here, NEVER written by this plugin;
 *        b. the `uiLocale` field of this plugin's OWN settings namespace
 *           (`agent-lang`), written by the browser half: it reports the
 *           locale runtime's ACTIVE locale, which covers the "user never
 *           picked a language" case (browser navigator match) that leaves
 *           no trace in Host settings;
 *        c. neither → contribute nothing (English is already the default
 *           behavior; an English directive would only add prompt noise).
 *
 * The browser half (src/client.js) is the reporter AND the settings card:
 * it pushes the active locale into `agent-lang.uiLocale` and renders the
 * Settings → Plugins card (`settings.plugin.item` keyed by the namespace)
 * that switches mode / forceLocale.
 *
 * SETTINGS REGISTRATION: `settings.register(ns, schema)` requires a
 * CALLABLE schemastery schema (the service resolves values by calling
 * `schema(merged)`); zod objects throw and the namespace is never served,
 * which would also keep the card from dispatching (the Plugins tab pairs
 * served namespaces with registered cards). @deepseek-ai/schemastery cannot
 * be a static import here (the smoke test imports this file in plain Node
 * with zero dependencies), so it loads through a dynamic import at plugin
 * runtime — resolution walks the profile's shared fallback, the same
 * pattern dsh-better-workspace and dsh-context use (verified live).
 * @deepseek-ai/dsh-settings' optional settingsNamespace() helper is probed
 * for dsh era compatibility: newer dsh removed it and register() takes a
 * plain string; older dsh accepts the branded form, and either call shape
 * satisfies both.
 */
/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-agent-lang'

/**
 * No hard services: both `settings` and `systemPrompt` are injected
 * locally inside apply(), so a deployment without either one skips the
 * feature instead of blocking this plugin's load.
 */
export const inject = []

/** This plugin's own settings namespace (grammar: lowercase/digit/hyphen). */
export const SETTINGS_NAMESPACE = 'agent-lang'

/**
 * The built-in locale plugin's durable namespace, read-only here:
 * `locale.preference` is the user's explicit language choice. Absent while
 * the user never picked one — that absence delegates to the browser, which
 * is exactly what the client half reports into OUR namespace instead.
 */
const LOCALE_NAMESPACE = 'locale'

/** Runtime-context identity (globally unique; duplicates throw). */
const CONTEXT_NAME = 'agent-lang:ui-language'

/**
 * Slot after the centrally allocated CONTEXT_ORDERS entries (SANDBOX_POLICY
 * 110, APPROVAL_POLICY 115, SUBAGENT_DELEGATION 120): the language fact
 * reads as a runtime policy like its neighbors. See dsh-system-prompt's
 * CONTEXT_ORDERS table; pick a different free number if that table grows
 * past 125.
 */
const CONTEXT_ORDER = 125

/** Same grammar as the built-in locale ids (BCP 47-style). */
const BCP47 = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u

/** Accepted `mode` values. */
const MODE_PATTERN = /^(auto|off|force)$/

/** Language id → the language's own name, as the model should see it. */
const LANGUAGE_SELF_NAMES = {
  zh: '简体中文',
  ja: '日本語',
  ko: '한국어',
}

const TAG = '[agent-lang]'

// ── pure helpers (exported for tests) ────────────────────────────────────────

/**
 * Resolve the language tool-call descriptions should be written in.
 * @param {object} [input]
 * @param {string} [input.mode] - 'auto' | 'off' | 'force' (default 'auto').
 * @param {string} [input.forceLocale] - forced language for mode 'force'.
 * @param {string} [input.preference] - the built-in locale namespace's
 *   `preference` (user's explicit choice), when present.
 * @param {string} [input.reported] - the browser half's reported active
 *   locale (`uiLocale`), when present.
 * @returns {string | undefined} a language id, or undefined to contribute
 *   nothing (English stays the default behavior).
 */
export function pickDisplayLanguage({ mode = 'auto', forceLocale, preference, reported } = {}) {
  if (mode === 'off') return undefined
  if (mode === 'force' && typeof forceLocale === 'string' && BCP47.test(forceLocale)) {
    return forceLocale
  }
  // 'auto', or 'force' without a valid forceLocale (falls through): the
  // explicit user choice outranks the browser report because the report
  // already resolves navigator fallbacks the user never confirmed.
  if (typeof preference === 'string' && BCP47.test(preference)) return preference
  if (typeof reported === 'string' && BCP47.test(reported)) return reported
  return undefined
}

/**
 * The language's own name for the directive prose. Built-ins get their
 * self-name; unknown ids (external language packs) degrade to naming the
 * BCP-47 tag, which models map to the right language reliably.
 * @param {string} id - a language id.
 * @returns {string} the display name to embed in the directive.
 */
export function languageSelfName(id) {
  const key = String(id).toLowerCase()
  if (key === 'en') return 'English'
  if (Object.prototype.hasOwnProperty.call(LANGUAGE_SELF_NAMES, key)) {
    return LANGUAGE_SELF_NAMES[key]
  }
  return `the language with BCP-47 tag "${id}"`
}

/**
 * The ", not in English" override clause — only meaningful when the target
 * language is NOT English. Since v0.3.0 English is a regular target too:
 * some models mix languages inside their thinking/replies, so an explicit
 * English directive pins the language just like any other.
 * @param {string} lang - resolved language id.
 * @returns {string} ', not in English' or '' for English itself.
 */
function notEnglishClause(lang) {
  return lang.toLowerCase() === 'en' ? '' : ', not in English'
}

/**
 * Build the directive text for one language id — one compact paragraph in
 * the runtime-context snapshot style (the snapshot joins entries with blank
 * lines under its own header, so no markdown heading here). Returns '' only
 * when no language was resolved at all: empty context text is filtered at
 * render. English yields an explicit directive (anti language-mixing).
 * @param {string | undefined} lang - resolved language id.
 * @returns {string} the context text ('' = contribute nothing).
 */
export function buildLanguageDirective(lang) {
  if (typeof lang !== 'string' || lang.length === 0) return ''
  const selfName = languageSelfName(lang)
  return `Write tool-call descriptions in ${selfName}${notEnglishClause(lang)}; the English wording in tool schemas is format guidance only, including run_code's \`description\` in PTC mode. `
    + 'Keep descriptions short; identifiers, paths, and commands stay in their original script.'
}

/**
 * Resolve ONE channel's language from its own mode/locale pair plus the
 * shared detection chain. Same rules as {@link pickDisplayLanguage}: off →
 * undefined; force+valid tag → the tag; auto → preference over report.
 * @param {object} [channel]
 * @param {string} [channel.mode] - 'auto' | 'off' | 'force'.
 * @param {string} [channel.locale] - the channel's forced tag.
 * @param {string} [channel.preference] - explicit Settings→General choice.
 * @param {string} [channel.reported] - browser-reported active locale.
 * @returns {string | undefined} the channel's language, or undefined.
 */
export function resolveChannelLanguage({ mode = 'auto', locale, preference, reported } = {}) {
  return pickDisplayLanguage({ mode, forceLocale: locale, preference, reported })
}

/**
 * Build the combined directive text for all three channels (descriptions,
 * thinking, replies) — still ONE compact runtime-context entry. Each enabled
 * channel contributes one sentence; the desc sentence keeps the full
 * schema-override rationale (it fights the hardest against the English tool
 * schemas), while think/output state their rule plainly. Returns '' when
 * nothing is enabled or everything resolves to English.
 * @param {object} input - resolved settings plus the detection chain.
 * @param {string} [input.preference] - explicit user language choice.
 * @param {string} [input.reported] - browser-reported locale.
 * @param {string} [input.descMode] - tool-descriptions channel mode.
 * @param {string} [input.descLocale] - tool-descriptions forced tag.
 * @param {string} [input.thinkMode] - thinking channel mode.
 * @param {string} [input.thinkLocale] - thinking forced tag.
 * @param {string} [input.outMode] - replies channel mode.
 * @param {string} [input.outLocale] - replies forced tag.
 * @returns {string} the context text ('' = contribute nothing).
 */
export function buildChannelDirectives(input = {}) {
  const chain = { preference: input.preference, reported: input.reported }
  // Contract defaults: an omitted desc channel keeps the plugin's original
  // behavior (auto), while omitted think/out channels stay OFF — an unset
  // optional channel must never silently start overriding the model.
  const desc = resolveChannelLanguage({ mode: input.descMode ?? 'auto', locale: input.descLocale, ...chain })
  const think = resolveChannelLanguage({ mode: input.thinkMode ?? 'off', locale: input.thinkLocale, ...chain })
  const out = resolveChannelLanguage({ mode: input.outMode ?? 'off', locale: input.outLocale, ...chain })
  if (!desc && !think && !out) return ''
  // Compact assembly (2026-08-31 rewrite, replaces the per-channel sentences):
  // one leading supersede clause, then ONE sentence for the languages —
  // channels sharing a language merge into a single clause; differing
  // languages get one clause each — and the schema-override rationale is
  // appended only while the descriptions channel is enabled (it is the only
  // channel that must beat the English examples baked into tool schemas).
  const names = []
  if (desc) names.push('tool-call descriptions')
  if (think) names.push('internal reasoning (thinking)')
  if (out) names.push('user-facing replies')
  const langs = [desc, think, out].filter(Boolean)
  const distinct = [...new Set(langs.map(id => id.toLowerCase()))]
  let sentence
  if (distinct.length === 1) {
    const all = names.length > 1 ? ' all' : ''
    sentence = `${joinNames(names)} must${all} be written in ${languageSelfName(langs[0])}${notEnglishClause(langs[0])}`
  } else {
    const clauses = []
    if (desc) clauses.push(`tool-call descriptions in ${languageSelfName(desc)}`)
    if (think) clauses.push(`internal reasoning in ${languageSelfName(think)}`)
    if (out) clauses.push(`user-facing replies in ${languageSelfName(out)}`)
    sentence = `Write ${joinNames(clauses)}`
  }
  const parts = [sentence]
  if (desc) {
    parts.push('the English wording in tool schemas is format guidance only, including run_code\'s \`description\` in PTC mode; keep descriptions short, with identifiers, paths, and commands in their original script')
  }
  return `Current language rules supersede earlier language directives. ${parts.join('; ')}.`
}

/** Join 2-3 names/clauses with commas and a final "and" (Oxford). */
function joinNames(items) {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return items[0] + ' and ' + items[1]
  return items[0] + ', ' + items[1] + ', and ' + items[2]
}

/** Test surface: constants and pure helpers for helper-level tests. */
export const _internal = {
  SETTINGS_NAMESPACE,
  LOCALE_NAMESPACE,
  CONTEXT_NAME,
  CONTEXT_ORDER,
  BCP47,
  MODE_PATTERN,
  LANGUAGE_SELF_NAMES,
  pickDisplayLanguage,
  resolveChannelLanguage,
  languageSelfName,
  buildLanguageDirective,
  buildChannelDirectives,
}

// ── plugin ──────────────────────────────────────────────────────────────────

/**
 * Wire the feature onto whatever scope mounts this plugin. On the HOST plane
 * (the bundle-patch row) the context entry is GLOBAL: every unsealed agent
 * preset in the process merges it into its per-request assembly.
 * @param {import('@deepseek-ai/cordis').Context} ctx - mounting context.
 */
export function apply(ctx) {
  const log = ctx && ctx.logger && typeof ctx.logger.info === 'function'
    ? (msg) => ctx.logger.info(msg)
    : (msg) => console.log(msg)
  if (!ctx || typeof ctx.inject !== 'function') return

  // ── own settings namespace: the reporter's landing spot + the user's
  // mode/forceLocale knobs. Served ONLY while this plugin lives; the Plugins
  // tab pairs it with the browser card registered under the same key.
  try {
    ctx.inject(['settings'], (sctx) => {
      // Dynamic import: keeps this module importable by the zero-dependency
      // smoke test (the plain-Node path never reaches this callback), and
      // resolution at plugin runtime walks the profile's shared fallback.
      Promise.all([import('@deepseek-ai/dsh-settings'), import('@deepseek-ai/schemastery')])
        .then(([ds, sm]) => {
          const settings = sctx && sctx.settings
          if (!settings || typeof settings.register !== 'function') return
          const Schema = sm.default
          // Era probe: dsh >= 0.1.2-alpha.2 removed settingsNamespace();
          // register() takes a plain string there, and the older register()
          // accepted the branded helper — one call satisfies both eras.
          const ns = typeof ds.settingsNamespace === 'function'
            ? ds.settingsNamespace(SETTINGS_NAMESPACE)
            : SETTINGS_NAMESPACE
          const schema = Schema.object({
            // Browser-reported active GUI locale; the client half writes
            // ONLY this field, so user-configured modes/locales survive
            // every report (settings writes are per-field deep merges).
            uiLocale: Schema.string().pattern(BCP47).required(false),
            // ── channel: tool-call descriptions (the original fields; the
            // backward-compatible read path maps these onto the desc channel).
            // auto = follow the detected GUI language; off = contribute
            // nothing; force = always forceLocale.
            mode: Schema.string().pattern(MODE_PATTERN).default('auto'),
            forceLocale: Schema.string().pattern(BCP47).required(false),
            // ── channel: model thinking. Defaults to OFF: reasoning language
            // can affect quality, so the model's natural behavior stays until
            // the user opts in.
            thinkMode: Schema.string().pattern(MODE_PATTERN).default('off'),
            thinkLocale: Schema.string().pattern(BCP47).required(false),
            // ── channel: user-facing replies. Defaults to OFF: the untouched
            // behavior is "reply in the language the user typed in".
            outMode: Schema.string().pattern(MODE_PATTERN).default('off'),
            outLocale: Schema.string().pattern(BCP47).required(false),
          })
          settings.register(ns, schema)
          log(`${TAG} settings namespace registered: ${SETTINGS_NAMESPACE}`)
        })
        .catch((error) => {
          log(`${TAG} settings namespace registration FAILED: ${error && error.stack || String(error)}`)
        })
    })
  } catch (error) {
    log(`${TAG} settings inject wiring failed: ${error?.message ?? error}`)
  }

  // ── the directive: one global dynamic runtime-context entry, re-evaluated
  // at EVERY assembly so a GUI language switch (or a settings.yaml hot edit)
  // lands on the next request with no restart.
  try {
    ctx.inject(['systemPrompt'], (pctx) => {
      try {
        pctx.effect(() => pctx.systemPrompt.context({
          name: CONTEXT_NAME,
          order: CONTEXT_ORDER,
          text: () => {
            try {
              // SERVICE READ RULE (learned live, 2026-08-31): this callback's
              // context declares ONLY 'systemPrompt', so 'pctx.settings' is an
              // undeclared-property read that silently resolves undefined —
              // the first version's optional chain then produced '' for every
              // language and the directive never injected at all. Optional
              // services must go through ctx.get('name'), which needs no
              // inject declaration and returns undefined only when the
              // service is genuinely absent.
              const settings = pctx.get('settings')
              const own = settings?.get?.(SETTINGS_NAMESPACE) ?? {}
              // The locale namespace belongs to the built-in plugin; on a
              // deployment without it (no web surface) settings.get resolves
              // undefined and the reported chain carries the language alone.
              const locale = settings?.get?.(LOCALE_NAMESPACE)
              // Three channels: descriptions (the original mode/forceLocale
              // fields), thinking, and replies — each independently
              // auto/force/off; disabled channels contribute nothing.
              return buildChannelDirectives({
                preference: locale?.preference,
                reported: own.uiLocale,
                descMode: own.mode,
                descLocale: own.forceLocale,
                thinkMode: own.thinkMode,
                thinkLocale: own.thinkLocale,
                outMode: own.outMode,
                outLocale: own.outLocale,
              })
            } catch {
              return ''
            }
          },
        }), 'dsh-agent-lang: ui-language context')
        log(`${TAG} ui-language directive context active (${CONTEXT_NAME})`)
      } catch (error) {
        log(`${TAG} context registration failed: ${error?.message ?? error}`)
      }
    })
  } catch (error) {
    log(`${TAG} systemPrompt inject wiring failed: ${error?.message ?? error}`)
  }
}
