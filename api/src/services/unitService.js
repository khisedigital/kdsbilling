const { Op } = require('sequelize');
const AppError = require('../utils/AppError');
const { getMasterModels } = require('../models/master');

const UNIT_TYPES = ['count', 'weight', 'volume', 'length'];

function serializeUnit(unit) {
  const row = unit.toJSON ? unit.toJSON() : unit;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    baseUnitId: row.base_unit_id,
    conversionFactor: row.conversion_factor != null ? Number(row.conversion_factor) : 1,
    status: row.status,
    sortOrder: row.sort_order,
    baseUnit: row.baseUnit ? {
      id: row.baseUnit.id,
      code: row.baseUnit.code,
      name: row.baseUnit.name,
    } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listUnits(query = {}) {
  const { MasterUnit } = getMasterModels();
  const where = {};
  if (query.status) where.status = query.status;
  if (query.activeOnly === 'true' || query.activeOnly === true) where.status = 'active';

  const units = await MasterUnit.findAll({
    where,
    include: [{ model: MasterUnit, as: 'baseUnit', attributes: ['id', 'code', 'name'], required: false }],
    order: [['sort_order', 'ASC'], ['type', 'ASC'], ['name', 'ASC']],
  });
  return units.map(serializeUnit);
}

async function getUnit(id) {
  const { MasterUnit } = getMasterModels();
  const unit = await MasterUnit.findByPk(id, {
    include: [{ model: MasterUnit, as: 'baseUnit', attributes: ['id', 'code', 'name'], required: false }],
  });
  if (!unit) throw new AppError('Unit not found', 404, 'NOT_FOUND');
  return serializeUnit(unit);
}

async function createUnit(data) {
  const { MasterUnit } = getMasterModels();

  if (!data.code?.trim()) throw new AppError('Unit code is required', 400, 'VALIDATION_ERROR');
  if (!data.name?.trim()) throw new AppError('Unit name is required', 400, 'VALIDATION_ERROR');
  if (!data.type || !UNIT_TYPES.includes(data.type)) {
    throw new AppError(`Unit type must be one of: ${UNIT_TYPES.join(', ')}`, 400, 'VALIDATION_ERROR');
  }

  const code = data.code.trim().toLowerCase();
  const existing = await MasterUnit.findOne({ where: { code } });
  if (existing) throw new AppError('Unit code already exists', 409, 'DUPLICATE_ENTRY');

  if (data.baseUnitId) {
    const base = await MasterUnit.findByPk(data.baseUnitId);
    if (!base) throw new AppError('Base unit not found', 400, 'VALIDATION_ERROR');
  }

  const unit = await MasterUnit.create({
    code,
    name: data.name.trim(),
    type: data.type,
    base_unit_id: data.baseUnitId || null,
    conversion_factor: data.conversionFactor != null ? Number(data.conversionFactor) : 1,
    status: data.status || 'active',
    sort_order: Number(data.sortOrder) || 0,
  });

  return getUnit(unit.id);
}

async function updateUnit(id, data) {
  const { MasterUnit } = getMasterModels();
  const unit = await MasterUnit.findByPk(id);
  if (!unit) throw new AppError('Unit not found', 404, 'NOT_FOUND');

  const updates = {};
  if (data.code !== undefined) {
    const code = data.code.trim().toLowerCase();
    const existing = await MasterUnit.findOne({ where: { code, id: { [Op.ne]: id } } });
    if (existing) throw new AppError('Unit code already exists', 409, 'DUPLICATE_ENTRY');
    updates.code = code;
  }
  if (data.name !== undefined) updates.name = data.name.trim();
  if (data.type !== undefined) {
    if (!UNIT_TYPES.includes(data.type)) {
      throw new AppError(`Unit type must be one of: ${UNIT_TYPES.join(', ')}`, 400, 'VALIDATION_ERROR');
    }
    updates.type = data.type;
  }
  if (data.baseUnitId !== undefined) {
    if (data.baseUnitId === id) {
      throw new AppError('Unit cannot be its own base unit', 400, 'VALIDATION_ERROR');
    }
    if (data.baseUnitId) {
      const base = await MasterUnit.findByPk(data.baseUnitId);
      if (!base) throw new AppError('Base unit not found', 400, 'VALIDATION_ERROR');
    }
    updates.base_unit_id = data.baseUnitId || null;
  }
  if (data.conversionFactor !== undefined) updates.conversion_factor = Number(data.conversionFactor);
  if (data.status !== undefined) updates.status = data.status;
  if (data.sortOrder !== undefined) updates.sort_order = Number(data.sortOrder);

  await unit.update(updates);
  return getUnit(id);
}

async function deleteUnit(id) {
  const { MasterUnit } = getMasterModels();
  const unit = await MasterUnit.findByPk(id);
  if (!unit) throw new AppError('Unit not found', 404, 'NOT_FOUND');

  const childCount = await MasterUnit.count({ where: { base_unit_id: id } });
  if (childCount) {
    throw new AppError('Unit is referenced as a base unit and cannot be deleted', 400, 'VALIDATION_ERROR');
  }

  await unit.destroy();
  return { deleted: true };
}

module.exports = {
  UNIT_TYPES,
  listUnits,
  getUnit,
  createUnit,
  updateUnit,
  deleteUnit,
};
