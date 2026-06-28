package dev.diegobaldeschi.adyton;

import android.os.Bundle;

import androidx.activity.EdgeToEdge;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Required by @capacitor-community/safe-area: draw behind the system bars
        // and let the plugin/env(safe-area-inset-*) handle the insets.
        EdgeToEdge.enable(this);
    }
}
