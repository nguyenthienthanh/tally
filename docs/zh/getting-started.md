# 快速开始

## 前置要求

- **Node 22.13 或更新版本。** tally 使用内置的 `node:sqlite`，因此没有原生模块要编译，也没有数据库
  服务要安装。22.5 虽然带了这个模块，但要加 `--experimental-sqlite`；22.13 是第一个开箱可用的版本，
  所以把它定为下限。CI 在 22.13、24 和 26 上跑测试。
- **pnpm**（任意较新版本；CI 用 11）。npm 也可以。
- 一台用过 Claude Code 的机器，也就是存在 `~/.claude/projects`。

## 安装

```bash
git clone https://github.com/nguyenthienthanh/tally.git
cd tally
pnpm install
pnpm build
```

目前没有全局安装，也还没有 `npm publish`。直接从克隆目录运行。

## 1. 检查数据来源

```bash
node dist/cli.js doctor
```

`doctor` 为每个来源打印一行，并标明存在或缺失：

| 来源 | tally 从中取什么 |
| --- | --- |
| `~/.claude/projects/**/*.jsonl` | 每个请求的元数据与 token 计数 |
| `~/.claude.json` | 套餐等级，以及 Claude Code 自己的 credit 常量 |
| `~/.claude/cache/rate-limits.json` | 当前 5 小时 / 7 天额度百分比 |
| `~/.claude/cache/usage-cycle.json` | 本计费周期的等值 API 成本 |
| `~/.claude/usage-data/` | Claude Code 自己的 `/insights` 输出 |

缺少来源不是致命错误。页面只渲染已有的部分，其余标为未知。例如读不到套餐上限时，它会隐藏 credit
那一侧，而不是编一个数字出来。

## 2. 建立索引

```bash
node dist/cli.js index
```

首次运行会读取全部会话记录。之后每次只读上次之后追加的字节，按文件记录字节水位，所以每天跑一次
只要不到一秒。

在开发这台机器上实测：3,473 个文件共 4.5 GB，约 13 秒，生成 `~/.tally/index.sqlite`，55 MB。

`--full` 强制全量重扫。很少需要；值得一提的场景是升级 tally 后发布说明提到 derived facts 版本变了，
而即便那时扫描器也会自己发现并重扫一次。

## 3. 打开面板

```bash
node dist/cli.js serve          # http://127.0.0.1:7777
node dist/cli.js serve --watch  # 有新会话时顺带重扫
```

服务只绑定 `127.0.0.1`。除两个 POST 路由外一切只读，而这两个路由需要服务器每次启动时新生成、
并嵌入页面的令牌。

### 分享截图

```bash
node dist/cli.js serve --redact
```

`--redact` 在数据到达页面之前，把项目路径换成加盐哈希，于是你可以展示数字而不暴露你在做什么项目。

## 4. 或者留在终端

```bash
node dist/cli.js report --grain=day --tz=Asia/Shanghai
```

同样的数字，不用浏览器：套餐与上限、校准状态、每个模型的 credit 与美元、按你选的粒度汇总，以及
带金额的发现。

## 关于语言

面板有越南文、中文和英文，按浏览器自动识别，也可用国旗按钮切换。CLI 输出英文。文档有三种语言，
见 README 顶部的链接。

## 排查

**`No such built-in module: node:sqlite`。** 你的 Node 低于 22.13，用 `node -v` 确认。

**面板说索引过期。** 额度快照比最近一次扫描更新，这样比较会少算。运行 `node dist/cli.js index`。

**某个模型的 credit 显示 `n/a`。** 你的 `~/.claude.json` 里没有该模型的 credit 费率。tally 把未知
显示为 `n/a`，绝不显示 `0`。

**完全没有索引到内容。** 确认 `~/.claude/projects` 存在且里面有 `.jsonl` 文件。`doctor` 会打印它
看到的文件数和总大小。
