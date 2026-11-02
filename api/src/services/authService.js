const bcrypt = require('bcrypt');
const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const { getMasterModels } = require('../models/master');
const tenantConnectionManager = require('../config/tenantConnectionManager');
const AppError = require('../utils/AppError');
const { normalizePhone } = require('../utils/phone');
const {
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} = require('../utils/token');

async function resolveTenant(shopCode) {
  let tenant;
  try {
    tenant = await tenantConnectionManager.getTenantBySlug(shopCode);
  } catch {
    throw new AppError('Shop not found. Check your shop code.', 404, 'SHOP_NOT_FOUND');
  }
  if (!['active', 'trial'].includes(tenant.status)) {
    throw new AppError('Shop account is suspended', 403, 'TENANT_SUSPENDED');
  }
  return tenant;
}

function resolveLoginIdentifier(body = {}) {
  const mobile = normalizePhone(body.mobile || body.phone);
  if (mobile) return { type: 'mobile', value: mobile };
  const email = body.email?.trim().toLowerCase();
  if (email) return { type: 'email', value: email };
  return null;
}

async function findUserIndex(tenantId, identifier) {
  const { TenantUserIndex } = getMasterModels();
  if (identifier.type === 'mobile') {
    return TenantUserIndex.findOne({
      where: { tenant_id: tenantId, phone: identifier.value, status: 'active' },
    });
  }
  return TenantUserIndex.findOne({
    where: { tenant_id: tenantId, email: identifier.value, status: 'active' },
  });
}

async function findTenantUser(db, identifier) {
  const { User, Role, Permission, Branch } = db;
  const where = identifier.type === 'mobile'
    ? { phone: identifier.value, status: 'active' }
    : { email: identifier.value, status: 'active' };

  return User.findOne({
    where,
    include: [
      {
        model: Role,
        as: 'role',
        include: [{ model: Permission, as: 'permissions' }],
      },
      {
        model: Branch,
        as: 'branches',
        through: { attributes: ['is_default'] },
      },
    ],
  });
}

async function login({ shopCode, mobile, phone, email, password, deviceInfo }) {
  const normalizedShopCode = shopCode?.trim().toLowerCase();
  const identifier = resolveLoginIdentifier({ mobile, phone, email });
  if (!normalizedShopCode || !identifier || !password) {
    throw new AppError('Shop code, mobile number and password are required', 400, 'VALIDATION_ERROR');
  }

  const tenant = await resolveTenant(normalizedShopCode);
  const userIndex = await findUserIndex(tenant.id, identifier);
  if (!userIndex) {
    throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
  }

  const models = await tenantConnectionManager.getTenantModels(tenant);
  const { RefreshToken } = models;
  const user = await findTenantUser(models, identifier);

  if (!user) {
    throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
  }

  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) {
    throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
  }

  const defaultBranch =
    user.branches.find((b) => b.UserBranch?.is_default) || user.branches[0];

  if (!defaultBranch) {
    throw new AppError('No branch assigned to user', 403, 'NO_BRANCH');
  }

  const permissions = user.role.permissions.map((p) => p.key);

  const tokenPayload = {
    sub: user.id,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    branchId: defaultBranch.id,
    role: user.role.name,
    permissions,
  };

  const accessToken = signAccessToken(tokenPayload);
  const refreshToken = signRefreshToken({
    sub: user.id,
    tenantId: tenant.id,
    type: 'refresh',
  });

  const refreshExpiry = new Date();
  refreshExpiry.setDate(refreshExpiry.getDate() + 7);

  await RefreshToken.create({
    user_id: user.id,
    token_hash: hashToken(refreshToken),
    expires_at: refreshExpiry,
    device_info: deviceInfo || null,
  });

  await user.update({ last_login_at: new Date() });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role.name,
      branch: {
        id: defaultBranch.id,
        name: defaultBranch.name,
        code: defaultBranch.code,
      },
      branches: user.branches.map((b) => ({
        id: b.id,
        name: b.name,
        code: b.code,
        isDefault: b.UserBranch?.is_default || false,
      })),
      permissions,
    },
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      currencyCode: tenant.currency_code,
      countryCode: tenant.country_code,
    },
  };
}

async function refresh(refreshToken) {
  if (!refreshToken) {
    throw new AppError('Refresh token required', 400, 'VALIDATION_ERROR');
  }

  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError('Invalid refresh token', 401, 'UNAUTHORIZED');
  }

  const tenant = await tenantConnectionManager.getTenantConfig(decoded.tenantId);
  const models = await tenantConnectionManager.getTenantModels(tenant);
  const { RefreshToken, User, Role, Permission, Branch } = models;

  const stored = await RefreshToken.findOne({
    where: {
      user_id: decoded.sub,
      token_hash: hashToken(refreshToken),
      revoked_at: null,
      expires_at: { [Op.gt]: new Date() },
    },
  });

  if (!stored) {
    throw new AppError('Invalid refresh token', 401, 'UNAUTHORIZED');
  }

  const user = await User.findOne({
    where: { id: decoded.sub, status: 'active' },
    include: [
      {
        model: Role,
        as: 'role',
        include: [{ model: Permission, as: 'permissions' }],
      },
      {
        model: Branch,
        as: 'branches',
        through: { attributes: ['is_default'] },
      },
    ],
  });

  if (!user) {
    throw new AppError('User not found', 401, 'UNAUTHORIZED');
  }

  const defaultBranch =
    user.branches.find((b) => b.UserBranch?.is_default) || user.branches[0];

  if (!defaultBranch) {
    throw new AppError('No branch assigned to user', 403, 'NO_BRANCH');
  }

  const permissions = user.role.permissions.map((p) => p.key);

  const accessToken = signAccessToken({
    sub: user.id,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    branchId: defaultBranch.id,
    role: user.role.name,
    permissions,
  });

  return { accessToken };
}

async function logout(refreshToken) {
  if (!refreshToken) return;

  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    return;
  }

  const tenant = await tenantConnectionManager.getTenantConfig(decoded.tenantId);
  const models = await tenantConnectionManager.getTenantModels(tenant);
  const { RefreshToken } = models;

  await RefreshToken.update(
    { revoked_at: new Date() },
    {
      where: {
        user_id: decoded.sub,
        token_hash: hashToken(refreshToken),
        revoked_at: null,
      },
    }
  );
}

async function verifyPin({ shopCode, userId, pin }) {
  const tenant = await resolveTenant(shopCode);
  const models = await tenantConnectionManager.getTenantModels(tenant);
  const { UserPin, User } = models;

  const userPin = await UserPin.findOne({
    where: { user_id: userId },
    include: [{ model: User, as: 'user' }],
  });

  if (!userPin) {
    throw new AppError('PIN not configured', 404, 'PIN_NOT_FOUND');
  }

  if (userPin.locked_until && userPin.locked_until > new Date()) {
    throw new AppError('PIN locked. Try again later', 423, 'PIN_LOCKED');
  }

  const valid = await bcrypt.compare(pin, userPin.pin_hash);
  if (!valid) {
    const attempts = userPin.failed_attempts + 1;
    const updates = { failed_attempts: attempts };
    if (attempts >= 5) {
      updates.locked_until = new Date(Date.now() + 15 * 60 * 1000);
      updates.failed_attempts = 0;
    }
    await userPin.update(updates);
    throw new AppError('Invalid PIN', 401, 'INVALID_PIN');
  }

  await userPin.update({ failed_attempts: 0, locked_until: null });
  return { verified: true, userId };
}

module.exports = {
  login,
  refresh,
  logout,
  verifyPin,
};
