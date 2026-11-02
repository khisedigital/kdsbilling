'use strict';

const { v4: uuidv4 } = require('uuid');
const { BUSINESS_TYPE_CATALOGS } = require('../../data/clothingGiftingMasterCatalog');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const sequelize = queryInterface.sequelize;

    for (const catalog of BUSINESS_TYPE_CATALOGS) {
      const [existingTypes] = await sequelize.query(
        'SELECT id FROM business_types WHERE code = :code LIMIT 1',
        { replacements: { code: catalog.code } },
      );

      let businessTypeId = existingTypes[0]?.id;
      if (!businessTypeId) {
        businessTypeId = uuidv4();
        await queryInterface.bulkInsert('business_types', [{
          id: businessTypeId,
          code: catalog.code,
          name: catalog.name,
          description: catalog.description,
          status: 'active',
          sort_order: catalog.code === 'clothing' ? 10 : 11,
          created_at: now,
          updated_at: now,
        }]);
      } else {
        await sequelize.query(
          `UPDATE business_types
           SET name = :name, description = :description, status = 'active', updated_at = :now
           WHERE id = :id`,
          {
            replacements: {
              id: businessTypeId,
              name: catalog.name,
              description: catalog.description,
              now,
            },
          },
        );
      }

      const categoryIdByName = {};
      for (const cat of catalog.categories) {
        const [existingCats] = await sequelize.query(
          `SELECT id FROM master_categories
           WHERE business_type_id = :btId AND name = :name
           LIMIT 1`,
          { replacements: { btId: businessTypeId, name: cat.name } },
        );

        let categoryId = existingCats[0]?.id;
        if (!categoryId) {
          categoryId = uuidv4();
          await queryInterface.bulkInsert('master_categories', [{
            id: categoryId,
            business_type_id: businessTypeId,
            name: cat.name,
            description: cat.description || null,
            status: 'active',
            sort_order: cat.sortOrder || 0,
            created_at: now,
            updated_at: now,
          }]);
        }
        categoryIdByName[cat.name] = categoryId;
      }

      // Detect optional brand_id column (added in later migration)
      const [brandCols] = await sequelize.query(
        `SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'master_products'
           AND COLUMN_NAME = 'brand_id'`,
      );
      const hasBrandId = brandCols.length > 0;

      for (const product of catalog.products) {
        const categoryId = categoryIdByName[product.categoryName] || null;
        const [existingProducts] = await sequelize.query(
          `SELECT id FROM master_products
           WHERE business_type_id = :btId AND name = :name
           LIMIT 1`,
          { replacements: { btId: businessTypeId, name: product.name } },
        );
        if (existingProducts[0]) continue;

        const row = {
          id: uuidv4(),
          business_type_id: businessTypeId,
          category_id: categoryId,
          name: product.name,
          description: null,
          uom_code: product.uomCode || 'pcs',
          selling_price: 0,
          cost_price: 0,
          mrp: null,
          sku: null,
          barcode: null,
          status: 'active',
          sort_order: product.sortOrder || 0,
          created_at: now,
          updated_at: now,
        };
        if (hasBrandId) row.brand_id = null;

        await queryInterface.bulkInsert('master_products', [row]);
      }
    }
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;
    for (const catalog of BUSINESS_TYPE_CATALOGS) {
      const [types] = await sequelize.query(
        'SELECT id FROM business_types WHERE code = :code LIMIT 1',
        { replacements: { code: catalog.code } },
      );
      const businessTypeId = types[0]?.id;
      if (!businessTypeId) continue;

      await sequelize.query(
        'DELETE FROM master_products WHERE business_type_id = :id',
        { replacements: { id: businessTypeId } },
      );
      await sequelize.query(
        'DELETE FROM master_categories WHERE business_type_id = :id',
        { replacements: { id: businessTypeId } },
      );
      await sequelize.query(
        'DELETE FROM business_types WHERE id = :id',
        { replacements: { id: businessTypeId } },
      );
    }
  },
};
