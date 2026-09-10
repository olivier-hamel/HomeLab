package ca.olivierhamel.homelab;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeVideoPlayerPlugin.class);
        super.onCreate(savedInstanceState);
        if (bridge != null) bridge.setWebViewClient(new RemoteBridgeWebViewClient(bridge));
    }
}
