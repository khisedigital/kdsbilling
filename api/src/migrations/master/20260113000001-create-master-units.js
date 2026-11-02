'use strict';

const { v4: uuidv4 } = require('uuid');

const DEFAULT_UNITS = [
  { id: uuidv4(), code: 'pcs', name: 'Pieces', type: 'count', conversion_factor: 1, base_code: null },
  { id: uuidv4(), code: 'kg', name: 'Kilogram', type: 'weight', conversion_factor: 1, base_code: null },
  { id: uuidv4(), code: 'g', name: 'Gram', type: 'weight', conversion_factor: 0.001, base_code: 'kg' },
  { id: uuidv4(), code: 'ltr', name: 'Litre', type: 'volume', conversion_factor: 1, base_code: null },
  { id: uuidv4(), code: 'ml', name: 'Millilitre', type: 'volume', conversion_factor: 0.001, base_code: 'ltr' },
  { id: uuidv4(), code: 'm', name: 'Metre', type: 'length', conversion_factor: 1, base_code: null },
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('master_units', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
      },
      code: {
        type: Sequelize.STRING(10),
        allowNull: false,
        unique: true,
      },
      name: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      type: {
        type: Sequelize.ENUM('count', 'weight', 'volume', 'length'),
        allowNull: false,
      },
      base_unit_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'master_units', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      conversion_factor: {
        type: Sequelize.DECIMAL(15, 6),
        defaultValue: 1,
      },
      status: {
        type: Sequelize.ENUM('active', 'inactive'),
        defaultValue: 'active',
      },
      sort_order: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    const now = new Date();
    const byCode = {};
    for (const u of DEFAULT_UNITS) {
      byCode[u.code] = u.id;
    }

    await queryInterface.bulkInsert(
      'master_units',
      DEFAULT_UNITS.map((u, i) => ({
        id: u.id,
        code: u.code,
        name: u.name,
        type: u.type,
        base_unit_id: u.base_code ? byCode[u.base_code] : null,
        conversion_factor: u.conversion_factor,
        status: 'active',
        sort_order: i + 1,
        created_at: now,
        updated_at: now,
      }))
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('master_units');
  },
};
