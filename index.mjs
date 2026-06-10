import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import readline from 'readline';
import cron from 'node-cron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const scriptPath = join(__dirname, 'scripts', 'wake-human.mjs');

// Helper to print structured logs
function log(level, message, meta = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta
  };
  console.log(JSON.stringify(payload));
}

// Timezone validation & resolution
function resolveTimezone(timezone) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return timezone;
  } catch {
    log('warn', 'Invalid timezone detected, falling back to UTC', { timezone });
    return 'UTC';
  }
}

// Environmental Configuration
const TARGET_URL = process.env.TARGET_URL || 'https://dososda.containers.snapdeploy.dev';
const WAKE_CRON = process.env.WAKE_CRON || '*/7 * * * *';
const WAKE_TZ = resolveTimezone(process.env.WAKE_TZ || process.env.WAKE_TIMEZONE || 'UTC');

let isRunning = false;

// Function to trigger a wake cycle
async function runWakeCycle(trigger) {
  if (isRunning) {
    log('warn', 'Previous wake cycle still running, skipping this tick', { trigger });
    return;
  }

  isRunning = true;
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  log('info', 'Wake cycle triggered', { runId, trigger });

  try {
    // Spawn child process running scripts/wake-human.mjs in silent mode to capture logs
    const child = fork(scriptPath, [], {
      silent: true,
      env: {
        ...process.env,
        TARGET_URL,
        WAKE_TIMEZONE: WAKE_TZ // sync timezone config to the child script
      }
    });

    // Handle stdout line by line
    const stdoutReader = readline.createInterface({ input: child.stdout });
    stdoutReader.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const parsed = JSON.parse(line);
        log(parsed.level || 'info', parsed.message, { ...parsed, runId, trigger });
      } catch {
        // Fallback for non-structured logging output
        log('info', line, { runId, trigger, raw: true });
      }
    });

    // Handle stderr line by line
    const stderrReader = readline.createInterface({ input: child.stderr });
    stderrReader.on('line', (line) => {
      if (!line.trim()) return;
      log('error', line, { runId, trigger, source: 'stderr' });
    });

    // Promise wrapper to await process completion
    await new Promise((resolve) => {
      child.on('close', (code) => {
        isRunning = false;
        if (code === 0) {
          log('info', 'Wake cycle completed successfully', { runId, trigger, code });
        } else {
          log('error', 'Wake cycle failed', { runId, trigger, code });
        }
        resolve();
      });

      child.on('error', (err) => {
        isRunning = false;
        log('error', 'Failed to start wake process child process', {
          runId,
          trigger,
          error: err instanceof Error ? err.message : String(err)
        });
        resolve();
      });
    });

  } catch (error) {
    isRunning = false;
    log('error', 'Unexpected error during wake cycle runner orchestration', {
      runId,
      trigger,
      error: error instanceof Error ? error.stack || error.message : String(error)
    });
  }
}

// Initialize Scheduler
log('info', 'Standalone katabump scheduler initialized', {
  cronExpression: WAKE_CRON,
  timezone: WAKE_TZ,
  targetUrl: TARGET_URL
});

// Register the cron task
try {
  cron.schedule(WAKE_CRON, () => {
    runWakeCycle('cron').catch((err) => {
      log('error', 'Failed during cron task dispatch', {
        error: err instanceof Error ? err.message : String(err)
      });
    });
  }, {
    scheduled: true,
    timezone: WAKE_TZ
  });
} catch (error) {
  log('error', 'Failed to register cron task scheduler', {
    cronExpression: WAKE_CRON,
    timezone: WAKE_TZ,
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
}

// Immediately run one wake cycle on startup as required
runWakeCycle('startup').catch((err) => {
  log('error', 'Failed during startup wake execution', {
    error: err instanceof Error ? err.message : String(err)
  });
});
