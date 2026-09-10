package ca.olivierhamel.homelab;

import android.content.Intent;
import android.net.Uri;
import android.webkit.CookieManager;
import androidx.media3.common.Format;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.mediacodec.MediaCodecInfo;
import androidx.media3.exoplayer.mediacodec.MediaCodecUtil;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;

@CapacitorPlugin(name = "NativeVideoPlayer")
@UnstableApi
public class NativeVideoPlayerPlugin extends Plugin {
    private static WeakReference<NativeVideoPlayerPlugin> instance = new WeakReference<>(null);
    private PluginCall playbackCall;
    private String closedSession;

    @Override
    public void load() {
        instance = new WeakReference<>(this);
    }

    @PluginMethod
    public void supportedOptions(PluginCall call) {
        JSArray options = call.getArray("options");
        if (options == null || options.length() > 20) {
            call.reject("Playback options are required.");
            return;
        }
        JSArray supported = new JSArray();
        for (int i = 0; i < options.length(); i++) {
            JSONObject option = options.optJSONObject(i);
            if (option == null || !Arrays.asList("mp4", "mov", "matroska", "webm", "mpegts").contains(option.optString("container"))) continue;
            Matcher codecs = Pattern.compile("codecs=\"([^\"]+)\"").matcher(option.optString("mime"));
            if (!codecs.find()) continue;
            boolean playable = true;
            boolean hasVideo = false;
            for (String codec : codecs.group(1).split(",")) {
                String mime = MimeTypes.getMediaMimeType(codec.trim());
                if (mime == null) { playable = false; break; }
                boolean video = MimeTypes.isVideo(mime);
                hasVideo |= video;
                Format.Builder format = new Format.Builder().setSampleMimeType(mime).setCodecs(codec.trim());
                if (video) {
                    format.setWidth(call.getInt("width", Format.NO_VALUE)).setHeight(call.getInt("height", Format.NO_VALUE))
                        .setFrameRate(call.getDouble("frameRate", -1.0).floatValue());
                }
                boolean decodable = false;
                try {
                    for (MediaCodecInfo decoder : MediaCodecUtil.getDecoderInfos(mime, false, false)) {
                        // Software video decoding can advertise support but cannot sustain HD on a stick.
                        if ((!video || decoder.hardwareAccelerated) && decoder.isFormatSupported(format.build())) {
                            decodable = true;
                            break;
                        }
                    }
                } catch (MediaCodecUtil.DecoderQueryException | RuntimeException ignored) {
                    // A broken vendor query must not advertise a format as supported.
                }
                if (!decodable) { playable = false; break; }
            }
            if (playable && hasVideo) supported.put(option.optString("id"));
        }
        JSObject response = new JSObject();
        response.put("supported", supported);
        call.resolve(response);
    }


    static void emit(JSObject event) {
        NativeVideoPlayerPlugin plugin = instance.get();
        if (plugin != null) plugin.notifyListeners("playerRequest", event);
    }

    static void complete(JSObject result) {
        NativeVideoPlayerPlugin plugin = instance.get();
        if (plugin == null) return;
        if ("close".equals(result.getString("action"))) plugin.closedSession = result.getString("sessionId");
        PluginCall call = plugin.playbackCall;
        plugin.playbackCall = null;
        if (call != null) call.resolve(result);
        else if ("close".equals(result.getString("action"))) emit(new JSObject().put("action", "close"));
        else if ("next".equals(result.getString("action"))) emit(new JSObject().put("action", "next"));
    }

    private File cacheSubtitle(JSObject subtitle) throws IOException {
        String content = subtitle.getString("content");
        if (content == null || !content.startsWith("WEBVTT")) throw new IOException("Choose valid WebVTT subtitles.");
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 2 * 1024 * 1024) throw new IOException("Subtitle files must be 2 MiB or smaller.");
        File directory = new File(getContext().getCacheDir(), "native-subtitles");
        if (!directory.exists() && !directory.mkdirs()) throw new IOException("Cannot create the subtitle cache.");
        File file = new File(directory, UUID.randomUUID() + ".vtt");
        try (FileOutputStream output = new FileOutputStream(file)) { output.write(bytes); }
        return file;
    }

    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url");
        Uri uri = url == null ? Uri.EMPTY : Uri.parse(url);
        if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) || uri.getHost() == null) {
            call.reject("An HTTP or HTTPS video URL is required.");
            return;
        }
        Intent intent = new Intent(getContext(), NativeVideoPlayerActivity.class);
        intent.putExtra("url", url);
        intent.putExtra("title", call.getString("title", "HomeLab TV"));
        intent.putExtra("position", call.getDouble("position", 0.0));
        intent.putExtra("timelineOffset", call.getDouble("timelineOffset", 0.0));
        intent.putExtra("playbackId", call.getString("playbackId", ""));
        intent.putExtra("searchQuery", call.getString("searchQuery", ""));
        intent.putExtra("sessionId", call.getString("sessionId", ""));
        intent.putExtra("allowNext", call.getBoolean("allowNext", false));
        String cookie = CookieManager.getInstance().getCookie(url);
        if (cookie != null) intent.putExtra("cookie", cookie);
        JSObject subtitle = call.getObject("subtitle");
        File cached;
        try {
            cached = subtitle == null ? null : cacheSubtitle(subtitle);
            if (cached != null) {
                intent.putExtra("subtitlePath", cached.getAbsolutePath());
                intent.putExtra("subtitleName", subtitle.getString("name", "Subtitles"));
            }
        } catch (IOException error) {
            call.reject(error.getMessage());
            return;
        }
        getActivity().runOnUiThread(() -> {
            NativeVideoPlayerActivity activity = NativeVideoPlayerActivity.current();
            if (closedSession != null && closedSession.equals(intent.getStringExtra("sessionId"))) {
                if (cached != null) cached.delete();
                call.resolve(new JSObject().put("action", "close").put("position", 0).put("duration", 0).put("ended", false));
                return;
            }
            if (playbackCall != null || (activity != null && !activity.isWaitingForSource())) {
                if (cached != null) cached.delete();
                call.reject("A native video is already playing.");
                return;
            }
            playbackCall = call;
            try {
                if (activity == null) getActivity().startActivity(intent);
                else activity.replacePlayback(intent);
            } catch (RuntimeException error) {
                playbackCall = null;
                if (cached != null) cached.delete();
                call.reject("The native video player could not be opened.", error);
            }
        });
    }

    @PluginMethod
    public void respond(PluginCall call) {
        // Commands are scoped to the selected file and request, so a late subtitle
        // download cannot affect a different source or undo the viewer choosing Off.
        JSObject data = call.getData();
        getActivity().runOnUiThread(() -> {
            NativeVideoPlayerActivity activity = NativeVideoPlayerActivity.current();
            if (activity != null) activity.respond(data);
            call.resolve();
        });
    }

    @PluginMethod
    public void status(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            NativeVideoPlayerActivity activity = NativeVideoPlayerActivity.current();
            if (activity != null && activity.isWaitingForSource()) activity.showSourceStatus(call.getString("message", "Loading video…"), call.getBoolean("error", false));
            call.resolve();
        });
    }
}
