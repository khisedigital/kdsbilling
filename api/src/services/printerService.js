const net = require('net');
const AppError = require('../utils/AppError');
const { generatePrint, thermalMarkupToEscPos } = require('./printService');
const billingService = require('./billingService');

async function listPrinters(db, branchId) {
  return db.Printer.findAll({
    where: { branch_id: branchId, status: 'active' },
    order: [['is_default', 'DESC'], ['name', 'ASC']],
  });
}

async function createPrinter(db, branchId, data) {
  if (!data.name?.trim()) throw new AppError('Printer name required', 400, 'VALIDATION_ERROR');
  if (data.isDefault) {
    await db.Printer.update({ is_default: false }, { where: { branch_id: branchId } });
  }
  return db.Printer.create({
    branch_id: branchId,
    name: data.name.trim(),
    printer_type: data.printerType || 'bluetooth',
    connection_string: data.connectionString || null,
    paper_size: data.paperSize || '80mm',
    is_default: data.isDefault || false,
    status: 'active',
  });
}

async function updatePrinter(db, branchId, id, data) {
  const printer = await db.Printer.findOne({ where: { id, branch_id: branchId } });
  if (!printer) throw new AppError('Printer not found', 404, 'NOT_FOUND');
  if (data.isDefault) {
    await db.Printer.update({ is_default: false }, { where: { branch_id: branchId } });
  }
  await printer.update({
    name: data.name?.trim() ?? printer.name,
    printer_type: data.printerType ?? printer.printer_type,
    connection_string: data.connectionString !== undefined ? data.connectionString : printer.connection_string,
    paper_size: data.paperSize ?? printer.paper_size,
    is_default: data.isDefault ?? printer.is_default,
    status: data.status ?? printer.status,
  });
  return printer;
}

async function deletePrinter(db, branchId, id) {
  const printer = await db.Printer.findOne({ where: { id, branch_id: branchId } });
  if (!printer) throw new AppError('Printer not found', 404, 'NOT_FOUND');
  await printer.update({ status: 'inactive' });
  return { deleted: true };
}

function sendEscPosToNetwork(host, port, rawText, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const escpos = thermalMarkupToEscPos(rawText);

    socket.setTimeout(timeoutMs);
    socket.connect(port, host, () => {
      socket.write(escpos, () => {
        socket.end();
        resolve({ sent: true, bytes: escpos.length });
      });
    });
    socket.on('error', reject);
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Printer connection timeout'));
    });
  });
}

async function printBillNetwork(db, tenant, billId, printerId, shopSettings = {}, publicBaseUrl = null, language = 'en') {
  const printer = await db.Printer.findByPk(printerId);
  if (!printer || printer.status !== 'active') {
    throw new AppError('Printer not found', 404, 'NOT_FOUND');
  }
  if (printer.printer_type !== 'network') {
    throw new AppError('Printer is not a network printer', 400, 'INVALID_PRINTER');
  }

  const [host, portStr] = (printer.connection_string || '').split(':');
  const port = parseInt(portStr, 10) || 9100;
  if (!host) throw new AppError('Invalid printer address', 400, 'INVALID_PRINTER');

  const bill = await billingService.getBill(db, billId);
  const format = printer.paper_size === '58mm' ? '58' : printer.paper_size === 'a4' ? 'a4' : '80';
  const printData = generatePrint(bill, tenant, format, shopSettings, publicBaseUrl, language);

  if (format === 'a4') {
    throw new AppError('A4 network print not supported. Use mobile share.', 400, 'UNSUPPORTED');
  }

  await sendEscPosToNetwork(host, port, printData.raw);
  return { printed: true, printer: printer.name, format };
}

module.exports = {
  listPrinters,
  createPrinter,
  updatePrinter,
  deletePrinter,
  printBillNetwork,
};
