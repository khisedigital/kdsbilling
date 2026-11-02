const bcrypt = require('bcrypt');
const { Op } = require('sequelize');
const { getMasterModels } = require('../models/master');
const AppError = require('../utils/AppError');
const { normalizePhone, placeholderEmailForPhone } = require('../utils/phone');

async function getProfile(db, userId) {
  const { User, Role } = db;
  const user = await User.findOne({
    where: { id: userId, status: 'active' },
    include: [{ model: Role, as: 'role', attributes: ['name'] }],
  });
  if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role?.name || null,
  };
}

async function updateProfile(db, tenant, userId, { name, phone, mobile }) {
  const { User, Role } = db;
  const { Tenant, TenantUserIndex } = getMasterModels();

  const user = await User.findOne({
    where: { id: userId, status: 'active' },
    include: [{ model: Role, as: 'role', attributes: ['id', 'name'] }],
  });
  if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');

  const oldPhone = user.phone;
  const oldEmail = user.email;
  const updates = {};
  if (name !== undefined) {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    if (trimmed.length > 150) throw new AppError('Name is too long', 400, 'VALIDATION_ERROR');
    updates.name = trimmed;
  }

  let phoneChanged = false;
  let newPhone = null;
  if (phone !== undefined || mobile !== undefined) {
    newPhone = normalizePhone(phone || mobile);
    if (!newPhone) {
      throw new AppError('Enter a valid 10-digit mobile number', 400, 'VALIDATION_ERROR');
    }
    if (newPhone !== oldPhone) {
      const taken = await User.findOne({
        where: { phone: newPhone, id: { [Op.ne]: user.id } },
      });
      if (taken) {
        throw new AppError('This mobile number is already in use', 409, 'DUPLICATE_PHONE');
      }
      updates.phone = newPhone;
      phoneChanged = true;
      if (!oldEmail || oldEmail.endsWith('@shop.local')) {
        updates.email = placeholderEmailForPhone(newPhone);
      }
    }
  }

  if (Object.keys(updates).length) {
    await user.update(updates);
  }

  if (phoneChanged && newPhone) {
    const indexWhere = oldPhone
      ? { tenant_id: tenant.id, phone: oldPhone }
      : { tenant_id: tenant.id, email: oldEmail };

    const existingIndex = await TenantUserIndex.findOne({ where: indexWhere });
    if (existingIndex) {
      await existingIndex.update({
        phone: newPhone,
        email: updates.email || user.email || placeholderEmailForPhone(newPhone),
        status: 'active',
      });
    } else {
      await TenantUserIndex.create({
        tenant_id: tenant.id,
        phone: newPhone,
        email: updates.email || user.email || placeholderEmailForPhone(newPhone),
        status: 'active',
      });
    }

    if (user.role?.name === 'owner') {
      await Tenant.update({ owner_mobile: newPhone }, { where: { id: tenant.id } });
      await tenant.update({ owner_mobile: newPhone });
    }
  }

  await user.reload({ include: [{ model: Role, as: 'role', attributes: ['name'] }] });

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role?.name || null,
  };
}

async function changePassword(db, userId, { currentPassword, newPassword }) {
  if (!currentPassword || !newPassword) {
    throw new AppError('Current and new password are required', 400, 'VALIDATION_ERROR');
  }
  if (String(newPassword).length < 6) {
    throw new AppError('New password must be at least 6 characters', 400, 'VALIDATION_ERROR');
  }

  const { User, RefreshToken } = db;
  const user = await User.findOne({ where: { id: userId, status: 'active' } });
  if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) {
    throw new AppError('Current password is incorrect', 401, 'INVALID_PASSWORD');
  }

  const passwordHash = await bcrypt.hash(String(newPassword), 12);
  await user.update({ password_hash: passwordHash });

  await RefreshToken.update(
    { revoked_at: new Date() },
    { where: { user_id: userId, revoked_at: null } }
  );

  return { changed: true };
}

module.exports = { getProfile, updateProfile, changePassword };
