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

## GitHub Actions 工作流

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

## 故障排查

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
