'use strict';

const { DataTypes, QueryTypes } = require('sequelize');

module.exports = {
  async up(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (!tables.some((table) => (typeof table === 'string' ? table : table.tableName) === 'catalog_sync_identities')) {
      await queryInterface.createTable('catalog_sync_identities', {
        device_id: { type: DataTypes.STRING(128), allowNull: false, primaryKey: true },
        entity_type: { type: DataTypes.STRING(16), allowNull: false, primaryKey: true },
        local_id: { type: DataTypes.STRING(128), allowNull: false, primaryKey: true },
        server_id: { type: DataTypes.UUID, allowNull: false },
        opening_quantity: { type: DataTypes.DECIMAL(15, 3), allowNull: true },
        opening_branch_id: { type: DataTypes.UUID, allowNull: true },
      });
    }
    const columns = await queryInterface.describeTable('catalog_sync_identities');
    if (!columns.opening_quantity) {
      await queryInterface.addColumn('catalog_sync_identities', 'opening_quantity', {
        type: DataTypes.DECIMAL(15, 3), allowNull: true,
      });
    }
    if (!columns.opening_branch_id) {
      await queryInterface.addColumn('catalog_sync_identities', 'opening_branch_id', {
        type: DataTypes.UUID, allowNull: true,
      });
    }
    const indexes = await queryInterface.showIndex('catalog_sync_identities');
    if (!indexes.some((index) => index.name === 'catalog_sync_identities_server_unique')) {
      await queryInterface.addIndex('catalog_sync_identities', ['device_id', 'entity_type', 'server_id'], {
        unique: true,
        name: 'catalog_sync_identities_server_unique',
      });
    }
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (!tables.some((table) => (typeof table === 'string' ? table : table.tableName) === 'catalog_sync_identities')) return;
    const [row] = await queryInterface.sequelize.query(
      'SELECT COUNT(*) AS count FROM catalog_sync_identities',
      { type: QueryTypes.SELECT },
    );
    if (Number(row.count) > 0) throw new Error('Cannot remove recorded catalog sync identities');
    await queryInterface.dropTable('catalog_sync_identities');
  },
};
