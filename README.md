# Ren'Py Work

本地优先的通用 Ren'Py 源文检视 / 编辑工具（本期最小切片）。

## 本期功能

- **打开 / 切换项目**：浏览本机目录并导入任意 Ren'Py 工程（含 `game/` 或直接选 `game/`）
- **分支关系图**：从 `label start` 沿静态 `jump`/`call`/`menu` 展开（深度≤12）；`jump expression` 显示为灰色节点
- **文件列表编辑**：左下选择 `.rpy`，右侧双语 textarea（中/英）；**仅点击「保存」才写回**
- **半自动翻译同步**：扫描配对 `tl/english`；保存中文时同步更新 tl 内 `#` 注释 / `old`；英文可同屏校对并一并保存；源文与注释不一致时标「译文待校」
- **资源管理**（`/assets`）：只读浏览 Character / 立绘 / 场景 / BGM / SFX / 音效；显示脚本名、路径、定义位置；图片与音频可预览
- 点击图上 label 节点可联动选中对应文件（可选）

不做：机翻 API、资源写回、topic_hub / 动态跳转展开、拖拽改边。

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
