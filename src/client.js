/**
 * dsh-agent-lang — browser half (hand-written ModuleLoader bundle).
 *
 * Two jobs:
 *   1. REPORTER — pushes the locale runtime's ACTIVE locale (the explicit
 *      Settings→General choice OR the browser navigator match, whatever the
 *      GUI is actually showing) into the Host's `agent-lang` settings
 *      namespace via a bound `settingsScope`, so the Host-side prompt
 *      directives can localize even before the user ever picks a language.
 *   2. SETTINGS CARD — registers a `settings.plugin.item` card keyed by the
 *      SAME namespace. The Plugins tab dispatches the intersection of
 *      Host-served namespaces and registered cards. The card exposes three
 *      independently configured channels — tool-call descriptions, model
 *      thinking, user-facing replies — each auto (follow the GUI language) /
 *      force (a fixed BCP 47 tag) / off, plus one-click "sync all to GUI"
 *      and "turn all off" shortcuts.
 *
 * SLOT REGISTRATION CONTRACT (verified against dsh-better-workspace 0.6.0,
 * live 2026-08-31): arbitrary objects do NOT reach the component through
 * top-level registration options — only the protocol fields do (`locale`
 * binds the `t` seat, `store` binds a store seat, and an `inject` FACTORY's
 * returned members become props: plain members by their own name, a `hooks`
 * sub-object's members as useXxx hooks). This bundle passes the bound
 * settings scopes through an `inject` factory as PLAIN members; the card
 * reads them via getSnapshot() per render and refreshes with a local tick
 * after each write (no useSyncExternalStore: a scope passed this way has no
 * hook adapter).
 *
 * Hand-written bundle rules (no build step in this repo):
 *   - ONE window.__ModuleLoader__.load({...}) call, id = package name;
 *   - `require` restricted to the client-module BASELINE whitelist:
 *     react and @deepseek-ai/dsh-client-ui-primitives only (smoke-enforced);
 *   - plain React.createElement, no JSX/TS; components defined at module
 *     level so parent re-renders never remount them;
 *   - `dsh.client.inject` in package.json lists the packages that must load
 *     first so `locale` / `settingsScope` / `slots` exist when this applies.
 */
window.__ModuleLoader__.load({
	id: "dsh-agent-lang",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		var React = require("react");
		var ui = require("@deepseek-ai/dsh-client-ui-primitives");

		var E = React.createElement;
		var useState = React.useState;

		// Common BCP 47 candidates for the force-language combo (datalist).
		// The datalist is a HINT, not a constraint: users may still type any
		// BCP 47 tag. Option labels only render on browsers that support
		// them; the value is what gets written.
		var LANG_OPTIONS = [
			{ value: "zh", label: "简体中文 (zh)" },
			{ value: "zh-Hans", label: "简体中文 (zh-Hans)" },
			{ value: "zh-TW", label: "繁體中文 (zh-TW)" },
			{ value: "en", label: "English (en)" },
			{ value: "ja", label: "日本語 (ja)" },
			{ value: "ko", label: "한국어 (ko)" },
			{ value: "fr", label: "Français (fr)" },
			{ value: "de", label: "Deutsch (de)" },
			{ value: "es", label: "Español (es)" },
			{ value: "ru", label: "Русский (ru)" },
			{ value: "pt", label: "Português (pt)" },
			{ value: "it", label: "Italiano (it)" },
			{ value: "ar", label: "العربية (ar)" },
			{ value: "hi", label: "हिन्दी (hi)" },
			{ value: "vi", label: "Tiếng Việt (vi)" },
			{ value: "th", label: "ไทย (th)" },
		];

		/** One channel's force-language options: a stored custom tag first
		 *  (so a saved value is always visible), then the common list. */
		function langOptions(current) {
			var opts = [];
			if (typeof current === "string" && current !== "") {
				opts.push({ value: current, label: current + " (current)" });
			}
			for (var i = 0; i < LANG_OPTIONS.length; i++) {
				var o = LANG_OPTIONS[i];
				if (o.value === current) continue;
				opts.push(o);
			}
			return opts;
		}

		var TAG = "[dsh-agent-lang]";
		var NS = "agent-lang";
		var LOCALE_NS = "locale";
		var DICT_NS = "agentLang";

		// ── locale dictionaries (all four MUST stay key-aligned; smoke-enforced) ──

		var zh = {
			"title": "语言控制",
			"cardDesc": "工具描述、模型思考、回复输出——三个通道各自跟随界面语言或固定指定语言",
			"mode.auto": "跟随界面语言",
			"mode.force": "强制指定语言",
			"mode.off": "关闭",
			"quick.syncAll": "全部跟随界面",
			"quick.offAll": "全部关闭",
			"chan.desc": "工具描述",
			"chan.think": "模型思考",
			"chan.output": "回复输出",
			"chosen": "设置中的显式选择",
			"reported": "浏览器上报",
			"undetected": "未检测到语言(不注入)",
			"none": "—",
			"error": "写入失败",
			"hint": "三个通道独立配置:跟随界面 / 强制指定 / 关闭(思考与回复默认关闭以保持现状)。检测优先级:设置 → 通用 → 语言的显式选择 > 浏览器上报。切换后下一轮请求即生效;minimal 模式提示词封闭,不在范围内。",
		};

		var en = {
			"title": "Language Control",
			"cardDesc": "Tool descriptions, model thinking, and replies — each follows the GUI language or a fixed one",
			"mode.auto": "Follow GUI language",
			"mode.force": "Force a language",
			"mode.off": "Off",
			"quick.syncAll": "Sync all to GUI",
			"quick.offAll": "Turn all off",
			"chan.desc": "Tool descriptions",
			"chan.think": "Model thinking",
			"chan.output": "Replies",
			"chosen": "Explicit choice (Settings → General)",
			"reported": "Browser report",
			"undetected": "No language detected (nothing injected)",
			"none": "—",
			"error": "Write failed",
			"hint": "Three independent channels: follow GUI / force a tag / off (thinking and replies default to off, preserving current behavior). Detection order: the explicit Settings → General → Language choice over the browser report. Changes apply on the next request; the minimal preset seals its prompt and is out of scope.",
		};

		// Optional language packs: registered per-locale, inert until a matching
		// external language definition (ja/ko) is active in the GUI.
		var ja = {
			"title": "言語制御",
			"cardDesc": "ツール説明・モデルの思考・回答をそれぞれGUI言語または指定言語で",
			"mode.auto": "GUI言語に従う",
			"mode.force": "言語を指定",
			"mode.off": "オフ",
			"quick.syncAll": "すべてGUI言語に",
			"quick.offAll": "すべてオフ",
			"chan.desc": "ツール説明",
			"chan.think": "モデルの思考",
			"chan.output": "回答出力",
			"chosen": "設定での明示的な選択",
			"reported": "ブラウザー報告",
			"undetected": "言語未検出(注入なし)",
			"none": "—",
			"error": "書き込み失敗",
			"hint": "3つのチャネルを独立に設定:GUI言語に従う / 指定 / オフ(思考と回答は現状維持のためデフォルトはオフ)。検出順序:設定 → 全般 → 言語の明示的な選択がブラウザー報告に優先。切り替えは次のリクエストから反映;minimal プリセットはプロンプトが封鎖されているため対象外です。",
		};

		var ko = {
			"title": "언어 제어",
			"cardDesc": "도구 설명·모델 사고·응답을 각각 GUI 언어 또는 지정 언어로",
			"mode.auto": "GUI 언어 따르기",
			"mode.force": "언어 지정",
			"mode.off": "끄기",
			"quick.syncAll": "전체 GUI 언어로",
			"quick.offAll": "전체 끄기",
			"chan.desc": "도구 설명",
			"chan.think": "모델 사고",
			"chan.output": "응답 출력",
			"chosen": "설정에서 명시적 선택",
			"reported": "브라우저 보고",
			"undetected": "언어 미감지(주입 없음)",
			"none": "—",
			"error": "쓰기 실패",
			"hint": "세 채널을 독립 설정:GUI 언어 따르기 / 지정 / 끄기(사고와 응답은 현상 유지를 위해 기본 꺼짐). 감지 순서: 설정 → 일반 → 언어의 명시적 선택이 브라우저 보고에 우선. 전환은 다음 요청부터 적용;minimal 프리셋은 프롬프트가 폐쇄되어 있어 대상에서 제외됩니다.",
		};

		/** Language id → self name, mirroring the host half's table. */
		function selfName(id) {
			if (typeof id !== "string" || id.length === 0) return undefined;
			var key = id.toLowerCase();
			if (key === "en") return "English";
			if (key === "zh") return "简体中文";
			if (key === "ja") return "日本語";
			if (key === "ko") return "한국어";
			return '"' + id + '"';
		}

		// ── styles (dl- prefixed; tokens mirror PluginCard.module.css) ──────────

		var STYLE_ID = "dsh-agent-lang-style";

		var CSS = [
			".dl-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s,background .16s}",
			".dl-card:hover{border-color:var(--dsw-alias-label-dimmed)}",
			".dl-card.dl-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}",
			".dl-header{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}",
			".dl-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}",
			".dl-headText{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}",
			".dl-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}",
			".dl-desc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}",
			".dl-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}",
			".dl-chevron.dl-chevronOpen{transform:rotate(180deg)}",
			".dl-body{display:flex;flex-direction:column;gap:12px;padding:4px 16px 16px;max-width:640px}",
			".dl-row{display:flex;align-items:baseline;gap:8px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary)}",
			".dl-rowLabel{flex:none;color:var(--dsw-alias-label-tertiary)}",
			".dl-rowValue{min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}",
			".dl-seg{display:flex;gap:8px;flex-wrap:wrap}",
			".dl-segBtn{appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;padding:6px 12px;cursor:pointer;transition:border-color .16s,color .16s}",
			".dl-segBtn:hover{border-color:var(--dsw-alias-label-dimmed)}",
			".dl-segBtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
			".dl-segBtn.dl-segActive{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}",
			".dl-force{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--dsw-alias-label-secondary)}",
			".dl-chanLabel{font-weight:500;color:var(--dsw-alias-label-primary)}",
			".dl-input{appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:6px 10px;max-width:220px}",
			".dl-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
			".dl-hint{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}",
			".dl-error{margin:0;font-size:12px;color:var(--dsw-alias-status-danger, #e5484d)}",
		].join("\n");

		function ensureStyles() {
			try {
				if (typeof document === "undefined" || typeof document.getElementById !== "function") return function () {};
				if (document.getElementById(STYLE_ID)) return function () {};
				var style = document.createElement("style");
				style.id = STYLE_ID;
				style.textContent = CSS;
				document.head.appendChild(style);
				return function () {
					try {
						if (style.parentNode) style.parentNode.removeChild(style);
					} catch (error) { /* best effort */ }
				};
			} catch (error) {
				return function () {};
			}
		}

		/** Defensive primitives lookup: an unknown icon name degrades to a text chevron. */
		function icon(name) {
			try {
				var component = ui && ui[name];
				return typeof component === "function" ? component : null;
			} catch (error) {
				return null;
			}
		}

		// ── error boundary (the dsh-better-workspace QuietBoundary pattern) ──────

		/** A render failure degrades THIS card, never the settings page. */
		function QuietBoundary(props) {}
		QuietBoundary.prototype = Object.create(React.Component.prototype);
		QuietBoundary.prototype.constructor = QuietBoundary;
		QuietBoundary.state = { failed: false };
		QuietBoundary.getDerivedStateFromError = function () { return { failed: true } };
		QuietBoundary.prototype.componentDidCatch = function (error) {
			console.warn(TAG + " settings card render failed:", error && error.message ? error.message : error);
		};
		QuietBoundary.prototype.render = function () {
			if (this.state && this.state.failed) return null;
			return this.props.children;
		};

		// ── settings card (module-level component) ───────────────────────────────

		/**
		 * The Settings → Plugins card. `t` arrives through the registration's
		 * `locale` field; `scope`/`localeScope` arrive as PLAIN props from the
		 * `inject` factory. Snapshots are read per render; each write bumps a
		 * local tick so the card re-reads without an external-store hook adapter.
		 */
		function DescLangCard(props) {
			var t = typeof props.t === "function" ? props.t : function (key) { return key; };

			var openState = useState(false);
			var open = openState[0];
			var setOpen = openState[1];

			var errorState = useState("");
			var error = errorState[0];
			var setError = errorState[1];

			var tickState = useState(0);
			var tick = tickState[0];
			var bumpTick = tickState[1];
			void tick;

			var scope = props.scope;
			var localeScope = props.localeScope;

			var snap = { status: "unavailable" };
			try {
				if (scope && typeof scope.getSnapshot === "function") snap = scope.getSnapshot();
			} catch (error_) { /* keep unavailable */ }
			var localeSnap = undefined;
			try {
				if (localeScope && typeof localeScope.getSnapshot === "function") localeSnap = localeScope.getSnapshot();
			} catch (error_) { /* ignore */ }

			if (snap.status !== "ready") return null;

			var value = snap.value || {};
			var mode = value.mode || "auto";
			var reported = typeof value.uiLocale === "string" ? value.uiLocale : "";
			var chosen = localeSnap && localeSnap.status === "ready" && localeSnap.value
				? (typeof localeSnap.value.preference === "string" ? localeSnap.value.preference : "")
				: "";

			// Generic multi-field write: each patch key is set in order; an
			// empty-string value clears the stored field (re-inherits defaults).
			function write(patch) {
				setError("");
				var keys = Object.keys(patch);
				var chain = Promise.resolve();
				for (var ki = 0; ki < keys.length; ki++) {
					(function (key) {
						chain = chain.then(function () {
							var v = patch[key];
							if (v === "") return scope.unset(key);
							return scope.set(key, v);
						});
					})(keys[ki]);
				}
				chain
					.then(function () { bumpTick(function (n) { return n + 1; }); })
					.catch(function (err) {
						bumpTick(function (n) { return n + 1; });
						setError(t("error") + ": " + (err && err.message ? err.message : String(err)));
					});
			}

			// One label resolver shared by the three channels: what the channel
			// currently resolves to, shown beside its name.
			function channelLabel(m, locale) {
				if (m === "off") return t("mode.off");
				if (m === "force") {
					if (typeof locale === "string" && locale) return selfName(locale) || locale;
					return t("mode.force");
				}
				var effective = chosen || reported;
				if (!effective) return t("undetected");
				if (effective.toLowerCase() === "en") return "English";
				var self = selfName(effective);
				return (self || '"' + effective + '"') + " (" + effective + ")";
			}

			var channels = [
				{ key: "desc", label: t("chan.desc"), modeKey: "mode", localeKey: "forceLocale", m: mode, loc: value.forceLocale },
				{ key: "think", label: t("chan.think"), modeKey: "thinkMode", localeKey: "thinkLocale", m: value.thinkMode || "off", loc: value.thinkLocale },
				{ key: "out", label: t("chan.output"), modeKey: "outMode", localeKey: "outLocale", m: value.outMode || "off", loc: value.outLocale },
			];

			var Chevron = icon("IconChevronDownOutline14");

			var modes = [
				{ id: "auto", label: t("mode.auto") },
				{ id: "force", label: t("mode.force") },
				{ id: "off", label: t("mode.off") },
			];

			function channelBlock(ch) {
				return E("div", { key: ch.key, className: "dl-force" },
					E("span", { className: "dl-chanLabel" }, ch.label + ": " + channelLabel(ch.m, ch.loc)),
					E("div", { className: "dl-seg" },
						modes.map(function (m) {
							return E("button", {
								key: m.id,
								type: "button",
								className: "dl-segBtn" + (ch.m === m.id ? " dl-segActive" : ""),
								onClick: function () {
									var patch = {};
									patch[ch.modeKey] = m.id;
									write(patch);
								},
							}, m.label);
						}),
					),
					ch.m === "force"
						? E(React.Fragment, null,
							E("input", {
								className: "dl-input",
								type: "text",
								list: "dl-lang-" + ch.key,
								defaultValue: typeof ch.loc === "string" ? ch.loc : "",
								placeholder: "zh",
								spellCheck: false,
								"aria-label": t("mode.force"),
								onBlur: function (event) {
									var patch = {};
									patch[ch.localeKey] = (event.target.value || "").trim();
									write(patch);
								},
								onKeyDown: function (event) {
									if (event.key === "Enter") {
										event.preventDefault();
										var patch = {};
										patch[ch.localeKey] = (event.target.value || "").trim();
										write(patch);
									}
								},
							}),
							E("datalist", { id: "dl-lang-" + ch.key },
								langOptions(ch.loc).map(function (opt) {
									return E("option", { key: opt.value, value: opt.value, label: opt.label }, null);
								})
							),
						)
						: null,
				);
			}

			return E("li", { className: "dl-card" + (open ? " dl-open" : "") },
				E("button", {
					type: "button",
					className: "dl-header",
					"aria-expanded": open,
					onClick: function () { setOpen(!open); },
				},
					E("span", { className: "dl-headText" },
						E("span", { className: "dl-name" }, t("title")),
						E("span", { className: "dl-desc" }, t("cardDesc")),
					),
					Chevron
						? E(Chevron, { className: "dl-chevron" + (open ? " dl-chevronOpen" : "") })
						: E("span", { className: "dl-chevron" + (open ? " dl-chevronOpen" : "") }, "▾"),
				),
				open ? E("div", { className: "dl-body" },
					E("div", { className: "dl-seg" },
						E("button", {
							type: "button",
							className: "dl-segBtn",
							onClick: function () { write({ mode: "auto", thinkMode: "auto", outMode: "auto" }); },
						}, t("quick.syncAll")),
						E("button", {
							type: "button",
							className: "dl-segBtn",
							onClick: function () { write({ mode: "off", thinkMode: "off", outMode: "off" }); },
						}, t("quick.offAll")),
					),
					E("div", { className: "dl-row" },
						E("span", { className: "dl-rowLabel" }, t("chosen") + ":"),
						E("span", { className: "dl-rowValue" }, chosen || t("none")),
					),
					E("div", { className: "dl-row" },
						E("span", { className: "dl-rowLabel" }, t("reported") + ":"),
						E("span", { className: "dl-rowValue" }, reported || t("none")),
					),
					channels.map(channelBlock),
					error ? E("p", { className: "dl-error" }, error) : null,
					E("p", { className: "dl-hint" }, t("hint")),
				) : null,
			);
		}

		// ── plugin ────────────────────────────────────────────────────────────

		exports.name = "dsh-agent-lang/client";

		/** Required client services: locale runtime, settings scopes, slots. */
		exports.inject = ["locale", "settingsScope", "slots"];

		exports.apply = function (ctx) {
			var scope = ctx.settingsScope.bind({ namespace: NS });
			var localeScope = ctx.settingsScope.bind({ namespace: LOCALE_NS });

			var lastReported;

			function report(snapshot) {
				try {
					var active = snapshot && typeof snapshot.active === "string" ? snapshot.active : undefined;
					if (!active || active === lastReported) return;
					var previous = lastReported;
					lastReported = active;
					scope.set("uiLocale", active).then(
						function () {},
						function (error) {
							lastReported = previous;
							console.warn(TAG + " ui-locale report failed:", error && error.message ? error.message : error);
						},
					);
				} catch (error) {
					console.warn(TAG + " ui-locale report error:", error && error.message ? error.message : error);
				}
			}

			ctx.effect(function () {
				var disposers = [ensureStyles()];
				try {
					var disposeDict = ctx.locale.register(DICT_NS, { zh: zh, en: en });
					if (typeof disposeDict === "function") disposers.push(disposeDict);
					// Optional packs (ja/ko): inert until a matching external
					// language definition is active in the GUI.
					try {
						var disposeJa = ctx.locale.register(DICT_NS, "ja", ja);
						if (typeof disposeJa === "function") disposers.push(disposeJa);
					} catch (error) { /* optional pack stays absent */ }
					try {
						var disposeKo = ctx.locale.register(DICT_NS, "ko", ko);
						if (typeof disposeKo === "function") disposers.push(disposeKo);
					} catch (error) { /* optional pack stays absent */ }
				} catch (error) {
					console.warn(TAG + " dictionary registration failed:", error && error.message ? error.message : error);
				}
				try {
					report(ctx.locale.getSnapshot());
				} catch (error) {
					console.warn(TAG + " initial snapshot failed:", error && error.message ? error.message : error);
				}
				var disposeListener = ctx.on("locale/change", report);
				disposers.push(function () {
					try {
						if (typeof disposeListener === "function") disposeListener();
					} catch (error) { /* best effort */ }
				});
				return function () {
					for (var i = 0; i < disposers.length; i++) {
						try {
							if (typeof disposers[i] === "function") disposers[i]();
						} catch (error) { /* best effort */ }
					}
				};
			}, "dsh-agent-lang: styles, dictionaries, ui-locale report");

			// Guarded registration (the dsh-better-workspace pattern): a thrown
			// register degrades this one seat, never the plugin fiber.
			try {
				var slots = ctx.slots;
				if (!slots || typeof slots.register !== "function" || typeof slots.inject !== "function") {
					console.warn(TAG + " slots service unavailable; settings card skipped");
					return;
				}
				slots.inject("settings.plugin.item", function () {
					return slots.register({
						name: "settings.plugin.item",
						key: NS,
						locale: DICT_NS,
						// The inject factory's returned members become the
						// component's props: the two bound settings scopes ride
						// here as PLAIN members (top-level options fields do NOT
						// reach the component).
						inject: function () {
							return { scope: scope, localeScope: localeScope };
						},
					}, function CardWithBoundary(props) {
						return E(QuietBoundary, null, E(DescLangCard, props));
					});
				});
			} catch (error) {
				console.warn(TAG + " settings card registration failed:", error && error.message ? error.message : error);
			}
		};

		return module.exports;
	},
});
