package sh.mailflow.app;

import android.app.Dialog;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.lifecycle.DefaultLifecycleObserver;
import androidx.lifecycle.LifecycleOwner;
import java.net.URI;

final class MailFlowOidcLogin {
    private MailFlowOidcLogin() {}

    static boolean isStartUrl(String host, String url) {
        if (!NativeSecurity.isSameOrigin(host, url)) return false;
        try {
            return new URI(url).getRawPath().matches("/auth/oidc/[^/]+/start");
        } catch (Exception ignored) {
            return false;
        }
    }

    static boolean isReturnUrl(String host, String url) {
        if (!NativeSecurity.isSameOrigin(host, url)) return false;
        try {
            URI uri = new URI(url);
            String path = uri.getRawPath();
            if (path.matches("/auth/oidc/[^/]+/callback")) return true;
            String query = uri.getRawQuery();
            return ("/".equals(path) || "/login".equals(path))
                && query != null && query.matches("(^|.*&)(oidc_error|oidc_success)=.*");
        } catch (Exception ignored) {
            return false;
        }
    }

    static boolean isAllowedUrl(String host, String url) {
        return NativeSecurity.isSameOrigin(host, url) || NativeSecurity.isHttpsUrl(url);
    }

    static void open(MainActivity activity, WebView appView, String host, String startUrl) {
        Dialog dialog = new Dialog(activity);
        dialog.setTitle(R.string.app_name);

        // Share the app's cookie jar without exposing its Capacitor or native message bridges.
        WebView loginView = new WebView(activity);
        WebSettings settings = loginView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptThirdPartyCookies(loginView, false);

        loginView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!dialog.isShowing()) return true;
                String url = request.getUrl().toString();
                if (!isAllowedUrl(host, url)) return true;
                if (!request.isForMainFrame() || !isReturnUrl(host, url)) return false;

                dialog.dismiss();
                appView.loadUrl(url);
                return true;
            }
        });
        LifecycleOwner owner = activity;
        DefaultLifecycleObserver observer = new DefaultLifecycleObserver() {
            @Override
            public void onDestroy(LifecycleOwner owner) {
                dialog.dismiss();
            }
        };
        owner.getLifecycle().addObserver(observer);
        dialog.setOnDismissListener(ignored -> {
            owner.getLifecycle().removeObserver(observer);
            loginView.stopLoading();
            if (loginView.getParent() instanceof ViewGroup) {
                ((ViewGroup) loginView.getParent()).removeView(loginView);
            }
            loginView.destroy();
        });
        dialog.setContentView(loginView);
        dialog.show();
        dialog.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        loginView.loadUrl(startUrl);
    }
}
