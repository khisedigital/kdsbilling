const { DataTypes } = require('sequelize');

function defineTaxJurisdiction(sequelize) {
  return sequelize.define('TaxJurisdiction', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    country_code: { type: DataTypes.STRING(2), allowNull: false },
    region_code: DataTypes.STRING(10),
    name: { type: DataTypes.STRING(100), allowNull: false },
    status: { type: DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },
  }, { tableName: 'tax_jurisdictions' });
}

function defineTaxType(sequelize) {
  return sequelize.define('TaxType', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING(20), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(100), allowNull: false },
    is_compound: { type: DataTypes.BOOLEAN, defaultValue: false },
  }, { tableName: 'tax_types' });
}

function defineTaxGroup(sequelize) {
  return sequelize.define('TaxGroup', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    jurisdiction_id: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING(100), allowNull: false },
    total_rate: { type: DataTypes.DECIMAL(8, 4), defaultValue: 0 },
    status: { type: DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },
  }, { tableName: 'tax_groups' });
}

function defineTaxGroupComponent(sequelize) {
  return sequelize.define('TaxGroupComponent', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    tax_group_id: { type: DataTypes.UUID, allowNull: false },
    tax_type_id: { type: DataTypes.UUID, allowNull: false },
    rate_percent: { type: DataTypes.DECIMAL(8, 4), allowNull: false },
  }, { tableName: 'tax_group_components' });
}

function defineCategory(sequelize) {
  return sequelize.define('Category', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING(150), allowNull: false },
    parent_id: DataTypes.UUID,
    description: DataTypes.TEXT,
    status: { type: DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },
    deleted_at: DataTypes.DATE,
  }, { tableName: 'categories', paranoid: false });
}

function defineBrand(sequelize) {
  return sequelize.define('Brand', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING(150), allowNull: false, unique: true },
    description: DataTypes.TEXT,
    status: { type: DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },
    deleted_at: DataTypes.DATE,
  }, { tableName: 'brands', paranoid: false });
}

function defineProduct(sequelize) {
  return sequelize.define('Product', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING(200), allowNull: false },
    description: DataTypes.TEXT,
    category_id: DataTypes.UUID,
    brand_id: DataTypes.UUID,
    uom_id: { type: DataTypes.UUID, allowNull: false },
    tax_group_id: DataTypes.UUID,
    tax_code: DataTypes.STRING(30),
    is_weight_based: { type: DataTypes.BOOLEAN, defaultValue: false },
    allow_decimal_qty: { type: DataTypes.BOOLEAN, defaultValue: false },
    has_variants: { type: DataTypes.BOOLEAN, defaultValue: false },
    status: { type: DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },
    deleted_at: DataTypes.DATE,
  }, { tableName: 'products', paranoid: false });
}

function defineProductVariant(sequelize) {
  return sequelize.define('ProductVariant', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    product_id: { type: DataTypes.UUID, allowNull: false },
    sku: { type: DataTypes.STRING(50), allowNull: false, unique: true },
    size: DataTypes.STRING(30),
    color: DataTypes.STRING(50),
    cost_price: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    selling_price: { type: DataTypes.DECIMAL(15, 4), allowNull: false },
    mrp: DataTypes.DECIMAL(15, 4),
    wholesale_price: DataTypes.DECIMAL(15, 4),
    uom_id: DataTypes.UUID,
    tax_group_id: DataTypes.UUID,
    reorder_level: { type: DataTypes.DECIMAL(15, 3), defaultValue: 0 },
    status: { type: DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },
    deleted_at: DataTypes.DATE,
  }, { tableName: 'product_variants', paranoid: false });
}

function defineBarcode(sequelize) {
  return sequelize.define('Barcode', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    variant_id: { type: DataTypes.UUID, allowNull: false },
    barcode: { type: DataTypes.STRING(50), allowNull: false, unique: true },
    is_primary: { type: DataTypes.BOOLEAN, defaultValue: false },
    /** Quantity (in the variant's unit) added when this barcode is scanned; null = ask / 1. */
    quantity: { type: DataTypes.DECIMAL(12, 4), allowNull: true },
  }, { tableName: 'barcodes' });
}

function defineProductImage(sequelize) {
  return sequelize.define('ProductImage', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    product_id: { type: DataTypes.UUID, allowNull: false },
    variant_id: DataTypes.UUID,
    file_name: { type: DataTypes.STRING(255), allowNull: false },
    file_path: { type: DataTypes.STRING(500), allowNull: false },
    mime_type: DataTypes.STRING(100),
    is_primary: { type: DataTypes.BOOLEAN, defaultValue: false },
    sort_order: { type: DataTypes.INTEGER, defaultValue: 0 },
  }, { tableName: 'product_images' });
}

function initCatalogModels(sequelize, { UnitOfMeasure }) {
  const TaxJurisdiction = defineTaxJurisdiction(sequelize);
  const TaxType = defineTaxType(sequelize);
  const TaxGroup = defineTaxGroup(sequelize);
  const TaxGroupComponent = defineTaxGroupComponent(sequelize);
  const Category = defineCategory(sequelize);
  const Brand = defineBrand(sequelize);
  const Product = defineProduct(sequelize);
  const ProductVariant = defineProductVariant(sequelize);
  const Barcode = defineBarcode(sequelize);
  const ProductImage = defineProductImage(sequelize);

  TaxJurisdiction.hasMany(TaxGroup, { foreignKey: 'jurisdiction_id', as: 'taxGroups' });
  TaxGroup.belongsTo(TaxJurisdiction, { foreignKey: 'jurisdiction_id', as: 'jurisdiction' });

  TaxGroup.hasMany(TaxGroupComponent, { foreignKey: 'tax_group_id', as: 'components' });
  TaxGroupComponent.belongsTo(TaxGroup, { foreignKey: 'tax_group_id', as: 'taxGroup' });
  TaxGroupComponent.belongsTo(TaxType, { foreignKey: 'tax_type_id', as: 'taxType' });

  Category.hasMany(Category, { foreignKey: 'parent_id', as: 'children' });
  Category.belongsTo(Category, { foreignKey: 'parent_id', as: 'parent' });

  Category.hasMany(Product, { foreignKey: 'category_id', as: 'products' });
  Brand.hasMany(Product, { foreignKey: 'brand_id', as: 'products' });
  Product.belongsTo(Category, { foreignKey: 'category_id', as: 'category' });
  Product.belongsTo(Brand, { foreignKey: 'brand_id', as: 'brand' });
  Product.belongsTo(UnitOfMeasure, { foreignKey: 'uom_id', as: 'uom' });
  Product.belongsTo(TaxGroup, { foreignKey: 'tax_group_id', as: 'taxGroup' });

  Product.hasMany(ProductVariant, { foreignKey: 'product_id', as: 'variants' });
  ProductVariant.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });
  ProductVariant.belongsTo(UnitOfMeasure, { foreignKey: 'uom_id', as: 'uom' });
  ProductVariant.belongsTo(TaxGroup, { foreignKey: 'tax_group_id', as: 'taxGroup' });

  ProductVariant.hasMany(Barcode, { foreignKey: 'variant_id', as: 'barcodes' });
  Barcode.belongsTo(ProductVariant, { foreignKey: 'variant_id', as: 'variant' });

  Product.hasMany(ProductImage, { foreignKey: 'product_id', as: 'images' });
  ProductImage.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });
  ProductImage.belongsTo(ProductVariant, { foreignKey: 'variant_id', as: 'variant' });

  return {
    TaxJurisdiction,
    TaxType,
    TaxGroup,
    TaxGroupComponent,
    Category,
    Brand,
    Product,
    ProductVariant,
    Barcode,
    ProductImage,
  };
}

module.exports = { initCatalogModels };
