# Ren'Py Work

本地优先的通用 Ren'Py 源文检视 / 编辑工具（本期最小切片）。

## 本期功能

- **打开 / 切换项目**：浏览本机目录并导入任意 Ren'Py 工程（含 `game/` 或直接选 `game/`）
- **扫描索引**：递归扫描 `game/**/*.rpy`（排除 `tl/`、`cache/`、`saves/`），提取对话与 menu 选项文案
- **文本编辑**：每行一个 `textarea`；**仅点击「保存」才写回** `.rpy`（无自动保存）

不做：分支图、翻译对照写回、资源索引。

## 要求

- Node.js 18+
- 仅建议在本机 `next dev` 使用（API 会读写你指定的工程目录）

## 使用

```bash
cp .env.local.example .env.local   # 可选：设置 DEFAULT_GAME_ROOT
npm install
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)，点「打开项目」导入工程。

可选环境变量（`.env.local`）：

```bash
DEFAULT_GAME_ROOT=/path/to/your/game   # 或含 game/ 的工程根
```

## 写回约定

- 只替换目标行中**第一个**引号字符串的正文
- 不改缩进、speaker、`$` / `python:` / 条件结构
- 本期不写 `tl/` 下翻译文件

## 自测样例

任意合法 Ren'Py 工程均可。例如：

`/Users/fishenal/Documents/listenman/listenman` 或其下 `game/`。
