'use strict';

const { DataTypes, QueryTypes } = require('sequelize');

module.exports = {
  async up(queryInterface) {
    const table = await queryInterface.describeTable('stock_ledger');
    if (!table.client_movement_id) {
      await queryInterface.addColumn('stock_ledger', 'client_movement_id', {
        type: DataTypes.STRING(128),
        allowNull: true,
      });
    }
    const indexes = await queryInterface.showIndex('stock_ledger');
    if (!indexes.some((index) => index.unique && index.fields?.length === 1
      && (index.fields[0].attribute || index.fields[0].name) === 'client_movement_id')) {
      await queryInterface.addIndex('stock_ledger', ['client_movement_id'], {
        name: 'stock_ledger_client_movement_id_unique',
        unique: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('stock_ledger');
    if (table.client_movement_id) {
      const [row] = await queryInterface.sequelize.query(
        'SELECT COUNT(*) AS count FROM stock_ledger WHERE client_movement_id IS NOT NULL',
        { type: QueryTypes.SELECT },
      );
      if (Number(row.count) > 0) throw new Error('Cannot remove recorded stock movement identities');
    }
    const indexes = await queryInterface.showIndex('stock_ledger');
    if (indexes.some((index) => index.name === 'stock_ledger_client_movement_id_unique')) {
      await queryInterface.removeIndex('stock_ledger', 'stock_ledger_client_movement_id_unique');
    }
    if (table.client_movement_id) await queryInterface.removeColumn('stock_ledger', 'client_movement_id');
  },
};
