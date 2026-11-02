const { Op } = require('sequelize');
const { getMasterModels } = require('../../models/master');
const { errorMessage } = require('./shopifyUtils');

const STALE_LOCK_MS = 15 * 60 * 1000;
const FULL_SYNC_STALE_MS = 45 * 60 * 1000;
/** Keys prefixed with `c:` coalesce while pending and are released once a worker picks the job up. */
const COALESCE_PREFIX = 'c:';

function isUniqueViolation(err) {
  return err?.name === 'SequelizeUniqueConstraintError';
}

/**
 * Inserts a job. Returns the job, or null when an identical job (same dedupe key)
 * already exists — this is how webhook retries and bursts are made idempotent.
 */
async function enqueue(tenantId, jobType, payload = {}, options = {}) {
  const { ShopifySyncJob } = getMasterModels();
  const dedupeKey = options.coalesceKey
    ? `${COALESCE_PREFIX}${options.coalesceKey}`
    : options.dedupeKey || null;
  try {
    return await ShopifySyncJob.create({
      tenant_id: tenantId,
      job_type: jobType,
      payload,
      dedupe_key: dedupeKey ? dedupeKey.slice(0, 191) : null,
      status: 'pending',
      attempts: 0,
      max_attempts: options.maxAttempts || 8,
      run_after: options.runAfter || new Date(),
    });
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

async function claimJobs(workerId, limit = 5) {
  const { ShopifySyncJob, sequelize } = getMasterModels();
  const candidates = await ShopifySyncJob.findAll({
    attributes: ['id'],
    where: { status: 'pending', run_after: { [Op.lte]: new Date() } },
    order: [['run_after', 'ASC']],
    limit: limit * 2,
  });

  const claimed = [];
  for (const { id } of candidates) {
    if (claimed.length >= limit) break;
    const [affected] = await ShopifySyncJob.update(
      {
        status: 'running',
        locked_at: new Date(),
        locked_by: workerId,
        attempts: sequelize.literal('attempts + 1'),
        dedupe_key: sequelize.literal(
          `CASE WHEN dedupe_key LIKE '${COALESCE_PREFIX}%' THEN NULL ELSE dedupe_key END`
        ),
      },
      { where: { id, status: 'pending' } }
    );
    if (affected === 1) {
      claimed.push(await ShopifySyncJob.findByPk(id));
    }
  }
  return claimed.filter(Boolean);
}

async function completeJob(job) {
  await job.update({ status: 'done', completed_at: new Date(), locked_at: null, last_error: null });
}

function retryDelayMs(attempts) {
  return Math.min(30 * 60 * 1000, 15000 * 2 ** Math.max(0, attempts - 1));
}

async function failJob(job, err) {
  const retryable = err?.retryable !== false;
  const exhausted = job.attempts >= job.max_attempts;
  if (retryable && !exhausted) {
    await job.update({
      status: 'pending',
      locked_at: null,
      locked_by: null,
      last_error: errorMessage(err),
      run_after: new Date(Date.now() + retryDelayMs(job.attempts)),
    });
    return 'retry';
  }
  await job.update({
    status: 'failed',
    locked_at: null,
    last_error: errorMessage(err),
    completed_at: new Date(),
  });
  return 'failed';
}

async function recoverStaleJobs() {
  const { ShopifySyncJob } = getMasterModels();
  const now = Date.now();
  const [count] = await ShopifySyncJob.update(
    { status: 'pending', locked_at: null, locked_by: null, last_error: 'Recovered after worker stopped' },
    {
      where: {
        status: 'running',
        [Op.or]: [
          { job_type: { [Op.ne]: 'full_sync' }, locked_at: { [Op.lt]: new Date(now - STALE_LOCK_MS) } },
          { job_type: 'full_sync', locked_at: { [Op.lt]: new Date(now - FULL_SYNC_STALE_MS) } },
        ],
      },
    }
  );
  return count;
}

/** Long-running jobs refresh their lock so other workers don't treat them as abandoned. */
async function heartbeat(job) {
  await job.update({ locked_at: new Date() });
}

async function cleanupOldJobs() {
  const { ShopifySyncJob } = getMasterModels();
  const now = Date.now();
  await ShopifySyncJob.destroy({
    where: { status: 'done', completed_at: { [Op.lt]: new Date(now - 7 * 86400000) } },
  });
  await ShopifySyncJob.destroy({
    where: { status: 'failed', completed_at: { [Op.lt]: new Date(now - 30 * 86400000) } },
  });
}

async function hasPendingJob(tenantId, jobTypes) {
  const { ShopifySyncJob } = getMasterModels();
  const count = await ShopifySyncJob.count({
    where: {
      tenant_id: tenantId,
      job_type: Array.isArray(jobTypes) ? { [Op.in]: jobTypes } : jobTypes,
      status: { [Op.in]: ['pending', 'running'] },
    },
  });
  return count > 0;
}

async function cancelPendingJobs(tenantId, reason) {
  const { ShopifySyncJob } = getMasterModels();
  await ShopifySyncJob.update(
    { status: 'failed', last_error: reason, completed_at: new Date(), dedupe_key: null },
    { where: { tenant_id: tenantId, status: 'pending' } }
  );
}

async function jobStats(tenantIds = null) {
  const { ShopifySyncJob, sequelize } = getMasterModels();
  const where = { status: { [Op.in]: ['pending', 'running', 'failed'] } };
  if (tenantIds) where.tenant_id = { [Op.in]: tenantIds };
  const rows = await ShopifySyncJob.findAll({
    attributes: ['tenant_id', 'status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    where,
    group: ['tenant_id', 'status'],
    raw: true,
  });
  const stats = new Map();
  for (const row of rows) {
    const entry = stats.get(row.tenant_id) || { pending: 0, running: 0, failed: 0 };
    entry[row.status] = Number(row.count) || 0;
    stats.set(row.tenant_id, entry);
  }
  return stats;
}

module.exports = {
  enqueue,
  claimJobs,
  completeJob,
  failJob,
  recoverStaleJobs,
  heartbeat,
  cleanupOldJobs,
  hasPendingJob,
  cancelPendingJobs,
  jobStats,
};
