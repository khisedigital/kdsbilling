'use strict';

const { DataTypes } = require('sequelize');

/**
 * Add extra_settings JSON to branches to support all business types:
 * FSSAI number (food/grocery), Drug license (pharmacy), Trade license,
 * PAN, custom bill titles (Tax Invoice / Bill of Supply / Retail Invoice / Cash Memo),
 * tagline, UPI ID, terms & conditions, state, pincode, secondary phone, etc.
 */
module.exports = {
  async up(queryInterface) {
    const table = await queryInterface.describeTable('branches');
    if (!table.extra_settings) {
      await queryInterface.addColumn('branches', 'extra_settings', {
        type: DataTypes.JSON,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('branches');
    if (table.extra_settings) {
      await queryInterface.removeColumn('branches', 'extra_settings');
    }
  },
};
