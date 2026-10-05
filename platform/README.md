# AF Hub 项目数据库（platform/）

所有项目都在同一个 Firebase 项目 **af-hub-8f188** 里，一个账号走遍所有项目；但**每个项目有自己独立的数据库**：

| 项目 | 网址 | 数据库 |
|---|---|---|
| AC3 | https://af-hub-two.vercel.app/ac3/ | `af-hub-8f188-ac3` |
| 355 Lexington | https://af-hub-two.vercel.app/lex/ | `af-hub-8f188-lex` |
| Cooper Park 2 | 还在原网址、原 Firebase（最后迁） | — |

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

f. **Realtime Database → 默认数据库（af-hub-8f188-default-rtdb）→ Rules**：把仓库根目录 `firebase-database-rules.json` 全部内容贴进去，点 Publish。这是 hub 首页的规则，改动有三处：
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
