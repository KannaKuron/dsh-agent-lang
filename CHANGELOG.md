# Changelog — dsh-agent-lang

> 倒序排列,新版本条目在最上面。条目格式:`## vX.Y.Z — YYYY-MM-DD` + 类型(feat / fix / docs / chore)+ 要点 + 相关链接。
> 纪律见 AGENTS.md「变更记录纪律」:发版前先更新本文件并随版本提交;事故复盘、复现与真机验证记录也记在这里。

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
