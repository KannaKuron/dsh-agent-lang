// Smoke tests for dsh-desc-lang — pure file/helper level, no Cordis runtime
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
  languageSelfName,
  buildLanguageDirective,
} = _internal

const hostSource = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8')
const clientSource = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')

// ── plugin shape ─────────────────────────────────────────────────────────────

test('plugin shape: name, no hard injects, namespace constants', () => {
  assert.equal(pluginName, 'dsh-desc-lang')
  assert.deepEqual(pluginInject, [])
  assert.equal(SETTINGS_NAMESPACE, 'desc-lang')
  assert.equal(LOCALE_NAMESPACE, 'locale')
})

test('context placement: free slot after the centrally allocated orders', () => {
  assert.equal(CONTEXT_NAME, 'desc-lang:ui-language')
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
  assert.equal(languageSelfName('ja'), 'the language with BCP-47 tag "ja"')
})

test('buildLanguageDirective: zh mentions the run_code description and the self name', () => {
  const text = buildLanguageDirective('zh')
  assert.match(text, /简体中文/)
  assert.match(text, /run_code/)
  assert.match(text, /description/)
  assert.match(text, /not in English/)
})

test('buildLanguageDirective: English and absent contribute nothing', () => {
  assert.equal(buildLanguageDirective('en'), '')
  assert.equal(buildLanguageDirective('EN'), '')
  assert.equal(buildLanguageDirective(undefined), '')
  assert.equal(buildLanguageDirective(''), '')
})

test('buildLanguageDirective: unknown tags still produce a directive', () => {
  const text = buildLanguageDirective('ja')
  assert.match(text, /BCP-47 tag "ja"/)
  assert.ok(text.length > 0)
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
  assert.match(clientSource, /id: "dsh-desc-lang"/)
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

test('client bundle: reports ONLY uiLocale into the desc-lang namespace', () => {
  assert.match(clientSource, /settingsScope\.bind\(\{ namespace: NS \}\)/)
  assert.match(clientSource, /scope\.set\("uiLocale", active\)/)
  // never touches the built-in locale namespace with a write
  for (const banned of ['localeScope.set', 'localeScope.unset', 'localeScope.mutate']) {
    assert.ok(!clientSource.includes(banned), `client bundle must not call ${banned}`)
  }
})

test('client bundle: settings card keyed by the namespace with zh/en dictionaries', () => {
  assert.match(clientSource, /settings\.plugin\.item/)
  assert.match(clientSource, /key: NS/)
  assert.match(clientSource, /ctx\.locale\.register\(DICT_NS, \{ zh: zh, en: en \}\)/)
  assert.match(clientSource, /ctx\.locale\.register\(DICT_NS, "ja", ja\)/)
  assert.match(clientSource, /ctx\.locale\.register\(DICT_NS, "ko", ko\)/)
})

test('client bundle: zh/en/ja/ko dictionary keys stay aligned', () => {
  function keys(objectLiteralName) {
    const start = clientSource.indexOf('var ' + objectLiteralName + ' = {')
    assert.ok(start >= 0, objectLiteralName + ' not found')
    let depth = 0
    let i = clientSource.indexOf('{', start)
    const from = i
    for (; i < clientSource.length; i++) {
      const ch = clientSource[i]
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) break
      }
    }
    const body = clientSource.slice(from, i)
    return new Set([...body.matchAll(/"([a-zA-Z][a-zA-Z0-9.]*)":/g)].map((m) => m[1]))
  }
  const zhKeys = keys('zh')
  assert.ok(zhKeys.size > 0)
  for (const other of ['en', 'ja', 'ko']) {
    assert.deepEqual([...keys(other)].sort(), [...zhKeys].sort(), other + ' dictionary keys drift from zh')
  }
})

test('client bundle: card receives scopes ONLY through the inject factory', () => {
  assert.match(clientSource, /function DescLangCard\(props\) \{/)
  // verified against dsh-better-workspace 0.6.0: top-level options fields do
  // NOT reach the component — the scopes must ride the inject factory.
  assert.match(clientSource, /inject: function \(\) \{\s*\n\s*return \{ scope: scope, localeScope: localeScope \}/)
  const optionsBlock = clientSource.slice(
    clientSource.indexOf('key: NS'),
    clientSource.indexOf('inject: function ()'),
  )
  assert.ok(!/(^|\n)\s*(scope|localeScope|store):/.test(optionsBlock), 'scopes leaked into top-level registration options')
  // no external-store hook adapter CALLS: snapshots are read per render, writes bump a tick
  // (the word may appear in explanatory comments)
  assert.doesNotMatch(clientSource, /useSyncExternalStore\s*\(/)
  // a render failure degrades this card only (QuietBoundary pattern)
  assert.match(clientSource, /QuietBoundary/)
})

// ── manifest consistency ─────────────────────────────────────────────────────

test('package manifest: client entry + dsh.client declaration', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.name, 'dsh-desc-lang')
  assert.equal(pkg.exports['./client'], './src/client.js')
  assert.equal(pkg.dsh.client.platform, 'web')
  for (const dep of pkg.dsh.client.inject) assert.match(dep, /^@deepseek-ai\//)
  assert.ok(!pkg.dependencies, 'runtime deps are peers resolved through the profile, not installed')
})

test('plugin manifest and bundle patch reference the plugin row', () => {
  const manifest = JSON.parse(readFileSync(new URL('../dsh.plugin.json', import.meta.url), 'utf8'))
  assert.equal(manifest.id, 'dsh-external/dsh-desc-lang')
  assert.equal(manifest.main, './src/index.js')
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(patch, /- insert:/)
  assert.match(patch, /id: desc-lang/)
  assert.match(patch, /name: 'dsh-desc-lang'/)
})
