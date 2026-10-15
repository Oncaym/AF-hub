# AF Helper（桌面小精灵 Leona）

**Leona**（形象是 Leo 画的）住在桌面上，永远浮在最上面：在屏幕下面走来走去、喝咖啡、打盹、画图。点她（或按 **Ctrl+Shift+Space**）打开**对话框**（hub 的 `/assistant/`）；拖她可以放到任何地方；右键是选项。只有她身上能点，旁边透明的地方点击会穿过去。

- 用中文 / 韩文 / 英文直接说要做什么，可以贴截图（Ctrl+V）、拖 PDF、Excel 进来。
- 它会查：Design Board（图纸、审图意见、Excel 表）、安装 tracker（AC3 / Lexington 的进度、日志、submittal）。
- 它会改：记审图意见、改状态、导入 Excel、更新安装进度 / 日志 / submittal。**每个改动先出一张确认卡，点了才保存**，用的是你自己的账号权限。
- 她头上的红色数字 = 你的待办；有新的她会说出来，也会弹 Windows 通知。对话框在干活时她在画图。
- 调 Claude 用的是 Vercel 上的 `ANTHROPIC_API_KEY`（按 API 计费），不占任何人的 Claude 账号额度。不想用 AI 的人照常用网页。

## 安装（每个人自己装，不用管理员）
1. 打开 GitHub 仓库的 **Releases**，下载最新的 `AF-Helper-Setup-x.y.z.exe`。
2. 双击。如果 Windows 说"Windows 已保护你的电脑"，点 **更多信息 → 仍要运行**（安装包没有买代码签名证书）。
3. 装好会自己打开。第一次在小窗口里登录 hub 账号，以后会记住。
4. 右键 Leona（或任务栏右下角的图标）可以：显示 / 隐藏 Leona、让她别走动、调大小（Normal / Small）、开机自动启动、重新加载、退出。

## 什么时候要发新版本
小窗口里的内容都来自 hub 网页：改 Design Board 只要推 hub，**不用重装**。只有改了这个文件夹（Leona、托盘菜单、快捷键）才要发新版：
1. 改 `package.json` 里的 `version`。
2. Push，然后 GitHub → Actions → **AF Helper** → Run workflow。跑完 Releases 里就有新的安装包。

## 文件
- `main.js`：Leona 的窗口（走路 = 整个窗口沿屏幕移动）、对话框、托盘菜单、快捷键、通知。只有 hub 的页面能在对话框里打开，其他链接都交给浏览器。
- `pet.html` / `pet.js` / `pet-preload.js`：Leona（姿势、台词、气泡、待办数字、只有身体接鼠标）。
- `assets/`：她的图（`tools/make-assets.py` 从 Leo 的 1024px 原图生成 480px webp 和身体范围 `poses.js`；也生成 icon / tray 图标）。
- `panel-preload.js`：只给 hub 页面三个功能：待办数字、通知、"正在干活"。
- `offline.*`：连不上 hub 时的页面。
- `test/smoke.mjs`：Linux 上的冒烟测试（`xvfb-run -a node test/smoke.mjs`）。
