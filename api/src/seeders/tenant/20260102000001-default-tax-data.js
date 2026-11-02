const { v4: uuidv4 } = require('uuid');

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    const jurisdictionId = uuidv4();
    await queryInterface.bulkInsert('tax_jurisdictions', [
      {
        id: jurisdictionId,
        country_code: 'IN',
        region_code: null,
        name: 'India - Default',
        status: 'active',
        created_at: now,
        updated_at: now,
      },
    ]);

    const taxTypes = [
      { code: 'VAT', name: 'Value Added Tax' },
      { code: 'GST', name: 'Goods & Services Tax' },
      { code: 'CGST', name: 'Central GST' },
      { code: 'SGST', name: 'State GST' },
      { code: 'IGST', name: 'Integrated GST' },
      { code: 'SALES_TAX', name: 'Sales Tax' },
    ];

    const taxTypeIds = {};
    for (const tt of taxTypes) {
      const id = uuidv4();
      taxTypeIds[tt.code] = id;
      await queryInterface.bulkInsert('tax_types', [
        { id, code: tt.code, name: tt.name, is_compound: false, created_at: now, updated_at: now },
      ]);
    }

    const taxGroups = [
      { name: 'Tax Exempt (0%)', total_rate: 0, components: [{ code: 'GST', rate: 0 }] },
      { name: 'GST 5%', total_rate: 5, components: [{ code: 'CGST', rate: 2.5 }, { code: 'SGST', rate: 2.5 }] },
      { name: 'GST 12%', total_rate: 12, components: [{ code: 'CGST', rate: 6 }, { code: 'SGST', rate: 6 }] },
      { name: 'GST 18%', total_rate: 18, components: [{ code: 'CGST', rate: 9 }, { code: 'SGST', rate: 9 }] },
      { name: 'VAT 10%', total_rate: 10, components: [{ code: 'VAT', rate: 10 }] },
    ];

    for (const group of taxGroups) {
      const groupId = uuidv4();
      await queryInterface.bulkInsert('tax_groups', [
        {
          id: groupId,
          jurisdiction_id: jurisdictionId,
          name: group.name,
          total_rate: group.total_rate,
          status: 'active',
          created_at: now,
          updated_at: now,
        },
      ]);

      for (const comp of group.components) {
        await queryInterface.bulkInsert('tax_group_components', [
          {
            id: uuidv4(),
            tax_group_id: groupId,
            tax_type_id: taxTypeIds[comp.code],
            rate_percent: comp.rate,
            created_at: now,
            updated_at: now,
          },
        ]);
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('tax_group_components', null, {});
    await queryInterface.bulkDelete('tax_groups', null, {});
    await queryInterface.bulkDelete('tax_types', null, {});
    await queryInterface.bulkDelete('tax_jurisdictions', null, {});
  },
};
