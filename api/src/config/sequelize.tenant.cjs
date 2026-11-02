const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const shared = {
  username: process.env.TENANT_DB_USER || 'root',
  password: process.env.TENANT_DB_PASSWORD || '',
  database: process.env.TENANT_DB_NAME || 'billing_tenant_dev',
  host: process.env.TENANT_DB_HOST || 'localhost',
  port: parseInt(process.env.TENANT_DB_PORT, 10) || 3306,
  dialect: 'mysql',
  logging: console.log,
};

// sequelize-cli picks the key matching NODE_ENV
module.exports = {
  development: shared,
  production: { ...shared, logging: false },
  test: shared,
};
