#!/usr/bin/env node
require('dotenv').config();

const { provisionTenant } = require('../src/services/tenantProvisioner');
const { getMasterSequelize } = require('../src/config/masterDatabase');
const { initMasterModels } = require('../src/models/master');

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag, fallback) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : fallback;
  };

  const name = getArg('--name', 'Demo Kirana Shop');
  const slug = getArg('--slug', 'demo-kirana');
  const ownerName = getArg('--owner-name', 'Shop Owner');
  const ownerMobile = getArg('--owner-mobile', '9876543210');
  const ownerPassword = getArg('--owner-password', 'Owner@123');

  const masterSequelize = getMasterSequelize();
  await masterSequelize.authenticate();
  initMasterModels(masterSequelize);

  const result = await provisionTenant({
    name,
    slug,
    ownerName,
    ownerMobile,
    ownerPassword,
  });

  console.log('\nTenant provisioned successfully:');
  console.log(JSON.stringify(result, null, 2));
  console.log('\nLogin credentials:');
  console.log(`  Shop Code: ${slug}`);
  console.log(`  Mobile:    ${ownerMobile}`);
  console.log(`  Password:  ${ownerPassword}`);
  console.log(`  PIN:       1234`);
}

main().catch((err) => {
  console.error('Provisioning failed:', err.message);
  process.exit(1);
});
