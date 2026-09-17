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
  // empty forever (live regression, 2026-08-31).
  assert.match(hostSource, /pctx\.get\('settings'\)/)
  // ban the ACCESS form only (the word may appear in explanatory comments)
  assert.doesNotMatch(hostSource, /pctx\.settings\??\./)
})

test('host half: namespace schema via dynamic schemastery import, era-probed ns', () => {
  // Dynamic import keeps this file importable by zero-dependency Node tests.
  assert.match(hostSource, /import\('@deepseek-ai\/schemastery'\)/)
  assert.match(hostSource, /import\('@deepseek-ai\/dsh-settings'\)/)
  assert.match(hostSource, /settingsNamespace/)
  assert.match(hostSource, /settings\.register\(ns, schema\)/)
})

test('host half: reads the locale namespace but never writes it', () => {
  assert.match(hostSource, new RegExp('LOCALE_NAMESPACE'))
  for (const banned of ['update(LOCALE_NAMESPACE', 'replace(LOCALE_NAMESPACE', 'mutate(LOCALE_NAMESPACE']) {
    assert.ok(!hostSource.includes(banned), `host half must not call ${banned}`)
  }
})

test('host half: directive text provider is a function re-evaluated per assembly', () => {
  assert.match(hostSource, /text: \(\) => \{/)
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
  assert.match(clientSource, /settingsScope\.bind\(\{ namespace: NS \}\)/)
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

test('plugin manifest and bundle patch reference the plugin row', () => {
  const manifest = JSON.parse(readFileSync(new URL('../dsh.plugin.json', import.meta.url), 'utf8'))
  assert.equal(manifest.id, 'dsh-external/dsh-agent-lang')
  assert.equal(manifest.main, './src/index.js')
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(patch, /- insert:/)
  assert.match(patch, /id: agent-lang/)
  assert.match(patch, /name: 'dsh-agent-lang'/)
})
