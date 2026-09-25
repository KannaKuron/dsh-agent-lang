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
 * SETTINGS, TWO ERAS (split at dsh 0.1.7):
 *
 *   OLD (<= 0.1.6): the settings service exposes `register(ns, schema)` and
 *   values persist in `$DSH_HOME/settings.yaml`. This half registers the
 *   `agent-lang` namespace with a CALLABLE schemastery schema (the service
 *   resolves values by calling `schema(merged)`; zod objects throw and the
 *   namespace is never served, which would also keep the card from
 *   dispatching). @deepseek-ai/dsh-settings' optional settingsNamespace()
 *   helper is probed: newer dsh removed it and register() takes a plain
 *   string, older dsh accepts the branded form — one call shape satisfies
 *   every old host.
 *
 *   NEW (>= 0.1.7): `register()`/SettingsScope are gone. A plugin's settings
 *   ARE its row Config: this module statically exports `Config`, every field
 *   marked `.volatile()` (dsh 0.1.7 schemastery extension — probed, because
 *   the installed schemastery on a 0.1.6 host predates it), and the profile
 *   patch stores the values under the row id `agent-lang` — the same string
 *   as the old namespace, so the one-shot legacy `settings.yaml` import maps
 *   old user values straight onto the new home. apply() receives the fields
 *   as `Volatile<T>` refs (`.get()` reads a frozen snapshot; a host older
 *   than the extension passes plain values), and edits no longer remount
 *   this plugin — the directive's text closure re-evaluates per assembly, so
 *   a flipped knob lands on the very next request with zero wiring. The
 *   static schemastery import replaces the old dynamic one (the Loader needs
 *   `Config` at module import; resolution walks the profile's shared
 *   fallback exactly like the dynamic form did, and the smoke test now
 *   installs schemastery as a devDependency).
 *
 * The era split is a runtime probe (`typeof settings.register === 'function'`),
 * so one build serves both hosts.
 */

/**
 * The schemastery module, resolved LAZILY (v0.7.0): `@deepseek-ai/schemastery`
 * is a PEER, so it is not resolvable by plain Node from this package — it comes
 * from the host's own resolution (the profile shared fallback). A deployment
 * whose fallback lacks it used to fail the *static* import at the top of this
 * file, and the Loader treats a failed plugin import as a non-fatal skip
 * (`vendor/loader/src/config/entry.ts` `_init()`: logger.error + return, no
 * fiber) — so the row silently never mounted: no host half, no `dsh.client`
 * scan, no client bundle in the boot graph, and every host log stays green
 * (same all-green failure class as dsh-better-workspace issue #9; reproduced
 * with a fixture plugin whose only difference was a static peer import).
 * Deferring the import hides the schema where the module is absent instead of
 * killing the row: the prompt directive and the browser card keep working.
 */
let Schema = null
try {
  Schema = (await import('@deepseek-ai/schemastery')).default
} catch (error) {
  Schema = null
  console.warn(
    '[dsh-agent-lang] @deepseek-ai/schemastery is not resolvable here; the row Config surface is absent'
    + ' (the language directive and the browser card do not depend on it): '
    + (error && error.message || String(error)),
  )
}

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

/**
 * dsh >= 0.1.7 schemastery marks a field live-editable without remount; a
 * 0.1.6-era schemastery predates the method, and the guard keeps this module
 * loadable there (the field then behaves as an ordinary config value).
 * @param {object} schema - one built schema node.
 * @returns {object} the same node, volatile when the host supports it.
 */
function live(schema) {
  return typeof schema.volatile === 'function' ? schema.volatile() : schema
}

/**
 * Row Config = the settings surface on dsh >= 0.1.7 (the profile patch stores
 * the values under the row id `agent-lang`); inert metadata on older hosts,
 * whose values keep flowing through the registered settings namespace.
 * Field names and shapes are IDENTICAL to the old namespace schema, so the
 * legacy `settings.yaml` one-shot import and the client card map 1:1.
 * Absent (undefined) when schemastery is unresolvable: cordis then passes the
 * row config through unvalidated and the card loses its form controls, instead
 * of the whole row disappearing.
 */
export const Config = Schema === null ? undefined : Schema.object({
  // Browser-reported active GUI locale; the client half writes ONLY this
  // field, so user-configured modes/locales survive every report.
  uiLocale: live(Schema.string().pattern(BCP47).required(false)),
  // ── channel: tool-call descriptions (the original fields; the
  // backward-compatible read path maps these onto the desc channel).
  mode: live(Schema.string().pattern(MODE_PATTERN).default('auto')),
  forceLocale: live(Schema.string().pattern(BCP47).required(false)),
  // ── channel: model thinking. Defaults OFF: reasoning language can affect
  // quality, so the model's natural behavior stays until the user opts in.
  thinkMode: live(Schema.string().pattern(MODE_PATTERN).default('off')),
  thinkLocale: live(Schema.string().pattern(BCP47).required(false)),
  // ── channel: user-facing replies. Defaults OFF: the untouched behavior is
  // "reply in the language the user typed in".
  outMode: live(Schema.string().pattern(MODE_PATTERN).default('off')),
  outLocale: live(Schema.string().pattern(BCP47).required(false)),
  // ── audience: do teammates / subagents carry the same directive?
  // Defaults TRUE (the user's decision, 2026-09-25): a teammate writing tool
  // descriptions in another language is exactly as visible in the UI as the
  // main agent doing it. `false` withholds the contribution from every child
  // agent (Agent Team members, `subagent`/`spawn_teammate` children at any
  // nesting depth) while the main agent keeps it.
  subagents: live(Schema.boolean().default(true)),
})

/**
 * Read one Config value across eras: dsh >= 0.1.7 hands apply() a Volatile
 * ref (`.get()`), older hosts and fresh defaults pass plain values.
 * @param {unknown} value - a resolved Config field.
 * @returns {unknown} the current plain value.
 */
export function valueOf(value) {
  return value && typeof value.get === 'function' ? value.get() : value
}

/**
 * Normalize the `subagents` switch. Anyone who never touched it gets the
 * default TRUE, and only an explicit false (boolean or the string a
 * hand-edited profile patch may carry) withholds the directive from children
 * — an unreadable value must never silently narrow the plugin's coverage.
 * @param {unknown} value - the resolved `subagents` field.
 * @returns {boolean} whether child agents (teammates / subagents) get the directive.
 */
export function subagentsEnabled(value) {
  if (value === false || value === 'false') return false
  return true
}

/**
 * Whether one session header describes a DELEGATED child (an Agent Team
 * member or any other subagent) rather than a top-level agent. Three
 * independent markers are checked because they are written by different
 * layers of the delegation path (`childSessionMeta` sets all three for
 * in-process children; a restored or foreign child may carry only some).
 * @param {object|null|undefined} header - `agent.session.header`.
 * @returns {boolean} true for a child session.
 */
export function isSubagentHeader(header) {
  if (!header || typeof header !== 'object') return false
  if (header.parentSession !== undefined && header.parentSession !== null) return true
  if (header.origin === 'subagent') return true
  return typeof header.delegationDepth === 'number' && header.delegationDepth > 0
}

/**
 * The text one assembly contributes. The switch only narrows CHILD coverage:
 * the main agent keeps its directive, and a child is withheld one when the
 * user turned `subagents` off. Everything else (channel modes, language
 * priority, empty-when-undetected) is the unchanged directive builder.
 * @param {object} input - `{ isChild, enabled }` plus the builder's inputs.
 * @returns {string} the directive text, or '' when this assembly contributes none.
 */
export function directiveText(input = {}) {
  if (input.isChild === true && input.enabled !== true) return ''
  return buildChannelDirectives(input)
}

/**
 * Language id → the language's own name, as the model should see it.
 * Mirrors the client half's SELF_NAMES table — the two must carry the SAME
 * set (tests/smoke.mjs compares them), so change one and change the other.
 * 'en' rides in the table only to keep the two sets equal: languageSelfName()
 * answers English before it reaches the table.
 */
const LANGUAGE_SELF_NAMES = {
  'en': 'English',
  'zh': '简体中文',
  'zh-hk': '繁體中文(香港)',
  'zh-mo': '繁體中文(澳門)',
  'zh-tw': '繁體中文(台灣)',
  'ja': '日本語',
  'ko': '한국어',
  'ar': 'العربية',
  'de': 'Deutsch',
  'fr': 'Français',
  'hi': 'हिन्दी',
  'id': 'Bahasa Indonesia',
  'it': 'Italiano',
  'nl': 'Nederlands',
  'pl': 'Polski',
  'pt': 'Português',
  'ru': 'Русский',
  'sv': 'Svenska',
  'th': 'ไทย',
  'tr': 'Türkçe',
  'vi': 'Tiếng Việt',
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
 * The language's own name for the directive prose. Every language this
 * plugin ships a dictionary for has its self-name here; unknown ids (external
 * language packs) degrade to naming the BCP-47 tag, which models map to the
 * right language reliably.
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
  valueOf,
  subagentsEnabled,
  isSubagentHeader,
  directiveText,
}

// ── plugin ──────────────────────────────────────────────────────────────────

/**
 * Resolve this plugin's current settings across eras (pure helper factory).
 *
 * OLD (<= 0.1.6): values live in the registered settings namespace, read
 * through `settings.get(ns)`. NEW (>= 0.1.7): the row Config IS the surface —
 * `config` fields arrive as Volatile refs, read through `valueOf`. The
 * locale preference is a built-in namespace on old hosts and the `locale`
 * entry's Config form on new ones (`settings.describe()`), so the explicit
 * user choice keeps outranking the browser report on both.
 * @param {object|null|undefined} config - apply()'s resolved Config.
 * @param {boolean} legacy - the apply()-time era probe (old settings service).
 * @returns {{ own: () => object, preference: (settings: unknown) => unknown }}
 *   era-aware readers for the directive's text closure.
 */
function readersOf(config, legacy) {
  const own = () => {
    if (!config || typeof config !== 'object') return {}
    return {
      uiLocale: valueOf(config.uiLocale),
      mode: valueOf(config.mode),
      forceLocale: valueOf(config.forceLocale),
      thinkMode: valueOf(config.thinkMode),
      thinkLocale: valueOf(config.thinkLocale),
      outMode: valueOf(config.outMode),
      outLocale: valueOf(config.outLocale),
      subagents: valueOf(config.subagents),
    }
  }
  /** The user's explicit language choice, read era-appropriately. */
  const preference = (settings) => {
    try {
      if (legacy) {
        // OLD: the built-in locale plugin's registered namespace.
        const locale = settings?.get?.(LOCALE_NAMESPACE)
        return locale?.preference
      }
      // NEW: the `locale` entry's live Config form (SettingsForms.describe
      // projects every active entry; fresh on every call, no cache to go
      // stale). A deployment without the settings service carries the
      // browser report alone, exactly as before.
      if (!settings || typeof settings.describe !== 'function') return undefined
      const form = settings.describe().find((d) => d && d.ns === LOCALE_NAMESPACE)
      const value = form && form.value
      return value && typeof value.preference === 'string' ? value.preference : undefined
    } catch {
      return undefined
    }
  }
  return { own, preference }
}

/**
 * Wire the feature onto whatever scope mounts this plugin. On the HOST plane
 * (the bundle-patch row) the context entry is GLOBAL: every unsealed agent
 * preset in the process merges it into its per-request assembly.
 * @param {import('@deepseek-ai/cordis').Context} ctx - mounting context.
 * @param {object} [config] - resolved row Config (volatile refs on dsh >= 0.1.7).
 */
export function apply(ctx, config) {
  const log = ctx && ctx.logger && typeof ctx.logger.info === 'function'
    ? (msg) => ctx.logger.info(msg)
    : (msg) => console.log(msg)
  if (!ctx || typeof ctx.inject !== 'function') return

  // Era probe: only the OLD settings service exposes register(); on dsh
  // >= 0.1.7 the row Config above IS the namespace and there is nothing to
  // register (values persist under the row id, `agent-lang`).
  const legacySettings = (() => {
    try {
      const settings = ctx.get('settings')
      return !!(settings && typeof settings.register === 'function')
    } catch {
      return false
    }
  })()

  // ── OLD-era own settings namespace: the reporter's landing spot + the
  // user's mode/forceLocale knobs. Served ONLY while this plugin lives; the
  // Plugins tab pairs it with the browser card registered under the same key.
  if (legacySettings) {
    try {
      ctx.inject(['settings'], (sctx) => {
        // Dynamic import keeps resolution on the profile's shared fallback;
        // the schema mirrors the row Config field-for-field.
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
              // ── audience: teammates / subagents carry the same directive.
              // Defaults TRUE; false withholds it from every child agent.
              subagents: Schema.boolean().default(true),
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
  }

  // Era-aware readers for the directive's text closure: the NEW era reads
  // this plugin's own Config (volatile refs re-resolved per call — no
  // listener needed, a flipped knob lands on the next request), the OLD era
  // reads the registered namespace through the settings service.
  const readers = readersOf(config, legacySettings)

  /**
   * Resolve the directive for ONE assembly; `isChild` selects the audience
   * (main agent vs a teammate/subagent). Evaluated at every assembly, so a
   * language switch, a mode flip, or the audience switch itself lands on the
   * next request with no restart and no re-registration.
   * @param {object} sctx - the context owning this registration (service reads go through `get`).
   * @param {boolean} isChild - whether this registration serves a child agent.
   * @returns {string} the contribution text, '' when this assembly gets none.
   */
  const textFor = (sctx, isChild) => {
    try {
      // SERVICE READ RULE (learned live, 2026-08-31): the callback's context
      // declares ONLY 'systemPrompt', so `sctx.settings` is an
      // undeclared-property read that silently resolves undefined — the first
      // version's optional chain then produced '' for every language and the
      // directive never injected at all. Optional services must go through
      // ctx.get('name'), which needs no inject declaration and returns
      // undefined only when the service is genuinely absent.
      const settings = sctx.get('settings')
      // OLD era: values (own and the locale preference) come from the
      // registered namespaces; NEW era: `own` reads the Config refs and the
      // preference reads the locale entry's live form.
      const own = legacySettings
        ? settings?.get?.(SETTINGS_NAMESPACE) ?? {}
        : readers.own()
      // Three channels: descriptions (the original mode/forceLocale fields),
      // thinking, and replies — each independently auto/force/off; disabled
      // channels contribute nothing. The audience switch narrows children only.
      return directiveText({
        isChild,
        enabled: subagentsEnabled(own.subagents),
        preference: readers.preference(settings),
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
  }

  // ── the directive: one global dynamic runtime-context entry, re-evaluated
  // at EVERY assembly so a GUI language switch (or a settings edit) lands on
  // the next request with no restart. GLOBAL is the load-bearing choice: the
  // main agent, every preset, every agent created before this plugin loads,
  // and any delegation path this plugin cannot classify all inherit it, so
  // the audience switch can only ever REMOVE coverage from agents it
  // positively identified as children (never lose it from the main agent).
  try {
    ctx.inject(['systemPrompt'], (pctx) => {
      try {
        pctx.effect(() => pctx.systemPrompt.context({
          name: CONTEXT_NAME,
          order: CONTEXT_ORDER,
          text: () => textFor(pctx, false),
        }), 'dsh-agent-lang: ui-language context')
        log(`${TAG} ui-language directive context active (${CONTEXT_NAME})`)
      } catch (error) {
        log(`${TAG} context registration failed: ${error?.message ?? error}`)
      }

      // ── audience: CHILD agents get their own SCOPED entry under the same
      // name. `SystemPrompt` merges the global layer first and lets the scope
      // chain shadow by name (packages/core/scope/src/store.ts `merge()`:
      // "scoped entries shadow global entries with the same name"), so this
      // one entry decides the child's contribution outright: identical text
      // while the switch is on, '' when the user turned it off — the global
      // entry cannot slip past it. Registration rides the CHILD's own context
      // (the canonical per-agent pattern of `file-reference-local`), so it is
      // scoped to that agent and disposed with it; a nested subagent's own
      // scope is nearer than its parent's, so the nearest shadow wins.
      const agents = (() => {
        try {
          return pctx.get('agents')
        } catch {
          return undefined
        }
      })()
      const shadows = new Map()
      const disposeShadow = (agent) => {
        const fiber = shadows.get(agent)
        if (fiber === undefined) return
        shadows.delete(agent)
        try {
          Promise.resolve(fiber.dispose()).catch((error) => {
            log(`${TAG} child context disposal failed: ${error?.message ?? error}`)
          })
        } catch (error) {
          log(`${TAG} child context disposal failed: ${error?.message ?? error}`)
        }
      }
      const installShadow = (agent) => {
        try {
          if (!agent || typeof agent !== 'object' || shadows.has(agent)) return
          const header = agent.session && agent.session.header
          if (!isSubagentHeader(header)) return
          if (!agent.ctx || typeof agent.ctx.inject !== 'function') return
          const fiber = agent.ctx.inject(['systemPrompt'], (sctx) => {
            sctx.systemPrompt.context({
              name: CONTEXT_NAME,
              order: CONTEXT_ORDER,
              text: () => textFor(sctx, true),
            })
          })
          shadows.set(agent, fiber)
          log(`${TAG} child agent joined the audience switch: ${header && header.id ? header.id : 'unknown'}`)
        } catch (error) {
          log(`${TAG} child context registration failed: ${error?.message ?? error}`)
        }
      }
      try {
        // Agents that already exist (a restored session, or a plugin loaded
        // after a child was created) are classified once here.
        if (agents && typeof agents.list === 'function') {
          for (const agent of agents.list()) installShadow(agent)
        }
        // Every new agent, including teammates and nested subagents: the
        // event is scope-tagged, and an untagged listener is admitted globally
        // (`scopeTarget` in packages/core/scope/src/index.ts), which is how
        // sibling plugins observe the whole process.
        pctx.on('agent/created', ({ agent }) => { installShadow(agent) })
        pctx.on('agent/disposed', ({ agent }) => { disposeShadow(agent) })
        pctx.effect(() => () => {
          for (const agent of [...shadows.keys()]) disposeShadow(agent)
        }, 'dsh-agent-lang: child ui-language contexts')
      } catch (error) {
        log(`${TAG} child audience wiring failed: ${error?.message ?? error}`)
      }
    })
  } catch (error) {
    log(`${TAG} systemPrompt inject wiring failed: ${error?.message ?? error}`)
  }
}
