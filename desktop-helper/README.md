# AF Helper（桌面小精灵）

屏幕角上一个圆按钮，永远浮在最上面。点它（或按 **Ctrl+Shift+Space**）打开一个**对话框**（hub 的 `/assistant/`；旧地址 `/design/?mini=1` 会自动跳过去）：

- 用中文 / 韩文 / 英文直接说要做什么，可以贴截图（Ctrl+V）、拖 PDF、Excel 进来。
- 它会查：Design Board（图纸、审图意见）、安装 tracker（AC3 / Lexington 的进度、日志、submittal）。
- 它会改：记审图意见、改意见和图纸状态、更新安装进度 / 日志 / submittal。**每个改动先出一张确认卡，点 Confirm 才保存**，用的是你自己的账号权限（不是 editor 的项目只能看）。
- 圆按钮上的红色数字 = 你的待办（要你改的意见 + 等你审的意见）；有新的会弹 Windows 通知。
- 调 Claude 用的是 Vercel 上的 `ANTHROPIC_API_KEY`（和 Tracker Chat 同一把，按 API 计费），不占任何人的 Claude 账号额度。不想用 AI 的人照常用网页。

## 安装（每个人自己装，不用管理员）
1. 打开 GitHub 仓库的 **Releases**，下载最新的 `AF-Helper-Setup-x.y.z.exe`。
2. 双击。如果 Windows 说"Windows 已保护你的电脑"，点 **更多信息 → 仍要运行**（安装包没有买代码签名证书）。
3. 装好会自己打开。第一次在小窗口里登录 hub 账号，以后会记住。
4. 右键圆按钮（或任务栏右下角的图标）可以：开机自动启动、隐藏圆按钮、重新加载、退出。

## 什么时候要发新版本
小窗口里的内容都来自 hub 网页：改 Design Board 只要推 hub，**不用重装**。只有改了这个文件夹（圆按钮、托盘菜单、快捷键）才要发新版：
1. 改 `package.json` 里的 `version`。
2. Push，然后 GitHub → Actions → **AF Helper** → Run workflow。跑完 Releases 里就有新的安装包。

## 文件
- `main.js`：圆按钮、小窗口、托盘菜单、快捷键、通知。只有 hub 的页面能在小窗口里打开，其他链接都交给浏览器。
- `panel-preload.js`：只给 hub 页面两个功能：设置圆按钮上的数字、弹通知。
- `bubble.*`：圆按钮。`offline.*`：连不上 hub 时的页面。
- `test/smoke.mjs`：Linux 上的冒烟测试（`xvfb-run -a node test/smoke.mjs`）。
