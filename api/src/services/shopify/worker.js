const os = require('os');
const { Op } = require('sequelize');
const config = require('../../config');
const { getMasterModels } = require('../../models/master');
const jobQueue = require('./jobQueue');
const { handlers, loadContext } = require('./jobHandlers');
const { ShopifyAuthError } = require('./shopifyClient');
const connectionService = require('./connectionService');
const { isConfigured } = require('./shopifyUtils');

const POLL_MS = 3000;
const BATCH = 5;
// Every PM2 cluster instance runs a worker; jobs are claimed atomically so each runs once.
const WORKER_ID = `${os.hostname()}:${process.pid}`;

let timer = null;
let busy = false;
let tick = 0;
let pausedUntil = 0;

async function processJob(job) {
  let ctx = null;
  try {
    ctx = await loadContext(job);
    if (ctx.skip) {
      await job.update({ last_error: `Skipped: ${ctx.skip}` });
      await jobQueue.completeJob(job);
      return;
    }
    const handler = handlers[job.job_type];
    if (!handler) {
      const err = new Error(`Unknown job type ${job.job_type}`);
      err.retryable = false;
      throw err;
    }
    await handler(ctx);
    await jobQueue.completeJob(job);
  } catch (err) {
    if (err instanceof ShopifyAuthError && ctx?.connection) {
      await connectionService.markConnectionAuthError(ctx.db, ctx.tenantId, ctx.connection, err).catch(() => {});
    }
    const outcome = await jobQueue.failJob(job, err).catch(() => 'unknown');
    console.error(`[shopify] job ${job.job_type} ${job.id} ${outcome}: ${err.message}`);
  }
}

async function scheduleAutoSync() {
  const hours = config.shopify.autoSyncHours;
  if (!hours || hours <= 0) return;
  const { ShopifyShop } = getMasterModels();
  const cutoff = new Date(Date.now() - hours * 3600000);
  const due = await ShopifyShop.findAll({
    where: {
      status: 'connected',
      [Op.or]: [{ last_sync_at: null }, { last_sync_at: { [Op.lt]: cutoff } }],
    },
    attributes: ['tenant_id'],
    limit: 50,
  });
  for (const row of due) {
    await jobQueue.enqueue(row.tenant_id, 'full_sync', { reason: 'scheduled' }, {
      coalesceKey: `full:${row.tenant_id}`,
    });
  }
}

async function loop() {
  if (busy || Date.now() < pausedUntil) return;
  busy = true;
  try {
    tick += 1;
    if (tick % 20 === 1) await jobQueue.recoverStaleJobs();
    if (tick % 200 === 1) await scheduleAutoSync();
    if (tick % 1200 === 1) await jobQueue.cleanupOldJobs();
    const jobs = await jobQueue.claimJobs(WORKER_ID, BATCH);
    for (const job of jobs) await processJob(job);
  } catch (err) {
    const code = err?.original?.code || err?.parent?.code;
    if (code === 'ER_NO_SUCH_TABLE') {
      console.error('[shopify] worker paused: master Shopify tables missing (run npm run migrate:master)');
      pausedUntil = Date.now() + 5 * 60 * 1000;
    } else {
      console.error('[shopify] worker error:', err.message);
    }
  } finally {
    busy = false;
  }
}

function start() {
  if (timer) return;
  if (!config.shopify.workerEnabled) return;
  if (!isConfigured()) {
    if (config.shopify.apiKey) {
      console.warn('[shopify] worker not started: set SHOPIFY_API_SECRET, SHOPIFY_APP_URL and a valid SHOPIFY_TOKEN_ENCRYPTION_KEY');
    }
    return;
  }
  timer = setInterval(loop, POLL_MS);
  timer.unref();
  console.log(`[shopify] sync worker started (${WORKER_ID})`);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, processJob };
