import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13.6; rv:126.0) Gecko/20100101 Firefox/126.0'
];

const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1600, height: 900 },
  { width: 1728, height: 1117 },
  { width: 1920, height: 1080 }
];

function envInt(name, defaultValue, minValue = 0) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return defaultValue;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return defaultValue;
  }

  return Math.max(parsed, minValue);
}

function envFloat(name, defaultValue, minValue = 0, maxValue = 1) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return defaultValue;
  }

  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed)) {
    return defaultValue;
  }

  return Math.min(Math.max(parsed, minValue), maxValue);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom(list) {
  return list[randomInt(0, list.length - 1)];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function elapsedMs(startAt) {
  return Math.round(performance.now() - startAt);
}

function log(level, message, meta = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta
  };

  console.log(JSON.stringify(payload));
}

function resolveTimezone(timezone) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return timezone;
  } catch {
    log('warn', 'Invalid timezone detected, fallback to UTC', { timezone });
    return 'UTC';
  }
}

const config = {
  targetUrl: process.env.TARGET_URL || 'https://dososda.containers.snapdeploy.dev',
  locale: process.env.WAKE_LOCALE || 'en-US',
  timezone: resolveTimezone(process.env.WAKE_TIMEZONE || 'UTC'),
  retries: envInt('WAKE_RETRIES', 3, 1),
  navigationTimeoutMs: envInt('WAKE_NAV_TIMEOUT_MS', 30000, 5000),
  networkIdleTimeoutMs: envInt('WAKE_NETWORKIDLE_TIMEOUT_MS', 7000, 500),
  actionTimeoutMs: envInt('WAKE_ACTION_TIMEOUT_MS', 8000, 1000),
  jitterMinMs: envInt('WAKE_JITTER_MIN_MS', 250, 0),
  jitterMaxMs: envInt('WAKE_JITTER_MAX_MS', 1400, 1),
  retryBaseMs: envInt('WAKE_RETRY_BASE_MS', 1500, 200),
  retryJitterMinMs: envInt('WAKE_RETRY_JITTER_MIN_MS', 400, 0),
  retryJitterMaxMs: envInt('WAKE_RETRY_JITTER_MAX_MS', 1800, 0),
  mouseMovesMin: envInt('WAKE_MOUSE_MOVES_MIN', 3, 1),
  mouseMovesMax: envInt('WAKE_MOUSE_MOVES_MAX', 6, 1),
  scrollPassesMin: envInt('WAKE_SCROLL_PASSES_MIN', 2, 1),
  scrollPassesMax: envInt('WAKE_SCROLL_PASSES_MAX', 5, 1),
  interactProbability: envFloat('WAKE_INTERACT_PROBABILITY', 0.65),
  linkHopProbability: envFloat('WAKE_LINK_HOP_PROBABILITY', 0.5),
  headless: process.env.WAKE_HEADLESS !== 'false'
};

if (config.jitterMinMs > config.jitterMaxMs) {
  [config.jitterMinMs, config.jitterMaxMs] = [config.jitterMaxMs, config.jitterMinMs];
}

if (config.retryJitterMinMs > config.retryJitterMaxMs) {
  [config.retryJitterMinMs, config.retryJitterMaxMs] = [config.retryJitterMaxMs, config.retryJitterMinMs];
}

if (config.mouseMovesMin > config.mouseMovesMax) {
  [config.mouseMovesMin, config.mouseMovesMax] = [config.mouseMovesMax, config.mouseMovesMin];
}

if (config.scrollPassesMin > config.scrollPassesMax) {
  [config.scrollPassesMin, config.scrollPassesMax] = [config.scrollPassesMax, config.scrollPassesMin];
}

let targetUrl;
try {
  targetUrl = new URL(config.targetUrl);
} catch {
  log('error', 'TARGET_URL is invalid', { targetUrl: config.targetUrl });
  process.exit(1);
}

function cacheBustedUrl() {
  const url = new URL(targetUrl.toString());
  url.searchParams.set('_wake', `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
  return url.toString();
}

async function waitWithJitter(attempt, step) {
  const delayMs = randomInt(config.jitterMinMs, config.jitterMaxMs);
  log('info', 'Jitter wait', { attempt, step, delayMs });
  await sleep(delayMs);
}

async function waitForStableLoad(page, attempt, step) {
  const startedAt = performance.now();

  await page.waitForLoadState('domcontentloaded', { timeout: config.navigationTimeoutMs });

  let networkIdleReached = true;
  try {
    await page.waitForLoadState('networkidle', { timeout: config.networkIdleTimeoutMs });
  } catch {
    networkIdleReached = false;
    log('warn', 'networkidle wait timed out (best-effort)', {
      attempt,
      step,
      timeoutMs: config.networkIdleTimeoutMs
    });
  }

  log('info', 'Load state settled', {
    attempt,
    step,
    durationMs: elapsedMs(startedAt),
    networkIdleReached
  });
}

async function moveMouseHumanLike(page, attempt) {
  const startedAt = performance.now();
  const viewport = page.viewportSize() || { width: 1366, height: 768 };
  const maxX = Math.max(viewport.width - 5, 6);
  const maxY = Math.max(viewport.height - 5, 6);

  let currentX = randomInt(5, maxX);
  let currentY = randomInt(5, maxY);

  await page.mouse.move(currentX, currentY, { steps: randomInt(10, 24) });

  const moves = randomInt(config.mouseMovesMin, config.mouseMovesMax);
  for (let i = 0; i < moves; i += 1) {
    const nextX = randomInt(5, maxX);
    const nextY = randomInt(5, maxY);
    await page.mouse.move(nextX, nextY, { steps: randomInt(8, 24) });
    currentX = nextX;
    currentY = nextY;
    await sleep(randomInt(80, 260));
  }

  log('info', 'Mouse movement completed', {
    attempt,
    step: 'mouse-move',
    durationMs: elapsedMs(startedAt),
    finalX: currentX,
    finalY: currentY,
    moves
  });
}

async function scrollPage(page, attempt) {
  const startedAt = performance.now();
  const passes = randomInt(config.scrollPassesMin, config.scrollPassesMax);

  for (let i = 0; i < passes; i += 1) {
    const distance = randomInt(200, 850);
    await page.mouse.wheel(0, distance);
    await sleep(randomInt(180, 700));
  }

  if (Math.random() < 0.35) {
    await page.mouse.wheel(0, -randomInt(120, 420));
  }

  log('info', 'Scroll interaction completed', {
    attempt,
    step: 'scroll',
    durationMs: elapsedMs(startedAt),
    passes
  });
}

async function tryClickInteractiveElement(page, attempt) {
  if (Math.random() > config.interactProbability) {
    log('info', 'Skip interactive click by probability', {
      attempt,
      step: 'click-interactive',
      probability: config.interactProbability
    });
    return false;
  }

  const startedAt = performance.now();
  const candidates = await page.$$('a[href], button, [role="button"], input[type="button"], input[type="submit"]');

  if (!candidates.length) {
    log('info', 'No interactive elements found', { attempt, step: 'click-interactive' });
    return false;
  }

  const shuffled = [...candidates].sort(() => Math.random() - 0.5).slice(0, 14);
  for (const element of shuffled) {
    try {
      const visible = await element.isVisible();
      if (!visible) {
        continue;
      }

      const canClick = await element.evaluate((el) => {
        if (el instanceof HTMLButtonElement) {
          return !el.disabled;
        }
        if (el instanceof HTMLInputElement) {
          return !el.disabled;
        }
        return !el.hasAttribute('disabled');
      });

      if (!canClick) {
        continue;
      }

      const box = await element.boundingBox();
      if (!box || box.width < 8 || box.height < 8) {
        continue;
      }

      const tagName = await element.evaluate((el) => el.tagName.toLowerCase());
      await element.scrollIntoViewIfNeeded();
      await sleep(randomInt(80, 360));
      await element.click({ delay: randomInt(40, 170), timeout: 3000 });

      log('info', 'Clicked interactive element', {
        attempt,
        step: 'click-interactive',
        durationMs: elapsedMs(startedAt),
        tagName
      });

      return true;
    } catch {
      continue;
    }
  }

  log('info', 'Interactive click not performed', {
    attempt,
    step: 'click-interactive',
    durationMs: elapsedMs(startedAt)
  });

  return false;
}

async function tryInternalLinkHop(page, attempt) {
  if (Math.random() > config.linkHopProbability) {
    log('info', 'Skip internal hop by probability', {
      attempt,
      step: 'link-hop',
      probability: config.linkHopProbability
    });
    return false;
  }

  const startedAt = performance.now();
  const anchors = await page.$$('a[href]');

  if (!anchors.length) {
    log('info', 'No anchor elements found', { attempt, step: 'link-hop' });
    return false;
  }

  const candidates = [];
  for (const anchor of anchors) {
    try {
      const href = await anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
        continue;
      }

      const resolved = new URL(href, page.url());
      if (resolved.origin !== targetUrl.origin) {
        continue;
      }

      const visible = await anchor.isVisible();
      if (!visible) {
        continue;
      }

      const box = await anchor.boundingBox();
      if (!box || box.width < 8 || box.height < 8) {
        continue;
      }

      candidates.push({ anchor, href: resolved.toString() });
    } catch {
      continue;
    }
  }

  if (!candidates.length) {
    log('info', 'No internal links suitable for hop', {
      attempt,
      step: 'link-hop',
      durationMs: elapsedMs(startedAt)
    });
    return false;
  }

  const chosen = pickRandom(candidates);
  const beforeUrl = page.url();

  await chosen.anchor.scrollIntoViewIfNeeded();
  await sleep(randomInt(100, 380));
  await chosen.anchor.click({ delay: randomInt(50, 180), timeout: 3500 });
  await waitForStableLoad(page, attempt, 'link-hop:navigate');
  await waitWithJitter(attempt, 'link-hop:dwell');

  const afterUrl = page.url();
  if (afterUrl !== beforeUrl) {
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
    await waitForStableLoad(page, attempt, 'link-hop:return');
  }

  log('info', 'Internal link hop finished', {
    attempt,
    step: 'link-hop',
    durationMs: elapsedMs(startedAt),
    beforeUrl,
    afterUrl,
    selectedHref: chosen.href
  });

  return true;
}

async function runWakeAttempt(attempt) {
  const startedAt = performance.now();
  const userAgent = pickRandom(USER_AGENTS);
  const viewport = pickRandom(VIEWPORTS);

  log('info', 'Attempt started', {
    attempt,
    step: 'attempt:start',
    userAgent,
    viewport
  });

  let browser;
  let context;
  let page;

  try {
    browser = await chromium.launch({
      headless: config.headless,
      args: ['--disable-blink-features=AutomationControlled']
    });

    context = await browser.newContext({
      userAgent,
      viewport,
      locale: config.locale,
      timezoneId: config.timezone,
      extraHTTPHeaders: {
        'Accept-Language': `${config.locale},en;q=0.8`
      }
    });

    page = await context.newPage();
    page.setDefaultTimeout(config.actionTimeoutMs);

    const destination = cacheBustedUrl();
    log('info', 'Navigating to target', {
      attempt,
      step: 'goto',
      url: destination
    });

    await page.goto(destination, {
      waitUntil: 'domcontentloaded',
      timeout: config.navigationTimeoutMs
    });

    await waitForStableLoad(page, attempt, 'goto');
    await waitWithJitter(attempt, 'post-goto');

    await moveMouseHumanLike(page, attempt);
    await waitWithJitter(attempt, 'post-mouse');

    await scrollPage(page, attempt);
    await waitWithJitter(attempt, 'post-scroll');

    await tryClickInteractiveElement(page, attempt);
    await waitWithJitter(attempt, 'post-interact');

    await tryInternalLinkHop(page, attempt);
    await waitWithJitter(attempt, 'pre-screenshot');

    await page.screenshot({ path: 'wake-proof.png', fullPage: true });

    log('info', 'Attempt succeeded', {
      attempt,
      step: 'attempt:success',
      durationMs: elapsedMs(startedAt),
      finalUrl: page.url()
    });
  } catch (error) {
    if (page) {
      try {
        await page.screenshot({ path: 'wake-proof.png', fullPage: true });
        log('warn', 'Captured screenshot after failure', {
          attempt,
          step: 'attempt:failure-screenshot'
        });
      } catch {
        log('warn', 'Failed to capture screenshot after error', {
          attempt,
          step: 'attempt:failure-screenshot'
        });
      }
    }

    log('error', 'Attempt failed', {
      attempt,
      step: 'attempt:failed',
      durationMs: elapsedMs(startedAt),
      error: error instanceof Error ? error.message : String(error)
    });

    throw error;
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

async function main() {
  const startedAt = performance.now();

  log('info', 'Wake runner started', {
    step: 'runner:start',
    targetUrl: targetUrl.toString(),
    locale: config.locale,
    timezone: config.timezone,
    retries: config.retries
  });

  let lastError;

  for (let attempt = 1; attempt <= config.retries; attempt += 1) {
    try {
      await runWakeAttempt(attempt);
      log('info', 'Wake runner finished successfully', {
        step: 'runner:done',
        durationMs: elapsedMs(startedAt),
        attempt
      });
      return;
    } catch (error) {
      lastError = error;

      if (attempt >= config.retries) {
        break;
      }

      const backoffMs = config.retryBaseMs * attempt + randomInt(config.retryJitterMinMs, config.retryJitterMaxMs);
      log('warn', 'Retrying after backoff', {
        attempt,
        step: 'runner:retry-backoff',
        backoffMs
      });
      await sleep(backoffMs);
    }
  }

  log('error', 'All attempts failed', {
    step: 'runner:failed',
    durationMs: elapsedMs(startedAt),
    error: lastError instanceof Error ? lastError.message : String(lastError)
  });

  process.exit(1);
}

main().catch((error) => {
  log('error', 'Unhandled wake runner error', {
    step: 'runner:unhandled',
    error: error instanceof Error ? error.stack || error.message : String(error)
  });
  process.exit(1);
});
