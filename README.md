# snap-keep

基于 **Playwright 浏览器自动化** 的站点保活方案。该项目不做单独 HTTP warmup，请求与交互都由真实浏览器上下文完成。

目标站点默认值：

- `https://dososda.containers.snapdeploy.dev`

## 快速开始

```bash
npm install
npx playwright install --with-deps chromium
npm run wake:human
```

脚本成功后会在项目根目录生成：

- `wake-proof.png`：本次访问截图凭证

## 在 Katabump 部署 (独立运行，无需 GitHub Actions)

本项目支持完全脱离 GitHub Actions，直接在 Katabump 容器平台作为常驻服务运行。此模式为**首选推荐方案**。

它使用 `node-cron` 驱动定时调度，在服务启动时会立即执行一次唤醒，随后每隔 7 分钟自动执行一次。包含并发锁（防止上一次任务未结束时发生重叠冲突）、结构化日志、Run ID 追踪，并且能够优雅捕获错误而不导致整个调度程序崩溃。

### 1. 部署与启动步骤

1. **上传文件**：将本项目的所有代码文件上传至 Katabump 控制台。
2. **安装依赖**：
   ```bash
   npm install
   # 安装 Playwright 所需的浏览器及系统依赖
   npx playwright install --with-deps chromium
   ```
3. **配置环境变量**：在 Katabump 的 Environment Variables 面板中配置以下核心环境变量（参见下方配置说明）。
4. **启动服务**：
   Katabump 启动命令设置为：
   ```bash
   npm start
   ```
   （该命令会启动常驻调度程序 `node index.mjs`，并立即开始第一次唤醒测试）。

### 2. Katabump 专有环境变量

在 Katabump 部署时，除了常规的浏览器交互变量外，请额外设置以下变量：

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `TARGET_URL` | `https://dososda.containers.snapdeploy.dev` | 要唤醒的目标站点 |
| `WAKE_CRON` | `*/7 * * * *` | 唤醒的 Cron 表达式（默认每 7 分钟一次） |
| `WAKE_TZ` | `UTC` | 调度程序运行的时区（可选，支持 `Asia/Shanghai` 等） |

*(其余交互微调参数详见底部的「常规环境变量」或 `.env.example` 文件。)*

### 3. 免费版注意事项与权衡

由于 Katabump 免费容器资源有限，使用独立常驻模式时请知悉以下约束与权衡：
- **内存限制 (OOM) 隐患**：免费容器通常配额较低（例如 256MB 或 512MB RAM）。启动 Chromium 浏览器是一个高内存开销行为，若系统内存不足可能偶发浏览器启动失败或 OOM 崩溃。
- **定期手动续期**：Katabump 免费层通常需要每 **4 天** 手动进行一次服务器续期（Renew），否则服务会被自动挂起停止运行。
- **稳定性折中**：相较于 GitHub Actions 的托管运行，常驻在免费容器中的调度进程可能因为容器重启、宿主机迁移或资源挤兑而中断，需要定期通过 Katabump 控制台查看运行日志确认保活状态。

### 4. Katabump 专用排查指南

- **Chromium 启动报错 `Failed to launch browser`**
  - 这通常是因为容器内缺失 Playwright 所需的系统级依赖库。请确保在 Katabump 构建或启动阶段执行了 `npx playwright install --with-deps chromium`。
  - 如果依然由于系统资源极度匮乏（如 RAM/CPU 溢出）导致启动失败，可尝试在环境变量中调大 `WAKE_RETRIES=5` 增加容错概率。
- **时区不准确**
  - 请设置 `WAKE_TZ=Asia/Shanghai`（或你需要的时区），确保日志和 Cron 定时时间与预期相符。

---

## 环境变量

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `TARGET_URL` | `https://dososda.containers.snapdeploy.dev` | 要唤醒的目标地址 |
| `WAKE_LOCALE` | `en-US` | 浏览器 locale |
| `WAKE_TIMEZONE` | `UTC` | 浏览器时区 |
| `WAKE_RETRIES` | `3` | 全流程重试次数 |
| `WAKE_NAV_TIMEOUT_MS` | `30000` | 导航超时 |
| `WAKE_NETWORKIDLE_TIMEOUT_MS` | `7000` | `networkidle` best-effort 等待超时 |
| `WAKE_ACTION_TIMEOUT_MS` | `8000` | 页面交互默认超时 |
| `WAKE_JITTER_MIN_MS` / `WAKE_JITTER_MAX_MS` | `250` / `1400` | 行为间随机等待区间 |
| `WAKE_RETRY_BASE_MS` | `1500` | 重试基础退避时长 |
| `WAKE_RETRY_JITTER_MIN_MS` / `WAKE_RETRY_JITTER_MAX_MS` | `400` / `1800` | 重试退避抖动区间 |
| `WAKE_INTERACT_PROBABILITY` | `0.65` | 可交互元素点击概率 |
| `WAKE_LINK_HOP_PROBABILITY` | `0.5` | 站内链接跳转并返回概率 |
| `WAKE_HEADLESS` | `true` | 是否无头运行（设为 `false` 可本地调试） |

## GitHub Actions 工作流 (可选/遗留模式)

*注意：此模式现作为备份或遗留选项。对于在 Katabump 上的常驻部署，建议优先使用上方的「在 Katabump 部署」Standalone 模式。*

工作流文件：`.github/workflows/wake-human.yml`

- 触发方式：
  - `schedule`：默认每 7 分钟执行一次（`*/7 * * * *`）
  - `workflow_dispatch`：支持手动触发
- 内置 `concurrency`，防止任务重叠
- Node 20 环境执行
- 自动安装依赖与 Playwright Chromium（含系统依赖）
- 执行 `npm run wake:human`
- 无论成功或失败都会上传 artifact：
  - `wake-proof.png`
  - `wake.log`

## 手动触发

1. 打开 GitHub 仓库的 **Actions** 页面。
2. 选择 **Wake site with human-like Playwright flow**。
3. 点击 **Run workflow**。
4. 运行结束后在该次 workflow 的 **Artifacts** 下载截图与日志。

## 定时频率建议

- 默认 7 分钟适合需要较高活跃度的实例。
- 若实例成本敏感，可改为 10~15 分钟。
- 若目标平台有频率限制，可适当放大间隔并保留脚本内部随机行为。

## 常规故障排查

1. **冷启动慢导致超时**
   - 增大 `WAKE_NAV_TIMEOUT_MS`（例如 45000 或 60000）。
   - 保持 `WAKE_RETRIES=3` 或更高。

2. **偶发网络波动**
   - 保留默认重试与退避抖动参数。
   - 查看 artifact 中 `wake.log` 的 `attempt` 和 `step` 字段定位失败阶段。

3. **疑似反爬策略拦截**
   - 脚本已随机 UA、viewport、鼠标移动、滚动、点击、站内跳转。
   - 可调大 `WAKE_JITTER_*`，降低触发频率，减少行为模式固定化。

4. **`networkidle` 经常超时**
   - 脚本对 `networkidle` 是 best-effort，超时会记录 warning 但不会直接失败。
   - 若页面长连较多，可适当降低 `WAKE_NETWORKIDLE_TIMEOUT_MS` 以缩短等待。
