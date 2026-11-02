const { DataTypes } = require('sequelize');
const { initCatalogModels } = require('./catalog');
const { initInventoryModels } = require('./inventory');
const { initBillingModels } = require('./billing');
const { initShopifyModels } = require('./shopify');

function defineBranch(sequelize) {
  return sequelize.define(
    'Branch',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      code: {
        type: DataTypes.STRING(20),
        allowNull: false,
        unique: true,
      },
      address: DataTypes.TEXT,
      city: DataTypes.STRING(100),
      country_code: {
        type: DataTypes.STRING(2),
        defaultValue: 'IN',
      },
      currency_code: {
        type: DataTypes.STRING(3),
        defaultValue: 'INR',
      },
      tax_registration_number: DataTypes.STRING(50),
      phone: DataTypes.STRING(20),
      bill_footer: DataTypes.STRING(255),
      logo_url: DataTypes.STRING(500),
      is_default: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      status: {
        type: DataTypes.ENUM('active', 'inactive'),
        defaultValue: 'active',
      },
    },
    { tableName: 'branches' }
  );
}

function defineRole(sequelize) {
  return sequelize.define(
    'Role',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
      },
      label: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
    },
    { tableName: 'roles' }
  );
}

function definePermission(sequelize) {
  return sequelize.define(
    'Permission',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      key: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      label: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
    },
    { tableName: 'permissions' }
  );
}

function defineRolePermission(sequelize) {
  return sequelize.define(
    'RolePermission',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      role_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      permission_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
    },
    {
      tableName: 'role_permissions',
      indexes: [{ unique: true, fields: ['role_id', 'permission_id'] }],
    }
  );
}

function defineUser(sequelize) {
  return sequelize.define(
    'User',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING(150),
        allowNull: true,
        unique: true,
      },
      phone: {
        type: DataTypes.STRING(20),
        allowNull: true,
        unique: true,
      },
      password_hash: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      role_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('active', 'inactive'),
        defaultValue: 'active',
      },
      last_login_at: DataTypes.DATE,
    },
    { tableName: 'users' }
  );
}

function defineUserBranch(sequelize) {
  return sequelize.define(
    'UserBranch',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      branch_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      is_default: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      tableName: 'user_branches',
      indexes: [{ unique: true, fields: ['user_id', 'branch_id'] }],
    }
  );
}

function defineUserPin(sequelize) {
  return sequelize.define(
    'UserPin',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true,
      },
      pin_hash: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      failed_attempts: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      locked_until: DataTypes.DATE,
    },
    { tableName: 'user_pins' }
  );
}

function defineRefreshToken(sequelize) {
  return sequelize.define(
    'RefreshToken',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      token_hash: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      revoked_at: DataTypes.DATE,
      device_info: DataTypes.STRING(255),
    },
    { tableName: 'refresh_tokens' }
  );
}

function defineUnitOfMeasure(sequelize) {
  return sequelize.define(
    'UnitOfMeasure',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      code: {
        type: DataTypes.STRING(10),
        allowNull: false,
        unique: true,
      },
      name: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      type: {
        type: DataTypes.ENUM('count', 'weight', 'volume', 'length'),
        allowNull: false,
      },
      base_unit_id: DataTypes.UUID,
      conversion_factor: {
        type: DataTypes.DECIMAL(15, 6),
        defaultValue: 1,
      },
    },
    { tableName: 'units_of_measure' }
  );
}

function initTenantModels(sequelize) {
  const Branch = defineBranch(sequelize);
  const Role = defineRole(sequelize);
  const Permission = definePermission(sequelize);
  const RolePermission = defineRolePermission(sequelize);
  const User = defineUser(sequelize);
  const UserBranch = defineUserBranch(sequelize);
  const UserPin = defineUserPin(sequelize);
  const RefreshToken = defineRefreshToken(sequelize);
  const UnitOfMeasure = defineUnitOfMeasure(sequelize);

  Role.hasMany(User, { foreignKey: 'role_id', as: 'users' });
  User.belongsTo(Role, { foreignKey: 'role_id', as: 'role' });

  Role.belongsToMany(Permission, {
    through: RolePermission,
    foreignKey: 'role_id',
    otherKey: 'permission_id',
    as: 'permissions',
  });
  Permission.belongsToMany(Role, {
    through: RolePermission,
    foreignKey: 'permission_id',
    otherKey: 'role_id',
    as: 'roles',
  });

  User.belongsToMany(Branch, {
    through: UserBranch,
    foreignKey: 'user_id',
    otherKey: 'branch_id',
    as: 'branches',
  });
  Branch.belongsToMany(User, {
    through: UserBranch,
    foreignKey: 'branch_id',
    otherKey: 'user_id',
    as: 'users',
  });

  User.hasOne(UserPin, { foreignKey: 'user_id', as: 'pin' });
  UserPin.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

  User.hasMany(RefreshToken, { foreignKey: 'user_id', as: 'refreshTokens' });
  RefreshToken.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

  UnitOfMeasure.belongsTo(UnitOfMeasure, {
    foreignKey: 'base_unit_id',
    as: 'baseUnit',
  });

  const catalogModels = initCatalogModels(sequelize, { UnitOfMeasure });
  const inventoryModels = initInventoryModels(sequelize, {
    Branch,
    User,
    ProductVariant: catalogModels.ProductVariant,
    Product: catalogModels.Product,
  });

  const billingModels = initBillingModels(sequelize, {
    Branch,
    User,
    ProductVariant: catalogModels.ProductVariant,
  });

  const shopifyModels = initShopifyModels(sequelize, {
    Branch,
    Product: catalogModels.Product,
    ProductVariant: catalogModels.ProductVariant,
  });

  return {
    sequelize,
    Branch,
    Role,
    Permission,
    RolePermission,
    User,
    UserBranch,
    UserPin,
    RefreshToken,
    UnitOfMeasure,
    ...catalogModels,
    ...inventoryModels,
    ...billingModels,
    ...shopifyModels,
  };
}

module.exports = { initTenantModels };
