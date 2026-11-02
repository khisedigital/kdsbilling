'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('master_brands', {
      id: { type: Sequelize.UUID, primaryKey: true },
      business_type_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'business_types', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      name: { type: Sequelize.STRING(150), allowNull: false },
      description: { type: Sequelize.TEXT },
      status: { type: Sequelize.ENUM('active', 'inactive'), defaultValue: 'active' },
      sort_order: { type: Sequelize.INTEGER, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('master_brands', ['business_type_id', 'name'], {
      unique: true,
      name: 'master_brands_business_type_name',
    });

    await queryInterface.addColumn('master_products', 'brand_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'master_brands', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('master_products', 'brand_id');
    await queryInterface.dropTable('master_brands');
  },
};
