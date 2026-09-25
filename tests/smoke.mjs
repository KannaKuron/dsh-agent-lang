// Smoke tests for dsh-agent-lang — pure file/helper level, no Cordis runtime
// and zero dependencies needed. Run: npm test (node --test tests/smoke.mjs)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  _internal,
  name as pluginName,
  inject as pluginInject,
  SETTINGS_NAMESPACE,
} from '../src/index.js'

const {
  LOCALE_NAMESPACE,
  CONTEXT_NAME,
  CONTEXT_ORDER,
  BCP47,
  pickDisplayLanguage,
  resolveChannelLanguage,
  languageSelfName,
  buildLanguageDirective,
  buildChannelDirectives,
  subagentsEnabled,
  isSubagentHeader,
  directiveText,
} = _internal

const hostSource = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8')
const clientSource = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')

// ── source-slicing helpers (dictionary discipline) ───────────────────────────

/** The object literal body of `declaration`, brace-matched: a value holding a
 *  brace (or a line that merely looks like a key) cannot truncate the slice. */
function objectAt(source, declaration) {
  const start = source.indexOf(declaration)
  assert.ok(start >= 0, declaration + ' not found')
  let depth = 0
  const from = source.indexOf('{', start)
  let i = from
  for (; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) break
    }
  }
  return source.slice(from, i + 1)
}

/** One dictionary's key set, read off the source lines (the bundle is
 *  hand-written, so every key sits on a line of its own). */
function dictionaryKeys(segment) {
  return [...segment.matchAll(/^[\t ]+"([^"]+)": "/gm)].map((match) => match[1]).sort()
}

/** A `{ key: value }` table's key set (single- or double-quoted keys). */
function tableKeys(source, declaration) {
  return [...objectAt(source, declaration).matchAll(/^[\t ]*['"]([A-Za-z][A-Za-z0-9-]*)['"]:\s*['"]/gm)]
    .map((match) => match[1])
    .sort()
}

// ── plugin shape ─────────────────────────────────────────────────────────────

test('plugin shape: name, no hard injects, namespace constants', () => {
  assert.equal(pluginName, 'dsh-agent-lang')
  assert.deepEqual(pluginInject, [])
  assert.equal(SETTINGS_NAMESPACE, 'agent-lang')
  assert.equal(LOCALE_NAMESPACE, 'locale')
})

test('context placement: free slot after the centrally allocated orders', () => {
  assert.equal(CONTEXT_NAME, 'agent-lang:ui-language')
  // After SANDBOX_POLICY(110)/APPROVAL_POLICY(115)/SUBAGENT_DELEGATION(120).
  assert.equal(CONTEXT_ORDER, 125)
})

// ── language resolution ──────────────────────────────────────────────────────

test('pickDisplayLanguage: auto prefers the explicit choice over the report', () => {
  assert.equal(pickDisplayLanguage({ preference: 'zh', reported: 'ja' }), 'zh')
  assert.equal(pickDisplayLanguage({ reported: 'ja' }), 'ja')
  assert.equal(pickDisplayLanguage({}), undefined)
  assert.equal(pickDisplayLanguage(), undefined)
})

test('pickDisplayLanguage: off contributes nothing; force wins with a valid tag', () => {
  assert.equal(pickDisplayLanguage({ mode: 'off', preference: 'zh' }), undefined)
  assert.equal(pickDisplayLanguage({ mode: 'force', forceLocale: 'ja', preference: 'zh' }), 'ja')
  // force without a valid tag degrades to the auto chain
  assert.equal(pickDisplayLanguage({ mode: 'force', forceLocale: '', preference: 'zh' }), 'zh')
  assert.equal(pickDisplayLanguage({ mode: 'force', preference: 'zh' }), 'zh')
})

test('pickDisplayLanguage: malformed ids never leak through', () => {
  assert.equal(pickDisplayLanguage({ preference: 'not a tag!', reported: '../etc' }), undefined)
  assert.equal(pickDisplayLanguage({ mode: 'force', forceLocale: 'x' }), undefined)
})

test('languageSelfName: built-ins and unknown packs', () => {
  assert.equal(languageSelfName('zh'), '简体中文')
  assert.equal(languageSelfName('ZH'), '简体中文')
  assert.equal(languageSelfName('en'), 'English')
  assert.equal(languageSelfName('ja'), '日本語')
  assert.equal(languageSelfName('ko'), '한국어')
  assert.equal(languageSelfName('x-custom'), 'the language with BCP-47 tag "x-custom"')
})

test('languageSelfName: every shipped language answers with its own name', () => {
  // The table covers every dictionary the browser half ships, so a forced
  // channel names the language instead of degrading to the bare tag.
  assert.equal(languageSelfName('de'), 'Deutsch')
  assert.equal(languageSelfName('zh-HK'), '繁體中文(香港)')
  assert.equal(languageSelfName('zh-MO'), '繁體中文(澳門)')
  assert.equal(languageSelfName('zh-TW'), '繁體中文(台灣)')
  assert.equal(languageSelfName('tr'), 'Türkçe')
  assert.equal(languageSelfName('vi'), 'Tiếng Việt')
  // unknown ids (an external pack we ship no name for) still degrade to the tag
  assert.equal(languageSelfName('x-custom'), 'the language with BCP-47 tag "x-custom"')
})

test('buildLanguageDirective: zh mentions the run_code description and the self name', () => {
  const text = buildLanguageDirective('zh')
  assert.match(text, /简体中文/)
  assert.match(text, /run_code/)
  assert.match(text, /description/)
  assert.match(text, /not in English/)
})

test('buildLanguageDirective: absent contributes nothing; English is a REGULAR target (v0.3.0+, anti language-mixing)', () => {
  assert.equal(buildLanguageDirective(undefined), '')
  assert.equal(buildLanguageDirective(''), '')
  const en = buildLanguageDirective('en')
  assert.match(en, /must be written in English|Write tool-call descriptions in English/)
  // the ", not in English" clause is dropped for English itself (would be contradictory)
  assert.doesNotMatch(en, /not in English/)
  assert.equal(buildLanguageDirective('EN'), en)
})

test('buildLanguageDirective: builtin ja/ko use native names; unknown tags fall back to the tag itself', () => {
  assert.match(buildLanguageDirective('ja'), /日本語/)
  assert.match(buildLanguageDirective('ko'), /한국어/)
  const text = buildLanguageDirective('x-custom')
  assert.match(text, /BCP-47 tag "x-custom"/)
  assert.ok(text.length > 0)
})

// ── three-channel resolution ─────────────────────────────────────────────────

test('resolveChannelLanguage: per-channel modes resolve independently', () => {
  const chain = { preference: 'zh', reported: 'zh' }
  assert.equal(resolveChannelLanguage({ mode: 'off', ...chain }), undefined)
  assert.equal(resolveChannelLanguage({ mode: 'force', locale: 'ja', ...chain }), 'ja')
  assert.equal(resolveChannelLanguage({ mode: 'auto', ...chain }), 'zh')
  assert.equal(resolveChannelLanguage({ mode: 'force', locale: 'not a tag!', ...chain }), 'zh')
})

test('buildChannelDirectives: supersede clause + compact single-channel text', () => {
  const chain = { preference: 'zh', reported: 'zh' }
  const only = buildChannelDirectives({ descMode: 'auto', ...chain })
  // leading supersede clause present on every non-empty emission
  assert.match(only, /^Current language rules supersede earlier language directives\./)
  assert.match(only, /tool-call descriptions must be written in 简体中文, not in English/)
  assert.match(only, /format guidance only, including run_code's `description`/)
  // everything off → nothing
  assert.equal(buildChannelDirectives({ descMode: 'off', thinkMode: 'off', outMode: 'off', ...chain }), '')
})

test('buildChannelDirectives: same-language channels merge into one clause', () => {
  const text = buildChannelDirectives({
    preference: 'zh',
    descMode: 'auto',
    thinkMode: 'auto',
    outMode: 'auto',
  })
  assert.match(text, /tool-call descriptions, internal reasoning \(thinking\), and user-facing replies must all be written in 简体中文, not in English/)
  // BUDGET: the merged all-on emission stays under 420 chars (regression guard
  // against prompt bloat; the 2026-08-31 rewrite brought it from 528 to ~383)
  assert.ok(text.length <= 420, 'all-on directive grew past budget: ' + text.length)
})

test('buildChannelDirectives: differing languages get one clause each', () => {
  const text = buildChannelDirectives({
    preference: 'zh',
    descMode: 'auto',
    thinkMode: 'off',
    outMode: 'force',
    outLocale: 'ja',
  })
  assert.match(text, /Write tool-call descriptions in 简体中文 and user-facing replies in 日本語/)
  // self-name table covers ja/ko natively now (no verbose BCP-47 fallback)
  assert.doesNotMatch(text, /BCP-47 tag/)
})

// ── host half source discipline ──────────────────────────────────────────────

test('host half: registers a runtime CONTEXT, never a prompt section', () => {
  assert.match(hostSource, /systemPrompt\.context\(/)
  assert.doesNotMatch(hostSource, /systemPrompt\.section\(/)
  assert.match(hostSource, new RegExp('name: CONTEXT_NAME'))
})

test('host half: the directive reads settings via ctx.get, never as an undeclared ctx property', () => {
  // The context callback's ctx declares ONLY 'systemPrompt'; touching
  // ctx.settings there silently reads undefined and the directive stays
  // empty forever (live regression, 2026-08-31). v0.8.0 shares one provider
  // (`textFor`) between the global entry and the per-child entry, so its
  // parameter is named `sctx` — what matters is the `.get('settings')` form,
  // and the ACCESS form stays banned in every spelling.
  assert.match(hostSource, /sctx\.get\('settings'\)/)
  for (const banned of ['pctx.settings?.', 'sctx.settings?.', 'pctx.settings.', 'sctx.settings.']) {
    assert.ok(!hostSource.includes(banned), `host half must not read settings as ${banned}`)
  }
})

test('host half: lazy Config (dsh >= 0.1.7 settings) with volatile probing', () => {
  // dsh 0.1.7: the row Config IS the settings surface. The Loader needs
  // `Config` at module import, so the import is deferred with top-level await
  // (the Loader awaits the module, so `Config` is defined before it is read) —
  // a STATIC peer import would make an unresolvable schemastery kill the whole
  // row silently (non-fatal skip in the Loader, client half never loads).
  // `.volatile()` is probed so a 0.1.6-era schemastery still loads this module.
  assert.match(hostSource, /await import\('@deepseek-ai\/schemastery'\)/)
  assert.doesNotMatch(hostSource, /^import Schema from '@deepseek-ai\/schemastery'/m)
  assert.match(hostSource, /export const Config = Schema === null \? undefined : Schema\.object\(/)
  assert.match(hostSource, /typeof schema\.volatile === 'function' \? schema\.volatile\(\) : schema/)
  // Volatile refs arrive on new hosts; both shapes must read the same way.
  assert.match(hostSource, /export function valueOf\(value\)/)
})

test('host half: legacy namespace registration survives behind the era probe', () => {
  // dsh <= 0.1.6 keeps the registered-namespace path, gated on the service
  // still exposing register().
  assert.match(hostSource, /import\('@deepseek-ai\/dsh-settings'\)/)
  assert.match(hostSource, /settingsNamespace/)
  assert.match(hostSource, /settings\.register\(ns, schema\)/)
  assert.match(hostSource, /typeof settings\.register === 'function'/)
})

test('host half: reads the locale namespace but never writes it', () => {
  assert.match(hostSource, new RegExp('LOCALE_NAMESPACE'))
  for (const banned of ['update(LOCALE_NAMESPACE', 'replace(LOCALE_NAMESPACE', 'mutate(LOCALE_NAMESPACE']) {
    assert.ok(!hostSource.includes(banned), `host half must not call ${banned}`)
  }
})

test('host half: directive text provider is a function re-evaluated per assembly', () => {
  // Both registrations (the global one and the per-child shadow) must pass a
  // FUNCTION, never a captured string: a language switch, a mode flip, and
  // the audience switch all land on the next request through this call.
  const providers = [...hostSource.matchAll(/text: \(\) => textFor\((\w+), (true|false)\)/g)]
  assert.equal(providers.length, 2, 'expected one provider per registration (global + child)')
  assert.deepEqual(providers.map(m => m[2]).sort(), ['false', 'true'])
})

// ── teammate / subagent audience (v0.8.0) ────────────────────────────────────

test('subagentsEnabled: defaults ON, and only an explicit false narrows the audience', () => {
  // The user's requirement: teammates and subagents carry the directive by
  // default. An unreadable / absent value must never silently narrow coverage.
  assert.equal(subagentsEnabled(undefined), true)
  assert.equal(subagentsEnabled(null), true)
  assert.equal(subagentsEnabled(true), true)
  assert.equal(subagentsEnabled(''), true)
  assert.equal(subagentsEnabled('true'), true)
  assert.equal(subagentsEnabled(false), false)
  assert.equal(subagentsEnabled('false'), false)
})

test('isSubagentHeader: every delegation marker classifies a child', () => {
  // The three markers are written by different layers of the delegation path
  // (childSessionMeta sets all three for an in-process child).
  assert.equal(isSubagentHeader({ id: 'main' }), false)
  assert.equal(isSubagentHeader(undefined), false)
  assert.equal(isSubagentHeader(null), false)
  assert.equal(isSubagentHeader({ id: 'lead', cwd: '/tmp' }), false)
  assert.equal(isSubagentHeader({ id: 'child', parentSession: 'lead' }), true)
  assert.equal(isSubagentHeader({ id: 'child', origin: 'subagent' }), true)
  assert.equal(isSubagentHeader({ id: 'child', delegationDepth: 1 }), true)
  // depth 0 is a top-level session (absent depth is the same fact)
  assert.equal(isSubagentHeader({ id: 'main', delegationDepth: 0 }), false)
  // a malformed value must not be read as a child
  assert.equal(isSubagentHeader({ id: 'x', delegationDepth: '1' }), false)
  assert.equal(isSubagentHeader({ id: 'x', parentSession: null }), false)
})

test('directiveText: the switch withholds the directive from CHILDREN only', () => {
  const chain = { preference: 'zh', reported: 'zh', descMode: 'auto' }
  const main = directiveText({ isChild: false, enabled: true, ...chain })
  const child = directiveText({ isChild: true, enabled: true, ...chain })
  const childOff = directiveText({ isChild: true, enabled: false, ...chain })
  const mainOff = directiveText({ isChild: false, enabled: false, ...chain })
  // ON (the default) is byte-identical for both audiences
  assert.equal(child, main)
  assert.match(child, /简体中文/)
  // OFF removes the child contribution and leaves the main agent untouched
  assert.equal(childOff, '')
  assert.equal(mainOff, main)
  // an undetected language contributes nothing for either audience
  assert.equal(directiveText({ isChild: true, enabled: true, descMode: 'auto' }), '')
  // a disabled channel family stays disabled regardless of audience
  assert.equal(directiveText({ isChild: false, enabled: true, descMode: 'off', thinkMode: 'off', outMode: 'off', ...{ preference: 'zh' } }), '')
})

test('host half: children get a SCOPED entry under the same name, installed per agent', () => {
  // The global entry keeps serving the main agent (and anything this plugin
  // cannot classify); a child's own scope shadows it by name, which is what
  // makes the audience switch authoritative rather than additive.
  assert.match(hostSource, /agent\.ctx\.inject\(\['systemPrompt'\]/)
  assert.match(hostSource, /isSubagentHeader\(header\)/)
  assert.match(hostSource, /pctx\.on\('agent\/created'/)
  assert.match(hostSource, /pctx\.on\('agent\/disposed'/)
  // agents that already exist when this plugin loads are classified too
  assert.match(hostSource, /agents\.list\(\)/)
  // the shadow reuses the SAME name and order, so it shadows instead of adding
  const shadow = hostSource.slice(hostSource.indexOf('const installShadow'))
  assert.match(shadow, /name: CONTEXT_NAME/)
  assert.match(shadow, /order: CONTEXT_ORDER/)
  assert.match(shadow, /text: \(\) => textFor\(sctx, true\)/)
})

test('host half: the audience switch is declared on BOTH settings eras, default on', () => {
  // NEW era (row Config) and OLD era (registered namespace) must carry the
  // same field, or the card would offer a switch one host cannot store.
  const occurrences = [...hostSource.matchAll(/subagents: (live\()?Schema\.boolean\(\)\.default\(true\)/g)]
  assert.equal(occurrences.length, 2, 'expected the field on the row Config and the legacy namespace schema')
  assert.match(hostSource, /subagents: valueOf\(config\.subagents\)/)
  assert.match(hostSource, /enabled: subagentsEnabled\(own\.subagents\)/)
})

// ── client half bundle discipline ────────────────────────────────────────────

test('client bundle: ModuleLoader wrapper with the package id', () => {
  assert.match(clientSource, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(clientSource, /id: "dsh-agent-lang"/)
})

test('client bundle: require whitelist is the client-module baseline', () => {
  const requires = [...clientSource.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1])
  const baseline = new Set(['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
    '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-primitives'])
  for (const name of requires) assert.ok(baseline.has(name), `non-baseline require: ${name}`)
  assert.ok(requires.includes('react'))
  assert.ok(requires.includes('@deepseek-ai/dsh-client-ui-primitives'))
})

test('client bundle: no import/JSX/TypeScript syntax', () => {
  assert.doesNotMatch(clientSource, /\bimport\s*\(/)
  assert.doesNotMatch(clientSource, /^\s*import\s/m)
  assert.doesNotMatch(clientSource, /\bexport\s+(const|function|class)\b/)
  assert.doesNotMatch(clientSource, /<[A-Z][A-Za-z0-9]*\s*\/?>/)
  assert.doesNotMatch(clientSource, /:\s*(string|boolean|number|void)\b/)
})

test('client bundle: reports ONLY uiLocale into the agent-lang namespace', () => {
  // Era-split acquisition: the OLD bound scope and the NEW ConfigForm face
  // share the set/unset/getSnapshot contract; the plugin never hard-injects
  // either service (a missing service would leave the fiber PENDING on the
  // other era).
  assert.doesNotMatch(clientSource, /exports\.inject = \["locale", "settingsScope"/)
  assert.match(clientSource, /ctx\.inject\(\["settingsScope"\]/)
  assert.match(clientSource, /ctx\.inject\(\["configForms"\]/)
  assert.match(clientSource, /scope\.set\("uiLocale", active\)/)
  // never touches the built-in locale namespace with a write
  for (const banned of ['localeScope.set', 'localeScope.unset', 'localeScope.mutate']) {
    assert.ok(!clientSource.includes(banned), `client bundle must not call ${banned}`)
  }
})

test('client bundle: settings card keyed by the namespace, dictionaries published to the registry', () => {
  assert.match(clientSource, /settings\.plugin\.item/)
  assert.match(clientSource, /key: NS/)
  // The zh/en pair rides one call; every third language plus the macro-tag
  // aliases ride a second one, so a language added to the table cannot be left
  // unregistered — an unregistered dictionary is silently inert no matter how
  // complete its copy is.
  assert.match(clientSource, /ctx\.locale\.register\(DICT_NS, \{ zh: zh, en: en \}\)/)
  assert.match(clientSource, /ctx\.locale\.register\(DICT_NS, Object\.assign\(\{\}, LOCALE_ALIASES, LOCALES\)\)/)
})

test('client bundle: dual settings seat across dsh generations (0.1.6-alpha.2+)', () => {
  // Legacy seat stays (older hosts) and the Plugins-page seat is keyed by
  // the PACKAGE name — the page's configLedger matches on pkg.name, not on
  // the settings namespace.
  assert.match(clientSource, /slots\.inject\("settings\.plugin\.item"/)
  assert.match(clientSource, /slots\.inject\("plugins\.bundle\.config"/)
  assert.match(clientSource, /key: "dsh-agent-lang"/)
  // Both seats render the same component; the page seat passes view="page"
  // and the component drops its collapsible shell there.
  assert.match(clientSource, /props\.view === "page"/)
})

test('client bundle: force-language options merge registered locale packs over the static fallback', () => {
  assert.match(clientSource, /selectableLocales: function \(\) \{/)
  assert.match(clientSource, /ctx\.locale\.getSnapshot\(\)\.locales \|\| \[\]/)
  assert.match(clientSource, /function langOptions\(current, selectable\)/)
  assert.match(clientSource, /def\.label === "string" && def\.label \? def\.label : def\.id/)
  assert.match(clientSource, /LANG_OPTIONS/)
})

test('client bundle: three channels with one-click sync/off shortcuts', () => {
  // the three channel blocks with their settings keys
  for (const pair of ['modeKey: "mode"', 'modeKey: "thinkMode"', 'modeKey: "outMode"']) {
    assert.ok(clientSource.includes(pair), 'missing channel config ' + pair)
  }
  for (const pair of ['localeKey: "forceLocale"', 'localeKey: "thinkLocale"', 'localeKey: "outLocale"']) {
    assert.ok(clientSource.includes(pair), 'missing channel locale ' + pair)
  }
  // quick actions write all three modes at once
  assert.match(clientSource, /write\(\{ mode: "auto", thinkMode: "auto", outMode: "auto" \}\)/)
  assert.match(clientSource, /write\(\{ mode: "off", thinkMode: "off", outMode: "off" \}\)/)
})

test('every shipped dictionary carries the same key set as zh', () => {
  // A third-language block is preceded by a /* locale: <tag> */ marker, so the
  // blocks can be sliced without parsing the file. Equality matters because a
  // key missing from a third language falls back to English at lookup time — a
  // silent half-translated card, which is exactly what this catches.
  const zhKeys = dictionaryKeys(clientSource.slice(
    clientSource.indexOf('var zh = {'),
    clientSource.indexOf('var en = {'),
  ))
  assert.ok(zhKeys.length >= 16, 'the zh dictionary looks truncated: ' + zhKeys.length)

  const parts = objectAt(clientSource, 'var LOCALES = ').split('/* locale: ')
  assert.ok(parts.length - 1 >= 19, 'expected at least nineteen third-language dictionaries, saw ' + (parts.length - 1))
  for (let index = 1; index < parts.length; index += 1) {
    const tag = parts[index].slice(0, parts[index].indexOf(' */'))
    assert.deepEqual(dictionaryKeys(parts[index]), zhKeys, 'dictionary ' + tag + ' does not match the zh key set')
  }
})

test('client bundle: the third-language table ships the full tag list', () => {
  const tags = [...objectAt(clientSource, 'var LOCALES = ').matchAll(/\/\* locale: ([A-Za-z-]+) \*\//g)]
    .map((match) => match[1])
    .sort()
  assert.deepEqual(tags, [
    'ar', 'de', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'nl', 'pl', 'pt', 'ru', 'sv', 'th', 'tr', 'vi',
    'zh-hk', 'zh-mo', 'zh-tw',
  ])
})

test('client bundle: every shipped language has a self name, and the halves agree', () => {
  // The card names a forced language with its own name; the host half embeds
  // the same name in the injected directive, so the two tables must not drift.
  const names = tableKeys(clientSource, 'var SELF_NAMES = ')
  const hostNames = tableKeys(hostSource, 'const LANGUAGE_SELF_NAMES = ')
  assert.ok(hostNames.length >= 21, 'the self-name table looks truncated: ' + hostNames.length)
  assert.deepEqual(names, hostNames, 'the host and client self-name tables drifted apart')
  const tags = [...objectAt(clientSource, 'var LOCALES = ').matchAll(/\/\* locale: ([A-Za-z-]+) \*\//g)]
    .map((match) => match[1])
  for (const tag of ['zh', 'en'].concat(tags)) {
    assert.ok(names.includes(tag), 'no self name for shipped language ' + tag)
  }
})

test('client bundle: the bundle parses (a dictionary typo would blank the card)', () => {
  // The card is registered as a factory; a syntax error anywhere in the bundle
  // takes the whole client half down. Parsing it here costs nothing.
  assert.doesNotThrow(() => { new Function(clientSource) })
})

test('client bundle: card chrome consumes the 0.1.7-rc.2 design tokens with literal fallbacks', () => {
  // rc.2 shipped the unified token layer this card follows: the radius scale
  // (ui-theme styles/base.css `--dsw-radius-*`) and the one focus ring
  // (ui-theme styles/focus.css `--dsw-focus-ring-width` +
  // `--dsw-focus-ring-color`, which also blanks the colour under pointer
  // modality). Each var() names the literal this file used before, so a host
  // that predates the tokens keeps rendering what it rendered then — the tokens
  // are an upgrade, never a requirement.
  assert.match(clientSource, /var\(--dsw-radius-md,12px\)/)
  assert.match(clientSource, /var\(--dsw-radius-sm,8px\)/)
  assert.match(clientSource, /var\(--dsw-focus-ring-width,2px\) solid var\(--dsw-focus-ring-color,/)
  // the pre-token spellings must be gone from the rules themselves (a stale
  // hardcoded radius would silently win over the token nothing else applies)
  assert.doesNotMatch(clientSource, /border-radius:12px/)
  assert.doesNotMatch(clientSource, /border-radius:8px/)
  assert.doesNotMatch(clientSource, /outline:2px solid/)
  // the last fallback stays the pre-rc.2 brand colour: state-business-primary
  // is the newest name in the chain and need not exist on <= 0.1.6 hosts
  assert.match(clientSource, /var\(--dsw-alias-state-business-primary,var\(--dsw-alias-brand-primary\)\)/)
})

test('client bundle: the chevron probes the real glyph names, not a spelling no host exports', () => {
  // v0.1.0..v0.7.0 asked for `IconChevronDownOutline14`, which NO 0.1.7 build
  // exports (the family is `…OutlineRegular` / `…OutlineMedium`), so the card
  // silently rendered the text "▾" while the probe looked correct. The chain
  // keeps a real icon wherever a host ships one and the text glyph otherwise.
  assert.match(clientSource, /function firstIcon\(names\)/)
  assert.match(clientSource, /firstIcon\(\["IconChevronDownOutlineRegular", "IconChevronDownOutlineMedium", "IconChevronDownOutline14"\]\)/)
  const probe = clientSource.slice(clientSource.indexOf('var Chevron ='))
  assert.doesNotMatch(probe.slice(0, probe.indexOf('\n')), /icon\("IconChevronDownOutline14"\)$/, 'the probe must not bet on the legacy name alone')
})

test('client bundle: the audience switch renders default-on and writes a boolean', () => {
  // The card reads an absent field as ON (nobody who never touched it may end
  // up narrowing coverage) and writes real booleans, which the new-era Config
  // (`Schema.boolean()`) and the legacy namespace schema both accept.
  assert.match(clientSource, /var subOn = !\(value\.subagents === false \|\| value\.subagents === "false"\)/)
  assert.match(clientSource, /write\(\{ subagents: true \}\)/)
  assert.match(clientSource, /write\(\{ subagents: false \}\)/)
  for (const key of ['sub.title', 'sub.on', 'sub.off', 'sub.hint']) {
    assert.ok(clientSource.includes('t("' + key + '")'), 'the card must render ' + key)
  }
})

test('client bundle: the audience copy explains the fork boundary in every dictionary', () => {
  // The hint is the only place the switch's ONE surprising interaction is
  // documented for users: a forked teammate inherits the main agent's already
  // committed history snapshot, which no switch can rewrite.
  const zhBlock = clientSource.slice(clientSource.indexOf('var zh = {'), clientSource.indexOf('var en = {'))
  const enBlock = clientSource.slice(clientSource.indexOf('var en = {'), clientSource.indexOf('var LOCALES = '))
  const dictionaries = [zhBlock, enBlock,
    ...objectAt(clientSource, 'var LOCALES = ').split('/* locale: ').slice(1)]
  assert.equal(dictionaries.length, 21)
  for (const block of dictionaries) {
    const at = block.indexOf('"sub.hint"')
    assert.ok(at >= 0, 'a dictionary is missing sub.hint')
    // Read to the end of the line rather than through a quoted capture: some
    // translations escape inner quotes, which would truncate a regex match.
    const line = block.slice(at, block.indexOf('\n', at))
    assert.match(line, /fork/i, 'sub.hint must name the fork boundary: ' + line.slice(0, 60))
    // Both user-visible boundaries must ride the card copy (the user asked for
    // the switch, and the lead asked for the boundaries to be stated there):
    // the fork boundary above, and the "own prompt / sealed prompt never passes
    // through this channel" clause — every translation names codex with it.
    assert.match(line, /codex/i, 'sub.hint must state the external/sealed-prompt boundary: ' + line.slice(0, 60))
  }
})

test('client bundle: card receives scopes ONLY through the inject factory', () => {
  assert.match(clientSource, /function DescLangCard\(props\) \{/)
  // verified against dsh-better-workspace 0.6.0: top-level options fields do
  // NOT reach the component — the scopes must ride the inject factory.
  // (v0.4.4: the factory is hoisted into `injected` so BOTH seats — the
  // legacy settings.plugin.item card and the plugins.bundle.config page —
  // share one definition.)
  assert.match(clientSource, /var injected = function \(\) \{[\s\S]*?\n\s*return \{/)
  const optionsBlock = clientSource.slice(
    clientSource.indexOf('key: NS'),
    clientSource.indexOf('var injected'),
  )
  assert.ok(!/(^|\n)\s*(scope|localeScope|store):/.test(optionsBlock), 'scopes leaked into top-level registration options')
  assert.match(clientSource, /inject: injected/)
  // no external-store hook adapter CALLS: snapshots are read per render, writes bump a tick
  // (the word may appear in explanatory comments)
  assert.doesNotMatch(clientSource, /useSyncExternalStore\s*\(/)
  // a render failure degrades this card only (QuietBoundary pattern)
  assert.match(clientSource, /QuietBoundary/)
})

// ── manifest consistency ─────────────────────────────────────────────────────

test('package manifest: client entry + dsh.client declaration', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.name, 'dsh-agent-lang')
  assert.equal(pkg.exports['./client'], './src/client.js')
  assert.equal(pkg.dsh.client.platform, 'web')
  for (const dep of pkg.dsh.client.inject) assert.match(dep, /^@deepseek-ai\//)
  assert.ok(!pkg.dependencies, 'runtime deps are peers resolved through the profile, not installed')
})

test('package manifest: declares the dsh peer the 0.1.7+ compatibility gate reads', () => {
  // dsh 0.1.7-rc.1 added the ONLY enforced plugin-compatibility mechanism
  // (packages/boot/app-boot/src/plugin-compatibility.ts): every
  // peerDependencies entry named `@deepseek-ai/dsh` or `@deepseek-ai/dsh-*`
  // is compared — prereleases participating — against the running dsh
  // version, and a mismatch silently removes the plugin (bundle layer
  // skipped, row disabled). A manifest with no such peer is never validated,
  // so the range is part of the contract and this test pins it:
  //   floor `>=0.1.0` = the line this build serves (old era <= 0.1.6 through
  //                      the registered namespace, new era >= 0.1.7 through
  //                      the row Config), the floor engines.dsh already names;
  //   NO ceiling. This plugin survives host changes by RUNTIME detection (the
  //   dual-era probes), and the family rule is that an upgrading user must not
  //   lose the plugin to a version the gate merely *guesses* is incompatible:
  //   an upper bound would disable every family plugin on the next dsh line
  //   before anyone observed a real break. When a future line does break a
  //   contract, the adapting release tightens this range together with the
  //   code fix.
  // Not an enumerated version list either: the ecosystem's counter-example is
  // dsh-any-background@0.3.0, whose `... || 0.1.7-alpha.1` enumeration dropped
  // it on 0.1.7-rc.1 and forced per-machine exemptions.
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh'], '>=0.1.0')
  assert.match(pkg.engines.dsh, /^>=0\.1\.0$/, 'peer floor and engines.dsh must tell one compatibility story')
  // OPTIONAL, and it has to stay optional: the gate reads peerDependencies
  // only (`plugin-compatibility.ts` touches no other field, and dsh's runtime
  // reads `peerDependenciesMeta` nowhere at all), while a package manager with
  // autoInstallPeers (pnpm's default) would try to RESOLVE the range against
  // the registry. Every published @deepseek-ai/dsh version is a prerelease,
  // and a plain range excludes prereleases, so an auto-installing client fails
  // the whole install with ERR_PNPM_NO_MATCHING_VERSION / ERESOLVE. Optional
  // peers are not auto-installed, which removes the hazard without weakening
  // the gate (verified live: a manifest whose peer reads 999.0.0 is still
  // dropped even while the optional flag is set).
  assert.equal(pkg.peerDependenciesMeta?.['@deepseek-ai/dsh']?.optional, true)
})

test('plugin manifest and bundle patch reference the plugin row', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const manifest = JSON.parse(readFileSync(new URL('../dsh.plugin.json', import.meta.url), 'utf8'))
  assert.equal(manifest.id, 'dsh-external/dsh-agent-lang')
  assert.equal(manifest.main, './src/index.js')
  // Two manifests, one version: the npm `version` script syncs them, so this
  // assertion catches a hand-edited bump that missed one of the pair.
  assert.equal(manifest.version, pkg.version, 'dsh.plugin.json version drifted from package.json')
  assert.equal(manifest.engines.dsh, pkg.engines.dsh, 'the two manifests disagree about the dsh floor')
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(patch, /- insert:/)
  assert.match(patch, /id: agent-lang/)
  assert.match(patch, /name: 'dsh-agent-lang'/)
})

test('package meta: dsh 0.1.7 plugin-manager display assets', () => {
  // dsh 0.1.7 renders a bundle's localized title/description from
  // `./locale/<tag>.json` exports plus a top-level `icon`; older hosts read
  // none of it (inert extras), so one build serves every era.
  // `exports["./package.json"]` is load-bearing, not cosmetic: the Electron
  // renderer discovers a client package through
  // `createRequire(baseUrl).resolve("<pkg>/package.json")`
  // (packages/client/modules/src/index.ts locatePkgJson, the no-loader
  // fallback), which obeys the exports map — without the entry the client half
  // never enters the boot graph while every host log stays green.
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.icon, './icon.svg')
  assert.equal(pkg.exports['./package.json'], './package.json')
  assert.equal(pkg.exports['./locale/*.json'], './locale/*.json')
  assert.ok(pkg.files.includes('locale'), 'locale/ must ship in files[]')
  assert.ok(pkg.files.includes('icon.svg'), 'icon.svg must ship in files[]')
  readFileSync(new URL('../icon.svg', import.meta.url), 'utf8')
  for (const tag of ['en', 'zh']) {
    const meta = JSON.parse(readFileSync(new URL(`../locale/${tag}.json`, import.meta.url), 'utf8'))
    assert.equal(typeof meta.meta?.title, 'string', `locale/${tag}.json meta.title`)
    assert.equal(typeof meta.meta?.description, 'string', `locale/${tag}.json meta.description`)
  }
})
