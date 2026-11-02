const { Op } = require('sequelize');
const AppError = require('../utils/AppError');
const { getMasterModels } = require('../models/master');
const { serializePlan, buildTenantSubscriptionFromPlan } = require('../utils/planHelpers');

async function listPlans(query = {}) {
  const { SubscriptionPlan } = getMasterModels();
  const where = {};
  if (query.status) where.status = query.status;
  if (query.activeOnly === 'true' || query.activeOnly === true) where.status = 'active';

  const plans = await SubscriptionPlan.findAll({
    where,
    order: [
      ['sort_order', 'ASC'],
      ['name', 'ASC'],
    ],
  });
  return plans.map(serializePlan);
}

async function getPlan(id) {
  const { SubscriptionPlan } = getMasterModels();
  const plan = await SubscriptionPlan.findByPk(id);
  if (!plan) throw new AppError('Plan not found', 404, 'NOT_FOUND');
  return serializePlan(plan);
}

async function getPlanModel(id) {
  const { SubscriptionPlan } = getMasterModels();
  const plan = await SubscriptionPlan.findByPk(id);
  if (!plan) throw new AppError('Plan not found', 404, 'NOT_FOUND');
  if (plan.status !== 'active') throw new AppError('Plan is not active', 400, 'VALIDATION_ERROR');
  return plan;
}

async function createPlan(data) {
  const { SubscriptionPlan } = getMasterModels();

  if (!data.name?.trim()) throw new AppError('Plan name is required', 400, 'VALIDATION_ERROR');
  if (!data.code?.trim()) throw new AppError('Plan code is required', 400, 'VALIDATION_ERROR');

  const isTrial = Boolean(data.isTrial);
  const trialDays = data.trialDays != null ? Number(data.trialDays) : null;

  if (isTrial && (!trialDays || trialDays < 1)) {
    throw new AppError('Trial plans require trial days', 400, 'VALIDATION_ERROR');
  }

  const plan = await SubscriptionPlan.create({
    code: data.code.trim().toLowerCase(),
    name: data.name.trim(),
    description: data.description || null,
    max_branches: Number(data.maxBranches) || 1,
    max_users: Number(data.maxUsers) || 5,
    is_trial: isTrial,
    trial_days: isTrial ? trialDays : null,
    allowed_subscription_years: [],
    price_monthly: data.priceMonthly ?? null,
    price_yearly: data.priceYearly ?? null,
    status: data.status || 'active',
    sort_order: Number(data.sortOrder) || 0,
  });

  return serializePlan(plan);
}

async function updatePlan(id, data) {
  const { SubscriptionPlan } = getMasterModels();
  const plan = await SubscriptionPlan.findByPk(id);
  if (!plan) throw new AppError('Plan not found', 404, 'NOT_FOUND');

  const isTrial = data.isTrial !== undefined ? Boolean(data.isTrial) : plan.is_trial;
  const updates = {};

  if (data.name !== undefined) updates.name = data.name.trim();
  if (data.code !== undefined) updates.code = data.code.trim().toLowerCase();
  if (data.description !== undefined) updates.description = data.description || null;
  if (data.maxBranches !== undefined) updates.max_branches = Number(data.maxBranches);
  if (data.maxUsers !== undefined) updates.max_users = Number(data.maxUsers);
  if (data.isTrial !== undefined) updates.is_trial = isTrial;
  if (data.trialDays !== undefined) updates.trial_days = isTrial ? Number(data.trialDays) : null;
  if (data.priceMonthly !== undefined) updates.price_monthly = data.priceMonthly;
  if (data.priceYearly !== undefined) updates.price_yearly = data.priceYearly;
  if (data.status !== undefined) updates.status = data.status;
  if (data.sortOrder !== undefined) updates.sort_order = Number(data.sortOrder);

  const nextTrial = updates.is_trial ?? plan.is_trial;
  const nextTrialDays = updates.trial_days !== undefined ? updates.trial_days : plan.trial_days;

  if (nextTrial && (!nextTrialDays || nextTrialDays < 1)) {
    throw new AppError('Trial plans require trial days', 400, 'VALIDATION_ERROR');
  }

  await plan.update(updates);
  return serializePlan(plan);
}

async function deletePlan(id) {
  const { SubscriptionPlan, Tenant } = getMasterModels();
  const plan = await SubscriptionPlan.findByPk(id);
  if (!plan) throw new AppError('Plan not found', 404, 'NOT_FOUND');

  const inUse = await Tenant.count({ where: { plan_id: id } });
  if (inUse > 0) {
    await plan.update({ status: 'inactive' });
    return { deactivated: true, message: 'Plan has tenants — marked inactive instead of deleted' };
  }

  await plan.destroy();
  return { deleted: true };
}

async function applyPlanToTenant(planId, subscriptionYears) {
  const plan = await getPlanModel(planId);
  return buildTenantSubscriptionFromPlan(plan, subscriptionYears);
}

module.exports = {
  listPlans,
  getPlan,
  getPlanModel,
  createPlan,
  updatePlan,
  deletePlan,
  applyPlanToTenant,
};
