package ca.olivierhamel.homelab;

import android.content.Intent;
import android.net.Uri;
import android.webkit.CookieManager;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

@CapacitorPlugin(name = "NativeVideoPlayer")
public class NativeVideoPlayerPlugin extends Plugin {
    private static final int MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;

    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("A video URL is required.");
            return;
        }
        Uri uri = Uri.parse(url);
        if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))) {
            call.reject("Only HTTP and HTTPS video URLs are supported.");
            return;
        }

        Intent intent = new Intent(getContext(), NativeVideoPlayerActivity.class);
        intent.putExtra(NativeVideoPlayerActivity.EXTRA_URL, url);
        intent.putExtra(NativeVideoPlayerActivity.EXTRA_TITLE, call.getString("title", "HomeLab TV"));
        intent.putExtra(NativeVideoPlayerActivity.EXTRA_POSITION, call.getDouble("position", 0.0));
        String cookie = CookieManager.getInstance().getCookie(url);
        if (cookie != null && !cookie.isEmpty()) intent.putExtra(NativeVideoPlayerActivity.EXTRA_COOKIE, cookie);
        JSObject subtitle = call.getObject("subtitle");
        if (subtitle != null) {
            String content = subtitle.getString("content");
            if (content == null || !content.startsWith("WEBVTT")) {
                call.reject("The native subtitle must be valid WebVTT.");
                return;
            }
            byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
            if (bytes.length > MAX_SUBTITLE_BYTES) {
                call.reject("Native subtitles must be 2 MiB or smaller.");
                return;
            }
            File directory = new File(getContext().getCacheDir(), "native-subtitles");
            if (!directory.exists() && !directory.mkdirs()) {
                call.reject("The native subtitle cache could not be created.");
                return;
            }
            File file = new File(directory, UUID.randomUUID() + ".vtt");
            try (FileOutputStream output = new FileOutputStream(file)) {
                output.write(bytes);
            } catch (IOException error) {
                call.reject("The native subtitle could not be cached.", error);
                return;
            }
            intent.putExtra(NativeVideoPlayerActivity.EXTRA_SUBTITLE_PATH, file.getAbsolutePath());
            intent.putExtra(NativeVideoPlayerActivity.EXTRA_SUBTITLE_LANGUAGE, subtitle.getString("language", "und"));
            intent.putExtra(NativeVideoPlayerActivity.EXTRA_SUBTITLE_NAME, subtitle.getString("name", "Subtitles"));
        }
        try {
            startActivityForResult(call, intent, "playerResult");
        } catch (RuntimeException error) {
            String path = intent.getStringExtra(NativeVideoPlayerActivity.EXTRA_SUBTITLE_PATH);
            if (path != null) new File(path).delete();
            call.reject("The native video player could not be opened.", error);
        }
    }

    @ActivityCallback
    private void playerResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (data != null && data.hasExtra(NativeVideoPlayerActivity.EXTRA_ERROR)) {
            call.reject(data.getStringExtra(NativeVideoPlayerActivity.EXTRA_ERROR));
            return;
        }
        JSObject response = new JSObject();
        response.put("position", data == null ? 0 : data.getDoubleExtra(NativeVideoPlayerActivity.EXTRA_RESULT_POSITION, 0));
        response.put("duration", data == null ? 0 : data.getDoubleExtra(NativeVideoPlayerActivity.EXTRA_RESULT_DURATION, 0));
        response.put("ended", data != null && data.getBooleanExtra(NativeVideoPlayerActivity.EXTRA_RESULT_ENDED, false));
        call.resolve(response);
    }
}
