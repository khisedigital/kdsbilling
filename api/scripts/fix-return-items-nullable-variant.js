#!/usr/bin/env node
/**
 * One-shot: allow null variant_id on return_items for every tenant DB.
 * Run on the API server after deploying model/service changes:
 *
 *   node scripts/fix-return-items-nullable-variant.js
 */
require('dotenv').config();

const { Sequelize } = require('sequelize');
const { getMasterSequelize } = require('../src/config/masterDatabase');
const { initMasterModels } = require('../src/models/master');
const migration = require('../src/migrations/tenant/20260916000001-return-items-nullable-variant.js');

async function alterDb(dbName) {
  const sequelize = new Sequelize(
    dbName,
    process.env.TENANT_DB_USER || process.env.MASTER_DB_USER || 'root',
    process.env.TENANT_DB_PASSWORD || process.env.MASTER_DB_PASSWORD || '',
    {
      host: process.env.TENANT_DB_HOST || process.env.MASTER_DB_HOST || 'localhost',
      port: parseInt(process.env.TENANT_DB_PORT || process.env.MASTER_DB_PORT || '3306', 10),
      dialect: 'mysql',
      logging: false,
    },
  );
  try {
    await sequelize.authenticate();
    await migration.up(sequelize.getQueryInterface());
    const [rows] = await sequelize.query(
      `SELECT IS_NULLABLE AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'return_items' AND COLUMN_NAME = 'variant_id'`,
      { replacements: [dbName] },
    );
    console.log(`OK  ${dbName}  nullable=${rows[0]?.n || '?'}`);
  } finally {
    await sequelize.close();
  }
}

async function main() {
  const master = getMasterSequelize();
  await master.authenticate();
  const { Tenant } = initMasterModels(master);
  const tenants = await Tenant.findAll({
    attributes: ['name', 'db_name'],
    order: [['name', 'ASC']],
  });
  await master.close();

  if (!tenants.length) {
    console.log('No tenants found.');
    return;
  }

  let failed = 0;
  for (const t of tenants) {
    if (!t.db_name) continue;
    try {
      await alterDb(t.db_name);
    } catch (err) {
      failed += 1;
      console.error(`FAIL ${t.db_name}: ${err.message}`);
    }
  }
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
