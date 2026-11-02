const { Sequelize } = require('sequelize');
const config = require('./index');

let masterSequelize = null;

function getMasterSequelize() {
  if (!masterSequelize) {
    const { host, port, database, username, password } = config.masterDb;
    masterSequelize = new Sequelize(database, username, password, {
      host,
      port,
      dialect: 'mysql',
      logging: config.env === 'development' ? console.log : false,
      define: {
        underscored: true,
        timestamps: true,
      },
    });
  }
  return masterSequelize;
}

module.exports = { getMasterSequelize };
