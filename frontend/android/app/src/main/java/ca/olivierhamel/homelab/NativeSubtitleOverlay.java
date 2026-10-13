package ca.olivierhamel.homelab;

import android.os.Handler;
import android.os.Looper;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.extractor.text.Subtitle;
import androidx.media3.extractor.text.webvtt.WebvttParser;
import androidx.media3.ui.SubtitleView;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** External captions have their own clock, so loading or retiming never reloads the video. */
@UnstableApi
final class NativeSubtitleOverlay {
    interface Position { long milliseconds(); }
    interface Loaded { void complete(String error); }
    private final SubtitleView view;
    private final Position position;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private Subtitle subtitle;
    private long baseOffsetMs;
    private long adjustmentMs;
    private int generation;
    private boolean running;
    private String name = "";
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            render();
            if (running) handler.postDelayed(this, 100);
        }
    };

    NativeSubtitleOverlay(SubtitleView view, Position position) {
        this.view = view;
        this.position = position;
    }

    void load(String content, String name, long baseOffsetMs, Loaded loaded) {
        int version = ++generation;
        worker.execute(() -> {
            Subtitle parsed = null;
            String error = null;
            try {
                byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
                if (bytes.length > 2 * 1024 * 1024 || !content.startsWith("WEBVTT")) throw new IllegalArgumentException();
                parsed = new WebvttParser().parseToLegacySubtitle(bytes, 0, bytes.length);
                if (parsed.getEventTimeCount() == 0) throw new IllegalArgumentException();
            } catch (RuntimeException problem) { error = "These subtitles could not be read. Choose another file."; }
            Subtitle result = parsed;
            String problem = error;
            handler.post(() -> {
                if (version != generation) return;
                if (problem == null) {
                    subtitle = result;
                    this.name = name;
                    this.baseOffsetMs = baseOffsetMs;
                    adjustmentMs = 0;
                    render();
                }
                loaded.complete(problem);
            });
        });
    }

    boolean hasSubtitle() { return subtitle != null; }
    String name() { return name; }
    long adjustmentMs() { return adjustmentMs; }
    void adjust(long value) { adjustmentMs = Math.max(-600_000, Math.min(600_000, value)); render(); }
    void clear() { generation++; subtitle = null; name = ""; adjustmentMs = 0; render(); }
    void cancelLoad() { generation++; }
    void start() { if (!running) { running = true; handler.post(tick); } }
    void stop() { running = false; handler.removeCallbacks(tick); }
    void destroy() { stop(); generation++; worker.shutdownNow(); }

    private void render() {
        view.setCues(subtitle == null ? Collections.emptyList() : subtitle.getCues((position.milliseconds() + baseOffsetMs - adjustmentMs) * 1000));
    }
}
