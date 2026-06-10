# snap-keep

基于 **Playwright 浏览器自动化** 的站点保活方案。该项目不做单独 HTTP warmup，请求与交互都由真实浏览器上下文完成。

目标站点默认值：

- `https://dososda.containers.snapdeploy.dev`

## 快速开始（本地测试）

```bash
npm install
npx playwright install --with-deps chromium
npm run wake:human
```

脚本成功后会在项目根目录生成：

- `wake-proof.png`：本次访问截图凭证

## GitHub Actions 工作流（主要模式）

工作流文件：`.github/workflows/wake-human.yml`

### 触发方式

- **`schedule`**：每 7 分钟自动执行一次（`*/7 * * * *`）
- **`workflow_dispatch`**：支持通过 GitHub 网页端手动触发

### 工作流特性

- 内置 `concurrency` 组，防止同一分支上的任务重叠执行
- Node 20 环境运行
- 自动安装 npm 依赖及 Playwright Chromium（含系统依赖）
- 执行 `npm run wake:human` 完成浏览器唤醒
- 无论成功或失败，都会上传 artifact：
  - `wake-proof.png`（截图凭证）
  - `wake.log`（完整运行日志）

### 手动触发

1. 打开 GitHub 仓库的 **Actions** 页面
2. 选择 **Wake site with human-like Playwright flow**
3. 点击 **Run workflow** → 下拉选择分支 → 点击 **Run workflow**
4. 运行结束后在该次 workflow 的 **Artifacts** 下载截图与日志

### 定时调度说明

GitHub Actions 的 `schedule` 事件基于 UTC 时间，且存在以下局限性：

- 对于公开仓库，调度可能会有数分钟到数十分钟的延迟（取决于 GitHub 队列负载）
- 免费账户的调度不保证准时触发
- 仓库若长期不活跃（60 天无提交），GitHub Actions 会自动禁用

如果对调度的准时性有更高要求，可以配合外部定时器来触发 `workflow_dispatch`（参见下方 Cloudflare Cron Triggers 部分）。

## Cloudflare Cron Triggers 可选：外部定时触发

如果你希望使用更可靠的定时调度来触发 GitHub Actions，可以利用免费的 Cloudflare Workers Cron Triggers 来调用 GitHub 的 `workflow_dispatch` API。

### 示例 Worker 代码

```js
// Cloudflare Worker — 定时调用 GitHub Actions workflow_dispatch
export default {
  async scheduled(event, env, ctx) {
    const GITHUB_TOKEN = env.GITHUB_TOKEN;
    const OWNER = 'your-username';
    const REPO = 'snap-keep';
    const WORKFLOW = 'wake-human.yml';

    const resp = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
      {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'User-Agent': 'snap-keep-cron'
        },
        body: JSON.stringify({ ref: 'main' })
      }
    );

    if (!resp.ok) {
      console.error('dispatch failed', resp.status, await resp.text());
    }
  }
};
```

### 配置步骤

1. 在 GitHub 生成一个 **Personal Access Token**（`repo` 或 `actions` 权限）
2. 在 Cloudflare Dashboard 创建一个 Worker，绑定 Cron Trigger（例如 `*/7 * * * *`）
3. 在 Worker 的环境变量中设置 `GITHUB_TOKEN`（使用 Secrets 存储）
4. 将 Worker 部署即可——它会按 Cron 表达式定期唤醒你的 GitHub Actions 工作流

这种方法可以在 GitHub Actions 自身调度不稳定或仓库不活跃导致调度被禁用时，作为独立的外部定时器使用。

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

## 定时频率建议

- 默认 7 分钟适合需要较高活跃度的实例
- 若实例成本敏感，可改为 10~15 分钟
- 若目标平台有频率限制，可适当放大间隔并保留脚本内部随机行为

## 日志与调试

每次 GitHub Actions 运行后，可以在 workflow 的 **Artifacts** 中找到：

- **`wake-proof.png`**：浏览器运行结束后截取的全页截图。无论成功还是失败都会尝试生成。
- **`wake.log`**：完整的结构化 JSON 日志流，包含每次运行的 attempt、step、耗时等信息。

日志结构示例：

```json
{"ts":"2026-01-01T12:00:00.000Z","level":"info","message":"Attempt started","attempt":1,"step":"attempt:start"}
{"ts":"2026-01-01T12:00:05.000Z","level":"info","message":"Attempt succeeded","attempt":1,"step":"attempt:success","durationMs":5123}
```

## 常规故障排查

1. **冷启动慢导致超时**
   - 在 workflow 环境变量中增大 `WAKE_NAV_TIMEOUT_MS`（例如 45000 或 60000）
   - 保持 `WAKE_RETRIES=3` 或更高

2. **偶发网络波动**
   - 保留默认重试与退避抖动参数
   - 查看 artifact 中 `wake.log` 的 `attempt` 和 `step` 字段定位失败阶段

3. **疑似反爬策略拦截**
   - 脚本已随机 UA、viewport、鼠标移动、滚动、点击、站内跳转
   - 可调大 `WAKE_JITTER_*`，降低触发频率，减少行为模式固定化

4. **`networkidle` 经常超时**
   - 脚本对 `networkidle` 是 best-effort，超时会记录 warning 但不会直接失败
   - 若页面长连接较多，可适当降低 `WAKE_NETWORKIDLE_TIMEOUT_MS` 以缩短等待
