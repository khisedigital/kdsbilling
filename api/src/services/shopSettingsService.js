const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getMasterModels } = require('../models/master');
const AppError = require('../utils/AppError');
const { normalizePhone } = require('../utils/phone');
const config = require('../config');

async function resolveDefaultBranch(db, preferredBranchId) {
  const { Branch } = db;
  if (preferredBranchId) {
    const preferred = await Branch.findOne({
      where: { id: preferredBranchId, status: 'active' },
    });
    if (preferred) return preferred;
  }
  const defaultBranch = await Branch.findOne({
    where: { is_default: true, status: 'active' },
  });
  if (defaultBranch) return defaultBranch;
  return Branch.findOne({ where: { status: 'active' }, order: [['created_at', 'ASC']] });
}

function serializeSettings(tenant, branch) {
  return {
    shopName: tenant.name,
    shopNameMr: branch?.name_mr || '',
    shopCode: tenant.slug,
    address: branch?.address || '',
    addressMr: branch?.address_mr || '',
    city: branch?.city || '',
    gstin: branch?.tax_registration_number || '',
    phone: branch?.phone || tenant.owner_mobile || '',
    billFooter: branch?.bill_footer || 'Thank you!',
    logoUrl: branch?.logo_url || null,
    branchId: branch?.id || null,
    branchName: branch?.name || null,
  };
}

async function getShopSettings(db, tenant, branchId) {
  const branch = await resolveDefaultBranch(db, branchId);
  if (!branch) throw new AppError('No branch found', 404, 'NO_BRANCH');

  // Keep bill phone filled from owner mobile when shop phone was never set
  if (!branch.phone && tenant.owner_mobile) {
    await branch.update({ phone: String(tenant.owner_mobile).trim() });
    await branch.reload();
  }

  return serializeSettings(tenant, branch);
}

async function updateShopSettings(db, tenant, branchId, data = {}) {
  const { Tenant } = getMasterModels();
  const branch = await resolveDefaultBranch(db, branchId);
  if (!branch) throw new AppError('No branch found', 404, 'NO_BRANCH');

  const branchUpdates = {};

  if (data.shopName !== undefined) {
    const shopName = String(data.shopName || '').trim();
    if (!shopName) throw new AppError('Shop name is required', 400, 'VALIDATION_ERROR');
    if (shopName.length > 150) throw new AppError('Shop name is too long', 400, 'VALIDATION_ERROR');
    await Tenant.update({ name: shopName }, { where: { id: tenant.id } });
    await tenant.update({ name: shopName });
  }

  if (data.address !== undefined) branchUpdates.address = String(data.address || '').trim() || null;
  if (data.shopNameMr !== undefined) {
    const nameMr = String(data.shopNameMr || '').trim();
    if (nameMr.length > 150) throw new AppError('Marathi shop name is too long', 400, 'VALIDATION_ERROR');
    branchUpdates.name_mr = nameMr || null;
  }
  if (data.addressMr !== undefined) {
    const addressMr = String(data.addressMr || '').trim();
    if (addressMr.length > 500) throw new AppError('Marathi address is too long', 400, 'VALIDATION_ERROR');
    branchUpdates.address_mr = addressMr || null;
  }
  if (data.city !== undefined) branchUpdates.city = String(data.city || '').trim() || null;
  if (data.gstin !== undefined) {
    branchUpdates.tax_registration_number = String(data.gstin || '').trim().toUpperCase() || null;
  }
  if (data.phone !== undefined) {
    const raw = String(data.phone || '').trim();
    if (!raw) {
      branchUpdates.phone = null;
    } else {
      const phone = normalizePhone(raw);
      if (!phone) throw new AppError('Enter a valid 10-digit shop phone', 400, 'VALIDATION_ERROR');
      branchUpdates.phone = phone;
    }
  }
  if (data.billFooter !== undefined) {
    const footer = String(data.billFooter || '').trim();
    if (footer.length > 255) throw new AppError('Bill footer is too long', 400, 'VALIDATION_ERROR');
    branchUpdates.bill_footer = footer || null;
  }

  if (Object.keys(branchUpdates).length) {
    await branch.update(branchUpdates);
  }

  await branch.reload();
  return serializeSettings(tenant, branch);
}

function ensureLogoDir(tenantSlug) {
  const dir = path.join(config.uploadPath, tenantSlug, 'logo');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function uploadShopLogo(db, tenant, branchId, file) {
  if (!file?.buffer) throw new AppError('Image file is required', 400, 'VALIDATION_ERROR');

  const branch = await resolveDefaultBranch(db, branchId);
  if (!branch) throw new AppError('No branch found', 404, 'NO_BRANCH');

  if (branch.logo_url?.startsWith('/uploads/')) {
    const oldRel = branch.logo_url.replace(/^\/uploads\//, '');
    const oldPath = path.join(config.uploadPath, oldRel);
    if (fs.existsSync(oldPath)) {
      try {
        fs.unlinkSync(oldPath);
      } catch {
        // ignore cleanup errors
      }
    }
  }

  const dir = ensureLogoDir(tenant.slug);
  const ext = path.extname(file.originalname) || '.jpg';
  const fileName = `${uuidv4()}${ext}`;
  fs.writeFileSync(path.join(dir, fileName), file.buffer);

  const relativePath = `${tenant.slug}/logo/${fileName}`.replace(/\\/g, '/');
  const logoUrl = `/uploads/${relativePath}`;
  await branch.update({ logo_url: logoUrl });

  return serializeSettings(tenant, branch);
}

async function removeShopLogo(db, tenant, branchId) {
  const branch = await resolveDefaultBranch(db, branchId);
  if (!branch) throw new AppError('No branch found', 404, 'NO_BRANCH');

  if (branch.logo_url?.startsWith('/uploads/')) {
    const oldRel = branch.logo_url.replace(/^\/uploads\//, '');
    const oldPath = path.join(config.uploadPath, oldRel);
    if (fs.existsSync(oldPath)) {
      try {
        fs.unlinkSync(oldPath);
      } catch {
        // ignore
      }
    }
  }

  await branch.update({ logo_url: null });
  await branch.reload();
  return serializeSettings(tenant, branch);
}

module.exports = {
  getShopSettings,
  updateShopSettings,
  uploadShopLogo,
  removeShopLogo,
  resolveDefaultBranch,
  serializeSettings,
};
