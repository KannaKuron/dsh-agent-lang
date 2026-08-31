/**
 * dsh-desc-lang — browser half (hand-written ModuleLoader bundle).
 *
 * Two jobs:
 *   1. REPORTER — pushes the locale runtime's ACTIVE locale (the explicit
 *      Settings→General choice OR the browser navigator match, whatever the
 *      GUI is actually showing) into the Host's `desc-lang` settings
 *      namespace via a bound `settingsScope`, so the Host-side prompt
 *      directive can localize tool-call descriptions even before the user
 *      ever picks a language.
 *   2. SETTINGS CARD — registers a `settings.plugin.item` card keyed by the
 *      SAME namespace. The Plugins tab dispatches the intersection of
 *      Host-served namespaces and registered cards, so the card appears in
 *      Settings → Plugins automatically once the Host half has registered
 *      the namespace. The card switches mode (auto/force/off) and, for
 *      force mode, the forced language tag.
 *
 * Hand-written bundle rules (no build step in this repo):
 *   - ONE window.__ModuleLoader__.load({...}) call, id = package name (the
 *     combo route serves `<id>/client.js`);
 *   - `require` restricted to the client-module BASELINE whitelist:
 *     react and @deepseek-ai/dsh-client-ui-primitives only (smoke-enforced);
 *   - plain React.createElement, no JSX/TS; components defined at module
 *     level so parent re-renders never remount them;
 *   - `dsh.client.inject` in package.json lists the packages that must load
 *     first so `locale` / `settingsScope` / `slots` exist when this applies.
 */
window.__ModuleLoader__.load({
	id: "dsh-desc-lang",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		var React = require("react");
		var ui = require("@deepseek-ai/dsh-client-ui-primitives");

		var E = React.createElement;
		var useState = React.useState;
		var useSyncExternalStore = React.useSyncExternalStore;

		var TAG = "[dsh-desc-lang]";
		var NS = "desc-lang";
		var LOCALE_NS = "locale";
		var DICT_NS = "descLang";

		// ── locale dictionaries (zh/en keys MUST stay aligned; smoke-enforced) ──

		var zh = {
			"title": "工具描述语言",
			"cardDesc": "让每个工具调用的 description 跟随界面语言书写(含 PTC 模式 run_code)",
			"mode": "行为",
			"mode.auto": "跟随界面语言",
			"mode.force": "强制指定语言",
			"mode.off": "关闭",
			"forceLocale": "语言标签",
			"forceLocale.hint": "BCP 47 标签,如 zh、ja、zh-Hant;留空则回到跟随界面语言",
			"current": "当前生效",
			"default": "英文(默认行为,不注入提示词)",
			"chosen": "设置中的显式选择",
			"reported": "浏览器上报",
			"none": "—",
			"error": "写入失败",
			"hint": "自动检测顺序:设置 → 通用 → 语言里的显式选择优先;从未选择过时跟随浏览器语言(由本页上报)。切换界面语言后,下一轮请求即生效。极简模式(minimal)的提示词由其自身封闭,不在覆盖范围内。",
		};

		var en = {
			"title": "Tool Description Language",
			"cardDesc": "Tool-call descriptions (including PTC run_code's) follow the GUI language",
			"mode": "Behavior",
			"mode.auto": "Follow GUI language",
			"mode.force": "Force a language",
			"mode.off": "Off",
			"forceLocale": "Language tag",
			"forceLocale.hint": "BCP 47 tag, e.g. zh, ja, zh-Hant; empty falls back to following the GUI language",
			"current": "Currently active",
			"default": "English (default behavior, nothing injected)",
			"chosen": "Explicit choice (Settings → General)",
			"reported": "Browser report",
			"none": "—",
			"error": "Write failed",
			"hint": "Auto-detection order: the explicit Settings → General → Language choice wins; with no choice ever made, the browser language is followed (reported by this page). A GUI language switch takes effect on the next request. The minimal preset seals its own prompt and is out of scope by design.",
		};

		/** Language id → self name, mirroring the host half's table. */
		function selfName(id) {
			if (typeof id !== "string" || id.length === 0) return undefined;
			var key = id.toLowerCase();
			if (key === "en") return "English";
			if (key === "zh") return "简体中文";
			return '"' + id + '"';
		}

		// ── styles (dl- prefixed; tokens mirror PluginCard.module.css) ──────────

		var STYLE_ID = "dsh-desc-lang-style";

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
			".dl-force{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--dsw-alias-label-secondary)}",
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

		// ── settings card (module-level component; hooks before early returns) ──

		/**
		 * The Settings → Plugins card. Runtime props arrive through the slot
		 * registration options: `t` (bound dictionary), `scope` (this plugin's
		 * settings scope), `localeScope` (the built-in locale namespace scope,
		 * read-only, for showing the explicit choice in the detection chain).
		 */
		function DescLangCard(props) {
			var scope = props.scope;
			var localeScope = props.localeScope;
			var t = typeof props.t === "function" ? props.t : function (key) { return key; };

			var openState = useState(false);
			var open = openState[0];
			var setOpen = openState[1];

			var errorState = useState("");
			var error = errorState[0];
			var setError = errorState[1];

			var snap = useSyncExternalStore(scope.subscribe, scope.getSnapshot);
			var localeSnap = localeScope
				? useSyncExternalStore(localeScope.subscribe, localeScope.getSnapshot)
				: { status: "unavailable" };

			// A card renders nothing while its namespace is unavailable: the
			// Host plugin is absent or the connection keeps settings local.
			if (snap.status !== "ready") return null;

			var value = snap.value || {};
			var mode = value.mode || "auto";
			var reported = typeof value.uiLocale === "string" ? value.uiLocale : "";
			var chosen = localeSnap && localeSnap.status === "ready" && localeSnap.value
				? (typeof localeSnap.value.preference === "string" ? localeSnap.value.preference : "")
				: "";

			function write(patch) {
				setError("");
				Promise.resolve()
					.then(function () {
						if (patch.mode !== undefined) return scope.set("mode", patch.mode);
					})
					.then(function () {
						if (patch.forceLocale !== undefined) {
							return patch.forceLocale === ""
								? scope.unset("forceLocale")
								: scope.set("forceLocale", patch.forceLocale);
						}
					})
					.catch(function (err) {
						setError(t("error") + ": " + (err && err.message ? err.message : String(err)));
					});
			}

			var resolvedLabel = t("default");
			if (mode === "force" && typeof value.forceLocale === "string" && value.forceLocale) {
				resolvedLabel = selfName(value.forceLocale) || value.forceLocale;
			} else if (mode === "auto") {
				var effective = chosen || reported;
				var self = selfName(effective);
				if (effective && effective.toLowerCase() !== "en") {
					resolvedLabel = (self || '"' + effective + '"') + " (" + effective + ")";
				} else if (effective && effective.toLowerCase() === "en") {
					resolvedLabel = "English";
				}
			}

			var Chevron = icon("IconChevronDownOutline14");

			var modes = [
				{ id: "auto", label: t("mode.auto") },
				{ id: "force", label: t("mode.force") },
				{ id: "off", label: t("mode.off") },
			];

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
					E("div", { className: "dl-row" },
						E("span", { className: "dl-rowLabel" }, t("current") + ":"),
						E("span", { className: "dl-rowValue" }, resolvedLabel),
					),
					E("div", { className: "dl-row" },
						E("span", { className: "dl-rowLabel" }, t("chosen") + ":"),
						E("span", { className: "dl-rowValue" }, chosen || t("none")),
					),
					E("div", { className: "dl-row" },
						E("span", { className: "dl-rowLabel" }, t("reported") + ":"),
						E("span", { className: "dl-rowValue" }, reported || t("none")),
					),
					E("div", { className: "dl-force" },
						E("span", null, t("mode")),
						E("div", { className: "dl-seg" },
							modes.map(function (m) {
								return E("button", {
									key: m.id,
									type: "button",
									className: "dl-segBtn" + (mode === m.id ? " dl-segActive" : ""),
									onClick: function () { write({ mode: m.id }); },
								}, m.label);
							}),
						),
					),
					mode === "force"
						? E("label", { className: "dl-force" },
							E("span", null, t("forceLocale")),
							E("input", {
								className: "dl-input",
								type: "text",
								defaultValue: typeof value.forceLocale === "string" ? value.forceLocale : "",
								placeholder: "zh",
								spellCheck: false,
								onBlur: function (event) {
									write({ forceLocale: (event.target.value || "").trim() });
								},
								onKeyDown: function (event) {
									if (event.key === "Enter") {
										event.preventDefault();
										write({ forceLocale: (event.target.value || "").trim() });
									}
								},
							}),
							E("span", { className: "dl-hint" }, t("forceLocale.hint")),
						)
						: null,
					error ? E("p", { className: "dl-error" }, error) : null,
					E("p", { className: "dl-hint" }, t("hint")),
				) : null,
			);
		}

		// ── plugin ────────────────────────────────────────────────────────────

		exports.name = "dsh-desc-lang/client";

		/** Required client services: locale runtime, settings scopes, slots. */
		exports.inject = ["locale", "settingsScope", "slots"];

		exports.apply = function (ctx) {
			// The bound scope for THIS plugin's namespace: reads/writes route
			// through the shared describe mirror with revision fencing, and the
			// binder's provider fiber carries the remote dependency.
			var scope = ctx.settingsScope.bind({ namespace: NS });
			// Read-only view of the built-in locale namespace, for the card's
			// detection-chain display. Bound defensively: the namespace exists
			// wherever the locale plugin's Host half is composed.
			var localeScope = ctx.settingsScope.bind({ namespace: LOCALE_NS });

			var lastReported;

			function report(snapshot) {
				try {
					var active = snapshot && typeof snapshot.active === "string" ? snapshot.active : undefined;
					if (!active || active === lastReported) return;
					var previous = lastReported;
					lastReported = active;
					// ONE field per write: user-configured mode/forceLocale in the
					// same namespace are per-field merges and always survive.
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
					// Dictionary registration is an owned effect: unloading this
					// plugin withdraws the copy without touching other namespaces.
					var disposeDict = ctx.locale.register(DICT_NS, { zh: zh, en: en });
					if (typeof disposeDict === "function") disposers.push(disposeDict);
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
			}, "dsh-desc-lang: styles, dictionary, ui-locale report");

			// The Plugins tab pairs Host-served namespaces with cards registered
			// under the same key, so this card appears exactly when the Host half
			// of this plugin is alive.
			try {
				ctx.slots.inject("settings.plugin.item", function () {
					return ctx.slots.register({
						name: "settings.plugin.item",
						key: NS,
						locale: DICT_NS,
						scope: scope,
						localeScope: localeScope,
					}, DescLangCard);
				});
			} catch (error) {
				console.warn(TAG + " settings card registration failed:", error && error.message ? error.message : error);
			}
		};

		return module.exports;
	},
});
