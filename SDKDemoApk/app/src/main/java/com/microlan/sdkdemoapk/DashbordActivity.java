package com.microlan.sdkdemoapk;



import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Dialog;
import android.bluetooth.BluetoothSocket;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;


import com.microlan.printersdk2.BluetoothManager;
import com.microlan.printersdk2.PrinterCommands;
import com.microlan.printersdk2.PrinterSDK;
import com.microlan.printersdk2.Utils;

import java.io.IOException;
import java.io.OutputStream;
import java.io.UnsupportedEncodingException;

public class DashbordActivity extends AppCompatActivity {
    private String TAG = "Main Activity";
    EditText message;
    ImageView imgPrint;
    private Dialog loadingDialog;
    Button btnPrint, btnBill, btnImage,btnConnectPrinter, btnLabel50x25, btnCalibrate;
    private static final int REQUEST_IMAGE_GALLERY = 1;
    private static final int REQUEST_PERMISSIONS = 2;

    // ============================================================
    // HARDCODE PHYSICAL LABEL + PRINTER WIDTH HERE
    // ============================================================
    /** Physical sticker size in millimetres (change these for your stock). */
    private static final float LABEL_WIDTH_MM = 50f;   // ← label width  (mm)
    private static final float LABEL_HEIGHT_MM = 25f;  // ← label height (mm)

    /**
     * Printable dots across the print head (NOT the sticker width).
     * 58 mm class heads ≈ 384 px @ 203 dpi
     * 80 mm class heads ≈ 576 px @ 203 dpi
     */
    private static final int PRINTER_WIDTH_PX = 384;   // ← 384 (58mm) or 576 (80mm)

    /** Dots per mm @ 203 dpi (8 dots/mm). Used only to size the canvas from mm. */
    private static final float DOTS_PER_MM = 8f;

    /**
     * Label separator — ESC/POS GS FF (0x1D 0x0C).
     * Advances to the next gap / black-mark. printersdk2 has no dedicated API;
     * do NOT use printNewLine() / FEED_LINE for labels (that is continuous receipt feed).
     */
    private static final byte[] LABEL_FORM_FEED = new byte[]{0x1D, 0x0C};

    byte FONT_TYPE;
    private static BluetoothSocket btsocket;
    private static OutputStream outputStream;

    @SuppressLint("MissingInflatedId")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_dashbord);

        message = findViewById(R.id.txtMessage);
        btnPrint = findViewById(R.id.btnPrint);
        btnBill = findViewById(R.id.btnBill);
        btnImage = findViewById(R.id.btnImage);
        imgPrint = findViewById(R.id.imgPrint);
        btnConnectPrinter = findViewById(R.id.btnConnectPrinter);
        btnLabel50x25 = findViewById(R.id.btnLabel50x25);
        btnCalibrate = findViewById(R.id.btnCalibrate);

        loadingDialog = new Dialog(DashbordActivity.this);
        loadingDialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        loadingDialog.setContentView(R.layout.layout_progress);

        // Check permissions
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.READ_EXTERNAL_STORAGE}, REQUEST_PERMISSIONS);
        }

        btnPrint.setOnClickListener(v -> {

                printText(message.getText().toString());

        });

        btnImage.setOnClickListener(v -> {
            Intent intent = new Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI);
            startActivityForResult(intent, REQUEST_IMAGE_GALLERY);
        });

        btnConnectPrinter.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Intent intentconnect = new Intent(DashbordActivity.this,DeviceList.class);
                startActivity(intentconnect);
            }
        });

        btnLabel50x25.setOnClickListener(v -> printLabel50x25());

        btnCalibrate.setOnClickListener(v -> calibratePrinter());

        // Assume a method to connect to Bluetooth device and initialize btsocket
        connectToBluetoothDevice();
    }

    /**
     * Label calibration / feed test.
     * Uses INIT + form-feed (gap/black-mark), not continuous FEED_LINE.
     */
    private void calibratePrinter() {
        try {
            OutputStream out = requirePrinterOut();
            out.write(PrinterCommands.INIT);
            // Advance across a few labels via sensor, not line feeds
            for (int i = 0; i < 3; i++) {
                out.write(LABEL_FORM_FEED);
            }
            out.flush();
            Toast.makeText(this, "Calibration / feed test sent. Wait for paper to stop.", Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            e.printStackTrace();
            Toast.makeText(this, "Calibrate failed: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private void printLabel50x25() {
        Bitmap labelBmp = null;
        Bitmap fitted = null;
        try {
            loadingDialog.show();

            // 1) Build canvas from hardcoded physical label mm size
            labelBmp = createLabelBitmap();

            // 2) Fit to print-head width without stretching (aspect preserved)
            fitted = fitToPrinterWidth(labelBmp, PRINTER_WIDTH_PX);

            // 3) SDK image prep + raster — do NOT use printPhoto (it appends \n feeds)
            BluetoothManager bluetoothManager = BluetoothManager.getInstance(this);
            BluetoothSocket bluetoothSocket = bluetoothManager.getBluetoothSocket();
            if (bluetoothSocket == null || !bluetoothSocket.isConnected()) {
                Toast.makeText(this, "Connect printer first", Toast.LENGTH_SHORT).show();
                return;
            }

            PrinterSDK printerSDK = new PrinterSDK(bluetoothSocket);
            // Skip printerSDK.resizeBitmap — it targets receipt sizes (450×530) and can distort labels
            Bitmap processed = printerSDK.prepareImageForPrint(fitted);
            byte[] raster = Utils.decodeBitmap(processed);

            OutputStream out = bluetoothSocket.getOutputStream();
            out.write(PrinterCommands.INIT);
            out.write(raster);
            // 4) Gap / black-mark form-feed instead of printNewLine() / \n
            //    NOTE: PrinterSDK.printText(byte[]) always appends FEED_LINE — avoid it for labels.
            out.write(LABEL_FORM_FEED);
            out.flush();

            Toast.makeText(this, "Label sent (" + LABEL_WIDTH_MM + "x" + LABEL_HEIGHT_MM + " mm)", Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            e.printStackTrace();
            Toast.makeText(this, "Label print failed: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        } finally {
            loadingDialog.cancel();
            if (fitted != null && fitted != labelBmp && !fitted.isRecycled()) {
                fitted.recycle();
            }
            if (labelBmp != null && !labelBmp.isRecycled()) {
                labelBmp.recycle();
            }
        }
    }

    /**
     * Creates the label layout canvas from {@link #LABEL_WIDTH_MM} / {@link #LABEL_HEIGHT_MM}.
     * Canvas pixels = mm × {@link #DOTS_PER_MM} (203 dpi).
     */
    private Bitmap createLabelBitmap() {
        // ★ Physical size → canvas pixels (hardcoded mm constants above)
        final int width = Math.round(LABEL_WIDTH_MM * DOTS_PER_MM);
        final int height = Math.round(LABEL_HEIGHT_MM * DOTS_PER_MM);
        final int padX = Math.max(4, width / 40);
        final int padY = Math.max(4, height / 25);

        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        canvas.drawColor(Color.WHITE);

        Paint paint = new Paint();
        paint.setColor(Color.BLACK);
        paint.setAntiAlias(false);
        paint.setStyle(Paint.Style.FILL);

        paint.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD));
        paint.setTextSize(height * 0.12f);
        paint.setTextAlign(Paint.Align.LEFT);
        canvas.drawText("Sample Product", padX, padY + paint.getTextSize(), paint);

        paint.setTextAlign(Paint.Align.RIGHT);
        canvas.drawText("Rs.99", width - padX, padY + paint.getTextSize(), paint);

        float dividerY = padY + paint.getTextSize() + 6f;
        paint.setStrokeWidth(2f);
        canvas.drawLine(padX, dividerY, width - padX, dividerY, paint);

        int barTop = (int) (dividerY + 8);
        int barBottom = height - padY - Math.round(height * 0.18f);
        int barLeft = padX;
        int barRight = width - padX;
        int[] modules = {
                1,1,1,0,1,0,0,1,0,1,1,0,0,1,0,1,0,0,1,1,0,1,0,1,1,0,0,1,0,1,
                0,0,1,1,0,1,1,0,0,1,0,1,0,1,1,0,0,1,0,1,0,0,1,1,0,1,0,1,1,0,
                1,0,0,1,0,1,1,0,0,1,1,0,1,0,1,0,0,1,1,0,1,0,0,1,0,1,1,0,1,1
        };
        int moduleW = Math.max(2, (barRight - barLeft) / modules.length);
        int x = barLeft + ((barRight - barLeft) - moduleW * modules.length) / 2;
        for (int i = 0; i < modules.length; i++) {
            if (modules[i] == 1) {
                canvas.drawRect(x, barTop, x + moduleW, barBottom, paint);
            }
            x += moduleW;
        }

        paint.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL));
        paint.setTextSize(height * 0.08f);
        paint.setTextAlign(Paint.Align.LEFT);
        canvas.drawText("2000000000008", padX, height - padY, paint);
        paint.setTextAlign(Paint.Align.RIGHT);
        canvas.drawText("1/1", width - padX, height - padY, paint);

        return bitmap;
    }

    /**
     * Scales bitmap down to {@code maxWidthPx} preserving aspect ratio (no stretch).
     * Upscaling is skipped — never widen beyond native canvas size.
     */
    private Bitmap fitToPrinterWidth(Bitmap source, int maxWidthPx) {
        if (source == null) return null;
        int srcW = source.getWidth();
        int srcH = source.getHeight();
        if (srcW <= maxWidthPx) {
            return source;
        }
        float scale = maxWidthPx / (float) srcW;
        int dstW = maxWidthPx;
        int dstH = Math.max(1, Math.round(srcH * scale));
        return Bitmap.createScaledBitmap(source, dstW, dstH, false);
    }

    private OutputStream requirePrinterOut() throws IOException {
        BluetoothManager bluetoothManager = BluetoothManager.getInstance(this);
        BluetoothSocket bluetoothSocket = bluetoothManager.getBluetoothSocket();
        if (bluetoothSocket == null || !bluetoothSocket.isConnected()) {
            throw new IOException("Connect printer first");
        }
        return bluetoothSocket.getOutputStream();
    }

    private void connectToBluetoothDevice() {
        // Implementation for connecting to a Bluetooth device and initializing btsocket and outputStream
    }

    private void printText(String msg) {
        BluetoothManager bluetoothManager = BluetoothManager.getInstance(this);
        BluetoothSocket bluetoothSocket = bluetoothManager.getBluetoothSocket();
        PrinterSDK printerSDK = new PrinterSDK(bluetoothSocket);
        printerSDK.printText(msg);
        printerSDK.printNewLine();
        printerSDK.printNewLine();

    }

    private void printPhoto(Bitmap bmp) {
        loadingDialog.show();
        BluetoothManager bluetoothManager = BluetoothManager.getInstance(this);
        BluetoothSocket bluetoothSocket = bluetoothManager.getBluetoothSocket();
        PrinterSDK printerSDK = new PrinterSDK(bluetoothSocket);
        Bitmap processedBitmap = printerSDK.resizeBitmap(bmp);
         processedBitmap = printerSDK.prepareImageForPrint(processedBitmap);
        byte[] command = Utils.decodeBitmap(processedBitmap);
        printerSDK.printText(command);
        printerSDK.printNewLine();
        printerSDK.printNewLine();
        loadingDialog.cancel();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == REQUEST_IMAGE_GALLERY && resultCode == RESULT_OK && data != null) {
            Uri imageUri = data.getData();
            if (imageUri != null) {
                try {
                    Bitmap bitmap = MediaStore.Images.Media.getBitmap(this.getContentResolver(), imageUri);
                    printPhoto(bitmap);
                } catch (IOException e) {
                    e.printStackTrace();
                    Toast.makeText(this, "Failed to load image", Toast.LENGTH_SHORT).show();
                }
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_PERMISSIONS) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                // Permission granted
            } else {
                Toast.makeText(this, "Permission denied", Toast.LENGTH_SHORT).show();
            }
        }
    }
}
