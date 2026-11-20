// 导入dtpweb模块
const { DTPWeb } = require("dtpweb");
const imgSrc =
    "data:image/png;base64,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";
//
/**
 * @type {DTPWeb | undefined}
 */
let api = undefined;
/**
 * @type {import("../lib/utils").LPA_Printer[]}
 */
let printers = [];

/**
 * 获取打印机列表。
 */
async function getPrinters() {
    if (api) {
        const items = await api.getPrinters();
        // 重新添加打印机列表
        if (items) {
            printers = items;
            console.log(printers);
        } else {
            printers = [];
            console.log("未检测到打印机");
        }
    }
}

/**
 * 获取当前选中的打印机；
 */
function getCurrPrinter() {
    const printer = printers ? printers[0] : undefined;
    return {
        printerName: printer?.name,
        ip: printer?.ip,
    };
}
/**
 * 打开当前打印机；
 * @returns {Promise<boolean>}
 */
async function openPrinter() {
    if (!api) return false;
    //
    if (printers.length <= 0) {
        await getPrinters();
    }
    //
    if (printers.length > 0) {
        return api.openPrinter(printers[0]);
    }
    return false;
}

/**
 * 关闭已连接打印机；
 */
async function closePrinter() {
    if (api) api.closePrinter();
}

/**
 * 打印线条相关对象。
 */
async function drawLineTest() {
    // 打开打印机
    if (!(await openPrinter())) return;

    const width = 45;
    const lineSpace = 5;
    const height = lineSpace * 4;
    const orientation = 0;
    const jobName = "drawLineTest";
    const lineWidth = 0.5;

    // 开始打印任务；
    if (await api.startJob({ width, height, orientation, jobName })) {
        //
        await api.drawLine({ x1: 0, y1: 5, x2: 45, y2: 5, lineWidth: lineWidth });
        await api.drawDashLine({
            x1: 0,
            y1: 10,
            x2: 45,
            y2: 10,
            lineWidth: lineWidth,
            dashLen: [0.5, 0.5],
        });
        await api.drawDashLine({
            x1: 0,
            y1: 15,
            x2: 45,
            y2: 15,
            lineWidth: lineWidth,
            dashLen: [0.7, 0.3],
        });
        // 提交打印任务；
        await api.commitJob();
    }
    //
    await closePrinter();
}

/**
 * 打印矩形框相关对象。
 */
async function drawRectTest() {
    // 打开打印机
    if (!(await openPrinter())) return;

    const width = 45;
    const height = 30;
    const orientation = 0;
    const jobName = "drawRectTest";
    const padding = 2;

    // 创建打印任务
    if (await api.startJob({ width, height, orientation, jobName })) {
        await api.startPage();
        // 第一页，打印矩形框
        await api.drawRectangle({ width: width, height: height });
        // 打印填充矩形
        await api.fillRectangle({
            x: padding,
            y: padding,
            width: width - padding * 2,
            height: height - padding * 2,
        });
        await api.endPage();

        // 第二页，打印圆角矩形框
        await api.startPage();
        await api.drawRoundRectangle({
            width: width,
            height: height,
            cornerWidth: 3.0,
            cornerHeight: 3.0,
            lineWidth: 0.5,
        });
        await api.fillRoundRectangle({
            x: padding,
            y: padding,
            width: width - padding * 2,
            height: height - padding * 2,
            cornerWidth: 2,
            cornerHeight: 2,
        });
        await api.endPage();

        // 提交打印任务
        return await api.commitJob();
    }
    //
    await api.closePrinter();
}

/**
 * 打印椭圆相关对象。
 */
async function drawEllipseTest() {
    // 打开打印机
    if (!(await openPrinter())) return;

    const width = 45;
    const height = 30;
    const orientation = 0;
    const jobName = "drawEllipseTest";
    const padding = 2;

    // 创建打印任务。
    if (await api.startJob({ width, height, orientation, jobName })) {
        // 第一页,打印椭圆边框
        await api.drawEllipse({ width: width, height: height, lineWidth: 0.5 });
        // 第二页，打印填充椭圆
        await api.fillEllipse({
            x: padding,
            y: padding,
            width: width - padding * 2,
            height: height - padding * 2,
        });

        // 提交打印任务。
        await api.commitJob();
    }
    //
    await api.closePrinter();
}

/**
 * 打印文本相关对象。
 */
async function drawTextTest() {
    // 打开打印机
    if (!(await openPrinter())) return;

    const width = 40;
    const height = 30;
    const orientation = 0;
    const jobName = "drawTextTest";
    const fontHeight = 5;
    const text = "@上海道臻信息技术有限公司#";
    // const text = "www.dothatnech.com";

    if (await api.startJob({ width, height, orientation, jobName })) {
        //
        await api.drawText({ text, width, height, fontHeight });
        //
        return await api.commitJob();
    }
    //
    await api.closePrinter();
}

/**
 * 绘制一维码。
 */
async function drawBarcodeTest() {
    // 打开打印机
    if (!(await openPrinter())) return;

    const width = 45;
    const height = 30;
    const orientation = 0;
    const jobName = "drawBarcodeTest";
    const text = "1234567890";
    const margin = 5;

    if (await api.startJob({ width, height, orientation, jobName })) {
        //
        await api.draw1DBarcode({
            text: text,
            x: margin,
            y: margin,
            width: width - margin * 2,
            height: height - margin * 2,
            textHeight: 5,
        });
        await api.commitJob();
    }
    //
    await api.closePrinter();
}

/**
 * 绘制二维码。
 */
async function drawQRCodeTest() {
    // 打开打印机
    if (!(await openPrinter())) return;

    const width = 45;
    const height = 45;
    const orientation = 0;
    const jobName = "drawQRCodeTest";
    const margin = 5;
    const text = "上海道臻信息技术有限公司";
    // const text = "www.dothantech.com";

    if (await api.startJob({ width, height, orientation, jobName })) {
        //
        await api.draw2DQRCode({
            text: text,
            x: margin,
            y: margin,
            width: width - margin * 2,
        });
        return api.commitJob();
    }
    //
    await api.closePrinter();
}

/**
 * 打印PDF417。
 */
async function drawPDF417Test() {
    // 打开打印机
    if (!(await openPrinter())) return;

    const width = 45;
    const height = 30;
    const orientation = 0;
    const jobName = "drawPDF417Test";
    const text = "上海道臻信息技术有限公司";
    // const text = "www.dothantech.com";
    const margin = 5;

    if (await api.startJob({ width, height, orientation, jobName })) {
        //
        await api.draw2DPdf417({
            text: text,
            x: margin,
            y: margin,
            width: width - margin * 2,
            height: height - margin * 2,
        });

        api.commitJob();
    }
    //
    await api.closePrinter();
}

/**
 * 打印PDF417。
 */
async function drawDataMatrixTest() {
    // 打开打印机
    if (!(await openPrinter())) return;

    const width = 40;
    const height = 40;
    const orientation = 0;
    const jobName = "drawDataMatrixTest";
    // const text = "上海道臻信息技术有限公司";
    const text = "www.dothantech.com";
    const margin = 5;

    if (await api.startJob({ width, height, orientation, jobName })) {
        //
        await api.draw2DDataMatrix({
            text: text,
            x: margin,
            y: margin,
            width: width - margin * 2,
            height: height - margin * 2,
        });

        api.commitJob();
    }
    //
    await api.closePrinter();
}

/**
 * 打印网络图片。
 */
async function drawImageUrlTest() {
    // 打开打印机
    if (!(await openPrinter())) return;

    const width = 30;
    const height = 30;
    const orientation = 0;
    const jobName = "drawImageTest";
    const url = "http://www.detonger.com/img/QRCode_OfficialAccounts.png";
    const margin = 5;
    if (await api.startJob({ width, height, orientation, jobName })) {
        //
        await api.drawImage({
            imageFile: url,
            x: margin,
            y: margin,
            width: width - margin * 2,
            height: height - margin * 2,
        });
        api.commitJob();
    }
    //
    await api.closePrinter();
}

async function drawImageDataTest() {
    // 打开打印机
    if (!(await openPrinter())) return;

    const labelWidth = 30;
    const labelHeight = 30;
    const orientation = 0;
    const jobName = "drawImageDataTest";
    //
    if (await api.startJob({ width: labelWidth, height: labelHeight, orientation, jobName })) {
        //
        await api.drawImageD({
            data: imgSrc,
            drawWidth: labelWidth,
            drawHeight: labelHeight,
        });
        await api.commitJob();
    }
    //
    await api.closePrinter();
}

/**
 * 直接打印BASE64图片测试。
 */
async function printImageDataTest() {
    const printer = getCurrPrinter();
    const printerName = printer.printerName || printer.name;
    //
    if (!api || !printerName) return;
    //
    await api.printImage({
        data: imgSrc,
        printerName: printerName,
    });
}

async function onTest() {
    // 先获取打印机列表。
    await getPrinters();
    //
    await drawTextTest();
    //
    await drawQRCodeTest();
    //
    await drawBarcodeTest();
    //
    await drawPDF417Test();
    //
    await drawDataMatrixTest();
    //
    await drawImageUrlTest();
    //
    await drawImageDataTest();
    //
    await drawLineTest();
    //
    await drawRectTest();
    //
    await drawEllipseTest();
    //
    await printImageDataTest();
}

(function main() {
    // 初始化dtpweb接口。
    api = DTPWeb.getInstance();
    api.checkPlugin((success) => {
        if (success) {
            onTest();
        } else {
            api = undefined;
            console.log("dtpweb接口不可用");
        }
    });
})();
