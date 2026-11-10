package com.kdspoz.retail.label

import android.bluetooth.BluetoothSocket
import android.graphics.Bitmap
import android.os.SystemClock
import android.util.Log
import com.microlan.printersdk2.PrinterCommands
import com.microlan.printersdk2.Utils
import java.io.IOException

/**
 * 50 × H mm label print — same approach as SDKDemoApk:
 * - canvas sized from physical mm (H = 25 or 28 from settings)
 * - fit to print-head width without stretching
 * - hard black/white bitmap + Utils.decodeBitmap (no dither)
 * - GS FF form-feed for gap / black-mark (not continuous \n / FEED_LINE)
 *
 * Do not use PrinterSDK.printText(byte[]) for labels — it always appends FEED_LINE.
 */
object LabelPrinterJob {
  private const val TAG = "KdsLabelPrinter"

  // ============================================================
  // PHYSICAL LABEL + PRINTER WIDTH (same as SDKDemoApk)
  // ============================================================
  /** Physical sticker size in millimetres (height comes from the loaded roll). */
  const val LABEL_WIDTH_MM = 50
  const val LABEL_HEIGHT_MM = 28

  /**
   * Printable dots across the print head (same as LabelBitmap).
   * 58 mm ≈ 384 px @ 203 dpi · 80 mm ≈ 576 px
   * LabelBitmap already draws at this width so fitToPrinterWidth is a no-op.
   */
  private const val PRINTER_WIDTH_PX = 384

  /** Label separator — ESC/POS GS FF (gap / black-mark sensor). */
  private val LABEL_FORM_FEED = byteArrayOf(0x1D, 0x0C)

  private val transmission = Any()

  fun print(socket: BluetoothSocket, bitmap: Bitmap, content: LabelContent, copies: Int) {
    synchronized(transmission) {
      ensureConnected(socket)
      val count = copies.coerceIn(1, 99)
      val fitted = fitToPrinterWidth(bitmap, PRINTER_WIDTH_PX)
      try {
        // Do not call prepareImageForPrint — it dithers the sticker, which
        // prints product name, price, and barcode as a dark blur.
        val raster = Utils.decodeBitmap(fitted)
          ?: throw IOException("Utils.decodeBitmap returned null.")

        Log.i(
          TAG,
          "label esc/pos ${fitted.width}x${fitted.height} raster=${raster.size} copies=$count barcode=${content.barcode}",
        )

        val out = socket.outputStream
          ?: throw IOException("Printer socket has no output stream.")
        // Continuous stream (same as desktop default). JS may already chunk if user enabled Batched ×3.
        out.write(PrinterCommands.INIT)
        // Left edge of the head. A centered align parks the sticker image in the middle of the roll.
        out.write(byteArrayOf(0x1B, 0x61, 0x00, 0x1D, 0x4C, 0x00, 0x00))
        // Two stickers, then wait. A third picture still in the buffer is what cuts the label.
        var left = count
        while (left > 0) {
          val n = minOf(2, left)
          repeat(n) {
            out.write(raster)
            out.write(LABEL_FORM_FEED)
          }
          out.flush()
          left -= n
          if (left > 0) Thread.sleep(n * 1200L)
        }
        Log.i(TAG, "label flushed at ${SystemClock.elapsedRealtime()} connected=${socket.isConnected}")
      } finally {
        recycleExtra(fitted, bitmap)
      }
    }
  }

  /** Feed a few labels via sensor so gap / black-mark is learned. */
  fun calibrate(socket: BluetoothSocket) {
    synchronized(transmission) {
      ensureConnected(socket)
      val out = socket.outputStream
        ?: throw IOException("Printer socket has no output stream.")
      out.write(PrinterCommands.INIT)
      repeat(3) { out.write(LABEL_FORM_FEED) }
      out.flush()
      Log.i(TAG, "calibrate form-feed x3")
      Thread.sleep(1500L)
    }
  }

  /** Advance one label via gap / black-mark sensor. */
  fun pullIn(socket: BluetoothSocket) {
    synchronized(transmission) {
      ensureConnected(socket)
      val out = socket.outputStream
        ?: throw IOException("Printer socket has no output stream.")
      out.write(LABEL_FORM_FEED)
      out.flush()
      Thread.sleep(500L)
    }
  }

  /** Scale down to max width only — never stretch / never upscale. */
  private fun fitToPrinterWidth(source: Bitmap, maxWidthPx: Int): Bitmap {
    if (source.width <= maxWidthPx) return source
    val scale = maxWidthPx / source.width.toFloat()
    val dstW = maxWidthPx
    val dstH = (source.height * scale).toInt().coerceAtLeast(1)
    return Bitmap.createScaledBitmap(source, dstW, dstH, false)
  }

  private fun ensureConnected(socket: BluetoothSocket) {
    if (!socket.isConnected) throw IOException("Printer is not connected.")
  }

  private fun recycleExtra(bitmap: Bitmap?, vararg keep: Bitmap) {
    if (bitmap == null || bitmap.isRecycled) return
    if (keep.any { it === bitmap }) return
    bitmap.recycle()
  }
}
