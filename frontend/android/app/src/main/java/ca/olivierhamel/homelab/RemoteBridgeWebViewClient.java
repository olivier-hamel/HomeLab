package ca.olivierhamel.homelab;

import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.util.Log;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.webkit.ScriptHandler;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.JSExport;
import com.getcapacitor.PluginHandle;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.json.JSONObject;

/** Preserves Capacitor's navigation/interception while extending its document-start injection. */
final class RemoteBridgeWebViewClient extends BridgeWebViewClient {
    private static final String TAG = "HomeLabWebView";
    private final Bridge bridge;
    private ScriptHandler remoteScript;
    private String injectedOrigin;

    RemoteBridgeWebViewClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
        Log.i(TAG, "APK " + BuildConfig.VERSION_NAME + " WebView=" + bridge.getWebView().getSettings().getUserAgentString());
    }

    private static String origin(Uri uri) {
        return uri.buildUpon().path(null).clearQuery().fragment(null).build().toString();
    }

    private void prepareRemoteBridge(Uri destination) {
        // Capacitor 6.2.2 installs DOCUMENT_START_SCRIPT only for the local app URL,
        // then disables the HTML injector, including for allowNavigation hosts.
        // Register before navigation: onPageFinished is too late for module startup.
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
        String saved = bridge.getContext().getSharedPreferences("CapacitorStorage", 0).getString("homelab-server-url", null);
        if (saved == null) return;
        Uri server = Uri.parse(saved);
        String scheme = server.getScheme();
        if (!("http".equals(scheme) || "https".equals(scheme)) || server.getHost() == null) return;
        String selectedOrigin = origin(server);
        if (!selectedOrigin.equals(origin(destination)) || selectedOrigin.equals(origin(Uri.parse(bridge.getLocalUrl())))) return;
        if (selectedOrigin.equals(injectedOrigin)) return;

        try {
            // Export the built-in plugins and every application plugin used by this shell.
            List<PluginHandle> plugins = new ArrayList<>();
            for (String name : new String[] { "CapacitorCookies", "CapacitorHttp", "WebView", "App", "Preferences", "NativeVideoPlayer" }) {
                PluginHandle plugin = bridge.getPlugin(name);
                if (plugin != null) plugins.add(plugin);
            }
            String script = JSExport.getGlobalJS(bridge.getContext(), bridge.getConfig().isLoggingEnabled(), bridge.isDevMode()) +
                "\nwindow.WEBVIEW_SERVER_URL = " + JSONObject.quote(bridge.getLocalUrl()) + ";\n" +
                JSExport.getBridgeJS(bridge.getContext()) + "\n" + JSExport.getPluginJS(plugins);
            ScriptHandler next = WebViewCompat.addDocumentStartJavaScript(
                bridge.getWebView(), "if (window === window.top) {\n" + script + "\n}", Collections.singleton(selectedOrigin)
            );
            if (remoteScript != null) remoteScript.remove();
            remoteScript = next;
            injectedOrigin = selectedOrigin;
            Log.i(TAG, "Registered remote bridge for " + selectedOrigin);
        } catch (Exception error) {
            Log.e(TAG, "Could not register remote bridge for " + selectedOrigin, error);
        }
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        if (request.isForMainFrame()) prepareRemoteBridge(request.getUrl());
        return super.shouldOverrideUrlLoading(view, request);
    }

    @Override
    @SuppressWarnings("deprecation")
    public boolean shouldOverrideUrlLoading(WebView view, String url) {
        prepareRemoteBridge(Uri.parse(url));
        return super.shouldOverrideUrlLoading(view, url);
    }

    @Override
    public void onPageStarted(WebView view, String url, Bitmap favicon) {
        Log.i(TAG, "Page started " + url);
        super.onPageStarted(view, url, favicon);
    }

    @Override
    public void onPageFinished(WebView view, String url) {
        super.onPageFinished(view, url);
        Log.i(TAG, "Page finished " + url);
        view.evaluateJavascript(
            "JSON.stringify({ready:document.readyState,root:!!document.getElementById('root'),bridge:typeof window.Capacitor?.fromNative,plugins:window.Capacitor?.PluginHeaders?.map(function(p){return p.name})})",
            result -> Log.i(TAG, "Page state " + result)
        );
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        handler.cancel();
        String message;
        switch (error.getPrimaryError()) {
            case SslError.SSL_UNTRUSTED:
                message = "This Fire TV does not trust the server's HTTPS certificate. Install the HomeLab certificate or use a trusted HTTPS address.";
                break;
            case SslError.SSL_IDMISMATCH:
                message = "The HTTPS certificate does not match this server address. Use the address the certificate was issued for.";
                break;
            case SslError.SSL_EXPIRED:
            case SslError.SSL_NOTYETVALID:
            case SslError.SSL_DATE_INVALID:
                message = "The HTTPS certificate is not valid at the current date. Check the Fire TV clock and the server certificate.";
                break;
            default:
                message = "The server's HTTPS certificate could not be verified. Check the server certificate and try again.";
        }
        reportServerError(view, error.getUrl(), message);
    }

    private void reportServerError(WebView view, String url, String message) {
        Log.e(TAG, message + " " + url);
        view.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('homelab:server-error', {detail: {message: " +
                JSONObject.quote(message) + "}}))", null
        );
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        Log.e(TAG, "Load error " + error.getErrorCode() + " " + error.getDescription() + " mainFrame=" + request.isForMainFrame() + " " + request.getUrl());
        if (request.isForMainFrame()) reportServerError(view, request.getUrl().toString(), "Could not reach HomeLab. Check the server address and network connection, then try again.");
        super.onReceivedError(view, request, error);
    }

    @Override
    public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
        Log.e(TAG, "HTTP " + response.getStatusCode() + " mainFrame=" + request.isForMainFrame() + " " + request.getUrl());
        if (request.isForMainFrame()) reportServerError(view, request.getUrl().toString(), "HomeLab returned HTTP " + response.getStatusCode() + ". Check the server address and try again.");
        super.onReceivedHttpError(view, request, response);
    }
}
