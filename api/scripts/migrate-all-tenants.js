#!/usr/bin/env node
/**
 * Run pending tenant migrations for every shop DB (or one via --db=...).
 *
 * Usage (from api/):
 *   node scripts/migrate-all-tenants.js
 *   node scripts/migrate-all-tenants.js --db=khisedigital_t_demo_shop
 */
require('dotenv').config();

const { getMasterSequelize } = require('../src/config/masterDatabase');
const { initMasterModels } = require('../src/models/master');
const { runTenantMigrations } = require('../src/services/tenantDbSetup');

async function main() {
  const dbArg = process.argv.find((a) => a.startsWith('--db='));
  const onlyDb = dbArg ? dbArg.slice('--db='.length).trim() : '';

  const sequelize = getMasterSequelize();
  await sequelize.authenticate();
  const { Tenant } = initMasterModels(sequelize);

  let tenants;
  if (onlyDb) {
    tenants = await Tenant.findAll({
      where: { db_name: onlyDb },
      attributes: ['id', 'name', 'slug', 'db_name', 'status'],
    });
    if (!tenants.length) {
      tenants = [{ name: onlyDb, slug: onlyDb, db_name: onlyDb, status: 'manual' }];
    }
  } else {
    tenants = await Tenant.findAll({
      attributes: ['id', 'name', 'slug', 'db_name', 'status'],
      order: [['name', 'ASC']],
    });
  }

  if (!tenants.length) {
    console.log('No tenants found.');
    process.exit(0);
  }

  console.log(`Migrating ${tenants.length} tenant database(s)…\n`);

  let ok = 0;
  let failed = 0;
  for (const t of tenants) {
    const dbName = t.db_name;
    if (!dbName) {
      console.log(`SKIP  ${t.slug || t.name} — no db_name`);
      continue;
    }
    process.stdout.write(`→ ${dbName} (${t.name || t.slug}) … `);
    try {
      await runTenantMigrations(dbName);
      console.log('OK');
      ok += 1;
    } catch (err) {
      console.log('FAILED');
      console.error(`  ${err.message}`);
      failed += 1;
    }
  }

  console.log(`\nDone. OK=${ok} FAILED=${failed}`);
  await sequelize.close();
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
