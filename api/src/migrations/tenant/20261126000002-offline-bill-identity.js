'use strict';

const { DataTypes, QueryTypes } = require('sequelize');

module.exports = {
  async up(queryInterface) {
    const table = await queryInterface.describeTable('sales_orders');
    if (!table.device_id) {
      await queryInterface.addColumn('sales_orders', 'device_id', {
        type: DataTypes.STRING(128),
        allowNull: true,
      });
    }
    if (!table.sync_payload_hash) {
      await queryInterface.addColumn('sales_orders', 'sync_payload_hash', {
        type: DataTypes.STRING(64),
        allowNull: true,
      });
    }
    const indexes = await queryInterface.showIndex('sales_orders');
    for (const index of indexes) {
      if (index.unique && index.fields?.length === 1
        && (index.fields[0].attribute || index.fields[0].name) === 'bill_number') {
        await queryInterface.removeIndex('sales_orders', index.name);
      }
    }
  },

  async down(queryInterface) {
    const [row] = await queryInterface.sequelize.query(
      'SELECT COUNT(*) AS count FROM sales_orders WHERE device_id IS NOT NULL',
      { type: QueryTypes.SELECT },
    );
    if (Number(row.count) > 0) throw new Error('Cannot remove recorded offline bill device identities');
    const duplicates = await queryInterface.sequelize.query(
      'SELECT bill_number FROM sales_orders GROUP BY bill_number HAVING COUNT(*) > 1 LIMIT 1',
      { type: QueryTypes.SELECT },
    );
    if (duplicates.length) throw new Error('Cannot restore unique bill numbers while duplicates exist');
    await queryInterface.addIndex('sales_orders', ['bill_number'], { unique: true, name: 'sales_orders_bill_number_unique' });
    await queryInterface.removeColumn('sales_orders', 'sync_payload_hash');
    await queryInterface.removeColumn('sales_orders', 'device_id');
  },
};
