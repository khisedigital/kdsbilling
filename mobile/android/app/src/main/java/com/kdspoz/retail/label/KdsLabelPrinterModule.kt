package com.kdspoz.retail.label

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.bluetooth.BluetoothManager as SystemBluetoothManager
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import java.io.IOException
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

/**
 * Microlan sdk2 thermal label printing (same path as SDKDemoApk).
 * Connect uses SPP with a hard timeout (BluetoothSocket.connect() can hang forever).
 * Print: label bitmap → PrinterSDK.prepareImageForPrint → Utils.decodeBitmap → GS FF.
 */
class KdsLabelPrinterModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val executor = Executors.newSingleThreadExecutor()
  private val lock = Any()
  private var printerSocket: BluetoothSocket? = null
  private var printerName: String? = null
  private var printerAddress: String? = null

  override fun getName(): String = "KdsLabelPrinter"

  @ReactMethod
  fun isAvailable(promise: Promise) {
    promise.resolve(true)
  }

  @SuppressLint("MissingPermission")
  @ReactMethod
  fun listPrinters(promise: Promise) {
    executor.execute {
      try {
        ensureBluetoothPermission()
        val adapter = requireAdapter()
        val list = Arguments.createArray()
        for (device in adapter.bondedDevices.orEmpty()) {
          val row = Arguments.createMap()
          row.putString("name", device.name?.takeIf { it.isNotBlank() } ?: "Printer")
          row.putString("address", device.address)
          list.pushMap(row)
        }
        promise.resolve(list)
      } catch (err: Exception) {
        promise.reject("LABEL_LIST", err.message, err)
      }
    }
  }

  @SuppressLint("MissingPermission")
  @ReactMethod
  fun connect(address: String, promise: Promise) {
    executor.execute {
      try {
        ensureBluetoothPermission()
        val adapter = requireAdapter()
        val target = address.trim()
        if (target.isEmpty()) throw IllegalArgumentException("Select a printer first.")

        val current = synchronized(lock) { printerSocket }
        if (current != null && current.isConnected &&
          printerAddress.equals(target, ignoreCase = true)
        ) {
          promise.resolve(statusMap(true))
          return@execute
        }

        stopDiscovery(adapter)
        closeSocket()

        val device = findBondedDevice(adapter, target)
          ?: adapter.getRemoteDevice(target.uppercase())
        val name = try {
          device.name?.takeIf { it.isNotBlank() }
        } catch (_: SecurityException) {
          null
        } ?: "Printer"

        Log.i(TAG, "connect start name=$name address=${device.address}")
        val socket = openSppSocket(adapter, device)
        synchronized(lock) {
          printerSocket = socket
          printerName = name
          printerAddress = device.address
        }
        Log.i(TAG, "connect ready address=${device.address}")
        promise.resolve(statusMap(true))
      } catch (err: Exception) {
        Log.e(TAG, "connect failed", err)
        closeSocket()
        promise.reject(
          "LABEL_CONNECT",
          err.message?.takeIf { it.isNotBlank() } ?: "Failed to connect to the printer.",
          err,
        )
      }
    }
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    executor.execute {
      try {
        val socket = synchronized(lock) { printerSocket }
        if (socket != null && !socket.isConnected) closeSocket()
        promise.resolve(statusMap(synchronized(lock) { printerSocket?.isConnected == true }))
      } catch (err: Exception) {
        promise.reject("LABEL_STATUS", err.message, err)
      }
    }
  }

  @ReactMethod
  fun printLabel(payload: ReadableMap, copies: Int, promise: Promise) {
    executor.execute {
      try {
        ensureBluetoothPermission()
        val socket = requireConnectedSocket()
        val content = LabelContent(
          shopName = payload.getStringOrEmpty("shopName"),
          productName = payload.getStringOrEmpty("productName"),
          detail = payload.getStringOrEmpty("detail"),
          barcode = payload.getStringOrEmpty("barcode").ifBlank { "2000000000008" },
          mrp = payload.getStringOrEmpty("mrp"),
          price = payload.getStringOrEmpty("price"),
        )
        val heightMm = when {
          payload.hasKey("heightMm") && !payload.isNull("heightMm") -> payload.getInt("heightMm")
          else -> 28
        }.let { if (it == 25) 25 else 28 }
        val bitmap = renderLabelBitmap(content, heightMm)
        try {
          // Same as SDKDemoApk: ESC/POS raster + GS FF (not TSPL / not continuous feed).
          LabelPrinterJob.print(socket, bitmap, content, copies)
          promise.resolve(null)
        } finally {
          if (!bitmap.isRecycled) bitmap.recycle()
        }
      } catch (err: Exception) {
        Log.e(TAG, "print failed", err)
        promise.reject("LABEL_PRINT", err.message, err)
      }
    }
  }

  /** Form-feed calibrate so gap / black-mark sensor finds label edges (SDKDemoApk). */
  @ReactMethod
  fun calibrate(promise: Promise) {
    executor.execute {
      try {
        ensureBluetoothPermission()
        LabelPrinterJob.calibrate(requireConnectedSocket())
        promise.resolve(null)
      } catch (err: Exception) {
        Log.e(TAG, "calibrate failed", err)
        promise.reject("LABEL_CALIBRATE", err.message, err)
      }
    }
  }

  /** Advance one label via gap / black-mark form-feed. */
  @ReactMethod
  fun pullIn(promise: Promise) {
    executor.execute {
      try {
        ensureBluetoothPermission()
        LabelPrinterJob.pullIn(requireConnectedSocket())
        promise.resolve(null)
      } catch (err: Exception) {
        Log.e(TAG, "pull-in failed", err)
        promise.reject("LABEL_PULLIN", err.message, err)
      }
    }
  }

  @ReactMethod
  fun disconnect(promise: Promise) {
    executor.execute {
      try {
        closeSocket()
        promise.resolve(null)
      } catch (err: Exception) {
        promise.reject("LABEL_DISCONNECT", err.message, err)
      }
    }
  }

  @SuppressLint("MissingPermission")
  private fun openSppSocket(adapter: BluetoothAdapter, device: BluetoothDevice): BluetoothSocket {
    stopDiscovery(adapter)
    val errors = mutableListOf<String>()

    // 1) Insecure SPP — most Chinese thermal printers need this.
    tryConnect("insecure SPP", errors) {
      device.createInsecureRfcommSocketToServiceRecord(SPP_UUID)
    }?.let { return it }

    // 2) Secure SPP — same as Microlan sdk2.
    tryConnect("secure SPP", errors) {
      device.createRfcommSocketToServiceRecord(SPP_UUID)
    }?.let { return it }

    // 3) Reflection channel 1 fallback.
    tryConnect("RFCOMM channel 1", errors) {
      @Suppress("UNCHECKED_CAST")
      val method = device.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
      method.invoke(device, 1) as BluetoothSocket
    }?.let { return it }

    throw IOException(
      "Could not connect to ${device.address}. Turn the printer on, close other print apps, then try again. (${errors.joinToString("; ")})",
    )
  }

  private fun tryConnect(
    label: String,
    errors: MutableList<String>,
    create: () -> BluetoothSocket,
  ): BluetoothSocket? {
    var socket: BluetoothSocket? = null
    return try {
      Log.i(TAG, "trying $label")
      socket = create()
      connectWithTimeout(socket, CONNECT_TIMEOUT_MS)
      Log.i(TAG, "$label connected")
      socket
    } catch (err: Exception) {
      val detail = err.message?.takeIf { it.isNotBlank() } ?: err.javaClass.simpleName
      Log.w(TAG, "$label failed: $detail")
      errors.add("$label: $detail")
      try {
        socket?.close()
      } catch (_: Exception) {
      }
      null
    }
  }

  /**
   * BluetoothSocket.connect() has no timeout and can hang forever on a busy/unsupported printer.
   * Closing the socket unblocks the connect thread.
   */
  private fun connectWithTimeout(socket: BluetoothSocket, timeoutMs: Long) {
    val error = AtomicReference<Exception>()
    val thread = Thread({
      try {
        socket.connect()
      } catch (err: Exception) {
        error.set(err)
      }
    }, "kds-bt-connect")
    thread.start()
    thread.join(timeoutMs)
    if (thread.isAlive) {
      try {
        socket.close()
      } catch (_: Exception) {
      }
      thread.join(1500)
      throw IOException("timed out after ${timeoutMs / 1000}s")
    }
    error.get()?.let { throw it }
  }

  @SuppressLint("MissingPermission")
  private fun findBondedDevice(adapter: BluetoothAdapter, address: String): BluetoothDevice? {
    return adapter.bondedDevices.orEmpty().firstOrNull {
      it.address.equals(address, ignoreCase = true)
    }
  }

  @SuppressLint("MissingPermission")
  private fun stopDiscovery(adapter: BluetoothAdapter) {
    try {
      if (adapter.isDiscovering) adapter.cancelDiscovery()
    } catch (_: SecurityException) {
    }
    var waits = 0
    while (adapter.isDiscovering && waits < 20) {
      try {
        Thread.sleep(100)
      } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
        break
      }
      waits += 1
      try {
        adapter.cancelDiscovery()
      } catch (_: SecurityException) {
      }
    }
  }

  private fun requireConnectedSocket(): BluetoothSocket {
    val socket = synchronized(lock) { printerSocket }
      ?: throw IllegalStateException("Connect a Bluetooth printer first.")
    if (!socket.isConnected) {
      closeSocket()
      throw IllegalStateException("Printer disconnected. Select it again, then print.")
    }
    return socket
  }

  private fun closeSocket() {
    synchronized(lock) {
      try {
        printerSocket?.close()
      } catch (_: Exception) {
      }
      printerSocket = null
      printerName = null
      printerAddress = null
    }
  }

  private fun statusMap(connected: Boolean) = Arguments.createMap().apply {
    putBoolean("connected", connected)
    if (!connected) return@apply
    putString("name", printerName ?: "Printer")
    putString("address", printerAddress)
  }

  private fun requireAdapter(): BluetoothAdapter {
    val adapter = bluetoothAdapter()
      ?: throw IllegalStateException("Bluetooth is not available on this device.")
    if (!adapter.isEnabled) throw IllegalStateException("Turn on Bluetooth, then try again.")
    return adapter
  }

  private fun bluetoothAdapter(): BluetoothAdapter? {
    val manager = reactContext.getSystemService(SystemBluetoothManager::class.java)
    return manager?.adapter
  }

  private fun ensureBluetoothPermission() {
    val needed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      listOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN)
    } else {
      listOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }
    val missing = needed.any {
      ContextCompat.checkSelfPermission(reactContext, it) != PackageManager.PERMISSION_GRANTED
    }
    if (missing) {
      throw IllegalStateException("Bluetooth permission is required to find the printer.")
    }
  }

  private fun ReadableMap.getStringOrEmpty(key: String): String {
    return if (hasKey(key) && !isNull(key)) getString(key)?.trim().orEmpty() else ""
  }

  companion object {
    private const val TAG = "KdsLabelPrinter"
    private const val CONNECT_TIMEOUT_MS = 8_000L
    /** Same SPP UUID Microlan sdk2 uses. */
    private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
  }
}
