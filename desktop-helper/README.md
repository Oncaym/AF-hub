# AF Helper（design team 桌面小精灵）

屏幕角上一个圆按钮，永远浮在最上面。点它（或按 **Ctrl+Shift+Space**）打开一个小窗口。小窗口里就是 hub 的 Design Board 精简页 `/design/?mini=1`：

- **To-do**：我要改的意见、等我审的意见。圆按钮上的红色数字就是这个数。
- **贴截图收意见**：✨ Paste from Discord（Claude 拆条，人点确认才加）。
- **Drawings**：每张图在谁手里、什么状态。
- **Links**：hub、AC3 / Lexington tracker、Takeoff（在浏览器里打开）。
- **问 Claude**：例如"AC3-103 还剩什么""把 #3 标成 rev 2 已改"。改东西前都要点确认。

有新的意见指给我，Windows 右下角会弹通知。

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
