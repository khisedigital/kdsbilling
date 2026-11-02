const AppError = require('../utils/AppError');

function addDays(baseDate, days) {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + days);
  return d;
}

function addYears(baseDate, years) {
  const d = new Date(baseDate);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

function parseAllowedYears(value) {
  if (Array.isArray(value)) return value.map(Number).filter((n) => n > 0);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(Number).filter((n) => n > 0) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function serializePlan(plan) {
  const row = plan.toJSON ? plan.toJSON() : plan;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    maxBranches: row.max_branches,
    maxUsers: row.max_users,
    isTrial: row.is_trial,
    trialDays: row.trial_days,
    priceMonthly: row.price_monthly,
    priceYearly: row.price_yearly,
    status: row.status,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildTenantSubscriptionFromPlan(plan, subscriptionYears, startDate = new Date()) {
  const limits = {
    plan_id: plan.id,
    max_branches: plan.max_branches,
    max_users: plan.max_users,
  };

  if (plan.is_trial) {
    if (!plan.trial_days || plan.trial_days < 1) {
      throw new AppError('Trial plan must have trial days configured', 400, 'VALIDATION_ERROR');
    }
    return {
      ...limits,
      status: 'trial',
      subscription_years: null,
      trial_ends_at: addDays(startDate, plan.trial_days),
      subscription_ends_at: null,
    };
  }

  const years = Number(subscriptionYears);
  if (!years || years < 1) {
    throw new AppError('Subscription years is required for paid plans', 400, 'VALIDATION_ERROR');
  }

  return {
    ...limits,
    status: 'active',
    subscription_years: years,
    trial_ends_at: null,
    subscription_ends_at: addYears(startDate, years),
  };
}

module.exports = {
  addDays,
  addYears,
  parseAllowedYears,
  serializePlan,
  buildTenantSubscriptionFromPlan,
};
