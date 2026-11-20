function getPagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  // Allow larger pages for desktop/catalog sync (19k+ shop catalogs).
  const limit = Math.min(2000, Math.max(1, parseInt(query.limit, 10) || 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function paginatedResponse(rows, count, { page, limit }) {
  return {
    items: rows,
    pagination: {
      page,
      limit,
      total: count,
      totalPages: Math.ceil(count / limit),
    },
  };
}

module.exports = { getPagination, paginatedResponse };
