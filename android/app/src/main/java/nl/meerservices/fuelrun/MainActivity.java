package nl.meerservices.fuelrun;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Fuel Run for Android: the game in a full-screen WebView, plus a built-in UDP listener.
 * Every UDP message on port 6001 (for example {"deviceNumber":1,"buttonNumber":3,"event":"pressStart"})
 * is handed straight to the game through window.fuelUdp(...).
 */
public class MainActivity extends Activity {
  private static final String GAME_URL = "https://meerservices.github.io/fuel-run/?app=android";
  private static final String OFFLINE_URL = "file:///android_asset/index.html";
  private static final int UDP_PORT = 6001;

  private WebView web;
  private volatile boolean running = false;
  private volatile DatagramSocket socket;
  private volatile String udpError = "";
  private volatile long udpCount = 0;
  private Thread udpThread;
  private WifiManager.MulticastLock multicastLock;

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    if (Build.VERSION.SDK_INT >= 28) {
      getWindow().getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
    }
    web = new WebView(this);
    web.setBackgroundColor(0xFF06070F);
    setContentView(web);

    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setDatabaseEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    s.setLoadWithOverviewMode(true);
    s.setUseWideViewPort(true);
    s.setAllowFileAccess(true);
    s.setUserAgentString(s.getUserAgentString() + " FuelRunApp/1");

    web.addJavascriptInterface(new NativeBridge(), "FuelRunNative");
    web.setWebChromeClient(new WebChromeClient());
    web.setWebViewClient(new WebViewClient() {
      @Override
      public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
        if (req.isForMainFrame() && !OFFLINE_URL.equals(view.getUrl())) view.loadUrl(OFFLINE_URL);  // no internet: bundled copy
      }
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
        Uri u = req.getUrl();
        String sc = u.getScheme() == null ? "" : u.getScheme();
        if (sc.equals("mailto") || sc.equals("tel") || sc.equals("intent")) {
          try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}
          return true;
        }
        return false;
      }
    });

    if (state != null) web.restoreState(state); else web.loadUrl(GAME_URL);
    hideSystemUi();
  }

  @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
  @Override protected void onResume() { super.onResume(); web.onResume(); startUdp(); hideSystemUi(); }
  @Override protected void onPause() { stopUdp(); web.onPause(); super.onPause(); }
  @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) hideSystemUi(); }
  @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
  @Override protected void onDestroy() { stopUdp(); web.destroy(); super.onDestroy(); }

  @SuppressWarnings("deprecation")
  private void hideSystemUi() {
    if (Build.VERSION.SDK_INT >= 30) {
      WindowInsetsController c = getWindow().getInsetsController();
      if (c != null) {
        c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
        c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
      }
    } else {
      getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
          | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
          | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }
  }

  /* ---------- UDP listener ---------- */
  private void startUdp() {
    if (running) return;
    running = true;
    try {
      WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
      if (wifi != null) { multicastLock = wifi.createMulticastLock("fuelrun-udp"); multicastLock.setReferenceCounted(false); multicastLock.acquire(); }
    } catch (Exception ignored) {}
    udpThread = new Thread(() -> {
      byte[] buf = new byte[4096];
      while (running) {
        try {
          DatagramSocket s = new DatagramSocket(null);
          s.setReuseAddress(true);
          s.setBroadcast(true);
          s.bind(new InetSocketAddress(UDP_PORT));
          socket = s;
          udpError = "";
          while (running) {
            DatagramPacket p = new DatagramPacket(buf, buf.length);
            s.receive(p);
            String msg = new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8).trim();
            if (msg.isEmpty()) continue;
            udpCount++;
            final String js = "window.fuelUdp&&window.fuelUdp(" + JSONObject.quote(msg) + ")";
            web.post(() -> web.evaluateJavascript(js, null));
          }
        } catch (Exception e) {
          if (!running) break;
          udpError = e.getMessage() == null ? e.toString() : e.getMessage();
          try { Thread.sleep(2000); } catch (InterruptedException ie) { break; }
        } finally {
          DatagramSocket s = socket; socket = null;
          if (s != null) s.close();
        }
      }
    }, "fuelrun-udp");
    udpThread.setDaemon(true);
    udpThread.start();
  }

  private void stopUdp() {
    running = false;
    DatagramSocket s = socket; socket = null;
    if (s != null) s.close();
    if (udpThread != null) udpThread.interrupt();
    if (multicastLock != null && multicastLock.isHeld()) multicastLock.release();
  }

  private static String localIps() {
    List<String> out = new ArrayList<>();
    try {
      for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
        if (!ni.isUp() || ni.isLoopback()) continue;
        for (InetAddress a : Collections.list(ni.getInetAddresses())) if (a instanceof Inet4Address) out.add(a.getHostAddress());
      }
    } catch (Exception ignored) {}
    return String.join(", ", out);
  }

  /** Available to the game as window.FuelRunNative */
  private class NativeBridge {
    @JavascriptInterface public String info() {
      try {
        JSONObject o = new JSONObject();
        o.put("udp", UDP_PORT);
        o.put("listening", socket != null && !socket.isClosed());
        o.put("error", udpError);
        o.put("count", udpCount);
        o.put("ip", localIps());
        o.put("version", BuildConfig.VERSION_NAME);
        return o.toString();
      } catch (Exception e) { return "{}"; }
    }
  }
}
