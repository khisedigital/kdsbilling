const { v4: uuidv4 } = require('uuid');

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const categories = ['Rent', 'Salary', 'Utilities', 'Transport', 'Miscellaneous'];
    for (const name of categories) {
      await queryInterface.bulkInsert('expense_categories', [
        { id: uuidv4(), name, status: 'active', created_at: now, updated_at: now },
      ]);
    }

    const offers = [
      { name: '5% Off', offer_type: 'percent_off', value: 5 },
      { name: '10% Off', offer_type: 'percent_off', value: 10 },
      { name: '₹50 Off', offer_type: 'flat_off', value: 50 },
    ];
    for (const o of offers) {
      await queryInterface.bulkInsert('offers', [
        { id: uuidv4(), ...o, min_purchase: 0, status: 'active', created_at: now, updated_at: now },
      ]);
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('offers', null, {});
    await queryInterface.bulkDelete('expense_categories', null, {});
  },
};
