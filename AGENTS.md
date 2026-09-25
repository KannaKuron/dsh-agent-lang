# AGENTS.md

面向后续在本仓库继续开发的 Agent / 贡献者。读完再动手。

## 项目一句话

「dsh-agent-lang」:DSH 插件,控制模型产出文本的三个语言通道——**工具调用 `description`**(含 PTC 模式 `run_code` 的 description,即调用卡片标题)、**模型思考**、**回复输出**——每个通道独立配置:跟随界面语言 / 强制指定语言 / 关闭,支持一键全部跟随、一键全部关闭。默认仅工具描述通道开启(auto),思考与回复默认关闭(保持现状)。做法:主机面注册一条全局动态 runtime-context 指示 + 浏览器半上报界面语言 + 设置 → 插件卡片控制行为。

## 环境与工具

- 本机已安装 GitHub CLI(`gh`,已认证 KannaKuron):建仓、推送、release 优先用 gh。
- 发布(2026-08-31 起 npm OIDC 全链路已就绪,与 dsh-better-workspace 同款):bootstrap 首版 0.3.0 已在 npmjs 建包,Trusted Publisher 已登记(repo=KannaKuron/dsh-agent-lang,file=.\.github/workflows/npm-publish.yml,permissions=publish);**日常发版**:`npm test` 全绿 → 改版本(package.json 与 dsh.plugin.json 两个都改且一致)→ `git tag vX.Y.Z && git push origin main --tags` → 仓库目录内 `gh release create vX.Y.Z --title "vX.Y.Z" --generate-notes` → Release published 触发 OIDC workflow(node 24 + id-token: write,零令牌)自动发 npm → `gh run watch <id> --exit-status` 看绿 → `npm view dsh-agent-lang version --registry=https://registry.npmjs.org` 确认 → `curl -X PUT https://registry.npmmirror.com/dsh-agent-lang/sync` 同步 npmmirror。
- 本机 web profile 装本地开发版:`npm pack` 出 tarball → 在 `(dsh home)/profiles/web` 里 `pnpm add <tarball>` → 重启 DSH(`package.json` 的 `dsh.bundle.patch` 声明自动挂载,无需手改 profile patch)。

- **发布事故处置(2026-08-31,v0.3.1 实际教训)**:workflow 文件在发布周期内被「删除→恢复」或仓库 Actions 被 toggle 后,GitHub 会要求**文件内容发生变化**才重新注册(re-touch 无内容变化的 commit 无效),且**半激活期创建的 run 会永久卡 queued(连 job 都不生成,jobs = 0 是铁证)**——事件流有 ReleaseEvent 但 actions/runs total_count 为 0 = 事件根本没触发 workflow。处置:① 修改 workflow(内容变化,如加 `workflow_dispatch:`)并 push;② `gh run cancel` 作废卡死的 queued run;③ 重新 `gh workflow run` 手动触发(本 workflow 已带 `workflow_dispatch`,应急补发不需要再发假 release);④ 跑绿后 `npm view <pkg> version --registry=https://registry.npmjs.org` 确认 → npmmirror 同步。诊断命令:`gh run list --repo <repo> --limit 5`、`gh api repos/<repo>/actions/runs --jq .total_count`(0 = 从未触发)、`gh run view <id> --json status,conclusion`。

## 变更记录纪律(2026-09-13 起)

- **所有版本发布、修复、事故复盘、复现/验证记录一律写进本仓库 `CHANGELOG.md`**,不再追加进本文件;
  本文件只保留仍然有效的规则、不变量与当前事实,历史叙事由 CHANGELOG 承载(需引用时写
  「见 CHANGELOG vX.Y.Z」)。
- **发版流程新增强制步骤**:更新 CHANGELOG(写好新版本条目)→ 随版本提交 → 再打 tag /
  发 Release;顺序不能反。
- CHANGELOG 条目格式:倒序排列;`## vX.Y.Z — YYYY-MM-DD` + 类型(feat / fix / docs / chore)+
  要点 bullet + 相关链接(issue / PR / discussion / Release)。

## 目录地图

| 路径 | 作用 |
|---|---|
| `src/index.js` | host 半：导出行 `Config`（**顶层 await 惰性 import** schemastery，拿不到时 `Config = undefined`，全字段 `.volatile()` 探测）双时代设置面，旧宿主上另经动态 import 注册 `agent-lang` 命名空间；+ 全局动态 runtime-context 指示（`systemPrompt.context`） |
| `src/client.js` | 浏览器半（手写 ModuleLoader bundle）：双时代设置面可选注入（旧 settingsScope / 新 configForms）上报界面语言 + 双座位注册设置卡片 |
| `cordis.patch.yml` | `dsh plugin add` 官方安装通道的挂载声明(insert 一行插件 row,主机面全局挂载) |
| `dsh.plugin.json` | 插件注册表清单(id `dsh-external/dsh-agent-lang`) |
| `tests/smoke.mjs` | 冒烟测试(纯文件/helper 级,零依赖):helper 逻辑、源码纪律(require 白名单、无 import/JSX、词典对齐与 19 tag 清单、自称表两半一致)、清单一致性 |
| `locale/{en,zh}.json` + `icon.svg` | dsh 0.1.7 插件管理页展示资产(多语言标题/描述 + 图标);旧宿主完全忽略 |

## 核心不变量(改代码前必读)

1. **只注入提示,不改资产**。绝不修改 preset / persona / 工具 schema / 任何 dsh 发行文件:它们是部署资产,升级覆盖 + 影响 request-cache 稳定性设计。唯一通道是运行时注册的提示贡献。
2. **通道是 `systemPrompt.context()`,不是 `section()`**。理由:与沙箱/审批策略同列(语义契合)、每轮请求刷新(语言切换下一轮生效)、渲染在请求末尾(近因压过工具 schema 的英文指引)。空文本贡献会在渲染时被丢弃——**完全未检测到语言**时返回 '' 是**特性**(零提示噪声);**英文自 v0.3.0 起是正常目标语言**(部分模型思考/输出会混杂多语言,显式英文指示同样纠正),仅为英文自身省略 ", not in English" 从句。已知例外:`minimal` preset 的 persona `complete: true` 且 `includeRuntimeContext: false`,提示对一切后挂贡献者封闭——接受,文档声明,不要试图穿透(waterfall 也改不动 complete 恢复)。
3. **语言来源优先级(纯函数 `pickDisplayLanguage`,测试覆盖)**:mode off → 无;force+合法 forceLocale → forceLocale;auto:locale ns 的 `preference` > agent-lang ns 的 `uiLocale`;非法 BCP 47 一律忽略。**绝不写 `locale` 命名空间**(那是用户的显式选择,写它会破坏「absence delegates to browser」语义);client 只写自己 ns 的 `uiLocale` 单字段(settings 写是逐字段深合并,mode/forceLocale 永远幸存)。
4. **设置双时代(v0.6.0 起,dsh 0.1.7 分界,运行时探测 `typeof settings.register === 'function'`)**:
   - **旧(<=0.1.6)**:命名空间 schema 必须是可调用的 schemastery 对象(`schema(merged)` 解析值;zod 会抛 `not a function` 且命名空间永不服务);host 半经动态 `import('@deepseek-ai/dsh-settings')` + `settingsNamespace()` era 探测注册 `agent-lang` 命名空间,值存 `~/.dsh/settings.yaml`。
   - **新(>=0.1.7)**:`register()`/SettingsScope 已删除,插件的设置面**就是行 Config**——host 半用**顶层 await 惰性 import** `@deepseek-ai/schemastery` 并导出 `Config`(字段与旧命名空间 schema 完全同名同形;行 id `agent-lang` 与旧命名空间同串,旧 settings.yaml 一次性导入直接落位);全部字段经 `live()` 探测加 `.volatile()`(已发布 npm 的 3.18.2 **没有** volatile,探测是硬要求;0.1.7 宿主的 profile 内 schemastery 才有),apply 收到 `Volatile<T>` 引用,`valueOf()` 双形态读取。指示文本闭包每次组装重读引用,翻转下一轮生效,无需监听 `loader/volatile-update`。语言偏好读取:旧 = `settings.get('locale')`;新 = `settings.describe()` 里 ns `'locale'` 的表单值。
   - **绝不用顶层静态 peer import(v0.7.0 加固)**:schemastery 是 **peer**,普通 Node 从本包位置解析不到它(实测 `createRequire(插件目录).resolve('@deepseek-ai/schemastery')` → `MODULE_NOT_FOUND`),它只靠宿主自己的解析(profile shared fallback)供上来。顶层静态 import 一旦解析失败,dsh Loader 把插件行的导入失败当**非致命跳过**(`vendor/loader/src/config/entry.ts` `_init()`:logger.error + return,永不建 fiber)——host 半不存在 ⇒ `ClientModuleRegistry` 扫不到 `dsh.client` ⇒ client 半不进启动图,**宿主日志全绿、功能整体消失**(与 dsh-better-workspace issue #9 同一失败类;已用"除静态 peer import 外完全相同"的夹具插件实证:静态版 `apply()` 从不执行,惰性版照常执行、只是 `mod=null`)。现改 `await import(...)` + try/catch,拿不到时 `Config` 导出 `undefined`(cordis 对 `!runtime.Config` 直接放行配置),插件照常挂载、提示注入与卡片上报不受影响。冒烟测试两条断言锁死(不得出现静态导入行 + 必须是 `Schema === null ? undefined : …`)。
   - **devDependency 的用途**:仓库保留 `devDependencies`(@deepseek-ai/schemastery)只为本地 `npm test` 能 import 到它;运行时解析走宿主(profile shared fallback,已验证)。schemastery 只进 peerDependencies + devDependencies,不进 dependencies。
5. **无构建**。host 半纯 ESM JS;client 半是**手写 ModuleLoader bundle**(`window.__ModuleLoader__.load({id, factory})`,id=包名):`require` 只允许基线白名单(react、react/jsx-runtime、react-dom、react-dom/client、@deepseek-ai/cordis、@deepseek-ai/dsh-client-store、@deepseek-ai/dsh-client-ui-slots、@deepseek-ai/dsh-client-ui-primitives),冒烟测试强制;无 import/JSX/TS 语法。**client 半的 `exports.inject` 只声明跨时代必有服务(locale、slots),设置面一律可选注入**——0.1.7 删除了 `settingsScope` 服务,硬注入会让 fiber 永远 PENDING(卡片与上报一起死);旧时代走 `ctx.inject(['settingsScope'], …)` 绑命名空间,新时代走 `ctx.inject(['configForms'], …)` 取 `configForms.get('agent-lang')`,两代 face 同契约(getSnapshot/set/unset),卡内零改动。设置卡双座位(settings.plugin.item + plugins.bundle.config)不变:0.1.7 上旧座位静默挂起,新座位照常。
6. **slot 契约**:`settings.plugin.item` 是 keyed 槽,**key = 设置命名空间**(`agent-lang`);tab 派发「宿主已服务命名空间 ∩ 已注册卡片」——宿主半不注册命名空间,卡片永远不出现。卡片 chrome 必须手写(`dl-` 前缀 CSS,令牌跟官方 `ui-plugin-manager` 的 bundle 页/`ui-theme` 的设计令牌,不能 import ui-settings-plugins(不在白名单))。注册里的 `locale: DICT_NS` 让框架把 `t` 座位绑到本插件的词典命名空间,该座位**按 locale revision 重新派生**(渲染机制给每个 outlet 订阅 locale 变化:语言切换即重渲染并换新的 `t` 引用),所以卡片文案跟随 GUI 语言实时切换,插件自己不必订阅刷新、也不得在 apply 里把词典捕获成一次性值。命名空间不可用(`snap.status !== 'ready'`)时卡片渲染 null(官方行为)。
7. **词典纪律(21 门语言)**:NS = agentLang;`zh` / `en` 是文件内的两本基础词典,其余 **19 门第三语言**在 `LOCALES` 表里一门一条(每条前一行 `/* locale: <tag> */` 标记;繁体三门 `zh-hk` / `zh-mo` / `zh-tw`,其中 zh-mo 与 zh-hk 同文)。注册表按**精确 id** 查表,不会替我们把 `zh-Hant-*` 折到港式,因此 `LOCALE_ALIASES` 把宏标签 `zh-hant` / `zh-hans` 指到同一批词典对象上(引用而非副本,没有第二本要对齐);区域 id 靠语言包自己的 fallback 链走到别名。**每本词典的 key 必须与 `zh` 完全相等**——缺键只会静默回退英文,卡片就成半翻译状态——冒烟测试 `every shipped dictionary carries the same key set as zh` 按标记切片逐门比对,另一条锁定 19 个 tag 的完整清单。加一门语言 = 在 `LOCALES` 追加一个带标记的条目再跑测试,不改任何逻辑:注册是一次 `ctx.locale.register(DICT_NS, Object.assign({}, LOCALE_ALIASES, LOCALES))`,表里有什么就发布什么,不可能漏注册。语言自称映射(共 21 条,含 en)host/client 各一份,冒烟测试比对两边集合,改要同步。
   词典只在语言包(`ctx.locale.addLanguage`,如 dsh-i18n)把该 tag 注册进 catalog 后才可能成为 active——**本插件不自己 addLanguage**:那会把半翻译语言塞进 设置 → 通用 → 语言 的选择器。
8. **React 纪律**:纯 React.createElement;组件定义在模块层(内联定义会在父渲染时重挂载);所有 hooks 先于任何 early return;primitives 图标经**候选链**特征探测降级(`firstIcon([...])`,逐个试到命中为止,全不命中回退文本 ▾)——**不要赌单个拼写**:v0.1.0…v0.7.0 一直探测的 `IconChevronDownOutline14` 在 0.1.7 的 rc.1/rc.2 里根本不存在(官方家族是 `…OutlineRegular`/`…OutlineMedium`),于是图标静默消失、只剩文字,缺陷还不可见(见 CHANGELOG v0.7.1;v0.4.3 的旧结论是误判)。
9. **context order 125** 是自由槽位,排在官方 CONTEXT_ORDERS(SANDBOX_POLICY 110 / APPROVAL_POLICY 115 / SUBAGENT_DELEGATION 120)之后;若官方表扩张越过 125,换一个空闲数。
10. **slot 注册 options 的顶层字段不会传给组件**(2026-08-31 实测:首版把 scope/localeScope 放顶层,组件 props.scope 为 undefined,useSyncExternalStore(undefined.subscribe) 渲染即崩,卡片无声消失而上报链路照常)。只有协议字段生效:`locale` 绑 t、`store` 绑 store seat、**`inject` 工厂返回的成员按原名成为 props**(hooks 子对象绑成 useXxx)。传对象一律走 inject 工厂;组件外再包 QuietBoundary(渲染失败只废本卡)。对照范本:已安装的 dsh-better-workspace 0.6.0(sandbox 里的开发副本可能滞后,以 profile node_modules 里实际装的版本为准)。
11. **host 半读未声明服务必须 `ctx.get('name')`**:`ctx.inject(['systemPrompt'], (pctx) => ...)` 的 pctx 只有声明过的服务可作属性访问,`pctx.settings?.get?.(...)` 这种未声明属性读取**静默 undefined**(可选链连错都不报),指示因此永远空文本(2026-08-31 实测:卡片/上报全正常但指示从未注入,agent 描述依旧英文)。测试已锁定 `pctx.get('settings')` 形态。
12. **强制语言下拉选项三来源、去重优先级递减**(v0.4.1):已存自定义 tag(保可见)> **locale 快照的已注册语言**(`ctx.locale.getSnapshot().locales`,经 inject 工厂 `selectableLocales` 喂入组件;任何语言包插件经 `ctx.locale.addLanguage` 注册的语言——如 dsh-i18n——**自然并入并置前,无需本插件感知具体包**)> 静态 LANG_OPTIONS 兜底(未装任何包时依旧可用)。feed 缺失/异常一律降级为静态列表;选项 label 用语言包自带 label(缺失回退 id)。
13. **peerDependencies 必须声明 dsh 范围**(v0.7.0 起,dsh 0.1.7-rc.1 新增的唯一强制兼容门禁):`"@deepseek-ai/dsh": ">=0.1.0"`——门禁只读 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 的 range、prerelease 参与匹配,不匹配就**静默**少插件(bundle 整层被跳过 / 行被 `disabled`);没有这类 peer 的插件永不被校验。取值规则:下界跟 `engines.dsh` 一致(本构建服务的整条 0.1 线);**不设上界**——本插件靠运行时探测跨版本自愈,上界只会在下一次 dsh 升级时把插件停用,而那时还没有任何真实破坏被观察到;真出现破坏时,在适配版里连代码一起收紧这个 range。**也不要逐个版本枚举**(dsh-any-background 的教训见 CHANGELOG v0.7.0)。另必须配 `peerDependenciesMeta` 把该 peer 标 `optional: true`:门禁不读 meta,但包管理器(autoInstallPeers 默认开启)会去 registry 解析 range,而 `@deepseek-ai/dsh` 已发布的版本**全是 prerelease**、普通 range 按 semver 排除 prerelease ⇒ 不标 optional 会让安装整体失败(`ERR_PNPM_NO_MATCHING_VERSION`;实测见 CHANGELOG v0.7.0)。适配新版本时同步改 range、`engines.dsh`、`peerDependenciesMeta` 与冒烟测试里锁定的字面量。
14. **卡片 chrome 用官方设计令牌 + 旧字面量回退**(v0.7.1 起,dsh 0.1.7-rc.2 的分界):rc.2 把 `--dsw-radius-xs/sm/md/lg/xl/panel`(`ui-theme/src/styles/base.css`)与统一焦点环 `--dsw-focus-ring-width` / `--dsw-focus-ring-color`(`ui-theme/src/styles/focus.css`,指针模态下官方把颜色置 transparent ⇒ 鼠标点击不画环)铺满整个客户端;本插件是手写 CSS,必须自己跟。写法固定为 `var(--dsw-radius-md,12px)` / `outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary)))`:令牌在前、**旧字面量在最后**(≤rc.1 宿主逐像素不变),焦点色回退链末端保留 `brand-primary`,因为 `state-business-primary` 在 ≤0.1.6 上不保证存在。冒烟测试禁止旧硬编码写法回流。新增/修改卡片样式时照此办理;若官方再换令牌名,同样「新令牌 + 旧值回退」地跟进。

## 验证清单(改动后)

1. `npm test` 全绿(39 项)。
2. 真机(隔离实例:`DSH_HOME=<tmp> dsh --profile <probe> --no-open --port <port>`;0.1.7 起 profile 自带 app,**不要再写 `web` 子命令**,否则 `too many arguments`)。
   - 0.1.7+ 时代:界面语言上报落在 profile 的 `cordis.patch.yml` 用户层(`- id: agent-lang` + `config.uiLocale`);设置卡片在侧边栏「插件」面板 → 本插件的 bundle 详情页(旧的 `settings.plugin.item` 座位在 0.1.7 已无 owner,注册静默挂起,属预期)。
   - ≤0.1.6 时代:设置 → 通用 页面出现 `agent-lang:` 命名空间段,卡片在设置 → 插件分区。
   - 语言注入链路(真实请求级证据,不依赖真模型):把 `llm-deepseek` 的 `baseURL` 指向本地 stub(Anthropic Messages SSE),`dsh --profile <headless probe> "<task>"` 跑一轮,在 stub 抓到的请求体里核对注入文本;`mode off`/未检测到语言时必须**没有**任何语言指示。
   - `minimal` 模式:确认不注入(设计边界)。
3. 升级 dsh 后复核:`settings.plugin.item` slot 契约(ui-settings-plugins 的 slot-contract.ts)、`SettingsScope` 接口(ui-settings 的 settings-contract.ts)、`systemPrompt.context` 签名(system-prompt)、CONTEXT_ORDERS 表是否越过 125。**2026-09-15 已对 dsh 0.1.6-alpha.1 复核通过**;**2026-09-23 已对 dsh 0.1.7-rc.1 复核通过**(逐项结论与真机证据见 CHANGELOG v0.7.0);**2026-09-25 已对 dsh 0.1.7-rc.2 复核通过**(rc.1↔rc.2 逐面零 diff 依据、设计令牌跟进与图标修复见 CHANGELOG v0.7.1)。另确认注入文本**无 `{{...}}` 插值风险**——渲染期插值对 malformed / unknown 引用会抛错,而三条语言来源全程经 `BCP47.test()` 校验,这条校验链是必须保持的不变量(记录见 CHANGELOG v0.4.3)。
