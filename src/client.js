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

		/** One channel's force-language options, three tiers (dedup, first
		 * wins): 1. the stored custom tag (a saved value stays visible);
		 * 2. every REGISTERED language — locale packs added via
		 * ctx.locale.addLanguage (dsh-i18n & friends) surface here
		 * automatically and lead the list; with no pack installed this tier
		 * is just the built-in zh/en; 3. the static LANG_OPTIONS fallback. */
		function langOptions(current, selectable) {
			var opts = [];
			var seen = {};
			if (typeof current === "string" && current !== "") {
				opts.push({ value: current, label: current + " (current)" });
				seen[current.toLowerCase()] = true;
			}
			if (selectable && selectable.length) {
				for (var i = 0; i < selectable.length; i++) {
					var def = selectable[i] || {};
					if (typeof def.id !== "string" || def.id === "") continue;
					var key = def.id.toLowerCase();
					if (seen[key]) continue;
					seen[key] = true;
					var name = typeof def.label === "string" && def.label ? def.label : def.id;
					opts.push({ value: def.id, label: name + " (" + def.id + ")" });
				}
			}
			for (var j = 0; j < LANG_OPTIONS.length; j++) {
				var o = LANG_OPTIONS[j];
				if (seen[o.value.toLowerCase()]) continue;
				seen[o.value.toLowerCase()] = true;
				opts.push(o);
			}
			return opts;
		}

		var TAG = "[dsh-agent-lang]";
		var NS = "agent-lang";
		var LOCALE_NS = "locale";
		var DICT_NS = "agentLang";

		// ── locale dictionaries (every one MUST stay key-aligned with zh) ───────
		//
		// A missing key silently falls back to English at lookup time, which leaves
		// the settings card half-translated; tests/smoke.mjs compares every shipped
		// dictionary against `zh` so a new string cannot land in zh and en alone.
		// Adding a language is ONE entry in LOCALES and nothing else — the same
		// registration call publishes whatever the table holds.
		//
		// These dictionaries are handed to the DSH locale registry under DICT_NS,
		// and the card reads them through the `t` seat its registration binds
		// (`locale: DICT_NS`). That seat IS the live lookup: the render machinery
		// subscribes to the locale runtime and re-derives `t` on every revision, so
		// a language switch repaints the card at once — nothing here is resolved or
		// frozen at apply time.
		//
		// A shipped dictionary stays inert until the GUI actually runs that
		// language, i.e. until a language pack registers the tag in the locale
		// catalog (ctx.locale.addLanguage, as dsh-i18n does). This plugin does NOT
		// add languages itself on purpose: that would offer half-translated
		// languages in Settings → General → Language, because the shell's own
		// dictionaries are not ours to ship.

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

		/* Third-language dictionaries, keyed by lowercase BCP-47 tag — the registry
		   matches locale ids case-insensitively, so `zh-hk` also answers an active
		   `zh-HK`. zh-MO shares the Hong Kong copy (港式) and zh-TW the Taiwanese
		   one, as the two written standards differ. */
		var LOCALES = {
			/* locale: ar */
			"ar": {
				"title": "التحكم باللغة",
				"cardDesc": "أوصاف الأدوات وتفكير النموذج والردود — ثلاث قنوات، كل واحدة تتبع لغة الواجهة أو لغة محددة",
				"mode.auto": "اتّباع لغة الواجهة",
				"mode.force": "فرض لغة محددة",
				"mode.off": "إيقاف",
				"quick.syncAll": "الكل حسب الواجهة",
				"quick.offAll": "إيقاف الكل",
				"chan.desc": "أوصاف الأدوات",
				"chan.think": "تفكير النموذج",
				"chan.output": "الردود",
				"chosen": "اختيار صريح في الإعدادات",
				"reported": "ما يبلّغ عنه المتصفح",
				"undetected": "لم تُكتشف أي لغة (لا حقن)",
				"none": "—",
				"error": "فشل الكتابة",
				"hint": "ثلاث قنوات مستقلة: اتّباع الواجهة / فرض لغة / إيقاف (تفكير النموذج والردود متوقفة افتراضيًا للحفاظ على السلوك الحالي). ترتيب الكشف: الاختيار الصريح في الإعدادات ← عام ← اللغة يتقدّم على ما يبلّغ عنه المتصفح. يسري التغيير في الطلب التالي؛ أما نمط minimal فنصّه التوجيهي مغلق وهو خارج النطاق.",
			},
			/* locale: de */
			"de": {
				"title": "Sprachsteuerung",
				"cardDesc": "Tool-Beschreibungen, Denken des Modells und Antworten — drei Kanäle, jeder folgt der GUI-Sprache oder einer festen Sprache",
				"mode.auto": "GUI-Sprache folgen",
				"mode.force": "Sprache erzwingen",
				"mode.off": "Aus",
				"quick.syncAll": "Alle auf GUI-Sprache",
				"quick.offAll": "Alle ausschalten",
				"chan.desc": "Tool-Beschreibungen",
				"chan.think": "Denken des Modells",
				"chan.output": "Antworten",
				"chosen": "Ausdrückliche Wahl in den Einstellungen",
				"reported": "Browser-Meldung",
				"undetected": "Keine Sprache erkannt (nichts injiziert)",
				"none": "—",
				"error": "Schreiben fehlgeschlagen",
				"hint": "Drei unabhängige Kanäle: GUI-Sprache folgen / Sprache erzwingen / aus (Denken und Antworten sind standardmäßig aus, um das bisherige Verhalten zu erhalten). Erkennungsreihenfolge: die ausdrückliche Wahl unter Einstellungen → Allgemein → Sprache hat Vorrang vor der Browser-Meldung. Änderungen greifen ab der nächsten Anfrage; das Preset minimal versiegelt seinen Prompt und bleibt außen vor.",
			},
			/* locale: fr */
			"fr": {
				"title": "Contrôle de la langue",
				"cardDesc": "Descriptions d'outils, réflexion du modèle et réponses — trois canaux, chacun suit la langue de l'interface ou une langue fixe",
				"mode.auto": "Suivre la langue de l'interface",
				"mode.force": "Forcer une langue",
				"mode.off": "Désactivé",
				"quick.syncAll": "Tout suivre l'interface",
				"quick.offAll": "Tout désactiver",
				"chan.desc": "Descriptions d'outils",
				"chan.think": "Réflexion du modèle",
				"chan.output": "Réponses",
				"chosen": "Choix explicite dans les paramètres",
				"reported": "Signalé par le navigateur",
				"undetected": "Aucune langue détectée (aucune injection)",
				"none": "—",
				"error": "Échec de l'écriture",
				"hint": "Trois canaux indépendants : suivre l'interface / forcer une langue / désactivé (réflexion et réponses désactivées par défaut pour ne rien changer). Ordre de détection : le choix explicite dans Paramètres → Général → Langue prime sur le signalement du navigateur. Le changement s'applique dès la requête suivante ; le preset minimal scelle son prompt et reste hors périmètre.",
			},
			/* locale: hi */
			"hi": {
				"title": "भाषा नियंत्रण",
				"cardDesc": "टूल विवरण, मॉडल की सोच और उत्तर — तीन चैनल, हर एक इंटरफ़ेस भाषा या तय भाषा का पालन करता है",
				"mode.auto": "इंटरफ़ेस भाषा का पालन",
				"mode.force": "भाषा बाध्य करें",
				"mode.off": "बंद",
				"quick.syncAll": "सभी इंटरफ़ेस के अनुसार",
				"quick.offAll": "सभी बंद करें",
				"chan.desc": "टूल विवरण",
				"chan.think": "मॉडल की सोच",
				"chan.output": "उत्तर",
				"chosen": "सेटिंग्स में स्पष्ट चयन",
				"reported": "ब्राउज़र रिपोर्ट",
				"undetected": "कोई भाषा नहीं मिली (कुछ भी इंजेक्ट नहीं)",
				"none": "—",
				"error": "लिखने में विफल",
				"hint": "तीन स्वतंत्र चैनल: इंटरफ़ेस का पालन / भाषा बाध्य / बंद (सोच और उत्तर मौजूदा व्यवहार बनाए रखने के लिए डिफ़ॉल्ट रूप से बंद हैं)। पहचान का क्रम: सेटिंग्स → सामान्य → भाषा में स्पष्ट चयन ब्राउज़र रिपोर्ट से पहले। बदलाव अगले अनुरोध से लागू होता है; minimal प्रीसेट अपना प्रॉम्प्ट सील करता है और दायरे से बाहर है।",
			},
			/* locale: id */
			"id": {
				"title": "Kontrol Bahasa",
				"cardDesc": "Deskripsi alat, penalaran model, dan balasan — tiga kanal, masing-masing mengikuti bahasa antarmuka atau bahasa tetap",
				"mode.auto": "Ikuti bahasa antarmuka",
				"mode.force": "Paksa bahasa",
				"mode.off": "Nonaktif",
				"quick.syncAll": "Semua ikuti antarmuka",
				"quick.offAll": "Nonaktifkan semua",
				"chan.desc": "Deskripsi alat",
				"chan.think": "Penalaran model",
				"chan.output": "Balasan",
				"chosen": "Pilihan eksplisit di Pengaturan",
				"reported": "Laporan peramban",
				"undetected": "Bahasa tidak terdeteksi (tidak ada injeksi)",
				"none": "—",
				"error": "Gagal menulis",
				"hint": "Tiga kanal independen: ikuti antarmuka / paksa bahasa / nonaktif (penalaran dan balasan nonaktif secara bawaan agar perilaku sekarang tetap). Urutan deteksi: pilihan eksplisit di Pengaturan → Umum → Bahasa mengalahkan laporan peramban. Perubahan berlaku pada permintaan berikutnya; preset minimal menyegel prompt-nya dan di luar cakupan.",
			},
			/* locale: it */
			"it": {
				"title": "Controllo lingua",
				"cardDesc": "Descrizioni degli strumenti, ragionamento del modello e risposte — tre canali, ciascuno segue la lingua dell'interfaccia o una lingua fissa",
				"mode.auto": "Segui la lingua dell'interfaccia",
				"mode.force": "Forza una lingua",
				"mode.off": "Disattivato",
				"quick.syncAll": "Tutti sull'interfaccia",
				"quick.offAll": "Disattiva tutto",
				"chan.desc": "Descrizioni degli strumenti",
				"chan.think": "Ragionamento del modello",
				"chan.output": "Risposte",
				"chosen": "Scelta esplicita nelle impostazioni",
				"reported": "Segnalazione del browser",
				"undetected": "Nessuna lingua rilevata (nessuna iniezione)",
				"none": "—",
				"error": "Scrittura non riuscita",
				"hint": "Tre canali indipendenti: segui l'interfaccia / forza una lingua / disattivato (ragionamento e risposte disattivati per impostazione predefinita, per non cambiare il comportamento attuale). Ordine di rilevamento: la scelta esplicita in Impostazioni → Generali → Lingua prevale sulla segnalazione del browser. Le modifiche valgono dalla richiesta successiva; il preset minimal sigilla il proprio prompt e resta fuori ambito.",
			},
			/* locale: ja */
			"ja": {
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
			},
			/* locale: ko */
			"ko": {
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
			},
			/* locale: nl */
			"nl": {
				"title": "Taalbeheer",
				"cardDesc": "Toolbeschrijvingen, denkwijze van het model en antwoorden — drie kanalen, elk volgt de interfacetaal of een vaste taal",
				"mode.auto": "Interfacetaal volgen",
				"mode.force": "Taal forceren",
				"mode.off": "Uit",
				"quick.syncAll": "Alles interfacetaal",
				"quick.offAll": "Alles uitzetten",
				"chan.desc": "Toolbeschrijvingen",
				"chan.think": "Denkwijze van het model",
				"chan.output": "Antwoorden",
				"chosen": "Expliciete keuze in instellingen",
				"reported": "Browsermelding",
				"undetected": "Geen taal gedetecteerd (niets geïnjecteerd)",
				"none": "—",
				"error": "Schrijven mislukt",
				"hint": "Drie onafhankelijke kanalen: interfacetaal volgen / taal forceren / uit (denkwijze en antwoorden staan standaard uit om het huidige gedrag te bewaren). Detectievolgorde: de expliciete keuze bij Instellingen → Algemeen → Taal gaat vóór de browsermelding. Wijzigingen gelden vanaf het volgende verzoek; de preset minimal verzegelt zijn prompt en valt buiten bereik.",
			},
			/* locale: pl */
			"pl": {
				"title": "Sterowanie językiem",
				"cardDesc": "Opisy narzędzi, rozumowanie modelu i odpowiedzi — trzy kanały, każdy podąża za językiem interfejsu lub ustalonym językiem",
				"mode.auto": "Zgodnie z językiem interfejsu",
				"mode.force": "Wymuś język",
				"mode.off": "Wyłączone",
				"quick.syncAll": "Wszystko jak interfejs",
				"quick.offAll": "Wyłącz wszystko",
				"chan.desc": "Opisy narzędzi",
				"chan.think": "Rozumowanie modelu",
				"chan.output": "Odpowiedzi",
				"chosen": "Jawny wybór w ustawieniach",
				"reported": "Zgłoszenie przeglądarki",
				"undetected": "Nie wykryto języka (nic nie wstrzyknięto)",
				"none": "—",
				"error": "Zapis nie powiódł się",
				"hint": "Trzy niezależne kanały: zgodnie z interfejsem / wymuszony język / wyłączone (rozumowanie i odpowiedzi są domyślnie wyłączone, aby zachować dotychczasowe działanie). Kolejność wykrywania: jawny wybór w Ustawienia → Ogólne → Język ma pierwszeństwo przed zgłoszeniem przeglądarki. Zmiany działają od następnego żądania; preset minimal zamyka swój prompt i pozostaje poza zakresem.",
			},
			/* locale: pt */
			"pt": {
				"title": "Controle de idioma",
				"cardDesc": "Descrições de ferramentas, raciocínio do modelo e respostas — três canais, cada um segue o idioma da interface ou um idioma fixo",
				"mode.auto": "Seguir o idioma da interface",
				"mode.force": "Forçar um idioma",
				"mode.off": "Desativado",
				"quick.syncAll": "Tudo pela interface",
				"quick.offAll": "Desativar tudo",
				"chan.desc": "Descrições de ferramentas",
				"chan.think": "Raciocínio do modelo",
				"chan.output": "Respostas",
				"chosen": "Escolha explícita nas configurações",
				"reported": "Relatado pelo navegador",
				"undetected": "Nenhum idioma detectado (nada injetado)",
				"none": "—",
				"error": "Falha ao gravar",
				"hint": "Três canais independentes: seguir a interface / forçar um idioma / desativado (raciocínio e respostas desativados por padrão para preservar o comportamento atual). Ordem de detecção: a escolha explícita em Configurações → Geral → Idioma tem prioridade sobre o relato do navegador. As mudanças valem na próxima requisição; o preset minimal sela o próprio prompt e fica fora do escopo.",
			},
			/* locale: ru */
			"ru": {
				"title": "Управление языком",
				"cardDesc": "Описания инструментов, рассуждения модели и ответы — три канала, каждый следует языку интерфейса или заданному языку",
				"mode.auto": "Следовать языку интерфейса",
				"mode.force": "Задать язык принудительно",
				"mode.off": "Выключено",
				"quick.syncAll": "Всё по интерфейсу",
				"quick.offAll": "Выключить всё",
				"chan.desc": "Описания инструментов",
				"chan.think": "Рассуждения модели",
				"chan.output": "Ответы",
				"chosen": "Явный выбор в настройках",
				"reported": "Сообщение браузера",
				"undetected": "Язык не определён (ничего не внедряется)",
				"none": "—",
				"error": "Не удалось записать",
				"hint": "Три независимых канала: следовать интерфейсу / задать язык принудительно / выключено (рассуждения и ответы по умолчанию выключены, чтобы сохранить текущее поведение). Порядок определения: явный выбор в разделе «Настройки → Общие → Язык» важнее сообщения браузера. Изменения вступают в силу со следующего запроса; пресет minimal изолирует свой промпт и не входит в область действия.",
			},
			/* locale: sv */
			"sv": {
				"title": "Språkstyrning",
				"cardDesc": "Verktygsbeskrivningar, modellens resonemang och svar — tre kanaler, var och en följer gränssnittets språk eller ett fast språk",
				"mode.auto": "Följ gränssnittets språk",
				"mode.force": "Tvinga ett språk",
				"mode.off": "Av",
				"quick.syncAll": "Allt enligt gränssnittet",
				"quick.offAll": "Stäng av allt",
				"chan.desc": "Verktygsbeskrivningar",
				"chan.think": "Modellens resonemang",
				"chan.output": "Svar",
				"chosen": "Uttryckligt val i inställningarna",
				"reported": "Rapport från webbläsaren",
				"undetected": "Inget språk hittades (inget injiceras)",
				"none": "—",
				"error": "Skrivning misslyckades",
				"hint": "Tre oberoende kanaler: följ gränssnittet / tvinga ett språk / av (resonemang och svar är av som standard för att behålla nuvarande beteende). Identifieringsordning: det uttryckliga valet under Inställningar → Allmänt → Språk går före webbläsarens rapport. Ändringar gäller från nästa begäran; förinställningen minimal förseglar sin prompt och omfattas inte.",
			},
			/* locale: th */
			"th": {
				"title": "ควบคุมภาษา",
				"cardDesc": "คำอธิบายเครื่องมือ การคิดของโมเดล และคำตอบ — สามช่องทาง แต่ละช่องตามภาษาอินเทอร์เฟซหรือภาษาที่กำหนด",
				"mode.auto": "ตามภาษาอินเทอร์เฟซ",
				"mode.force": "บังคับภาษา",
				"mode.off": "ปิด",
				"quick.syncAll": "ทั้งหมดตามอินเทอร์เฟซ",
				"quick.offAll": "ปิดทั้งหมด",
				"chan.desc": "คำอธิบายเครื่องมือ",
				"chan.think": "การคิดของโมเดล",
				"chan.output": "คำตอบ",
				"chosen": "ตัวเลือกที่ระบุในการตั้งค่า",
				"reported": "รายงานจากเบราว์เซอร์",
				"undetected": "ไม่พบภาษา (ไม่แทรกข้อความ)",
				"none": "—",
				"error": "เขียนไม่สำเร็จ",
				"hint": "สามช่องทางอิสระ: ตามอินเทอร์เฟซ / บังคับภาษา / ปิด (การคิดและคำตอบปิดโดยค่าเริ่มต้นเพื่อคงพฤติกรรมเดิม) ลำดับการตรวจหา: ตัวเลือกที่ระบุใน การตั้งค่า → ทั่วไป → ภาษา มาก่อนรายงานจากเบราว์เซอร์ การเปลี่ยนแปลงมีผลกับคำขอถัดไป; พรีเซ็ต minimal ปิดผนึกพรอมป์ของตนจึงไม่อยู่ในขอบเขต",
			},
			/* locale: tr */
			"tr": {
				"title": "Dil Denetimi",
				"cardDesc": "Araç açıklamaları, modelin düşünmesi ve yanıtlar — üç kanal; her biri arayüz dilini ya da sabit bir dili izler",
				"mode.auto": "Arayüz dilini izle",
				"mode.force": "Dil zorla",
				"mode.off": "Kapalı",
				"quick.syncAll": "Tümü arayüz dili",
				"quick.offAll": "Tümünü kapat",
				"chan.desc": "Araç açıklamaları",
				"chan.think": "Modelin düşünmesi",
				"chan.output": "Yanıtlar",
				"chosen": "Ayarlardaki açık seçim",
				"reported": "Tarayıcı bildirimi",
				"undetected": "Dil algılanmadı (hiçbir şey eklenmez)",
				"none": "—",
				"error": "Yazma başarısız",
				"hint": "Üç bağımsız kanal: arayüzü izle / dil zorla / kapalı (düşünme ve yanıtlar mevcut davranışı korumak için varsayılan olarak kapalıdır). Algılama sırası: Ayarlar → Genel → Dil altındaki açık seçim, tarayıcı bildiriminden önce gelir. Değişiklikler bir sonraki istekte geçerli olur; minimal ön ayarı istemini mühürler ve kapsam dışıdır.",
			},
			/* locale: vi */
			"vi": {
				"title": "Điều khiển ngôn ngữ",
				"cardDesc": "Mô tả công cụ, suy nghĩ của mô hình và câu trả lời — ba kênh, mỗi kênh theo ngôn ngữ giao diện hoặc một ngôn ngữ cố định",
				"mode.auto": "Theo ngôn ngữ giao diện",
				"mode.force": "Buộc một ngôn ngữ",
				"mode.off": "Tắt",
				"quick.syncAll": "Tất cả theo giao diện",
				"quick.offAll": "Tắt tất cả",
				"chan.desc": "Mô tả công cụ",
				"chan.think": "Suy nghĩ của mô hình",
				"chan.output": "Câu trả lời",
				"chosen": "Lựa chọn rõ ràng trong cài đặt",
				"reported": "Trình duyệt báo cáo",
				"undetected": "Không phát hiện ngôn ngữ (không chèn gì)",
				"none": "—",
				"error": "Ghi thất bại",
				"hint": "Ba kênh độc lập: theo giao diện / buộc ngôn ngữ / tắt (suy nghĩ và câu trả lời mặc định tắt để giữ nguyên hành vi hiện tại). Thứ tự phát hiện: lựa chọn rõ ràng trong Cài đặt → Chung → Ngôn ngữ được ưu tiên hơn báo cáo của trình duyệt. Thay đổi có hiệu lực từ yêu cầu kế tiếp; preset minimal niêm phong prompt của nó và nằm ngoài phạm vi.",
			},
			/* locale: zh-hk */
			"zh-hk": {
				"title": "語言控制",
				"cardDesc": "工具描述、模型思考、回覆輸出——三個通道各自跟隨介面語言或者指定語言",
				"mode.auto": "跟隨介面語言",
				"mode.force": "強制指定語言",
				"mode.off": "關閉",
				"quick.syncAll": "全部跟隨介面",
				"quick.offAll": "全部關閉",
				"chan.desc": "工具描述",
				"chan.think": "模型思考",
				"chan.output": "回覆輸出",
				"chosen": "設定中的明確選擇",
				"reported": "瀏覽器上報",
				"undetected": "未偵測到語言(不注入)",
				"none": "—",
				"error": "寫入失敗",
				"hint": "三個通道獨立設定:跟隨介面 / 強制指定 / 關閉(思考與回覆預設關閉以維持現狀)。偵測優先次序:設定 → 一般 → 語言的明確選擇 > 瀏覽器上報。切換後下一輪請求即時生效;minimal 模式提示詞封閉,不在範圍之內。",
			},
			/* locale: zh-mo */
			"zh-mo": {
				"title": "語言控制",
				"cardDesc": "工具描述、模型思考、回覆輸出——三個通道各自跟隨介面語言或者指定語言",
				"mode.auto": "跟隨介面語言",
				"mode.force": "強制指定語言",
				"mode.off": "關閉",
				"quick.syncAll": "全部跟隨介面",
				"quick.offAll": "全部關閉",
				"chan.desc": "工具描述",
				"chan.think": "模型思考",
				"chan.output": "回覆輸出",
				"chosen": "設定中的明確選擇",
				"reported": "瀏覽器上報",
				"undetected": "未偵測到語言(不注入)",
				"none": "—",
				"error": "寫入失敗",
				"hint": "三個通道獨立設定:跟隨介面 / 強制指定 / 關閉(思考與回覆預設關閉以維持現狀)。偵測優先次序:設定 → 一般 → 語言的明確選擇 > 瀏覽器上報。切換後下一輪請求即時生效;minimal 模式提示詞封閉,不在範圍之內。",
			},
			/* locale: zh-tw */
			"zh-tw": {
				"title": "語言控制",
				"cardDesc": "工具描述、模型思考、回覆輸出——三個通道各自跟隨介面語言或指定語言",
				"mode.auto": "跟隨介面語言",
				"mode.force": "強制指定語言",
				"mode.off": "關閉",
				"quick.syncAll": "全部跟隨介面",
				"quick.offAll": "全部關閉",
				"chan.desc": "工具描述",
				"chan.think": "模型思考",
				"chan.output": "回覆輸出",
				"chosen": "設定中的明確選擇",
				"reported": "瀏覽器回報",
				"undetected": "未偵測到語言(不會注入)",
				"none": "—",
				"error": "寫入失敗",
				"hint": "三個通道獨立設定:跟隨介面 / 強制指定 / 關閉(思考與回覆預設關閉以維持現狀)。偵測優先順序:設定 → 一般 → 語言的明確選擇優先於瀏覽器回報。切換後下一輪請求即生效;minimal 模式的提示詞是封閉的,不在範圍內。",
			},
		};

		/* Macro-tag aliases: the registry resolves a locale by exact id — its fallback
		   chain only follows ids a language pack declared — so a pack that activates
		   the macro tag `zh-Hant` is not folded onto `zh-hk` for us the way a
		   hand-written lookup would. Spelling the macro tags out keeps the card
		   translated under either spelling; a region id such as `zh-Hant-HK` or
		   `zh-Hans-CN` reaches them through the pack's own fallback chain. These
		   are references, not copies, so there is no second book to keep aligned. */
		var LOCALE_ALIASES = {
			"zh-hant": LOCALES["zh-hk"],
			"zh-hans": zh,
		};

		/** Language id → the language's own name, mirroring the host half's
		    LANGUAGE_SELF_NAMES table: the two carry the SAME set (the smoke test
		    compares them), so change one and change the other. Covers every shipped
		    dictionary; anything else degrades to the bare tag. */
		var SELF_NAMES = {
			"en": "English",
			"zh": "简体中文",
			"zh-hk": "繁體中文(香港)",
			"zh-mo": "繁體中文(澳門)",
			"zh-tw": "繁體中文(台灣)",
			"ja": "日本語",
			"ko": "한국어",
			"ar": "العربية",
			"de": "Deutsch",
			"fr": "Français",
			"hi": "हिन्दी",
			"id": "Bahasa Indonesia",
			"it": "Italiano",
			"nl": "Nederlands",
			"pl": "Polski",
			"pt": "Português",
			"ru": "Русский",
			"sv": "Svenska",
			"th": "ไทย",
			"tr": "Türkçe",
			"vi": "Tiếng Việt",
		};

		function selfName(id) {
			if (typeof id !== "string" || id.length === 0) return undefined;
			var key = id.toLowerCase();
			if (Object.prototype.hasOwnProperty.call(SELF_NAMES, key)) return SELF_NAMES[key];
			return '"' + id + '"';
		}

		// ── styles (dl- prefixed; tokens mirror the official card chrome) ───────

		/* dsh 0.1.7-rc.2 shipped the unified design-token layer this card now
		   consumes: `--dsw-radius-xs/sm/md/lg/xl/panel` (ui-theme styles/base.css)
		   and the one focus ring every component declares —
		   `--dsw-focus-ring-width` + `--dsw-focus-ring-color`
		   (ui-theme styles/focus.css, which also blanks the colour under pointer
		   modality). Each var() carries the literal this file used before, so a
		   host that predates the tokens renders exactly what it rendered then;
		   the focus colour keeps the old `brand-primary` as its last fallback
		   because the newer `state-business-primary` may not exist on <=0.1.6. */
		var RADIUS_MD = "var(--dsw-radius-md,12px)";
		var RADIUS_SM = "var(--dsw-radius-sm,8px)";
		var FOCUS_RING = "outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary)))";

		var STYLE_ID = "dsh-agent-lang-style";

		var CSS = [
			".dl-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:" + RADIUS_MD + ";background:var(--dsw-alias-bg-layer-3);-webkit-backdrop-filter:var(--dsh-any-blur-card-panels,blur(12px) saturate(1.15));backdrop-filter:var(--dsh-any-blur-card-panels,blur(12px) saturate(1.15));transition:border-color .16s,background .16s}",
			".dl-card:hover{border-color:var(--dsw-alias-label-dimmed)}",
			".dl-card.dl-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}",
			".dl-header{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:" + RADIUS_MD + "}",
			".dl-header:focus-visible{" + FOCUS_RING + ";outline-offset:-2px}",
			".dl-headText{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}",
			".dl-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}",
			".dl-desc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}",
			".dl-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}",
			".dl-chevron.dl-chevronOpen{transform:rotate(180deg)}",
			".dl-body{display:flex;flex-direction:column;gap:12px;padding:4px 16px 16px;max-width:640px}",
			".dl-pageCard{max-width:640px}",
			".dl-headerFlat{cursor:default}",
			".dl-pageBody{display:flex;flex-direction:column;gap:12px;padding:0 0 8px}",
			".dl-row{display:flex;align-items:baseline;gap:8px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary)}",
			".dl-rowLabel{flex:none;color:var(--dsw-alias-label-tertiary)}",
			".dl-rowValue{min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}",
			".dl-seg{display:flex;gap:8px;flex-wrap:wrap}",
			".dl-segBtn{appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:" + RADIUS_SM + ";background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;padding:6px 12px;cursor:pointer;transition:border-color .16s,color .16s}",
			".dl-segBtn:hover{border-color:var(--dsw-alias-label-dimmed)}",
			".dl-segBtn:focus-visible{" + FOCUS_RING + ";outline-offset:1px}",
			".dl-segBtn.dl-segActive{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}",
			".dl-force{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--dsw-alias-label-secondary)}",
			".dl-chanLabel{font-weight:500;color:var(--dsw-alias-label-primary)}",
			".dl-input{appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:" + RADIUS_SM + ";background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:6px 10px;max-width:220px}",
			".dl-input:focus-visible{" + FOCUS_RING + ";outline-offset:1px}",
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

		/** Defensive primitives lookup: an unknown icon name degrades to the next
		    candidate, and an empty chain to the text chevron. */
		function icon(name) {
			try {
				var component = ui && ui[name];
				return typeof component === "function" ? component : null;
			} catch (error) {
				return null;
			}
		}

		/** The first primitive among the candidate names that this host exports.
		    The glyph names are part of no contract this plugin can pin: the
		    `IconChevronDownOutline14` spelling this card used since v0.1.0 is
		    exported by NO 0.1.7 build (rc.1/rc.2 export the weight-suffixed
		    `…Regular`/`…Medium` family), so the probe silently fell back to the
		    text "▾" — the candidate chain is what keeps a real icon on hosts that
		    ship one and the text glyph on hosts that do not. */
		function firstIcon(names) {
			for (var index = 0; index < names.length; index += 1) {
				var component = icon(names[index]);
				if (component) return component;
			}
			return null;
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

			// Live language-registry feed from the inject factory; absent feeds
			// degrade to the static fallback list.
			function selectableLocales() {
				if (typeof props.selectableLocales === "function") {
					try { return props.selectableLocales() || []; } catch (error) { return []; }
				}
				return [];
			}

			var channels = [
				{ key: "desc", label: t("chan.desc"), modeKey: "mode", localeKey: "forceLocale", m: mode, loc: value.forceLocale },
				{ key: "think", label: t("chan.think"), modeKey: "thinkMode", localeKey: "thinkLocale", m: value.thinkMode || "off", loc: value.thinkLocale },
				{ key: "out", label: t("chan.output"), modeKey: "outMode", localeKey: "outLocale", m: value.outMode || "off", loc: value.outLocale },
			];

			var Chevron = firstIcon(["IconChevronDownOutlineRegular", "IconChevronDownOutlineMedium", "IconChevronDownOutline14"]);

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
								langOptions(ch.loc, selectableLocales()).map(function (opt) {
									return E("option", { key: opt.value, value: opt.value, label: opt.label }, null);
								})
							),
						)
						: null,
				);
			}

			// dsh 0.1.6-alpha.2: the Plugins page renders this card through the
			// `plugins.bundle.config` slot (keyed by the package name) with
			// view="page" — the page draws the title itself, so the collapsible
			// shell is only for the legacy Settings slot, which passes no view.
			var pageView = props.view === "page";

			var bodyContent = E("div", { className: "dl-body" },
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
				);

			if (pageView) return E("div", { className: "dl-card dl-pageCard" },
				E("div", { className: "dl-header dl-headerFlat" },
					E("span", { className: "dl-headText" },
						E("span", { className: "dl-name" }, t("title")),
						E("span", { className: "dl-desc" }, t("cardDesc")),
					),
				),
				bodyContent,
			);

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
				open ? bodyContent : null,
			);
		}

		// ── plugin ────────────────────────────────────────────────────────────

		exports.name = "dsh-agent-lang/client";

		/**
		 * Required client services: the locale runtime and slots exist on every
		 * host era. The settings face is acquired OPTIONALLY below - a hard inject
		 * would leave this fiber PENDING forever on the era that dropped the
		 * service (dsh 0.1.7 removed settingsScope), taking the card and the
		 * reporter down together.
		 */
		exports.inject = ["locale", "slots"];

		exports.apply = function (ctx) {
			// Era-split settings face. Both candidates expose the SAME contract the
			// card consumes - getSnapshot()/set(field, value)/unset(field) - because
			// ConfigForm (dsh >= 0.1.7) kept the SettingsScope face when the service
			// was replaced by the plugin-Config projection.
			//
			// OLD (<= 0.1.6): the client settingsScope service binds a namespace.
			// NEW (>= 0.1.7): ui-settings configForms service serves one form per
			// live profile entry; the form key is the row id - "agent-lang", the
			// same string as the old namespace, and "locale" for the preference.
			var scope = null;
			var localeScope = null;
			var wired = false;

			var lastReported;

			function report(snapshot) {
				try {
					if (!scope || typeof scope.set !== "function") return;
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
					// Third languages and the macro-tag aliases: ONE registry visit carries
					// every shipped dictionary, so a language added to the table cannot be
					// forgotten here. Each stays inert until a language pack makes that tag
					// active in the GUI; the card's `t` seat re-derives per locale revision,
					// so a switch repaints it without a reload.
					try {
						var disposePacks = ctx.locale.register(DICT_NS, Object.assign({}, LOCALE_ALIASES, LOCALES));
						if (typeof disposePacks === "function") disposers.push(disposePacks);
					} catch (error) {
						console.warn(TAG + " language pack registration failed:", error && error.message ? error.message : error);
					}
				} catch (error) {
					console.warn(TAG + " dictionary registration failed:", error && error.message ? error.message : error);
				}
				return function () {
					for (var i = 0; i < disposers.length; i++) {
						try {
							if (typeof disposers[i] === "function") disposers[i]();
						} catch (error) { /* best effort */ }
					}
				};
			}, "dsh-agent-lang: styles, dictionaries");

			/** Reporter + card wiring, once EITHER era settings face exists. */
			function wire() {
				if (wired || !scope) return;
				wired = true;
				try {
					report(ctx.locale.getSnapshot());
				} catch (error) {
					console.warn(TAG + " initial snapshot failed:", error && error.message ? error.message : error);
				}
				var disposeListener = ctx.on("locale/change", report);
				ctx.effect(function () {
					return function () {
						try {
							if (typeof disposeListener === "function") disposeListener();
						} catch (error) { /* best effort */ }
					};
				}, "dsh-agent-lang: ui-locale report listener");
				registerCards();
			}

			// OLD era (dsh <= 0.1.6): bound settings scopes. The optional inject
			// never fires on dsh >= 0.1.7, where the service no longer exists.
			try {
				ctx.inject(["settingsScope"], function (sctx) {
					try {
						var svc = sctx && sctx.settingsScope;
						if (!svc || typeof svc.bind !== "function") return;
						scope = svc.bind({ namespace: NS });
						localeScope = svc.bind({ namespace: LOCALE_NS });
						wire();
					} catch (error) {
						console.warn(TAG + " settingsScope acquisition failed:", error && error.message ? error.message : error);
					}
				});
			} catch (error) {
				console.warn(TAG + " settingsScope wiring failed:", error && error.message ? error.message : error);
			}

			// NEW era (dsh >= 0.1.7): one ConfigForm per live profile entry; the
			// form key is the row id, identical to the old namespace string.
			try {
				ctx.inject(["configForms"], function (fctx) {
					try {
						var forms = fctx && fctx.configForms;
						if (!forms || typeof forms.get !== "function") return;
						scope = forms.get(NS);
						localeScope = forms.get(LOCALE_NS);
						wire();
					} catch (error) {
						console.warn(TAG + " configForms acquisition failed:", error && error.message ? error.message : error);
					}
				});
			} catch (error) {
				console.warn(TAG + " configForms wiring failed:", error && error.message ? error.message : error);
			}

			/** Card registration (called by wire once a settings face exists). */
			function registerCards() {
				// Guarded registration (the dsh-better-workspace pattern): a thrown
				// register degrades this one seat, never the plugin fiber.
				// Guarded registration (the dsh-better-workspace pattern): a thrown
				// register degrades this one seat, never the plugin fiber.
				try {
					var slots = ctx.slots;
					if (!slots || typeof slots.register !== "function" || typeof slots.inject !== "function") {
						console.warn(TAG + " slots service unavailable; settings card skipped");
						return;
					}
					var injected = function () {
						// The inject factory's returned members become the
						// component's props: the two bound settings scopes ride
						// here as PLAIN members (top-level options fields do NOT
						// reach the component).
						return {
							scope: scope,
							localeScope: localeScope,
							selectableLocales: function () {
								try {
										return ctx.locale.getSnapshot().locales || [];
								} catch (error) {
										return [];
								}
							},
						};
					};
					// Legacy seat (dsh <= 0.1.6-alpha.1): Settings → Plugins card,
					// keyed by the settings namespace.
					slots.inject("settings.plugin.item", function () {
						return slots.register({
							name: "settings.plugin.item",
							key: NS,
							locale: DICT_NS,
							inject: injected,
						}, function CardWithBoundary(props) {
							return E(QuietBoundary, null, E(DescLangCard, props));
						});
					});
					// dsh 0.1.6-alpha.2+: the Plugins page's bundle configuration
					// seat, keyed by the PACKAGE name. Both injects wait for their
					// own declaration, so exactly one is live on any host version.
					slots.inject("plugins.bundle.config", function () {
						return slots.register({
							name: "plugins.bundle.config",
							key: "dsh-agent-lang",
							locale: DICT_NS,
							inject: injected,
						}, function BundleConfigWithBoundary(props) {
							return E(QuietBoundary, null, E(DescLangCard, props));
						});
					});
				} catch (error) {
					console.warn(TAG + " settings card registration failed:", error && error.message ? error.message : error);
				}

			}
		};

		return module.exports;
	},
});
