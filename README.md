# QQ音乐切换快捷桌面控件

在 GNOME 顶部面板最左侧加入 **上一首 / 播放暂停 / 下一首** 三个按钮，通过 MPRIS 控制 Linux 版 QQ 音乐。按钮常驻显示：没有正在播放的曲目时变灰，QQ 音乐注册 MPRIS 播放器后自动亮起。

同时附带一个修复脚本，解决 QQ 音乐 Linux 1.1.8 中“上一首”被错误接成“下一首”的官方 bug。

## 适配环境

| 项目 | 已验证版本 |
| --- | --- |
| 系统 | Ubuntu 26.04.1 LTS（Ubuntu 24.04+ / Debian 系同类环境理论可用，未逐一验证） |
| 桌面 | GNOME Shell 50.1，Wayland 会话（Ubuntu `--mode=ubuntu`） |
| Shell 扩展 API | 代码兼容 GNOME Shell 45–50（`metadata.json` 已声明） |
| QQ 音乐 | Linux 用户级安装 1.1.8，Electron 版，可执行文件 `~/.local/opt/qqmusic/qqmusic` |
| 关键依赖 | QQ 音乐通过 Chromium MediaSession 注册 `org.mpris.MediaPlayer2.*`；系统需带 `Gio`/`St` 的 GJS |
| 修复脚本依赖 | Python 3（仅 `patch-previoustrack.py` 需要） |

> X11 会话未专门测试；Wayland 下 GNOME Shell 无法用 `Alt+F2 → r` 热重载扩展，安装后必须注销重登一次（见下方步骤 2）。

## 项目结构

```
.
├── README.md
├── install.sh                  # 安装并启用扩展
├── patch-previoustrack.py      # 修复 QQ 音乐 1.1.8 “上一首” bug
└── qqmusic-panel@local/        # GNOME Shell 扩展本体
    ├── extension.js
    ├── metadata.json
    └── stylesheet.css
```

## 部署方法

### 1. 安装扩展

```bash
cd QQmuuicSwitcher_linux
bash install.sh
```

脚本会把 `qqmusic-panel@local/` 复制到 `~/.local/share/gnome-shell/extensions/` 并执行：

```bash
gnome-extensions enable qqmusic-panel@local
```

也可以手动复制并启用：

```bash
mkdir -p ~/.local/share/gnome-shell/extensions
cp -R qqmusic-panel@local ~/.local/share/gnome-shell/extensions/
gnome-extensions enable qqmusic-panel@local
```

### 2. 注销并重新登录（必须）

GNOME Shell 只在启动时扫描扩展目录，而且会缓存已加载的 JS 模块，`disable/enable` 不会重新读取文件。因此**必须注销再登录一次**，按钮才会出现在顶栏最左侧。

确认状态：

```bash
gnome-extensions info qqmusic-panel@local
# 状态应为 ACTIVE
```

### 3. 修复“上一首”按钮（QQ 音乐 1.1.8）

QQ 音乐 1.1.8 的 `resources/app.asar` 中存在如下错误代码：

```js
navigator.mediaSession.setActionHandler('previoustrack', () => {
  this.playNext();   // 错误：上一首被接成了下一首
});
```

运行修复脚本（会先生成 `app.asar.bak` 备份，再做等长原地替换，不破坏 asar 结构）：

```bash
python3 patch-previoustrack.py
# 若 QQ 音乐装在别处：
python3 patch-previoustrack.py /path/to/qqmusic/resources/app.asar
```

然后**重启 QQ 音乐**使补丁生效。回滚：

```bash
python3 patch-previoustrack.py --restore
```

### 4. 使用

播放任意歌曲；QQ 音乐注册 MPRIS 后（通常在开始播放后 2 秒内），顶栏按钮亮起：

- ⏮ 上一首
- ⏯ 播放 / 暂停（图标随状态切换）
- ⏭ 下一首

## 工作原理

- 扩展通过 D-Bus 枚举 `org.freedesktop.DBus.ListNames()`，每 2 秒轮询一次，避免 `NameOwnerChanged` 未送达导致遗漏。
- 通过 `GetConnectionUnixProcessID` + `/proc/<pid>/exe` 识别出属于 `qqmusic` 的播放器，避免被 Chrome/Firefox 的 MPRIS 抢走控制权；找不到时回退到正在播放的播放器。
- 按钮调用 MPRIS 的 `Previous` / `PlayPause` / `Next`。
- QQ 音乐未播放时没有 MPRIS 播放器，按钮保持常驻但禁用。

## 已知限制

- **QQ 音乐 1.1.8 的上一首 bug 需要步骤 3 的补丁**；应用自动更新可能覆盖 `app.asar`，届时重新打补丁即可。
- MPRIS 的 `Volume` 属性在该版本中写入无效（读回始终为 1），不能用它调应用音量。QQ 音乐的实际音量是其内部 `settings.json` 中的 `volume`（0–100），作用于 HTML `<audio>` 元素。
- 若只想调整“QQ 音乐这一个应用”的输出音量，推荐用 PipeWire 流音量：
  ```bash
  wpctl status | grep -i chromium   # QQ 音乐是 Electron，流名常为 Chromium
  wpctl set-volume <流ID> 0.5
  ```
  它不会影响系统输出设备音量。
- 耳机音量键发出的是 `XF86AudioRaiseVolume`/`XF86AudioLowerVolume`，属于系统音量，不会切歌；切歌需要 `XF86AudioPrev`/`XF86AudioNext` 或本扩展的顶栏按钮。
- 仅支持用户级扩展安装目录；系统级安装需自行放到 `/usr/share/gnome-shell/extensions/`。

## 卸载

```bash
gnome-extensions disable qqmusic-panel@local
rm -rf ~/.local/share/gnome-shell/extensions/qqmusic-panel@local
python3 patch-previoustrack.py --restore   # 如果需要还原 QQ 音乐
```

同样需要注销重登后扩展才会完全消失。

## 排障

```bash
gnome-extensions info qqmusic-panel@local
busctl --user list | grep org.mpris.MediaPlayer2
journalctl --user -b -o cat /usr/bin/gnome-shell | grep qqmusic-panel
```

若按钮一直是灰色，通常是 QQ 音乐还没有正在播放的曲目（未注册 MPRIS），先播放一首歌即可。
