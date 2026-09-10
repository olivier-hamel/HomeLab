package ca.olivierhamel.homelab;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.DefaultTrackNameProvider;
import androidx.media3.ui.DefaultTimeBar;
import androidx.media3.ui.PlayerView;
import com.getcapacitor.JSObject;
import java.io.File;
import java.io.FileInputStream;
import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.json.JSONObject;

@UnstableApi
public class NativeVideoPlayerActivity extends AppCompatActivity {
    private static final int CONTROLLER_TIMEOUT_MS = 4_000;
    private static final long TIMELINE_SEEK_INCREMENT_MS = 10_000;
    private static WeakReference<NativeVideoPlayerActivity> active = new WeakReference<>(null);
    static NativeVideoPlayerActivity current() {
        NativeVideoPlayerActivity activity = active.get();
        return activity == null || activity.isFinishing() ? null : activity;
    }

    private PlayerView playerView;
    private ExoPlayer player;
    private NativeSubtitleOverlay subtitles;
    private Button options;
    private AlertDialog dialog;
    private long positionMs;
    private long durationMs;
    private boolean playWhenReady = true;
    private boolean waitingForSource;
    private boolean closing;
    private boolean ended;
    private int requestId;
    private TrackSelectionParameters trackParameters;
    private float speed = 1f;
    private Button subtitleToggle;
    private boolean subtitlesEnabled;
    private boolean subtitlesLoading;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        active = new WeakReference<>(this);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        setContentView(R.layout.native_video_player);
        playerView = findViewById(R.id.native_player);
        // Captions use the same automatic English selection as desktop.
        playerView.setShowSubtitleButton(false);
        configureTvControls();
        options = findViewById(R.id.native_options);
        subtitleToggle = findViewById(R.id.native_subtitle_toggle);
        subtitleToggle.setOnClickListener(view -> toggleSubtitles());
        subtitleToggle.setOnFocusChangeListener((view, focused) -> playerView.setControllerShowTimeoutMs(focused ? 0 : CONTROLLER_TIMEOUT_MS));
        options.setOnClickListener(view -> showOptions());
        options.setOnFocusChangeListener((view, focused) -> playerView.setControllerShowTimeoutMs(focused ? 0 : CONTROLLER_TIMEOUT_MS));
        playerView.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener) visibility -> {
            findViewById(R.id.native_player_actions).setVisibility(waitingForSource ? View.GONE : visibility);
        });
        findViewById(R.id.native_source_retry).setOnClickListener(view -> nextSource());
        findViewById(R.id.native_source_quit).setOnClickListener(view -> closePlayer());
        subtitles = new NativeSubtitleOverlay(findViewById(R.id.native_subtitles), () -> player == null ? positionMs : player.getCurrentPosition());
        positionMs = state == null ? (long) (Math.max(0, getIntent().getDoubleExtra("position", 0)) * 1000) : state.getLong("position");
        if (state != null) {
            playWhenReady = state.getBoolean("playWhenReady", true);
            durationMs = state.getLong("duration");
            waitingForSource = state.getBoolean("waiting");
            speed = state.getFloat("speed", 1f);
            playerView.setResizeMode(state.getInt("resizeMode", AspectRatioFrameLayout.RESIZE_MODE_FIT));
        }
        subtitlesEnabled = state == null ? getIntent().hasExtra("subtitlePath") : state.getBoolean("subtitlesEnabled");
        if (subtitlesEnabled && !waitingForSource) {
            if (getIntent().hasExtra("subtitlePath")) loadInitialSubtitle();
            else requestAutomaticSubtitles();
        }
        updateSubtitleButton();
        if (waitingForSource) showSourceStatus("Waiting for another source…", false);
        else playerView.requestFocus();
    }

    private void configureTvControls() {
        // Media3's default focus feedback is designed primarily for touch screens.
        // Give every D-pad target a high-contrast TV focus ring and keep the
        // controller visible while the viewer is moving through its controls.
        styleFocusableControls(playerView);

        View progress = playerView.findViewById(androidx.media3.ui.R.id.exo_progress);
        if (progress instanceof DefaultTimeBar) {
            // The Media3 default divides the full duration into 20 key presses,
            // which can make one press jump several minutes in a long movie.
            ((DefaultTimeBar) progress).setKeyTimeIncrement(TIMELINE_SEEK_INCREMENT_MS);
        }
    }

    private void styleFocusableControls(View view) {
        if (view != playerView && view.isFocusable() && (view.isClickable() || view instanceof DefaultTimeBar)) {
            view.setBackgroundResource(R.drawable.player_control_focus);
            view.setOnFocusChangeListener((control, focused) -> {
                float focusedScale = control instanceof DefaultTimeBar ? 1f : 1.12f;
                control.animate().scaleX(focused ? focusedScale : 1f).scaleY(focused ? focusedScale : 1f).setDuration(120).start();
                control.setElevation(focused ? 12f : 0f);
                playerView.setControllerShowTimeoutMs(focused ? 0 : CONTROLLER_TIMEOUT_MS);
                if (focused) playerView.showController();
            });
        }
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) styleFocusableControls(group.getChildAt(i));
        }
    }

    boolean isWaitingForSource() { return waitingForSource; }

    void replacePlayback(Intent intent) {
        dismissDialog();
        requestId++;
        releasePlayer();
        deleteInitialSubtitle();
        setIntent(intent);
        subtitles.clear();
        positionMs = (long) (Math.max(0, intent.getDoubleExtra("position", 0)) * 1000);
        durationMs = 0;
        playWhenReady = true;
        ended = false;
        waitingForSource = false;
        trackParameters = null;
        findViewById(R.id.native_source_status).setVisibility(View.GONE);
        findViewById(R.id.native_player_actions).setVisibility(View.VISIBLE);
        if (getIntent().hasExtra("subtitlePath")) { subtitlesEnabled = true; loadInitialSubtitle(); }
        else if (subtitlesEnabled) requestAutomaticSubtitles();
        updateSubtitleButton();
        initializePlayer();
        subtitles.start();
        playerView.showController();
        playerView.requestFocus();
    }

    private void loadInitialSubtitle() {
        String path = getIntent().getStringExtra("subtitlePath");
        if (path == null) return;
        // Legacy bridge captions already have the source timeline offset applied.
        try (FileInputStream input = new FileInputStream(path)) {
            long size = new File(path).length();
            if (size > 2 * 1024 * 1024) return;
            byte[] bytes = new byte[(int) size];
            int read = 0, n;
            while (read < bytes.length && (n = input.read(bytes, read, bytes.length - read)) > 0) read += n;
            subtitles.load(new String(bytes, 0, read, StandardCharsets.UTF_8), getIntent().getStringExtra("subtitleName"), 0, error -> {
                subtitlesLoading = false;
                if (error == null) disableEmbeddedText();
                else { subtitlesEnabled = false; showMessage(error); }
                updateSubtitleButton();
            });
        } catch (Exception error) {
            subtitlesEnabled = false;
            updateSubtitleButton();
            showMessage("The selected subtitles could not be opened.");
        }
    }

    private void initializePlayer() {
        if (player != null || waitingForSource || closing) return;
        try {
            DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setUserAgent("HomeLab-TV/" + BuildConfig.VERSION_NAME).setConnectTimeoutMs(30_000).setReadTimeoutMs(90_000);
            String cookie = getIntent().getStringExtra("cookie");
            if (cookie != null && !cookie.isEmpty()) http.setDefaultRequestProperties(Collections.singletonMap("Cookie", cookie));
            player = new ExoPlayer.Builder(this, new DefaultRenderersFactory(this).setEnableDecoderFallback(true))
                .setMediaSourceFactory(new DefaultMediaSourceFactory(new DefaultDataSource.Factory(this, http))
                    .setLoadErrorHandlingPolicy(new DefaultLoadErrorHandlingPolicy(5)))
                .setLoadControl(new DefaultLoadControl.Builder().setBufferDurationsMs(15_000, 50_000, 2_500, 5_000)
                    .setTargetBufferBytes(32 * 1024 * 1024).setPrioritizeTimeOverSizeThresholds(false).build())
                .setSeekBackIncrementMs(TIMELINE_SEEK_INCREMENT_MS).setSeekForwardIncrementMs(TIMELINE_SEEK_INCREMENT_MS).build();
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true);
            player.setHandleAudioBecomingNoisy(true);
            player.setPlaybackSpeed(speed);
            if (trackParameters != null) player.setTrackSelectionParameters(trackParameters);
            disableEmbeddedText();
            playerView.setPlayer(player);
            player.addListener(new Player.Listener() {
                @Override public void onPlaybackStateChanged(int state) {
                    if (state == Player.STATE_ENDED) {
                        ended = true;
                        waitForSource("Playback finished.", true);
                        NativeVideoPlayerPlugin.complete(result("ended", null, 0));
                    }
                }
                @Override public void onPlayerError(PlaybackException error) {
                    Log.e("HomeLabPlayer", "Playback failed: " + error.getErrorCodeName());
                    String message = "Playback stopped (" + error.getErrorCodeName() + "). Try another source.";
                    waitForSource(message, true);
                    NativeVideoPlayerPlugin.complete(result("error", message, error.errorCode));
                }
            });
            MediaItem item = new MediaItem.Builder().setUri(getIntent().getStringExtra("url"))
                .setMediaMetadata(new MediaMetadata.Builder().setTitle(getIntent().getStringExtra("title")).build()).build();
            player.setMediaItem(item, positionMs);
            player.setPlayWhenReady(playWhenReady);
            player.prepare();
        } catch (RuntimeException error) {
            waitForSource("The video could not start. Try another source.", true);
            NativeVideoPlayerPlugin.complete(result("error", "The video player could not start.", 0));
        }
    }

    private void disableEmbeddedText() {
        if (player != null) player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build());
    }

    private void capturePosition() {
        if (player == null) return;
        positionMs = Math.max(0, player.getCurrentPosition());
        if (player.getDuration() != C.TIME_UNSET) durationMs = Math.max(0, player.getDuration());
        playWhenReady = player.getPlayWhenReady();
        trackParameters = player.getTrackSelectionParameters();
        speed = player.getPlaybackParameters().speed;
    }

    private void releasePlayer() {
        if (player == null) return;
        capturePosition();
        playerView.setPlayer(null);
        player.release();
        player = null;
    }

    private JSObject result(String action, String error, int errorCode) {
        capturePosition();
        JSObject result = new JSObject();
        result.put("action", action);
        result.put("sessionId", getIntent().getStringExtra("sessionId"));
        result.put("position", positionMs / 1000.0);
        result.put("duration", durationMs / 1000.0);
        result.put("ended", ended);
        if (error != null) { result.put("error", error); result.put("errorCode", errorCode); }
        return result;
    }

    private void waitForSource(String message, boolean error) {
        dismissDialog();
        requestId++;
        waitingForSource = true;
        releasePlayer();
        subtitles.stop();
        subtitles.cancelLoad();
        subtitlesLoading = false;
        showSourceStatus(message, error);
    }

    void showSourceStatus(String message, boolean error) {
        if (!waitingForSource) return;
        findViewById(R.id.native_source_status).setVisibility(View.VISIBLE);
        ((TextView) findViewById(R.id.native_source_message)).setText(message);
        findViewById(R.id.native_source_spinner).setVisibility(error ? View.GONE : View.VISIBLE);
        boolean canRetry = error && getIntent().getBooleanExtra("allowNext", false);
        findViewById(R.id.native_source_retry).setVisibility(canRetry ? View.VISIBLE : View.GONE);
        findViewById(R.id.native_player_actions).setVisibility(View.GONE);
        findViewById(canRetry ? R.id.native_source_retry : R.id.native_source_quit).requestFocus();
    }

    private void nextSource() {
        waitForSource("Looking for another source…", false);
        NativeVideoPlayerPlugin.complete(result("next", null, 0));
    }

    private void closePlayer() {
        if (closing) return;
        closing = true;
        requestId++;
        NativeVideoPlayerPlugin.complete(result("close", null, 0));
        finish();
    }

    private AlertDialog.Builder menu(String title) {
        return new AlertDialog.Builder(this, R.style.PlayerDialog).setTitle(title).setNegativeButton("Back", (d, which) -> {});
    }

    private void show(AlertDialog next) {
        dismissDialog();
        if (closing || isFinishing()) return;
        dialog = next;
        playerView.setControllerShowTimeoutMs(0);
        next.setOnDismissListener(d -> {
            if (dialog == next) dialog = null;
            if (!closing && !waitingForSource) { playerView.showController(); options.requestFocus(); }
        });
        next.show();
    }

    private void dismissDialog() {
        if (dialog != null) { AlertDialog previous = dialog; dialog = null; previous.dismiss(); }
    }

    private void showMessage(String message) { show(menu("Player").setMessage(message).create()); }

    private void showOptions() {
        if (waitingForSource) return;
        boolean allowNext = getIntent().getBooleanExtra("allowNext", false);
        String[] items = allowNext ? new String[] {"Audio track", "Picture size", "Try another source", "Quit to main page"}
            : new String[] {"Audio track", "Picture size", "Quit to main page"};
        show(menu("Player options").setItems(items, (d, which) -> {
            if (which == 0) showTracks(C.TRACK_TYPE_AUDIO);
            if (which == 1) showPictureSize();
            if (which == 2) { if (allowNext) nextSource(); else closePlayer(); }
            if (which == 3) closePlayer();
        }).create());
    }

    private void updateSubtitleButton() {
        subtitleToggle.setText(subtitlesLoading ? R.string.player_subtitles_loading :
            subtitlesEnabled ? R.string.player_subtitles_on : R.string.player_subtitles_off);
        subtitleToggle.setSelected(subtitlesEnabled);
    }

    private void toggleSubtitles() {
        if (waitingForSource || closing) return;
        subtitlesEnabled = !subtitlesEnabled;
        if (subtitlesEnabled) requestAutomaticSubtitles();
        else {
            subtitlesLoading = false;
            subtitles.clear();
            disableEmbeddedText();
            emitSubtitleRequest("subtitleOff");
        }
        updateSubtitleButton();
    }

    private void requestAutomaticSubtitles() {
        subtitlesLoading = true;
        subtitles.cancelLoad();
        updateSubtitleButton();
        emitSubtitleRequest("subtitleAuto");
    }

    private void emitSubtitleRequest(String action) {
        JSObject data = new JSObject();
        data.put("action", action);
        data.put("requestId", ++requestId);
        data.put("playbackId", getIntent().getStringExtra("playbackId"));
        NativeVideoPlayerPlugin.emit(data);
    }

    private void showPictureSize() {
        int[] modes = {AspectRatioFrameLayout.RESIZE_MODE_FIT, AspectRatioFrameLayout.RESIZE_MODE_ZOOM};
        show(menu("Picture size").setSingleChoiceItems(new String[] {"Fit — show the whole picture", "Zoom — fill screen, crop edges"},
            playerView.getResizeMode() == modes[0] ? 0 : 1, (d, which) -> { playerView.setResizeMode(modes[which]); d.dismiss(); }).create());
    }

    private void showTracks(int type) {
        if (player == null) return;
        List<String> names = new ArrayList<>();
        List<TrackSelectionOverride> overrides = new ArrayList<>();
        DefaultTrackNameProvider labels = new DefaultTrackNameProvider(getResources());
        int selected = -1;
        for (Tracks.Group group : player.getCurrentTracks().getGroups()) {
            if (group.getType() != type) continue;
            for (int i = 0; i < group.length; i++) {
                if (!group.isTrackSupported(i)) continue;
                if (group.isTrackSelected(i) && !(type == C.TRACK_TYPE_TEXT && subtitles.hasSubtitle())) selected = names.size();
                names.add(labels.getTrackName(group.getTrackFormat(i)));
                overrides.add(new TrackSelectionOverride(group.getMediaTrackGroup(), i));
            }
        }
        if (names.isEmpty()) { showMessage(type == C.TRACK_TYPE_TEXT ? "No supported embedded subtitles. Find subtitles online or choose an included file." : "No other supported audio tracks in this stream."); return; }
        show(menu(type == C.TRACK_TYPE_TEXT ? "Embedded subtitles" : "Audio track")
            .setSingleChoiceItems(names.toArray(new String[0]), selected, (d, which) -> {
                if (player == null) return;
                if (type == C.TRACK_TYPE_TEXT) { requestId++; subtitles.clear(); }
                player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon().setTrackTypeDisabled(type, false)
                    .setOverrideForType(overrides.get(which)).build());
                d.dismiss();
            }).create());
    }

    void respond(JSObject data) {
        if (waitingForSource || closing || data.optInt("requestId", -1) != requestId ||
            !data.optString("playbackId").equals(getIntent().getStringExtra("playbackId"))) return;
        if (!subtitlesEnabled) return;
        if (data.has("error")) {
            subtitlesEnabled = false;
            subtitlesLoading = false;
            updateSubtitleButton();
            showMessage(data.optString("error"));
            return;
        }
        JSONObject subtitle = data.optJSONObject("subtitle");
        if (subtitle != null) {
            int version = requestId;
            subtitles.load(subtitle.optString("content"), subtitle.optString("name", "Subtitles"),
                (long) (getIntent().getDoubleExtra("timelineOffset", 0) * 1000), error -> {
                    if (version != requestId || closing || waitingForSource) return;
                    subtitlesLoading = false;
                    if (error != null) { subtitlesEnabled = false; showMessage(error); }
                    else { disableEmbeddedText(); subtitles.start(); }
                    updateSubtitleButton();
                });
        }
    }

    @Override protected void onStart() {
        super.onStart();
        if (Build.VERSION.SDK_INT >= 24) initializePlayer();
        if (!waitingForSource) subtitles.start();
    }
    @Override protected void onResume() { super.onResume(); if (Build.VERSION.SDK_INT < 24) initializePlayer(); }
    @Override protected void onPause() { if (Build.VERSION.SDK_INT < 24) releasePlayer(); super.onPause(); }
    @Override protected void onStop() { subtitles.stop(); releasePlayer(); super.onStop(); }
    @Override protected void onSaveInstanceState(Bundle state) {
        capturePosition();
        state.putLong("position", positionMs); state.putLong("duration", durationMs);
        state.putBoolean("playWhenReady", playWhenReady); state.putBoolean("waiting", waitingForSource);
        state.putBoolean("subtitlesEnabled", subtitlesEnabled);
        state.putFloat("speed", speed); state.putInt("resizeMode", playerView.getResizeMode());
        super.onSaveInstanceState(state);
    }
    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        int key = event.getKeyCode();
        if (!waitingForSource && (key == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || key == KeyEvent.KEYCODE_MEDIA_PLAY ||
            key == KeyEvent.KEYCODE_MEDIA_PAUSE || key == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD || key == KeyEvent.KEYCODE_MEDIA_REWIND)) {
            return playerView.dispatchKeyEvent(event) || super.dispatchKeyEvent(event);
        }
        if (event.getKeyCode() == KeyEvent.KEYCODE_MENU) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) showOptions();
            return true;
        }
        if (!waitingForSource && !options.hasFocus() && !subtitleToggle.hasFocus() && event.getKeyCode() == KeyEvent.KEYCODE_DPAD_UP && event.getAction() == KeyEvent.ACTION_DOWN) {
            playerView.showController(); options.requestFocus(); return true;
        }
        if (waitingForSource || options.hasFocus() || subtitleToggle.hasFocus()) return super.dispatchKeyEvent(event);
        return playerView.dispatchKeyEvent(event) || super.dispatchKeyEvent(event);
    }
    @Override public void onBackPressed() { closePlayer(); }
    private void deleteInitialSubtitle() {
        String path = getIntent().getStringExtra("subtitlePath");
        if (path != null) new File(path).delete();
    }
    @Override protected void onDestroy() {
        dismissDialog();
        releasePlayer();
        subtitles.destroy();
        if (isFinishing()) {
            if (!closing) NativeVideoPlayerPlugin.complete(result("close", null, 0));
            deleteInitialSubtitle();
        }
        if (active.get() == this) active.clear();
        super.onDestroy();
    }
}
