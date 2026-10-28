import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { Readable } from 'stream';
import { finished } from 'stream/promises';

const TMP_ROOT = '/tmp/fast-apk-builder';
const JDK_DIR = path.join(TMP_ROOT, 'jdk');
const SDK_DIR = path.join(TMP_ROOT, 'sdk');
const BUILD_DIR = path.join(TMP_ROOT, 'build');

async function downloadFile(url: string, destPath: string) {
  console.log(`Downloading ${url}...`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  }
  const fileStream = fs.createWriteStream(destPath);
  await finished(Readable.fromWeb(res.body as any).pipe(fileStream));
}

async function main() {
  fs.mkdirSync(JDK_DIR, { recursive: true });
  fs.mkdirSync(SDK_DIR, { recursive: true });

  // 1. Ensure JDK 21 is present in /tmp (delete tarball immediately after extraction to save tmpfs RAM)
  let javaHome = '';
  const existingJdk = fs
    .readdirSync(JDK_DIR)
    .find((d) => d.startsWith('jdk-21'));
  if (existingJdk) {
    javaHome = path.join(JDK_DIR, existingJdk);
  } else {
    const jdkTar = path.join(TMP_ROOT, 'openjdk21.tar.gz');
    await downloadFile(
      'https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse',
      jdkTar
    );
    execSync(`tar -xzf "${jdkTar}" -C "${JDK_DIR}"`, { stdio: 'inherit' });
    fs.unlinkSync(jdkTar);
    const extracted = fs
      .readdirSync(JDK_DIR)
      .find((d) => d.startsWith('jdk-21'));
    if (!extracted) throw new Error('JDK extraction failed');
    javaHome = path.join(JDK_DIR, extracted);
  }

  // 2. Ensure Android build-tools;35.0.0 and platforms;android-35 are present
  const cmdlineLatestDir = path.join(SDK_DIR, 'cmdline-tools', 'latest');
  const sdkmanagerBin = path.join(cmdlineLatestDir, 'bin', 'sdkmanager');
  if (!fs.existsSync(sdkmanagerBin)) {
    const cmdZip = path.join(TMP_ROOT, 'cmdline-tools.zip');
    await downloadFile(
      'https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip',
      cmdZip
    );
    const extractTmp = path.join(TMP_ROOT, 'cmdline-extract');
    fs.rmSync(extractTmp, { recursive: true, force: true });
    fs.mkdirSync(extractTmp, { recursive: true });
    execSync(`unzip -q "${cmdZip}" -d "${extractTmp}"`, { stdio: 'inherit' });
    fs.unlinkSync(cmdZip);
    fs.mkdirSync(path.join(SDK_DIR, 'cmdline-tools'), { recursive: true });
    fs.renameSync(path.join(extractTmp, 'cmdline-tools'), cmdlineLatestDir);
  }

  const env = {
    ...process.env,
    JAVA_HOME: javaHome,
    ANDROID_HOME: SDK_DIR,
    ANDROID_SDK_ROOT: SDK_DIR,
    JAVA_OPTS: '-Xmx256m',
    PATH: `${path.join(javaHome, 'bin')}:${path.join(
      cmdlineLatestDir,
      'bin'
    )}:${process.env.PATH || ''}`,
  };

  const androidJar = path.join(SDK_DIR, 'platforms', 'android-35', 'android.jar');
  const buildToolsDir = path.join(SDK_DIR, 'build-tools', '35.0.0');
  if (!fs.existsSync(androidJar) || !fs.existsSync(buildToolsDir)) {
    console.log('Installing Android 35 platform & build-tools 35.0.0...');
    execSync(
      `yes | "${sdkmanagerBin}" --sdk_root="${SDK_DIR}" --licenses >/dev/null 2>&1 || true`,
      { env }
    );
    execSync(
      `"${sdkmanagerBin}" --sdk_root="${SDK_DIR}" --install "platforms;android-35" "build-tools;35.0.0"`,
      { env, stdio: 'inherit' }
    );
  }

  // 3. Build production web assets (dist/)
  console.log('Building production web bundle (dist/)...');
  execSync('npm run build', { cwd: process.cwd(), env, stdio: 'inherit' });

  // 4. Prepare minimal standalone Android project structure for aapt2 + javac + d8
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  const srcDir = path.join(BUILD_DIR, 'src', 'app', 'shakti', 'safety');
  const resDir = path.join(BUILD_DIR, 'res');
  const assetsPublicDir = path.join(BUILD_DIR, 'assets', 'public');
  const classesDir = path.join(BUILD_DIR, 'classes');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(path.join(resDir, 'mipmap-hdpi'), { recursive: true });
  fs.mkdirSync(path.join(resDir, 'values'), { recursive: true });
  fs.mkdirSync(assetsPublicDir, { recursive: true });
  fs.mkdirSync(classesDir, { recursive: true });

  // Copy dist/ into assets/public (excluding any existing .apk to avoid recursive bundling)
  const distDir = path.join(process.cwd(), 'dist');
  execSync(`cp -r "${distDir}/." "${assetsPublicDir}/"`, { stdio: 'inherit' });
  for (const apkName of ['shakti.apk', 'saathi.apk']) {
    const p = path.join(assetsPublicDir, apkName);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  // Copy app icon
  fs.copyFileSync(
    path.join(process.cwd(), 'public', 'icons', 'icon-192x192.png'),
    path.join(resDir, 'mipmap-hdpi', 'ic_launcher.png')
  );

  // Write res/values/strings.xml
  fs.writeFileSync(
    path.join(resDir, 'values', 'strings.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">SHAKTI</string>
</resources>
`
  );

  // Write AndroidManifest.xml
  const manifestXmlPath = path.join(BUILD_DIR, 'AndroidManifest.xml');
  fs.writeFileSync(
    manifestXmlPath,
    `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="app.shakti.safety"
    android:versionCode="1"
    android:versionName="1.0.0">

    <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="35" />

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-feature android:name="android.hardware.location.gps" android:required="false" />
    <uses-feature android:name="android.hardware.microphone" android:required="false" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:theme="@android:style/Theme.DeviceDefault.NoActionBar">

        <activity
            android:name="app.shakti.safety.MainActivity"
            android:label="@string/app_name"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|uiMode|navigation|density"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`
  );

  // Write MainActivity.java (Standalone Secure-Context https://localhost WebView + tel:/sms: Intents + Consent-first GPS)
  const mainActivityPath = path.join(srcDir, 'MainActivity.java');
  fs.writeFileSync(
    mainActivityPath,
    `package app.shakti.safety;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    private WebView webView;
    private GeolocationPermissions.Callback pendingGeoCallback;
    private String pendingGeoOrigin;
    private static final int REQ_LOCATION = 1001;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setUserAgentString(settings.getUserAgentString() + " ShaktiAndroidApk/1.0");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri == null) return null;
                String host = uri.getHost();
                String scheme = uri.getScheme();
                if (!"https".equalsIgnoreCase(scheme) || !"localhost".equalsIgnoreCase(host)) {
                    return null;
                }
                String reqPath = uri.getPath();
                if (reqPath == null || reqPath.isEmpty() || "/".equals(reqPath)) {
                    reqPath = "/index.html";
                }
                if (reqPath.startsWith("/api/")) {
                    byte[] emptyJson = "{}".getBytes(StandardCharsets.UTF_8);
                    Map<String, String> headers = new HashMap<>();
                    headers.put("Cache-Control", "no-store");
                    return new WebResourceResponse("application/json", "UTF-8", 404, "Offline Standalone Mode", headers, new ByteArrayInputStream(emptyJson));
                }

                String assetPath = "public" + reqPath;
                try {
                    InputStream is = getAssets().open(assetPath);
                    return new WebResourceResponse(guessMimeType(reqPath), "UTF-8", is);
                } catch (Exception e) {
                    if (!reqPath.contains(".")) {
                        try {
                            InputStream indexStream = getAssets().open("public/index.html");
                            return new WebResourceResponse("text/html", "UTF-8", indexStream);
                        } catch (Exception ex) {
                            return null;
                        }
                    }
                    return null;
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri == null) return false;
                String scheme = uri.getScheme();
                String host = uri.getHost();
                if ("tel".equalsIgnoreCase(scheme) || "sms".equalsIgnoreCase(scheme) || "smsto".equalsIgnoreCase(scheme) || "mailto".equalsIgnoreCase(scheme)) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                        startActivity(intent);
                    } catch (Exception ignored) {}
                    return true;
                }
                if (("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) && !"localhost".equalsIgnoreCase(host)) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                        startActivity(intent);
                    } catch (Exception ignored) {}
                    return true;
                }
                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                    checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                } else {
                    pendingGeoOrigin = origin;
                    pendingGeoCallback = callback;
                    requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
                }
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }
        });

        webView.loadUrl("https://localhost/index.html");
    }

    private String guessMimeType(String path) {
        String lower = path.toLowerCase();
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".webmanifest")) return "application/manifest+json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".ico")) return "image/x-icon";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        return "application/octet-stream";
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_LOCATION && pendingGeoCallback != null) {
            boolean granted = false;
            if (grantResults != null) {
                for (int res : grantResults) {
                    if (res == PackageManager.PERMISSION_GRANTED) {
                        granted = true;
                        break;
                    }
                }
            }
            pendingGeoCallback.invoke(pendingGeoOrigin, granted, false);
            pendingGeoCallback = null;
            pendingGeoOrigin = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
`
  );

  const aapt2 = path.join(buildToolsDir, 'aapt2');
  const d8 = path.join(buildToolsDir, 'd8');
  const zipalign = path.join(buildToolsDir, 'zipalign');
  const apksigner = path.join(buildToolsDir, 'apksigner');
  const javac = path.join(javaHome, 'bin', 'javac');
  const keytool = path.join(javaHome, 'bin', 'keytool');

  // 5. Compile resources with aapt2
  console.log('Compiling Android resources with aapt2...');
  const compiledResZip = path.join(BUILD_DIR, 'compiled_res.zip');
  execSync(`"${aapt2}" compile --dir "${resDir}" -o "${compiledResZip}"`, {
    env,
    stdio: 'inherit',
  });

  const unsignedApk = path.join(BUILD_DIR, 'unsigned.apk');
  const rJavaDir = path.join(BUILD_DIR, 'src');
  execSync(
    `"${aapt2}" link -o "${unsignedApk}" -I "${androidJar}" --manifest "${manifestXmlPath}" --java "${rJavaDir}" -A "${path.join(
      BUILD_DIR,
      'assets'
    )}" "${compiledResZip}"`,
    { env, stdio: 'inherit' }
  );

  // 6. Compile Java sources (MainActivity.java + R.java) with javac
  console.log('Compiling Java bytecode with javac...');
  const rJavaPath = path.join(srcDir, 'R.java');
  execSync(
    `"${javac}" -J-Xmx256m --release 11 -cp "${androidJar}" -d "${classesDir}" "${mainActivityPath}" "${rJavaPath}"`,
    { env, stdio: 'inherit' }
  );

  // 7. Convert .class files to classes.dex with d8 via classes.jar (avoids $1 shell expansion on inner classes)
  console.log('Converting bytecode to DEX with d8...');
  const jarBin = path.join(javaHome, 'bin', 'jar');
  const classesJar = path.join(BUILD_DIR, 'classes.jar');
  execSync(`"${jarBin}" -J-Xmx128m cf "${classesJar}" -C "${classesDir}" .`, {
    env,
    stdio: 'inherit',
  });
  execSync(
    `"${d8}" -JXmx256m --lib "${androidJar}" --min-api 24 --output "${BUILD_DIR}" "${classesJar}"`,
    { env, stdio: 'inherit' }
  );

  // Add classes.dex into unsigned.apk using JDK jar tool
  execSync(
    `"${jarBin}" -J-Xmx128m uf "${unsignedApk}" -C "${BUILD_DIR}" classes.dex`,
    {
      cwd: BUILD_DIR,
      env,
      stdio: 'inherit',
    }
  );

  // 8. Align and sign APK with zipalign + apksigner
  console.log('Aligning and signing shakti.apk...');
  const alignedApk = path.join(BUILD_DIR, 'aligned.apk');
  execSync(`"${zipalign}" -f -p 4 "${unsignedApk}" "${alignedApk}"`, {
    env,
    stdio: 'inherit',
  });

  const keystorePath = path.join(BUILD_DIR, 'debug.keystore');
  execSync(
    `"${keytool}" -J-Xmx128m -genkeypair -v -keystore "${keystorePath}" -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=SHAKTI Safety,O=SHAKTI,C=IN"`,
    { env, stdio: 'inherit' }
  );

  const publicApk = path.join(process.cwd(), 'public', 'shakti.apk');
  execSync(
    `"${apksigner}" sign --ks "${keystorePath}" --ks-pass pass:android --key-pass pass:android --out "${publicApk}" "${alignedApk}"`,
    { env, stdio: 'inherit' }
  );

  // Also copy to dist/shakti.apk if dist/ exists
  if (fs.existsSync(distDir)) {
    fs.copyFileSync(publicApk, path.join(distDir, 'shakti.apk'));
  }

  // Clean up /tmp to release all tmpfs RAM immediately!
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });

  const stat = fs.statSync(publicApk);
  console.log(
    `=== SUCCESS: Built and signed real Android APK at ${publicApk} (${(
      stat.size /
      1024
    ).toFixed(1)} KB) ===`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
