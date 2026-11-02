'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('users', 'email', {
      type: Sequelize.STRING(150),
      allowNull: true,
      unique: true,
    });

    await queryInterface.changeColumn('users', 'phone', {
      type: Sequelize.STRING(20),
      allowNull: true,
    });

    await queryInterface.addIndex('users', ['phone'], {
      unique: true,
      name: 'users_phone_unique',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('users', 'users_phone_unique');
    await queryInterface.changeColumn('users', 'phone', {
      type: Sequelize.STRING(20),
      allowNull: true,
    });
    await queryInterface.changeColumn('users', 'email', {
      type: Sequelize.STRING(150),
      allowNull: false,
      unique: true,
    });
  },
};
