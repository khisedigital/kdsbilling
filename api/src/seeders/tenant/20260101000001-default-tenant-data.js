const { PERMISSIONS, ROLES, ROLE_PERMISSIONS } = require('../../constants/permissions');
const { v4: uuidv4 } = require('uuid');

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const roleIds = {};
    const permissionIds = {};

    const roles = [
      { name: ROLES.OWNER, label: 'Owner' },
      { name: ROLES.MANAGER, label: 'Manager' },
      { name: ROLES.CASHIER, label: 'Cashier' },
      { name: ROLES.SALESPERSON, label: 'Salesperson' },
    ];

    await queryInterface.bulkInsert(
      'roles',
      roles.map((role) => {
        const id = uuidv4();
        roleIds[role.name] = id;
        return { id, ...role, created_at: now, updated_at: now };
      })
    );

    const permissionEntries = Object.entries(PERMISSIONS).map(([key, value]) => ({
      key: value,
      label: key.replace(/_/g, ' ').toLowerCase(),
    }));

    await queryInterface.bulkInsert(
      'permissions',
      permissionEntries.map((perm) => {
        const id = uuidv4();
        permissionIds[perm.key] = id;
        return { id, ...perm, created_at: now, updated_at: now };
      })
    );

    const rolePermissionRows = [];
    for (const [roleName, permKeys] of Object.entries(ROLE_PERMISSIONS)) {
      for (const permKey of permKeys) {
        rolePermissionRows.push({
          id: uuidv4(),
          role_id: roleIds[roleName],
          permission_id: permissionIds[permKey],
          created_at: now,
          updated_at: now,
        });
      }
    }

    await queryInterface.bulkInsert('role_permissions', rolePermissionRows);

    const branchId = uuidv4();
    await queryInterface.bulkInsert('branches', [
      {
        id: branchId,
        name: 'Main Branch',
        code: 'MAIN',
        address: 'Main Street',
        city: 'Mumbai',
        country_code: 'IN',
        currency_code: 'INR',
        is_default: true,
        status: 'active',
        created_at: now,
        updated_at: now,
      },
    ]);

    // Units are preloaded from platform master_units when tenant is provisioned.
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('units_of_measure', null, {});
    await queryInterface.bulkDelete('branches', null, {});
    await queryInterface.bulkDelete('role_permissions', null, {});
    await queryInterface.bulkDelete('permissions', null, {});
    await queryInterface.bulkDelete('roles', null, {});
  },
};
