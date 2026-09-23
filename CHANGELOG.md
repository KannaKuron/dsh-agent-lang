# Changelog — dsh-agent-lang

> 倒序排列,新版本条目在最上面。条目格式:`## vX.Y.Z — YYYY-MM-DD` + 类型(feat / fix / docs / chore)+ 要点 + 相关链接。
> 纪律见 AGENTS.md「变更记录纪律」:发版前先更新本文件并随版本提交;事故复盘、复现与真机验证记录也记在这里。

## v0.7.0 — 2026-09-23

**类型**:feat(适配 dsh v0.1.7-rc.1:声明插件兼容性 peer + 真机全链路复核;保持旧版本完全兼容)

- **声明 `@deepseek-ai/dsh` peer**(rc.1 新增的**唯一**强制插件兼容门禁,`packages/boot/app-boot/src/plugin-compatibility.ts`):range 取 `>=0.1.0`。此前本插件 peer 里没有任何 `@deepseek-ai/dsh*`,等于永不被校验;门禁只认 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 的 range,并用 `semver.satisfies(runtime, range, { includePrerelease: true })` 判定,不匹配时**静默**少插件(bundle 层被跳过 / 行被 `disabled`,不报错退出)。
  - 取值理由:下界 `>=0.1.0` = 本构建实际服务的整条 0.1 线(旧时代 ≤0.1.6 走 `settings.register` 命名空间,新时代 ≥0.1.7 走行 Config),与 `engines.dsh` 同一口径。**不设上界**(用户决策,2026-09-23):本插件跨版本靠运行时探测自愈,加 ` <0.2.0` 之类的上界会在下一次 dsh 升级时把插件先行停用,而那时并没有任何真实破坏被观察到;真出现破坏时,在适配版里连代码一起收紧这个 range。**也不逐个版本枚举**:dsh-any-background@0.3.0 的 `… || 0.1.7-alpha.1` 枚举正是被 rc.1 门禁拦下的现实案例(`~/.dsh/profiles/*/compatibility.json` 里的机器级豁免就是它的代价)。
  - **`peerDependenciesMeta` 必须把该 peer 标 `optional: true`**(真机实测发现并修复的安装期坑):门禁**只读** `peerDependencies`(`plugin-compatibility.ts` 全文只碰这一个字段;`peerDependenciesMeta` 在 dsh 运行期没有任何读取方,只有 dsh 仓库自己的校验脚本会读,且那些脚本不作用于第三方插件),但包管理器会解析 peer range 去自动安装——npm 上 `@deepseek-ai/dsh` 的**全部 26 个版本都是 prerelease**,而普通 range 按 semver 规则排除 prerelease,于是 `autoInstallPeers: true`(pnpm 默认值)的安装直接以 `ERR_PNPM_NO_MATCHING_VERSION: No matching version found for @deepseek-ai/dsh@>=0.1.0` 失败。optional peer 不会被自动安装,危害消失而门禁照常生效(阴性对照已实测:同一产物把 peer 改成 `999.0.0`、保留 optional 标志,门禁照样拦下)。
- **host 半的 schemastery 改惰性导入(静默全失效加固)**:`@deepseek-ai/schemastery` 是 peer,普通 Node 从本包位置**解析不到**它(实测 `createRequire(<插件目录>).resolve('@deepseek-ai/schemastery')` → `MODULE_NOT_FOUND`),只靠宿主解析供上来。顶层静态 `import` 一旦解析失败,dsh Loader 把插件行的导入失败当**非致命跳过**(`vendor/loader/src/config/entry.ts` `_init()`:`logger.error` + `return`,永不建 fiber)⇒ host 半不存在 ⇒ `ClientModuleRegistry` 扫不到 `dsh.client` ⇒ **client 半不进启动图、宿主日志全绿、功能整体消失**(与 dsh-better-workspace issue #9 同一失败类)。已用"除静态 peer import 外完全相同"的夹具插件实证:静态版 `apply()` 从不执行,惰性版照常执行(只是 `mod=null`)。现改 `await import(...)` + try/catch,拿不到时 `Config` 导出 `undefined`(cordis 对 `!runtime.Config` 直接放行配置),插件照常挂载、语言提示与卡片上报不受影响。冒烟新增"不得出现静态导入行"断言。真机复核(rc.1 隔离实例,3124):client 半在 `__DSH_BOOT__` 里、console 零错误、界面语言仍落进 profile 用户层 `cordis.patch.yml` 的 `agent-lang.config.uiLocale`。
- **rc.1 逐项复核结论**(权威检出 `/Users/kanna/project/deepseek-harness` @ `46a7f68b09`;`dsh --version` = 0.1.7-rc.1):

  | 本插件消费的官方契约 | rc.1 状态 | 处置 |
  |---|---|---|
  | `systemPrompt.context()`(`{name, order, text}`) | 未变(`packages/core/system-prompt/src/index.ts:78-87`) | 无改动 |
  | `CONTEXT_ORDERS` 表(110/115/120) | 未变(order 125 仍空闲) | 无改动 |
  | `settings.plugin.item` 座位 | **已消失**(rc.1 无任何 owner 声明,`grep` 仅剩注释) | 旧座位注册保留(≤0.1.6 宿主仍用),rc.1 上 `slots.inject` 静默挂起,属预期 |
  | `plugins.bundle.config` 座位(key = 包名,`view: 'page'`) | 未变(`ui-plugin-manager/.../PluginManagerPage.tsx:584`) | 无改动 |
  | `ConfigForm` face(`getSnapshot/set/unset/subscribe`、`status/revision`) | 未变(`ui-settings/src/client/config-form-types.ts`) | 无改动 |
  | `configForms.get(ns)` 服务 | 未变(`config-form.ts:266`) | 无改动 |
  | 行 Config 的 `.volatile()` 投影(`volatileForm` 无 volatile 字段则整条 ns 不服务) | 未变(`settings/src/schema.ts`) | 无改动;运行期 schemastery 确有 volatile,卡片 `status: ready` 已实测 |
  | `settings.describe()` 里 `locale` 条目的表单值(`value.preference`) | 未变(`settings/src/index.ts:302-340` + `client/locale/src/index.ts` 的 `preference` volatile 字段) | 无改动;真机优先级实测通过 |
  | `ctx.locale.register(ns, dicts)` / `getSnapshot().locales` / `locale/change` | 未变 | 无改动 |
  | `locale/<lang>.json` 的 `{meta:{title,description}}` + `package.json.icon` 约束 | 未变(`app-boot/src/package-meta.ts`) | 无改动 |
  | `exports["./package.json"]`(Electron renderer 的 `locatePkgJson` 回退走 exports map) | 未变 | 已有断言,补注释说明其不可省 |
  | `dsh.bundle.patch` 允许字符串或数组 | 有变(新增数组形态) | 本插件是单文件字符串,不受影响 |
  | `dsh.client.inject` 里的 `@deepseek-ai/dsh-client-runtime` | **包已从 rc.1 消失**(npm 上仍有 0.0.1-rc.1) | **保留**:加载器对无对应 row 的名字直接跳过(`client/modules/src/client/system.ts:268`),真机启动图里 client 半正常注入、零 console 警告;保留以免改变旧宿主排序 |
- **仓库变更**:`dsh.plugin.json` 的 `engines.dsh` 由 `>=0.0.1` 对齐为 `>=0.1.0`(与 package.json、peer 下界同一口径);冒烟测试新增/加强 4 条断言——peer range 字面量 + optional 标志 + 两个清单的 version/engines 一致性 + `exports["./package.json"]` 的桌面端理由。
- **真机证据**(隔离实例:`DSH_HOME=/tmp/dsh-adapt-agent-lang/home`,端口 3111,全程未碰 3080 与用户 profile):
  - 门禁阳性:`npm pack` → probe profile(`bundles: [base, web-app, dsh-agent-lang]`)→ `dsh --profile probe --dump-config` **stderr 为空**、`# == dsh-agent-lang / - id: agent-lang` 在树里。
  - 门禁阴性对照:同一产物把已装清单 peer 改成 `999.0.0` → `dsh: skipping profile bundle "dsh-agent-lang": … incompatible with dsh 0.1.7-rc.1 …`,该行从树里消失 ⇒ 门禁确实在本机执行,阳性结论不是"没跑"。optional 标志不影响该判定(实测)。
  - 安装期:同一 tarball 在 `autoInstallPeers: true` 的 pnpm 工程里,加 optional 前 `ERR_PNPM_NO_MATCHING_VERSION` 失败,加之后安装成功且**不**拉 `@deepseek-ai/dsh`。
  - 启动与 GUI:隔离 web 实例启动日志只有一行带 token 的 URL(无 `skipping` / `disabling` / pending 报错);headless Chrome over CDP 打开侧边栏「插件」→ 本插件详情页,`.dl-pageCard` 渲染出中文标题/描述与图标(data URI),三段通道显示「工具描述: 简体中文 (zh)」「模型思考/回复输出: 关闭」,点击「全部关闭 / 全部跟随界面」后通道即时翻转,profile 用户层 `cordis.patch.yml` 出现 `agent-lang: {uiLocale: zh}`(上报链路)与用户改动(逐字段写入,`uiLocale` 不被覆盖);console 无本插件相关错误。
  - **语言注入链路(真实请求级)**:把 `llm-deepseek.baseURL` 指向本地 Anthropic-Messages stub,`dsh --profile <headless probe> "say hi"` 跑真实会话,在 stub 抓到的请求体里核对——无语言可用时 **0 条**语言指示(零提示噪声是特性);`uiLocale: zh` → `… must be written in 简体中文, not in English`;再加 `locale.preference: en` → 指示变 **English**(显式选择压过浏览器上报,`settings.describe()` 新链路实测);三通道 `off` → **0 条**指示。
  - **volatile 即时生效(同进程无重启)**:在同一个 web 宿主进程里,卡片点「全部关闭」后下一轮请求的注入指示消失、点「全部跟随界面」后又回来——行 Config 的 volatile 更新不需要重载插件,AGENTS 不变量 4 的"翻转下一轮生效"在 rc.1 上成立。
  - 冒烟测试 37 项全绿。
- 未在真机覆盖:0.1.0…0.1.6 旧宿主(本机只装了 rc.1,无旧 runtime),旧时代路径由代码探测与既有测试保证,本轮未回归;`minimal` preset 的封闭边界未重测(设计边界,见 AGENTS 不变量 2)。

## v0.6.0 — 2026-09-22

**类型**:feat(适配 dsh v0.1.7-alpha.1,保持旧版本兼容)

- **设置面双时代**(dsh 0.1.7 将 settings.register/SettingsScope 替换为插件行 Config + profile patch 存储):
  - host 半静态导出 `Config`（字段与旧命名空间 schema 同名同形，行 id `agent-lang` 与旧命名空间同串，旧 settings.yaml 一次性导入直接落位），全字段 `.volatile()` 探测标记（已发布的 npm schemastery 3.18.2 无此方法，探测是硬要求）；apply 收到 Volatile 引用，`valueOf()` 双形态读取，指示闭包每次组装重读，翻转下一轮生效。
  - 语言偏好读取：旧 = `settings.get('locale')`；新 = `settings.describe()` 重 ns `'locale'` 的表单值（优先级链不变）。
  - client 半 `exports.inject` 改为只声明跨时代必有服务(locale/slots)，设置面可选注入：旧 `settingsScope` / 新 `configForms.get('agent-lang')`（两代 face 同契约，卡片与上报零改动；硬注入在 0.1.7 上会让 fiber 永远 PENDING）；设置卡双座位策略不变，0.1.7 上由 `plugins.bundle.config` 座位承接。
- **插件管理页展示资产**(dsh 0.1.7 新特性)：新增 `icon.svg` + `locale/{en,zh}.json`（多语言标题/描述），旧宿主完全忽略，单包双时代。
- **仓库变更**:host 半静态 import schemastery（Loader 需要模块顶层的 Config），新增 `devDependencies`（冒烟测试前需 `npm install`；运行时解析仍走 profile 共享 fallback，与旧动态导入同路）；schemastery 同时声明在 peerDependencies 与 devDependencies（dsh 0.1.7 推荐的 link 开发姿势）。
- 冒烟测试 36 项全绿（新增 Config/volatile/双时代获取/包元数据断言）。

## v0.5.4 — 2026-09-19

**类型**:fix(bundle 页卡片壳)

- 修复:v0.19.0/v0.5.3/v0.12.1/v0.6.1 把磨砂与卡片样式挂在旧座位的折叠卡类上,而插件面板的 bundle 页(page 形态)此前渲染的是**无壳裸 div**——磨砂/边框/背景在面板里根本没出现。page 形态现在渲染完整卡片壳(边框 + 背景 token + any-background 磨砂链 + 标题/描述头部 + 默认光标),与 dsh-better-workspace 的 bundle 页同构。
## v0.5.3 — 2026-09-19

**类型**:chore(视觉统一)

- 设置卡片表面加 dsh-any-background 磨砂适配链(backdrop-filter: var(--dsh-any-blur-card-panels, blur(12px) saturate(1.15)),-webkit- 同步)——与 dsh-better-workspace / dsh-gitbash-shell v0.19.0 同款配方,壁纸/透明主题下自然融合;page 形态(插件面板 bundle 页)此前已就绪,本次零结构改动。
## v0.5.2 — 2026-09-17

**类型**:docs(npm description 双语化)

- **package.json 的 description 改为「中文 · English」双语**:dsh 0.1.6-alpha.2 的新 Plugins 页对第三方插件直接显示 npm description 单字符串(官方 bundle 的中文来自页面内硬编码表,无第三方按语言切换通道);按生态惯例(ide-git / rewind-plugin 同款)双语拼接,中文界面一眼可读,英文保留 npm 搜索价值。无代码改动。

## v0.5.1 — 2026-09-17

**类型**:feat(dsh 0.1.6-alpha.2 设置页体系迁移适配)

- **设置卡双座位**:dsh 0.1.6-alpha.2 把插件配置从「设置 → 插件」分区(`settings.plugin.item` 槽,已从官方槽目录移除)迁到侧边栏新 **Plugins 面板**的 `plugins.bundle.config` 槽(keyed by **包名**)。本插件现在同时注册两个座位——旧 `settings.plugin.item`(key=`agent-lang` 命名空间,≤ 0.1.6-alpha.1 宿主照常出卡)与新 `plugins.bundle.config`(key=`dsh-agent-lang` 包名,≥ 0.1.6-alpha.2 宿主在插件详情页出配置区)。两个 `slots.inject` 各等各的槽声明,任何宿主版本下恰好只有一个生效,无需版本探测(按槽可用性自动,不依赖版本号比较)。
- **组件双视图**:`DescLangCard` 按 owner 传入的 `view` 分支——新槽固定 `view: "page"`(页面自画标题/图标/面包屑)时渲染纯表单体(`dl-page`/`dl-pageBody`,无折叠壳);旧槽不传 view,保持原折叠卡形态。
- 实现细节:inject 工厂提升为共享的 `injected` 变量(两座位同一份 props:scope/localeScope/selectableLocales);CSS 追加 `dl-page`/`dl-pageBody` 两条规则。与 v0.5.0 的 21 门词典体系无交集(注册共用同一 `DICT_NS`,`locale: DICT_NS` 让两座位都吃到词典座位)。
- 事实来源:dsh 源码 `packages/client/ui-plugin-manager/src/client/slot-contract.ts`(三槽契约,`plugins.item` 被官方内置卡占用、bundle 配置归 `plugins.bundle.config`/`plugins.row.config`);`packages/client/ui-settings-plugins`(官方内置卡已迁移);`extensions/cordis-client-runner/src/client/slot-catalog.ts`(旧槽已从目录消失)。
- 冒烟测试新增「dual settings seat across dsh generations」(双注册存在、key=包名、view 分支);更新 inject 工厂断言(工厂提升为变量后的形状)。

## v0.5.0 — 2026-09-15

**类型**:feat

- **设置卡片支持 21 种界面语言**。除文件内的 `zh` / `en` 两本基础词典外,新增 **19 门第三语言**,一门一条放在 `LOCALES` 表,每条前一行带 `/* locale: <tag> */` 标记:`ar` `de` `fr` `hi` `id` `it` `ja` `ko` `nl` `pl` `pt` `ru` `sv` `th` `tr` `vi` `zh-HK` `zh-MO` `zh-TW`(繁体三门里 zh-MO 与 zh-HK 同文,zh-TW 用台湾用词)。加一门语言 = 表里追加一条带标记的条目,注册逻辑一行不改。
- **词典经 `ctx.locale.register` 交给 DSH 的 locale 服务**(`agentLang` 命名空间,一次注册 `Object.assign({}, LOCALE_ALIASES, LOCALES)`,表里有什么就发布什么);卡片注册用 `locale: DICT_NS` 把 `t` 座位绑到本插件词典,该座位按 locale revision 重新派生。**语言跟随 DSH 的 `ctx.locale`,切换语言即时生效**——无需刷新页面、无需重启,词典也不会在 apply 时被捕获成一次性值。
- `LOCALE_ALIASES` 把宏标签 `zh-Hant` / `zh-Hans` 指到同一批词典对象上(引用而非副本,没有第二本要对齐):注册表按**精确 id** 查表,不会替我们把 `zh-Hant-*` 折到港式,区域 id 靠语言包自己的 fallback 链走到别名。
- 强制语言下拉的语言自称表(host/client 两半各一份)补齐到 21 条(含 `zh-HK` / `zh-MO` / `zh-TW`),未知 tag 仍降级为裸 BCP 47 标签。
- **新增守护测试「每本词典的键集与中文完全相等」**(`every shipped dictionary carries the same key set as zh`):按 `/* locale: */` 标记切片,逐门与 `zh` 比对 key 集合——缺键只会在查表时静默回退英文,卡片就成半翻译状态,这条测试专门拦它。另加三条守护:19 个 tag 的完整清单、host/client 自称表集合一致、bundle 语法可解析(词典打错字会让卡片整块空白)。冒烟测试 33 项全绿(原 29 项 + 4 项)。
- **译文为机器辅助翻译,欢迎在 issue / PR 里修正**——每门语言只占 `LOCALES` 表里一处,互不影响,改一门不会碰到别的语言。
- 文档:AGENTS.md「词典纪律」按 21 门语言的现状重写(标记约定、key 对齐、宏标签别名、本插件不自己 `addLanguage` 的理由)。
- Release:https://github.com/KannaKuron/dsh-agent-lang/releases/tag/v0.5.0

## v0.4.3 — 2026-09-15

**类型**:docs(兼容性核对,**无行为改动**)

- **dsh 0.1.6-alpha.1 兼容性核对通过**。逐项结果:
  - `systemPrompt.context()` 契约未变:`PromptContext` 仍是 `{ name, order, text }`,order 125 仍排在官方 CONTEXT_ORDERS(110/115/120)之后;新版给 **sections** 新增的 `interpolate: false` 不适用于 context 贡献,本插件不涉及。
  - 注入文本**不存在 `{{...}}` 插值风险**:渲染期插值对 malformed / unknown 引用会**抛错**,而本插件的三条语言来源(强制标签 / locale 显式选择 / 浏览器上报)全部经 `BCP47.test()` 校验后才进入文本——这条校验链是必须保持的不变量,不要绕过。
  - 图标 `IconChevronDownOutline14` 仍在新版 primitives 导出中(新版删的是 `IconSendOutline16`,本插件不用);`settings.plugin.item` 槽与 settings / locale 服务契约均无变化(locale 包本版只删了两条 JSON 树文案)。
- README 新增「版本兼容」小节(中英)。
- 冒烟测试 29 项全绿(无改动,回归确认)。

## v0.4.2 — 2026-09-05

**类型**:chore

- package.json 声明 `engines.dsh`(插件市场「宿主要求」显示面)。

## v0.4.1 — 2026-08-31

**类型**:feat

- 强制语言下拉合并已注册语言包:locale 快照的已注册语言(`ctx.locale.getSnapshot().locales`,dsh-i18n 等任何语言包插件自然并入)经 inject 工厂喂入组件,优先级 已存自定义 tag > 已注册语言 > 静态兜底;feed 缺失/异常降级静态列表。

## v0.4.0 — 2026-08-31

**类型**:feat

- 强制语言输入改为下拉(datalist)+ 自由 BCP 47 输入并存。

## v0.3.1 — 2026-08-31

**类型**:fix / release

- **发布事故恢复**:workflow 在发布周期内被「删除→恢复」且仓库 Actions 被 toggle,GitHub 要求**文件内容变化**才重新注册(零内容 re-touch 无效),半激活期创建的 run 永久卡 queued(jobs=0 是铁证:事件流有 ReleaseEvent 但 runs total_count 为 0)。处置:workflow 加 `workflow_dispatch` 并 push → `gh run cancel` 作废卡死 run → 手动触发补发 → npm 确认 + npmmirror 同步。教训固化为 AGENTS.md「发布事故处置」playbook。
- v0.3.0 为 npm 首版(bootstrap:`npm publish` 令牌建包 + `npm trust github` 登记 Trusted Publisher,此后零令牌)。

## v0.3.0 — 2026-08-31(npm 首版,无独立 git tag)

**类型**:feat

- 英文成为常规目标语言(部分模型思考/输出混杂多语言,显式英文指示同样纠正;英文自身省略 ", not in English" 从句)。
- 发布通道:0.3.0 期间曾移除 npm workflow,0.3.1 恢复(见上)。

## v0.2.0 — 2026-08-31

**类型**:feat

- supersede 子句 + 合并子句组装:三通道全开时提示 528 → 383 字符;更名 dsh-agent-lang,扩展为三通道(工具描述/思考/回复)独立控制。

## v0.1.0 — 2026-08-31(dsh-desc-lang,未发 npm)

**类型**:feat

- 首版(dsh-desc-lang):工具调用 description 跟随界面语言;host 半 runtime-context 指示 + client 半上报 uiLocale + 设置卡。
