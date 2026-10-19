# AF Hub 项目数据库（platform/）

所有项目都在同一个 Firebase 项目 **af-hub-8f188** 里，一个账号走遍所有项目；但**每个项目有自己独立的数据库**：

| 项目 | 网址 | 数据库 |
|---|---|---|
| AC3 | https://af-hub-two.vercel.app/ac3/ | `af-hub-8f188-ac3` |
| 355 Lexington | https://af-hub-two.vercel.app/lex/ | `af-hub-8f188-lex` |
| Cooper Park 2 | https://af-hub-two.vercel.app/cp2/ | `af-hub-8f188-cp2`（2026-10-16 代码已就绪，按下面「CP2 迁移」做完才生效） |

## 怎么保证项目之间不串数据

1. **物理隔开**：每个项目一个数据库，页面只连自己的那个。一个项目出问题、或从备份恢复，碰不到别的项目。
2. **服务器核对身份**：每个数据库里写着自己是哪个项目（`/meta/project`，只有管理工具能写）。页面每次保存都带上自己的项目名（来自 `project-config.js` 的 `hubId`）。两者对不上，服务器直接拒绝。
   - 页面打开时也会先核对：对不上就整页锁住，显示红字"this page and its database do not match"，什么都不读、不写。
   - 所以复制一个项目文件夹做新项目时，`firebase-config.js` 和 `project-config.js` **两个都要改**。只改一个，页面打不开，也写不进去，不会悄悄写到别的项目里。
3. **按项目给权限**：

   | 身份 | 怎么来 | 能做什么 |
   |---|---|---|
   | editor | 数据库里 `allowlist` | 改这个项目 |
   | gc | 数据库里 `gcList` | 只看 GC 视图，只能提问 |
   | viewer | 数据库里 `viewers` | 只看完整看板 |
   | 公司员工 | **已验证**的 @advfacade.com 邮箱 | 自动能看所有项目（只读） |

   其他人什么都看不到，连项目名都看不到。工头（个人邮箱）和 GC 只能进被加进去的项目。总览页（hub 首页）只给已验证的公司邮箱看。
4. **自动检查**：每次推送 GitHub 都会自动跑 Actions → *Platform tests*，测试真实页面、规则和迁移工具：
   - 编辑保存只落在自己项目；
   - 页面配错数据库会被拦下；
   - 没权限的人进不去；
   - 两个项目的配置文件互相不冲突。

   哪项不过，Actions 里会是红叉。
5. **备份**：每个数据库在 Firebase 里单独开每日自动备份（见下面第 1 步 e）。编辑历史只能追加，谁也改不了。

## 第一次上线（AC3、Lexington）

### 1. Firebase 控制台（af-hub-8f188），约 15 分钟

a. 确认是 **Blaze** 计划（一个项目建多个数据库需要 Blaze），并设置 $50 预算提醒。

b. **Realtime Database → Create database**，建两个：
   - 名字分别是 `af-hub-8f188-ac3` 和 `af-hub-8f188-lex`（一个字都不能差）
   - 位置选 **United States (us-central1)**
   - 选 **Locked mode**

c. **Authentication → Sign-in method → Email/Password → Enable**（只开第一个开关）。Anonymous 保持开着，hub 首页的汇总要用。

d. **Storage**：
   - 如果还没开，先点 Get started。
   - 然后 **Rules**，把 `platform/storage.rules` 全部内容贴进去，点 Publish。

e. （建议）**Realtime Database → 选中 af-hub-8f188-ac3 → Backups → 开启每日备份**，lex 也一样。

f. **Realtime Database → 默认数据库（af-hub-8f188-default-rtdb）→ Rules**：把仓库根目录 `firebase-database-rules.json` 全部内容贴进去，点 Publish（2026-10-19 起也可以用 Actions → Project database → `mode = rules`、`project = hub`）。这是 hub 首页的规则，改动有三处：
   - 删掉 v2；
   - 总览只给已验证的公司邮箱看；
   - 汇总写入规则不变。

### 2. Vercel（af-hub-two 这个项目）

把 AC3 项目里的 `ANTHROPIC_API_KEY` 环境变量复制到 af-hub-two：Settings → Environment Variables。Chat 自然语言更新要用它，不配也不影响其他功能。

### 3. GitHub Desktop：Push

推送后到 GitHub → **Actions → Platform tests**，等两个任务（local、emulator）都变绿。红了就截图发我。

### 4. 迁移（每个项目两步，先 Lexington 再 AC3）

GitHub → **Actions → Project database → Run workflow**：

1. `mode = dry-run`，`project = lex`，然后 Run。
   - 看日志：会列出要搬什么、有几个单元、几条日志、几个 submittal、名单上几个人。邮箱只显示首字母。
   - 什么都不写。
2. 没问题再跑一次 `mode = migrate`，`project = lex`。顺序是：
   1. 先给新数据库上规则；
   2. 冻结旧数据库，旧规则打印在日志里，要回滚就把它们贴回去；
   3. 复制；
   4. 把旧桶里的照片复制到 `p/lex/legacy/`；
   5. 给名单上的人开账号；
   6. 逐项核对。

   最后一行应该是 **✓ VERIFIED**。
3. AC3 同样两步（`project = ac3`）。

日志里如果出现"N other account(s) could sign in to the OLD tracker but are on no list"，说明有人以前能登录旧 tracker，但不在任何名单上。需要的话按下面"加人"把他们加成 viewer 或 gc。

### 5. 打开试用

1. 打开 https://af-hub-two.vercel.app/ac3/ ，输入邮箱，点 **First time here / forgot password**。
2. 收邮件、设密码，再登录。
3. Lexington 不用再登录。

旧网址（atlantic-chestnut-3-tracking、355-lexington-dashboard）迁移后会自动跳到新网址，跳转那一步我来提交。

## CP2 迁移（2026-10-16 准备好，约 20 分钟）

代码已经在仓库里：`cp2/` 文件夹，用 `core/` 公共代码。CP2 原来独有的 bay elevation（F-055/56/57）已经并进 `core/app.js`，只在有 `elevations.js`（`window.ELEV_BAYS`）的项目里出现，AC3、Lexington 不变。Glass Triage 页已永久删除（2026-10-16，Leo），迁移也不再复制它的 `/triage` 数据。

**按顺序做，中间不要停太久**：Push 之后到迁移完成之前，hub 首页 CP2 的 Open 会打开一个还没有数据库的页面，每 2 小时的 Hub report 也会报 CP2 读不到。

1. **GitHub Desktop：AF-hub Push**。等 Actions → *Platform tests* 两个都绿。
2. **Firebase 控制台（af-hub-8f188）→ Realtime Database → Create database**：名字 `af-hub-8f188-cp2`，位置 us-central1，Locked mode。然后 Backups 里开每日备份。
3. **Actions → Project database → Run workflow**：`mode = dry-run`，`project = cp2`。看日志里要搬的单元数、日志条数、照片数、名单人数对不对。
4. 同一个 workflow 再跑 `mode = migrate`，`project = cp2`。最后一行要是 **✓ VERIFIED**。这一步会冻结旧的 CP2 数据库（旧规则打印在日志里，可以贴回去回滚），并把旧桶里被引用的照片、单元图复制到 `p/cp2/legacy/`。
5. 打开 https://af-hub-two.vercel.app/cp2/ 看一下：单元、照片、📐 Openings 里的 Elevation。
6. **GitHub Desktop：Copper-Park-2-Install-Progress-Tracking Push**（只在第 4 步 VERIFIED 之后）。这个提交把旧网址整个转到 hub 的 `/cp2/`，书签和发出去的链接都还能用。

工头、GC 不用重新注册：迁移会给名单上的每个人开 hub 账号，他们在新页面点 **First time here** 设一次密码就行。

## Fab drawings（在 📐 Drawings 窗口里，链接下面，2026-10-16）

工厂和工地自己在 tracker 里找 fab 图，不用再打电话问 Leo。

- **谁能看**：这个项目的 editor、viewer，和所有公司邮箱。**GC 看不到**（GC 本来就没有 Drawings 按钮，规则也不让读 `/fab`）。
- **上传**（editor）：📐 Drawings → Fab drawings → ⬆ Add PDFs（或者直接把 PDF 拖进去，可以一次多个、一整套）。选完就自动传：浏览器逐页读出图上印的单元号（CP2 的图上有 "SF40" 这类 tag），每页存一张图片给手机看，原 PDF 也存着。单个文件最多 100 MB。
- **找图**：在搜索框输单元号或文件名；或者在 tracker 里点开单元，有图的单元标题旁会有「📑 Fab drawing」，点开直接看，右上角 PDF 打开原文件那一页。
- **最新版**：同一个单元，最后上传的那份就是它的图。图上没有版本号，所以按上传时间算；旧文件还在列表里。
- 图上没印单元号的 PDF，列表里标黄「no unit no.」，点 🏷 手动填。
- 存在哪：文件在共享存储桶 `p/<项目>/fab/<id>/`，数据库 `/fab/<id>` 只存链接。


**上线要做的（一次）**：

1. Push 以后，Actions → Project database → Run workflow：`mode = rules`，`project = all`。不做这步，AC3、Lexington 的 Fab drawings 会显示 "not shared with this account"。（CP2 迁移时会自动带上新规则。）
2. 只有 PDF 超过 15 MB 才需要：Firebase 控制台 → Storage → Rules，把 `platform/storage.rules` 全部贴进去，Publish。15 MB 以下现在的规则就能传。

## 🚚 To send（要送到工地的东西，2026-10-16；所有项目 + Shop 页，2026-10-19）

工地要什么框、门、sidelite，记在清单上，一直挂到工厂点「Sent ✓」为止。

- **Shop 页 `/send/`**（hub 首页右上角「🚚 Shop」）：所有项目一张清单，按项目分组，最急的项目和最急的一条在最上面。
  - 发车后点「Sent ✓」，这一条移到底下「Sent in the last 7 days」，点错了可以 undo。
  - 🖨 Print 打印成装车用的勾选清单。
  - 公司邮箱的人可以在这里给任何项目加一条：选项目 → 写一句（例如 `SD01 sidelite`）→ Add。
  - 「＋ qty · date · note · photo」可选：数量、需要日期、备注、照片（手机可以直接拍）。
- **还没有 dashboard 的项目**（例如 Package 7、Forest Hill）：在 Shop 页底下「Projects without a dashboard」→「＋ Project」加名字。项目做完了勾「finished」就隐藏。
  - 这些项目的数据在 hub 自己的数据库：`/sendSites/<s_名字>`、`/toSend/<s_名字>/<id>`。
- **有 dashboard 的项目**：工头（editor）在 tracker 的 📦 Warehouse 页最上面也能加；tracker 的 Warehouse 链接后面会显示「🚚 N」。数据在项目自己的数据库 `/toSend`。
- **什么算晚了（红色）**：填了需要日期的，当天和之后算晚；没填日期的，挂了 2 天以上算晚。
- **谁能做什么**：
  - 有 dashboard 的项目：editor 加、删任何一条；公司邮箱的人加，只能改、删自己加的；editor、viewer、公司邮箱都能点 Sent；GC 看不到。
  - 没有 dashboard 的项目：只有公司邮箱的人能看、能加、能点 Sent；只能改、删自己加的。
  - 工厂的人没有公司邮箱的，现在只能看到被加成 viewer 的项目（Actions → Project database → member），看不到没有 dashboard 的项目。
- **规则**：项目数据库用 Actions → Project database → `mode = rules`、`project = all`。`all` 现在也包括 hub 自己的数据库（`firebase-database-rules.json`），不用再去 console 里贴；换之前的旧规则会存一份在 hub 数据库的 `/_admin/rulesBefore`。只换 hub 的：`project = hub`。

## Morgan North（Benji 的 Glass Replacement Tracker，2026-10-19）

Benji 自己做、自己改的页面，原样放进 hub，地址是 `/mn/`。hub 只加了登录、数据库和总览这几样。

- **页面**：`mn/index.html` = Benji 网站上的页面 + 3 行 script（`mn/build.mjs` 加的）。Benji 的代码一行都不改。
  - Actions → **Morgan North page** 每天早上自动去 Benji 的网站取最新版；手动也可以 Run workflow。有变化就自动 commit。
  - 如果他的新版本开始往 hub 规则不允许的地方存东西（新的数据库路径、每块玻璃新的字段），这一步会失败并写明原因，hub 继续用上一个能用的版本。这时要先改 `platform/mn-database.rules.json`，再把 `mn/build.mjs` 里的 ALLOWED_NODES / ALLOWED_FIELDS 一起改掉。
- **`mn/hub-adapter.js`**：
  - 不登录就挡住页面；登录后才让页面连数据库。
  - 页面自己的 Firebase 设置换成 hub 的 `af-hub-8f188-mn`。
  - 有人打开页面时，把进度推到 hub 总览（`projects/mn/summary`），按楼层分。
  - 左下角显示登录的人，还有 Hub 和 Sign out。
- **数据库** `af-hub-8f188-mn`，规则是 `platform/mn-database.rules.json`：
  - `/units/<窗#玻璃>` = { status, date, crew, notes }；
  - `/plan` = 窗和要换的玻璃；
  - `/toSend`；
  - 名单和其他项目一样：editor 改；viewer、GC、公司邮箱只能看。
- **搬数据**：Actions → Project database，mode = `migrate`，project = `mn`，email = 要加成 editor 的人。
  - 从 Benji 的旧库复制 `units` 和 `plan`。旧库是开放的，不用钥匙。
  - 正式切换前用 `force` 再跑一次，换成最新数据；名单和 To send 不受影响。
  - 切换后 Benji 要自己把旧库锁上（Rules → `.read`、`.write` 都设成 false）。
- **照片**：Benji 的页面把照片只存在拍照的那个浏览器里，hub 版也一样。要共享得改他的页面。

## 日常操作

**加人 / 改权限 / 删人**：Actions → Project database → Run workflow
- `mode = member`
- `project = ac3`
- `email = 对方邮箱`
- `role = editor`、`gc`、`viewer` 或 `remove`

没有账号会自动建好。对方打开 tracker、输入邮箱、点 **First time here** 设密码就能用。

**新项目**（例如 MTA7）：
1. 我在仓库里建 `mta7/` 文件夹，并把它加进 `platform/projects.json`。
2. 你在控制台建数据库 `af-hub-8f188-mta7`。
3. Actions 跑 `mode = init`、`project = mta7`、`email = 你的邮箱`。

**改了规则文件以后**：Actions 跑 `mode = rules`、`project = all`，一次给所有项目数据库上新规则。

## Design Board（设计库，`/design/`）

design team 的图纸和审图意见，**跟安装 tracker 分开**：

- 单独一个数据库 `af-hub-8f188-design`。所有项目的 board 都在里面（`/boardInfo`、`/boards/<项目>`、`/images/<项目>`），所以还没有 tracker 的项目（Hillview 等）也能用。
- 规则文件是 `design-database.rules.json`。身份只有 editor（`allowlist`）和 viewer（`viewers`），没有 GC；公司员工能看，不能改。
- design team 只在 design 库的名单上，**不在任何 tracker 名单上**。
- 一条意见要关两次：drafter 标"已改"（fixed）→ 审图的人确认后"关闭"（closed）。规则保证只有 fixed 才能变成 closed。
- Claude（拆 Discord 截图、回答问题）走 `api/design.mjs`，用的是 Vercel 上同一个 `ANTHROPIC_API_KEY`。只有 design 库的 editor 能调用。Claude 只提建议，人点按钮才保存。
- 桌面小精灵在 `desktop-helper/`，见那里的 README。
- **🔍 Check DXF**（Drawings 页，所有能看 board 的人都有）：拖 DXF 进去，查图号、比例、索引、手改尺寸、压字、材料代号。跑的是 `design/review.py`（和 Design Team Board 里的 `run_review.bat` 同一份），在浏览器里用 Pyodide 跑，**DXF 不上传、不用 AI**。改了检查规则：改 `design/review.py`，跑 `python design/review_selftest.py`，再把它复制到 `Design Team Board/tools/shop-drawing-gen/review.py`。

### 第一次开（约 10 分钟）
1. **Firebase 控制台**（af-hub-8f188）→ Realtime Database → Create database，名字填 `af-hub-8f188-design`，地区跟其他项目库一样。
2. **GitHub Desktop：Push**。到 Actions → *Platform tests* 等两个任务变绿。
3. Actions → **Project database** → Run workflow：`mode = init`，`project = design`，`email = 你的邮箱`。
4. 加人：`mode = member`，`project = design`，`email = 对方邮箱`，`role = editor`（或 `viewer`）。每个人跑一次。
5. 打开 https://af-hub-two.vercel.app/design/ ，点 **+ New project board**（名字 Atlantic-Chestnut Building 3，id `ac3`），再到 Drawings 点 **Import drawing list (PDF)**，选 `AC3 drawing list.pdf`。

以后改了 `design-database.rules.json`：`mode = rules`，`project = design`（或 `all`）。

**一次加多个人**：`email` 里可以填好几个邮箱，用逗号或换行隔开，`role` 对所有人一样。有一个地址写错，整次都不改。

### Discord 自动拉消息（等服务器管理员把 bot 加进频道以后）
1. bot 在 Developer Portal 里打开 **Message Content Intent**，并且被加进审图频道（View Channel + Read Message History）。
2. Vercel（af-hub-two）→ Settings → Environment Variables 加两个：
   - `DISCORD_BOT_TOKEN`：bot 的 token（就是 `.secrets\discord_bot.txt` 里那串；这个文件夹不会被提交）。
   - `DISCORD_CHANNELS`：`{"ac3":"频道ID"}`，以后别的项目接着加，例如 `{"ac3":"…","hillview":"…"}`。频道 ID：Discord 开发者模式下右键频道 → Copy Channel ID。
3. Redeploy 一次。之后在 Design Board 的 ✨ Paste from Discord 里点 **⬇ Pull new from Discord**：从上次拉到的地方接着读，Claude 拆成一条条，人确认后才加。


## 注意

- 这个 GitHub 仓库是**公开的**，Actions 日志谁都能看。所以工具从不在日志里打印完整邮箱，你填的邮箱也不会出现在日志里。
- 建议以后把仓库改成 Private：Settings → Danger Zone → Change visibility。改了以后 Vercel 和 Actions 照常工作。
- 旧的 AC3 / Lexington Firebase 项目**不要删**：
  - atlantic-chestnut-3 里还放着 takeoff 工具的公司零件库（Firestore），AC3 的立面几何也还从那里读；
  - 旧数据也留着当回滚。
- 服务账号密钥只放 GitHub Secrets，绝不提交进仓库。

## 文件

| 文件 | 作用 |
|---|---|
| `project-database.rules.json` | 每个项目数据库的规则（所有项目同一份） |
| `storage.rules` | 共用文件桶的规则：每个项目只用 `p/<项目>/` |
| `projects.json` | 项目登记表：项目名、数据库、旧 Firebase 在哪 |
| `migrate/run.js` | 迁移 / 加人 / 上规则 / 新项目工具（由 Actions 运行） |
| `tests/` | 自动检查（见上面第 4 条"自动检查"） |
