const { DataTypes } = require('sequelize');

/** JSON attribute that also works on MariaDB, where JSON columns are read back as strings. */
function jsonColumn(field, options = {}) {
  return {
    type: DataTypes.JSON,
    allowNull: true,
    ...options,
    get() {
      const value = this.getDataValue(field);
      if (typeof value !== 'string') return value;
      try {
        return JSON.parse(value);
      } catch (_) {
        return value;
      }
    },
  };
}

module.exports = { jsonColumn };
