# AF Hub — 老板屏 MVP

一个 Hub,各组的 tracker 只多干一件事:推四个数。**界面一行不用改。**

```
af-hub/
├── index.html                    老板屏(iPad 竖屏优先,深/浅色自适应)
├── hub-report.js                 上报脚本 —— 复制到每个 tracker
├── af-hub-config.js              Hub 的 Firebase 配置(你建完项目后填)
├── firebase-database-rules.json  安全规则
└── README.md
```

---

## 契约:四组数字

| 字段 | 含义 |
|---|---|
| `done` / `total` | 完成 / 总数。单位各项目自己定(樘 / 件 / 延米) |
| `weekRate` / `prevWeekRate` / `avg4w` | 本周 / 上周 / 近四周均速 |
| `openDamage` | 未决损坏数(第 2 步接上,现在恒 0) |
| `pendingCO` | 待批 change order 数(同上) |

**老板屏比的是 `%` 和 `预计完工日`,不是绝对数量** —— 所以 Lexington 用「件」、AC3 用「樘」,照样同屏排序。

`预计完工日 = 剩余量 ÷ (近四周均速 ÷ 7)`,按最早完工排在最上面。

---

## 搭起来:4 步

### 1. 建 Hub 的 Firebase 项目(独立,不挂在 AC3 下)
Firebase Console → 新建项目 `af-hub` → Realtime Database → régions 选 us
→ Authentication 里打开 **匿名登录**(tracker 用它推数)和 **邮箱/密码**(老板登录)。

### 2. 贴规则
把 `firebase-database-rules.json` 的内容贴进 Realtime Database → 规则。

### 3. 填配置
把项目设置里的 web config 填进 `af-hub-config.js`:

```js
window.AF_HUB_FIREBASE = {
  apiKey: "…", authDomain: "af-hub.firebaseapp.com",
  databaseURL: "https://af-hub-default-rtdb.firebaseio.com",
  projectId: "af-hub", appId: "…"
};
```

部署 `af-hub/` 到 Vercel(静态,无需构建)。**没填配置也能打开** —— 会显示种子数据,先看形状。

### 4. 每个 tracker 接入(约 30 行,界面不动)

复制 `hub-report.js` 和 `af-hub-config.js` 到 tracker 根目录,`index.html` 的 `app.js` 之后加:

```html
<script src="af-hub-config.js?v=1"></script>
<script src="hub-report.js?v=1"></script>
```

`project-config.js` 里加三行:

```js
hubId:    'ac3',                 // hub 上的 key:ac3 / cp2 / lex
hubUnit:  '樘',                  // 樘 / 件 / 延米
hubScope: 'Storefront / CW',     // 一行描述
```

完事。上报是只写 `projects/{hubId}/summary` 一个节点,推不动也不影响 tracker 本身。

---

## 三个项目现状(2026-09-17 盘点)

| 项目 | 总数 | 构成 | 单位 |
|---|---|---|---|
| Atlantic Chestnut 3 | **待确认** | Storefront / CW | 樘 |
| Cooper Park 2 | 82 | GF 71 · L2 6 · L13 5 | 樘 |
| 355 Lexington | 232 | Shower Door 159 · Terrace Divider 33 · Guardrail 8 · Equipment Screen 2,26 层 | 件 |

⚠ **AC3 的总数要从云端拿。** 本地 `project-config.js` 的 `seedUnits` 只有 17 条(陈旧种子),
而 `AC3 ALL ELEVATIONS - reconciled.xlsx` 写的是「25 mark(s)」,平面图上光 GF 就有 70+ 个 marker。
**mark ≠ 樘** —— SF04 在平面上出现多次。老板屏要的是物理开口数(安装工作量),不是 mark 数。
接上 `hub-report.js` 之后这个数自动就有了(`units.length`),不用手工填。

---

## 下一步(不在 MVP 里)

| 步 | 内容 | 天 |
|---|---|---|
| 2 | 损坏台账 + change order(建在 Hub 里,各 tracker 不用改界面) | 4 |
| 3 | `af-core.js` 抽底座,外组 fork 改成引用它,界面一行不动 | 6 |
| 4 | 工厂排产(跨项目一张活单) | 6 |
| 5 | 工头端(今天要装哪几樘) | 4 |
