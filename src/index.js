/**
 * dsh-desc-lang — host half (plain JavaScript, no build step).
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
 *           (`desc-lang`), written by the browser half: it reports the
 *           locale runtime's ACTIVE locale, which covers the "user never
 *           picked a language" case (browser navigator match) that leaves
 *           no trace in Host settings;
 *        c. neither → contribute nothing (English is already the default
 *           behavior; an English directive would only add prompt noise).
 *
 * The browser half (src/client.js) is the reporter AND the settings card:
 * it pushes the active locale into `desc-lang.uiLocale` and renders the
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
export const name = 'dsh-desc-lang'

/**
 * No hard services: both `settings` and `systemPrompt` are injected
 * locally inside apply(), so a deployment without either one skips the
 * feature instead of blocking this plugin's load.
 */
export const inject = []

/** This plugin's own settings namespace (grammar: lowercase/digit/hyphen). */
export const SETTINGS_NAMESPACE = 'desc-lang'

/**
 * The built-in locale plugin's durable namespace, read-only here:
 * `locale.preference` is the user's explicit language choice. Absent while
 * the user never picked one — that absence delegates to the browser, which
 * is exactly what the client half reports into OUR namespace instead.
 */
const LOCALE_NAMESPACE = 'locale'

/** Runtime-context identity (globally unique; duplicates throw). */
const CONTEXT_NAME = 'desc-lang:ui-language'

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
}

const TAG = '[desc-lang]'

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
 * Build the directive text for one language id — one compact paragraph in
 * the runtime-context snapshot style (the snapshot joins entries with blank
 * lines under its own header, so no markdown heading here). Returns '' for
 * English or no language: empty context text is filtered at render, leaving
 * the default English behavior untouched with zero prompt noise.
 * @param {string | undefined} lang - resolved language id.
 * @returns {string} the context text ('' = contribute nothing).
 */
export function buildLanguageDirective(lang) {
  if (typeof lang !== 'string' || lang.length === 0) return ''
  if (lang.toLowerCase() === 'en') return ''
  const selfName = languageSelfName(lang)
  return `Tool-call description language: the user's web GUI display language is ${selfName} (${lang}). `
    + 'Every `description` argument on a tool call — including the `description` parameter of `run_code` programs in PTC mode — is that call’s user-facing label in the UI, and must be written in ' + selfName + ', not in English; the English wording and examples inside tool schemas are format guidance only. '
    + 'Keep each description a short, specific, active-voice phrase in its natural form in that language; code identifiers, file paths, commands, and other technical tokens may stay in their original script inside the translated phrase.'
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
  languageSelfName,
  buildLanguageDirective,
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
            // ONLY this field, so user-configured mode/forceLocale survive
            // every report (settings writes are per-field deep merges).
            uiLocale: Schema.string().pattern(BCP47).required(false),
            // auto = follow the detected GUI language; off = contribute
            // nothing; force = always forceLocale.
            mode: Schema.string().pattern(MODE_PATTERN).default('auto'),
            // Language to force when mode is 'force'.
            forceLocale: Schema.string().pattern(BCP47).required(false),
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
              const own = pctx.settings?.get?.(SETTINGS_NAMESPACE) ?? {}
              // The locale namespace belongs to the built-in plugin; on a
              // deployment without it (no web surface) settings.get resolves
              // undefined and the reported chain carries the language alone.
              const locale = pctx.settings?.get?.(LOCALE_NAMESPACE)
              return buildLanguageDirective(pickDisplayLanguage({
                mode: own.mode,
                forceLocale: own.forceLocale,
                preference: locale?.preference,
                reported: own.uiLocale,
              }))
            } catch {
              return ''
            }
          },
        }), 'dsh-desc-lang: ui-language context')
        log(`${TAG} ui-language directive context active (${CONTEXT_NAME})`)
      } catch (error) {
        log(`${TAG} context registration failed: ${error?.message ?? error}`)
      }
    })
  } catch (error) {
    log(`${TAG} systemPrompt inject wiring failed: ${error?.message ?? error}`)
  }
}
