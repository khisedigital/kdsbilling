'use strict';

const { DataTypes } = require('sequelize');

/** Desktop offline sync: idempotent createBill via client-generated UUID. */
module.exports = {
  async up(queryInterface) {
    const table = await queryInterface.describeTable('sales_orders');
    if (!table.client_bill_id) {
      await queryInterface.addColumn('sales_orders', 'client_bill_id', {
        type: DataTypes.UUID,
        allowNull: true,
        defaultValue: null,
      });
    }
    const indexes = await queryInterface.showIndex('sales_orders');
    const hasUnique = (indexes || []).some(
      (idx) => idx.name === 'sales_orders_client_bill_id_unique'
        || (idx.unique && (idx.fields || []).some((f) => (f.attribute || f.name || f) === 'client_bill_id')),
    );
    if (!hasUnique) {
      await queryInterface.addIndex('sales_orders', ['client_bill_id'], {
        unique: true,
        name: 'sales_orders_client_bill_id_unique',
      });
    }
  },

  async down(queryInterface) {
    const indexes = await queryInterface.showIndex('sales_orders');
    const hasUnique = (indexes || []).some((idx) => idx.name === 'sales_orders_client_bill_id_unique');
    if (hasUnique) {
      await queryInterface.removeIndex('sales_orders', 'sales_orders_client_bill_id_unique');
    }
    const table = await queryInterface.describeTable('sales_orders');
    if (table.client_bill_id) {
      await queryInterface.removeColumn('sales_orders', 'client_bill_id');
    }
  },
};
