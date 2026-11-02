/** Bill statuses that still represent a sold (non-void) order. */
const SOLD_BILL_STATUSES = ['completed', 'partially_returned', 'fully_returned'];

/** Bills that can accept additional item returns. */
const RETURNABLE_BILL_STATUSES = ['completed', 'partially_returned'];

const SOLD_BILL_STATUS_SQL = `'completed', 'partially_returned', 'fully_returned'`;

module.exports = {
  SOLD_BILL_STATUSES,
  RETURNABLE_BILL_STATUSES,
  SOLD_BILL_STATUS_SQL,
};
