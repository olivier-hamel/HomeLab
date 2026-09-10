package ca.olivierhamel.homelab;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.media.MediaFormat;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.MediaController;
import android.widget.Toast;
import android.widget.VideoView;
import androidx.appcompat.app.AppCompatActivity;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.util.HashMap;
import java.util.Map;

public class NativeVideoPlayerActivity extends AppCompatActivity {
    public static final String EXTRA_URL = "url";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_COOKIE = "cookie";
    public static final String EXTRA_POSITION = "position";
    public static final String EXTRA_SUBTITLE_PATH = "subtitlePath";
    public static final String EXTRA_SUBTITLE_LANGUAGE = "subtitleLanguage";
    public static final String EXTRA_SUBTITLE_NAME = "subtitleName";
    public static final String EXTRA_ERROR = "error";
    public static final String EXTRA_RESULT_POSITION = "resultPosition";
    public static final String EXTRA_RESULT_DURATION = "resultDuration";
    public static final String EXTRA_RESULT_ENDED = "resultEnded";

    private VideoView video;
    private boolean ended;
    private boolean resultSent;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        setTitle(getIntent().getStringExtra(EXTRA_TITLE));

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        video = new VideoView(this);
        root.addView(video, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        MediaController controls = new MediaController(this);
        controls.setAnchorView(video);
        video.setMediaController(controls);
        video.setOnPreparedListener(player -> {
            player.setScreenOnWhilePlaying(true);
            int position = (int) Math.min(Integer.MAX_VALUE, Math.max(0, getIntent().getDoubleExtra(EXTRA_POSITION, 0) * 1000));
            if (position > 0) video.seekTo(position);
            video.start();
            controls.show(3000);
        });
        video.setOnCompletionListener(player -> { ended = true; finishWithResult(); });
        video.setOnInfoListener((player, what, extra) -> {
            if (what == MediaPlayer.MEDIA_INFO_UNSUPPORTED_SUBTITLE || what == MediaPlayer.MEDIA_INFO_SUBTITLE_TIMED_OUT) {
                Toast.makeText(this, "The selected subtitles could not be displayed.", Toast.LENGTH_LONG).show();
            }
            return false;
        });
        video.setOnErrorListener((player, what, extra) -> {
            String message = "The native Android player could not decode this video.";
            Toast.makeText(this, message, Toast.LENGTH_LONG).show();
            Intent data = new Intent().putExtra(EXTRA_ERROR, message + " (" + what + "/" + extra + ")");
            setResult(Activity.RESULT_CANCELED, data);
            resultSent = true;
            finish();
            return true;
        });

        Map<String, String> headers = new HashMap<>();
        String cookie = getIntent().getStringExtra(EXTRA_COOKIE);
        if (cookie != null && !cookie.isEmpty()) headers.put("Cookie", cookie);
        video.setVideoURI(Uri.parse(getIntent().getStringExtra(EXTRA_URL)), headers);
        String subtitlePath = getIntent().getStringExtra(EXTRA_SUBTITLE_PATH);
        if (subtitlePath != null) {
            try {
                MediaFormat format = MediaFormat.createSubtitleFormat(MediaFormat.MIMETYPE_TEXT_VTT, getIntent().getStringExtra(EXTRA_SUBTITLE_LANGUAGE));
                video.addSubtitleSource(new FileInputStream(subtitlePath), format);
            } catch (FileNotFoundException error) {
                Toast.makeText(this, "The selected subtitles could not be opened.", Toast.LENGTH_LONG).show();
            }
        }
        video.requestFocus();
    }

    private void seekBy(int milliseconds) {
        if (video == null) return;
        video.seekTo(Math.max(0, Math.min(video.getDuration() - 1, video.getCurrentPosition() + milliseconds)));
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || keyCode == KeyEvent.KEYCODE_SPACE) {
            if (video.isPlaying()) video.pause(); else video.start();
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_REWIND) { seekBy(-10000); return true; }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD) { seekBy(10000); return true; }
        return super.onKeyDown(keyCode, event);
    }

    private void finishWithResult() {
        if (resultSent) return;
        resultSent = true;
        double position = video == null ? 0 : video.getCurrentPosition() / 1000.0;
        double duration = video == null || video.getDuration() < 0 ? 0 : video.getDuration() / 1000.0;
        Intent data = new Intent()
            .putExtra(EXTRA_RESULT_POSITION, position)
            .putExtra(EXTRA_RESULT_DURATION, duration)
            .putExtra(EXTRA_RESULT_ENDED, ended);
        setResult(Activity.RESULT_OK, data);
        finish();
    }

    @Override
    public void onBackPressed() {
        finishWithResult();
    }

    @Override
    protected void onDestroy() {
        if (video != null) video.stopPlayback();
        String subtitlePath = getIntent().getStringExtra(EXTRA_SUBTITLE_PATH);
        if (subtitlePath != null) new File(subtitlePath).delete();
        super.onDestroy();
    }
}
