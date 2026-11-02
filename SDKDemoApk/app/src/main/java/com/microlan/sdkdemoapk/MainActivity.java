package com.microlan.sdkdemoapk;



import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;



import java.util.ArrayList;
import java.util.List;

public class MainActivity extends AppCompatActivity {

    private static final int PERMISSION_REQUEST_CODE = 1;
    private TextView permissionStatus;
    private Button checkPermissionsButton;
    private Button startFunctionalityButton;

    // SharedPreferences for storing permission state
    private SharedPreferences sharedPreferences;
    private static final String PREFS_NAME = "PermissionPrefs";
    private static final String KEY_PERMISSIONS_GRANTED = "permissionsGranted";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        permissionStatus = findViewById(R.id.permissionStatus);
        checkPermissionsButton = findViewById(R.id.checkPermissionsButton);
        startFunctionalityButton = findViewById(R.id.startFunctionalityButton);

        // Initialize SharedPreferences
        sharedPreferences = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);

        // Check if permissions have been granted before
        if (!sharedPreferences.getBoolean(KEY_PERMISSIONS_GRANTED, false)) {
            checkAndRequestPermissions();
        } else {
            updatePermissionStatus("All required permissions granted.");
            proceedWithAppFunctionality();
        }

        checkPermissionsButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (!sharedPreferences.getBoolean(KEY_PERMISSIONS_GRANTED, false)) {
                    checkAndRequestPermissions();
                } else {
                    Toast.makeText(MainActivity.this, "Permissions already granted.", Toast.LENGTH_SHORT).show();
                }
            }
        });

        startFunctionalityButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {

                proceedWithAppFunctionality();

            }
        });
    }

    private void checkAndRequestPermissions() {
        List<String> neededPermissions = new ArrayList<>();

        // Required permissions
        String[] permissions = {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.READ_EXTERNAL_STORAGE,
                Manifest.permission.WRITE_EXTERNAL_STORAGE,
                Manifest.permission.BLUETOOTH,
                Manifest.permission.BLUETOOTH_ADMIN,
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.BLUETOOTH_SCAN
        };

        for (String permission : permissions) {
            if (ContextCompat.checkSelfPermission(this, permission) != PackageManager.PERMISSION_GRANTED) {
                neededPermissions.add(permission);
            }
        }

        if (!neededPermissions.isEmpty()) {
            String[] permissionsArray = neededPermissions.toArray(new String[0]);
            ActivityCompat.requestPermissions(this, permissionsArray, PERMISSION_REQUEST_CODE);
        } else {
            // If all permissions are granted, update the SharedPreferences
            updatePermissionStatus("All required permissions granted.");
            sharedPreferences.edit().putBoolean(KEY_PERMISSIONS_GRANTED, true).apply();
            proceedWithAppFunctionality();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == PERMISSION_REQUEST_CODE) {
            boolean allPermissionsGranted = true;
            for (int result : grantResults) {
                if (result != PackageManager.PERMISSION_GRANTED) {
                    allPermissionsGranted = false;
                    break;
                }
            }

            if (allPermissionsGranted) {
                updatePermissionStatus("All required permissions granted.");
                sharedPreferences.edit().putBoolean(KEY_PERMISSIONS_GRANTED, true).apply();
                proceedWithAppFunctionality();
            } else {
                updatePermissionStatus("Required permissions are needed for the app to function properly.");
                Toast.makeText(this, "Required permissions are needed for the app to function properly.", Toast.LENGTH_LONG).show();

                // Check if permissions were denied permanently
                for (int i = 0; i < permissions.length; i++) {
                    if (grantResults[i] == PackageManager.PERMISSION_DENIED) {
                        if (!ActivityCompat.shouldShowRequestPermissionRationale(this, permissions[i])) {
                            // Permission denied permanently
                            Toast.makeText(this, "Permission denied permanently. Please enable it in app settings.", Toast.LENGTH_LONG).show();
                            // Redirect to app settings
                            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                            intent.setData(Uri.parse("package:" + getPackageName()));
                            startActivity(intent);
                        }
                    }
                }
            }
        }
    }

    private void proceedWithAppFunctionality() {
        // Intent to start Dashboard activity
        Intent intent = new Intent(MainActivity.this, DashbordActivity.class);
        startActivity(intent);
        finish(); // Close MainActivity if no longer needed
    }

    private boolean arePermissionsGranted() {
        String[] permissions = {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.READ_EXTERNAL_STORAGE,
                Manifest.permission.WRITE_EXTERNAL_STORAGE,
                Manifest.permission.BLUETOOTH,
                Manifest.permission.BLUETOOTH_ADMIN,
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.BLUETOOTH_SCAN
        };

        for (String permission : permissions) {
            if (ContextCompat.checkSelfPermission(this, permission) != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        return true;
    }

    private void updatePermissionStatus(String message) {
        permissionStatus.setText(message);
    }
}