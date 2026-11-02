package com.kdspoz.retail.label

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface

/** 203 dpi. 50 × 25 mm label. */
private const val DOTS_PER_MM = 8
private const val LABEL_WIDTH_PX = 50 * DOTS_PER_MM
private const val LABEL_HEIGHT_PX = 25 * DOTS_PER_MM

/** Monospace prints cleanly on thermal heads — no bold / fake-bold. */
private val PRINTER_FONT: Typeface = Typeface.create(Typeface.MONOSPACE, Typeface.NORMAL)

data class LabelContent(
  val shopName: String,
  val productName: String,
  val detail: String,
  val barcode: String,
  val mrp: String,
  val price: String,
)

/**
 *  [           Shop name (large)              ]
 *  [ Product name left    |  qty  price right ]
 *  --------------------------------------------
 *  [              BARCODE (short)             ]
 *  [              barcode digits              ]
 */
fun renderLabelBitmap(content: LabelContent): Bitmap {
  val width = LABEL_WIDTH_PX
  val height = LABEL_HEIGHT_PX
  val padX = maxOf(4, width / 40)
  val padY = maxOf(3, height / 28)

  val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
  val canvas = Canvas(bitmap)
  canvas.drawColor(Color.WHITE)

  val paint = Paint().apply {
    color = Color.BLACK
    isAntiAlias = false
    style = Paint.Style.FILL
    typeface = PRINTER_FONT
    isFakeBoldText = false
    isSubpixelText = false
  }

  var y = padY.toFloat()

  // Shop name — larger, centered
  val shopSize = height * 0.11f
  paint.textSize = shopSize
  paint.textAlign = Paint.Align.CENTER
  val shop = ellipsize(paint, content.shopName.ifBlank { "Shop" }, shopSize, (width - padX * 2).toFloat())
  y += shopSize
  canvas.drawText(shop, width / 2f, y, paint)
  // Gap: shop name → product details
  y += 10f

  // One row: product LEFT · qty then price RIGHT
  val rowSize = height * 0.105f
  paint.textSize = rowSize

  val qtyText = content.detail.trim()
  val priceText = content.price.ifBlank { content.mrp }.trim()
  val rightPart = listOf(qtyText, priceText).filter { it.isNotBlank() }.joinToString("  ")
  val rightWidth = if (rightPart.isBlank()) 0f else paint.measureText(rightPart)
  val gap = 10f
  val leftMax = (width - padX * 2 - rightWidth - gap).coerceAtLeast(width * 0.35f)

  val productText = ellipsize(
    paint,
    content.productName.ifBlank { "Product" },
    rowSize,
    leftMax,
  )

  y += rowSize
  paint.textAlign = Paint.Align.LEFT
  canvas.drawText(productText, padX.toFloat(), y, paint)

  if (rightPart.isNotBlank()) {
    paint.textAlign = Paint.Align.RIGHT
    canvas.drawText(rightPart, (width - padX).toFloat(), y, paint)
  }
  // Gap: product details → divider / barcode
  y += 10f

  paint.strokeWidth = 1.5f
  canvas.drawLine(padX.toFloat(), y, (width - padX).toFloat(), y, paint)
  // Gap: divider → barcode
  y += 10f

  // Compact barcode
  val footerSize = height * 0.075f
  val footerReserve = footerSize + padY + 2f
  val barTop = y.toInt()
  val maxBarH = (height * 0.26f).toInt()
  val barBottom = (height - footerReserve).toInt().coerceAtMost(barTop + maxBarH).coerceAtLeast(barTop + 16)

  drawBarcode(
    canvas,
    content.barcode.ifBlank { "2000000000008" },
    padX.toFloat(),
    barTop.toFloat(),
    (width - padX * 2).toFloat(),
    (barBottom - barTop).toFloat(),
  )

  paint.typeface = PRINTER_FONT
  paint.isFakeBoldText = false
  paint.textSize = footerSize
  paint.textAlign = Paint.Align.CENTER
  canvas.drawText(
    content.barcode.ifBlank { "2000000000008" },
    width / 2f,
    (height - padY).toFloat(),
    paint,
  )

  return bitmap
}

private fun ellipsize(
  paint: Paint,
  text: String,
  size: Float,
  maxWidth: Float,
): String {
  if (maxWidth <= 0f) return ""
  paint.textSize = size
  paint.typeface = PRINTER_FONT
  paint.isFakeBoldText = false
  if (paint.measureText(text) <= maxWidth) return text
  val ellipsis = ".."
  var end = text.length
  while (end > 0 && paint.measureText(text.substring(0, end) + ellipsis) > maxWidth) {
    end -= 1
  }
  return if (end <= 0) ellipsis else text.substring(0, end) + ellipsis
}

private fun drawBarcode(canvas: Canvas, barcode: String, x: Float, y: Float, width: Float, height: Float) {
  val modules = try {
    BarcodeEncoder.encode(barcode)
  } catch (_: Exception) {
    "1011001101011001101001101101001"
  }
  val quiet = BarcodeEncoder.QUIET_ZONE_MODULES
  val total = modules.length + quiet * 2
  val module = (width / total).toInt().coerceAtLeast(2)
  val barLeft = x.toInt() + quiet * module
  val top = y.toInt()
  val bottom = (y + height).toInt().coerceAtLeast(top + 1)
  val paint = Paint().apply {
    color = Color.BLACK
    style = Paint.Style.FILL
    isAntiAlias = false
  }
  var cursor = barLeft
  var i = 0
  while (i < modules.length) {
    if (modules[i] != '1') {
      cursor += module
      i += 1
      continue
    }
    var run = 1
    while (i + run < modules.length && modules[i + run] == '1') run += 1
    canvas.drawRect(
      cursor.toFloat(),
      top.toFloat(),
      (cursor + run * module).toFloat(),
      bottom.toFloat(),
      paint,
    )
    cursor += run * module
    i += run
  }
}
