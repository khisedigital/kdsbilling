'use strict';

/** Speeds up variant barcode lookups used by label printing / generation. */
module.exports = {
  async up(queryInterface) {
    const indexes = await queryInterface.showIndex('barcodes');
    const hasVariantIndex = (indexes || []).some(
      (idx) =>
        idx.name === 'barcodes_variant_id' ||
        (Array.isArray(idx.fields) && idx.fields.map((f) => f.attribute || f).join(',') === 'variant_id')
    );
    if (!hasVariantIndex) {
      await queryInterface.addIndex('barcodes', ['variant_id'], { name: 'barcodes_variant_id' });
    }
  },

  async down(queryInterface) {
    try {
      await queryInterface.removeIndex('barcodes', 'barcodes_variant_id');
    } catch {
      // index may not exist on older DBs
    }
  },
};
