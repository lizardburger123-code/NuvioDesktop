// Nuvio app shell host for Linux (Nuvio fork).
//
// The desktop interface is a web page (webui/). On Windows it runs in a WebView2 child window
// inside the player bridge DLL; here it runs in this small helper process: a WebKitGTK view whose
// window is made a child of the app's main X11 window, so it sits over the Compose content the
// same way. It is a separate process on purpose:
//   * the player bridge forces WebKit's software path for its controls overlay (process-wide
//     environment switches); the interface needs accelerated compositing (3D transforms,
//     backdrop blur), which only a process with its own environment can have;
//   * a WebKit crash cannot take the JVM down, and the app falls back to the classic interface.
//
// Usage: nuvio-shell-host <host-xid|0> <page-url> [data-dir]
//   host-xid 0 opens a normal window (for testing the page without the app).
//
// Protocol (lines of UTF-8 text; JSON never contains a raw newline):
//   stdin   P<json>   deliver a message to the page
//           V1 / V0   show / hide
//           L         match the host window's size now
//           F         take keyboard focus
//           Q         quit
//           E<js>     (only with NUVIO_SHELL_TEST set) run script in the page, for smoke tests
//   out     M<json>   a message from the page, or a native event {"event":"created"|"loaded"|
//                     "failed"|"toggleFullscreen"}
//
// Drawing mode (NUVIO_SHELL_RENDER, chosen by the app per graphics driver):
//   gpu       WebKit's own choice: GPU compositing, frames handed over as GPU buffers
//   shm       GPU compositing, frames handed over through shared memory (no buffer sharing
//             between processes, which is the part that breaks on some drivers)
//   software  no GPU at all: the page is painted on the CPU (NVIDIA's driver shows a black
//             window otherwise). The page is told, and leaves out what needs the compositor.
// "out" is the original stdout; fd 1 itself is pointed at stderr so nothing WebKit or a library
// prints can corrupt the protocol.

#include <gtk/gtk.h>
#include <gdk/gdkx.h>
#include <webkit2/webkit2.h>
#include <X11/Xlib.h>

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef struct {
    GtkWidget *window;
    WebKitWebView *view;
    Display *dpy;
    Window host;
    Window xid;
    gboolean standalone;
    gboolean visible;
    gboolean loaded;
    gboolean quitting;
    gboolean software;    // drawing mode "software"
    int loads;
    GPtrArray *pending;   // messages posted before the page finished loading
    char *page_base;      // page URL without query/fragment: the only place navigation may go
    char *page_url;
    int out_fd;
    int last_w, last_h;
} Shell;

static Shell S;

#define LOG(...) do { fprintf(stderr, "[nuvio-shell] "); fprintf(stderr, __VA_ARGS__); fputc('\n', stderr); fflush(stderr); } while (0)

static void emit(const char *text) {
    GString *line = g_string_new("M");
    g_string_append(line, text);
    g_string_append_c(line, '\n');
    size_t done = 0;
    while (done < line->len) {
        ssize_t n = write(S.out_fd, line->str + done, line->len - done);
        if (n < 0) {
            if (errno == EINTR) continue;
            break;
        }
        done += (size_t)n;
    }
    g_string_free(line, TRUE);
}

static void quit_now(void) {
    if (S.quitting) return;
    S.quitting = TRUE;
    gtk_main_quit();
}

// ---- page <-> native ----------------------------------------------------------------------------

// The page talks to window.chrome.webview (WebView2's API). Give it the same object here.
static const char *kShim =
    "(function(){"
    "if(window.chrome&&window.chrome.webview)return;"
    "var listeners=[],queue=[];"
    "window.chrome=window.chrome||{};"
    "window.chrome.webview={"
    "postMessage:function(m){window.webkit.messageHandlers.shell.postMessage(typeof m==='string'?m:JSON.stringify(m));},"
    "addEventListener:function(t,fn){if(t!=='message')return;listeners.push(fn);var q=queue;queue=[];"
    "q.forEach(function(d){try{fn({data:d});}catch(e){console.error(e);}});},"
    "removeEventListener:function(t,fn){listeners=listeners.filter(function(f){return f!==fn;});}"
    "};"
    "window.__nuvioShellDeliver=function(d){if(!listeners.length){queue.push(d);return;}"
    "listeners.slice().forEach(function(fn){try{fn({data:d});}catch(e){console.error(e);}});};"
    "if(document.documentElement)document.documentElement.setAttribute('data-host','linux');"
    "})();";

static void deliver(const char *json) {
    GString *js = g_string_sized_new(strlen(json) + 64);
    g_string_append(js, "window.__nuvioShellDeliver&&window.__nuvioShellDeliver(");
    g_string_append(js, json);
    g_string_append(js, ");");
    webkit_web_view_evaluate_javascript(S.view, js->str, (gssize)js->len, NULL, NULL, NULL, NULL, NULL);
    g_string_free(js, TRUE);
}

static void post_to_page(const char *json) {
    if (!S.view) return;
    if (!S.loaded) {
        g_ptr_array_add(S.pending, g_strdup(json));
        return;
    }
    deliver(json);
}

static void on_script_message(WebKitUserContentManager *manager, WebKitJavascriptResult *result, gpointer data) {
    (void)manager; (void)data;
    JSCValue *value = webkit_javascript_result_get_js_value(result);
    if (!value || !jsc_value_is_string(value)) return;
    char *text = jsc_value_to_string(value);
    if (!text) return;
    for (char *p = text; *p; ++p) {
        if (*p == '\n' || *p == '\r') *p = ' ';
    }
    emit(text);
    g_free(text);
}

// ---- window -------------------------------------------------------------------------------------

// Keep our window exactly over the host's client area. X sizes are device pixels, GDK's are
// logical (it multiplies by the scale factor), so divide on the way in.
static void sync_size(gboolean force) {
    if (S.standalone || !S.window) return;
    GdkWindow *gw = gtk_widget_get_window(S.window);
    if (!gw) return;
    GdkDisplay *display = gdk_window_get_display(gw);
    XWindowAttributes host;
    gdk_x11_display_error_trap_push(display);
    Status ok = XGetWindowAttributes(S.dpy, S.host, &host);
    if (gdk_x11_display_error_trap_pop(display) || !ok) {
        LOG("host window is gone");
        quit_now();
        return;
    }
    if (host.width <= 0 || host.height <= 0) return;
    if (!force && host.width == S.last_w && host.height == S.last_h) return;
    S.last_w = host.width;
    S.last_h = host.height;
    int scale = gdk_window_get_scale_factor(gw);
    if (scale < 1) scale = 1;
    const int w = (host.width + scale - 1) / scale;
    const int h = (host.height + scale - 1) / scale;
    gdk_window_move_resize(gw, 0, 0, w, h);
    gtk_window_resize(GTK_WINDOW(S.window), w, h);
    // The view renders at its GTK allocation, which is otherwise applied a frame later.
    GtkAllocation allocation = {0, 0, w, h};
    gtk_widget_size_allocate(S.window, &allocation);
}

static gboolean on_size_tick(gpointer data) {
    (void)data;
    if (S.quitting) return G_SOURCE_REMOVE;
    if (S.visible) sync_size(FALSE);
    return G_SOURCE_CONTINUE;
}

static void take_focus(void) {
    if (!S.window || !S.visible) return;
    gtk_widget_grab_focus(GTK_WIDGET(S.view));
    if (S.standalone) return;
    GdkWindow *gw = gtk_widget_get_window(S.window);
    if (!gw) return;
    GdkDisplay *display = gdk_window_get_display(gw);
    // The app window's own focus lives on an AWT helper window, so keys only reach the page if
    // this window holds the X input focus itself.
    gdk_x11_display_error_trap_push(display);
    XSetInputFocus(S.dpy, S.xid, RevertToParent, CurrentTime);
    XFlush(S.dpy);
    gdk_x11_display_error_trap_pop_ignored(display);
}

static void set_visible(gboolean visible) {
    S.visible = visible;
    if (!S.window) return;
    if (S.standalone) {
        if (visible) gtk_widget_show_all(S.window); else gtk_widget_hide(S.window);
        return;
    }
    GdkWindow *gw = gtk_widget_get_window(S.window);
    if (!gw) return;
    // GDK-level show/hide: GtkWindow's own would re-place the window from root coordinates it
    // remembers, which are meaningless for a child of the app window.
    if (visible) {
        sync_size(TRUE);
        gdk_window_show(gw);
        gdk_window_raise(gw);
    } else {
        gdk_window_hide(gw);
    }
}

static void on_destroy(GtkWidget *widget, gpointer data) {
    (void)widget; (void)data;
    S.window = NULL;
    S.view = NULL;
    quit_now();
}

static gboolean on_button_press(GtkWidget *widget, GdkEventButton *event, gpointer data) {
    (void)widget; (void)event; (void)data;
    take_focus();
    return FALSE;
}

static gboolean on_key_press(GtkWidget *widget, GdkEventKey *event, gpointer data) {
    (void)widget; (void)data;
    if (event->keyval == GDK_KEY_F11) {
        emit("{\"event\":\"toggleFullscreen\"}");
        return TRUE;
    }
    return FALSE;
}

static gboolean on_context_menu(WebKitWebView *view, WebKitContextMenu *menu, GdkEvent *event,
                                WebKitHitTestResult *hit, gpointer data) {
    (void)view; (void)menu; (void)event; (void)data;
    // Keep the menu only where it is useful: text fields (paste), and everywhere with devtools on.
    if (g_getenv("NUVIO_SHELL_DEVTOOLS")) return FALSE;
    return webkit_hit_test_result_context_is_editable(hit) ? FALSE : TRUE;
}

static gboolean same_page(const char *uri) {
    if (!uri || !S.page_base) return FALSE;
    size_t base = strlen(S.page_base);
    if (strncmp(uri, S.page_base, base) != 0) return FALSE;
    return uri[base] == '\0' || uri[base] == '?' || uri[base] == '#';
}

// Only the interface page itself may load here; nothing navigates away or opens windows.
static gboolean on_decide_policy(WebKitWebView *view, WebKitPolicyDecision *decision,
                                 WebKitPolicyDecisionType type, gpointer data) {
    (void)view; (void)data;
    if (type == WEBKIT_POLICY_DECISION_TYPE_NEW_WINDOW_ACTION) {
        webkit_policy_decision_ignore(decision);
        return TRUE;
    }
    if (type == WEBKIT_POLICY_DECISION_TYPE_NAVIGATION_ACTION) {
        WebKitNavigationAction *action =
            webkit_navigation_policy_decision_get_navigation_action(WEBKIT_NAVIGATION_POLICY_DECISION(decision));
        WebKitURIRequest *request = action ? webkit_navigation_action_get_request(action) : NULL;
        const char *uri = request ? webkit_uri_request_get_uri(request) : NULL;
        if (same_page(uri)) return FALSE;
        LOG("blocked navigation to %s", uri ? uri : "(none)");
        webkit_policy_decision_ignore(decision);
        return TRUE;
    }
    return FALSE;
}

static void on_load_changed(WebKitWebView *view, WebKitLoadEvent event, gpointer data) {
    (void)view; (void)data;
    if (event == WEBKIT_LOAD_STARTED) {
        S.loaded = FALSE;
        S.loads++;
        if (S.loads > 1) LOG("page load %d started", S.loads);
    } else if (event == WEBKIT_LOAD_FINISHED) {
        S.loaded = TRUE;
        for (guint i = 0; i < S.pending->len; i++) deliver(g_ptr_array_index(S.pending, i));
        g_ptr_array_set_size(S.pending, 0);
        emit("{\"event\":\"loaded\"}");
    }
}

static gboolean on_load_failed(WebKitWebView *view, WebKitLoadEvent event, const char *uri, GError *error, gpointer data) {
    (void)view; (void)event; (void)data;
    // A cancelled load (blocked navigation) is not a failure of the page.
    if (error && g_error_matches(error, WEBKIT_NETWORK_ERROR, WEBKIT_NETWORK_ERROR_CANCELLED)) return FALSE;
    if (error && g_error_matches(error, WEBKIT_POLICY_ERROR, WEBKIT_POLICY_ERROR_FRAME_LOAD_INTERRUPTED_BY_POLICY_CHANGE)) return FALSE;
    LOG("load failed: %s (%s)", uri ? uri : "", error ? error->message : "");
    if (same_page(uri)) emit("{\"event\":\"failed\",\"reason\":\"navigation\"}");
    return FALSE;
}

// The page's process died. Load the page again (it comes back where the user was, see the page's
// lib/session.js); a process that keeps dying is reported, and the app starts over in a safer
// drawing mode or with the classic interface.
static void on_web_process_terminated(WebKitWebView *view, WebKitWebProcessTerminationReason reason, gpointer data) {
    (void)data;
    static int reloads = 0;
    static gint64 since = 0;
    const char *why = reason == WEBKIT_WEB_PROCESS_CRASHED ? "crashed"
                    : reason == WEBKIT_WEB_PROCESS_EXCEEDED_MEMORY_LIMIT ? "used too much memory" : "was stopped";
    LOG("web process ended: %s (reason %d)", why, (int)reason);
    S.loaded = FALSE;
    const gint64 now = g_get_monotonic_time();
    if (now - since > 60 * G_USEC_PER_SEC) {
        since = now;
        reloads = 0;
    }
    if (++reloads > 3) {
        emit("{\"event\":\"failed\",\"reason\":\"process\"}");
        return;
    }
    webkit_web_view_load_uri(view, S.page_url);
}

// ---- commands from the app ----------------------------------------------------------------------

static void handle_line(char *line, gsize length) {
    while (length > 0 && (line[length - 1] == '\n' || line[length - 1] == '\r')) line[--length] = '\0';
    if (length == 0) return;
    switch (line[0]) {
        case 'P': post_to_page(line + 1); break;
        case 'V': set_visible(line[1] == '1'); break;
        case 'L': if (S.visible) sync_size(TRUE); break;
        case 'F': take_focus(); break;
        case 'Q': quit_now(); break;
        case 'E':
            // Smoke tests only: run a line of script in the page.
            if (g_getenv("NUVIO_SHELL_TEST") && S.view) {
                webkit_web_view_evaluate_javascript(S.view, line + 1, -1, NULL, NULL, NULL, NULL, NULL);
            }
            break;
        default: break;
    }
}

static gboolean on_stdin(GIOChannel *channel, GIOCondition condition, gpointer data) {
    (void)data;
    if (condition & G_IO_IN) {
        for (;;) {
            char *line = NULL;
            gsize length = 0;
            GError *error = NULL;
            GIOStatus status = g_io_channel_read_line(channel, &line, &length, NULL, &error);
            if (status == G_IO_STATUS_NORMAL && line) {
                handle_line(line, length);
                g_free(line);
                if (S.quitting) return G_SOURCE_REMOVE;
                continue;
            }
            g_free(line);
            if (error) g_error_free(error);
            if (status == G_IO_STATUS_AGAIN) break;
            // EOF or error: the app is gone.
            quit_now();
            return G_SOURCE_REMOVE;
        }
    }
    if (condition & (G_IO_HUP | G_IO_ERR)) {
        quit_now();
        return G_SOURCE_REMOVE;
    }
    return G_SOURCE_CONTINUE;
}

// ---- setup --------------------------------------------------------------------------------------

static WebKitWebView *create_view(const char *data_dir) {
    WebKitUserContentManager *content = webkit_user_content_manager_new();
    webkit_user_content_manager_register_script_message_handler(content, "shell");
    g_signal_connect(content, "script-message-received::shell", G_CALLBACK(on_script_message), NULL);
    WebKitUserScript *shim = webkit_user_script_new(
        kShim, WEBKIT_USER_CONTENT_INJECT_TOP_FRAME, WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START, NULL, NULL);
    webkit_user_content_manager_add_script(content, shim);
    webkit_user_script_unref(shim);
    // Painted on the CPU: the page skips what only the compositor can do (animated screen changes).
    // NUVIO_SHELL_TEST_KEEP_TRANSITIONS leaves the page unaware, for the smoke test's comparison.
    if (S.software && !g_getenv("NUVIO_SHELL_TEST_KEEP_TRANSITIONS")) {
        WebKitUserScript *mark = webkit_user_script_new(
            "window.__nuvioRender='software';"
            "if(document.documentElement)document.documentElement.setAttribute('data-render','software');",
            WEBKIT_USER_CONTENT_INJECT_TOP_FRAME, WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START, NULL, NULL);
        webkit_user_content_manager_add_script(content, mark);
        webkit_user_script_unref(mark);
    }

    WebKitWebContext *context;
    if (data_dir && *data_dir) {
        char *cache_dir = g_build_filename(data_dir, "cache", NULL);
        WebKitWebsiteDataManager *manager = webkit_website_data_manager_new(
            "base-data-directory", data_dir, "base-cache-directory", cache_dir, NULL);
        context = webkit_web_context_new_with_website_data_manager(manager);
        g_object_unref(manager);
        g_free(cache_dir);
    } else {
        context = webkit_web_context_new_ephemeral();
    }

    WebKitWebView *view = WEBKIT_WEB_VIEW(g_object_new(
        WEBKIT_TYPE_WEB_VIEW, "web-context", context, "user-content-manager", content, NULL));
    g_object_unref(context);
    g_object_unref(content);

    GdkRGBA ground = {7 / 255.0, 8 / 255.0, 10 / 255.0, 1.0};
    webkit_web_view_set_background_color(view, &ground);

    WebKitSettings *settings = webkit_web_view_get_settings(view);
    // The page is a local file that pulls its own script, styles and fonts, and artwork from the web.
    webkit_settings_set_allow_file_access_from_file_urls(settings, TRUE);
    webkit_settings_set_allow_universal_access_from_file_urls(settings, TRUE);
    webkit_settings_set_javascript_can_access_clipboard(settings, TRUE);
    webkit_settings_set_enable_developer_extras(settings, g_getenv("NUVIO_SHELL_DEVTOOLS") != NULL);
    webkit_settings_set_enable_smooth_scrolling(settings, TRUE);
    webkit_settings_set_enable_back_forward_navigation_gestures(settings, FALSE);
    webkit_settings_set_media_playback_requires_user_gesture(settings, FALSE);
    if (S.software) {
        webkit_settings_set_hardware_acceleration_policy(settings, WEBKIT_HARDWARE_ACCELERATION_POLICY_NEVER);
    } else {
        // 3D transforms and backdrop blur need the compositor; don't wait for WebKit to decide.
        webkit_settings_set_hardware_acceleration_policy(settings, WEBKIT_HARDWARE_ACCELERATION_POLICY_ALWAYS);
    }

    g_signal_connect(view, "load-changed", G_CALLBACK(on_load_changed), NULL);
    g_signal_connect(view, "load-failed", G_CALLBACK(on_load_failed), NULL);
    g_signal_connect(view, "decide-policy", G_CALLBACK(on_decide_policy), NULL);
    g_signal_connect(view, "context-menu", G_CALLBACK(on_context_menu), NULL);
    g_signal_connect(view, "web-process-terminated", G_CALLBACK(on_web_process_terminated), NULL);
    g_signal_connect(view, "button-press-event", G_CALLBACK(on_button_press), NULL);
    g_signal_connect(view, "key-press-event", G_CALLBACK(on_key_press), NULL);
    // No dropping files or links onto the page.
    gtk_drag_dest_unset(GTK_WIDGET(view));
    return view;
}

// Settle the drawing mode before WebKit starts: it reads these once, and its processes inherit them.
static void apply_render_mode(void) {
    const char *mode = g_getenv("NUVIO_SHELL_RENDER");
    if (!mode || !*mode) mode = g_getenv("NUVIO_SHELL_SOFTWARE") ? "software" : "gpu";
    // The player bridge sets these for its own web view, in the app's process.
    g_unsetenv("WEBKIT_DISABLE_DMABUF_RENDERER");
    g_unsetenv("WEBKIT_DISABLE_COMPOSITING_MODE");
    if (strcmp(mode, "software") == 0) {
        S.software = TRUE;
        g_setenv("WEBKIT_DISABLE_COMPOSITING_MODE", "1", TRUE);
    } else if (strcmp(mode, "shm") == 0) {
        g_setenv("WEBKIT_DMABUF_RENDERER_FORCE_SHM", "1", TRUE);
    } else {
        mode = "gpu";
    }
    LOG("drawing mode: %s", mode);
}

static gboolean embed(void) {
    gtk_widget_add_events(S.window,
                          GDK_POINTER_MOTION_MASK | GDK_BUTTON_PRESS_MASK | GDK_BUTTON_RELEASE_MASK |
                          GDK_SCROLL_MASK | GDK_SMOOTH_SCROLL_MASK | GDK_ENTER_NOTIFY_MASK | GDK_LEAVE_NOTIFY_MASK |
                          GDK_KEY_PRESS_MASK | GDK_KEY_RELEASE_MASK | GDK_FOCUS_CHANGE_MASK);
    gtk_widget_realize(S.window);
    GdkWindow *gw = gtk_widget_get_window(S.window);
    if (!gw) return FALSE;
    S.dpy = GDK_WINDOW_XDISPLAY(gw);
    S.xid = GDK_WINDOW_XID(gw);
    GdkDisplay *display = gdk_window_get_display(gw);

    // The window manager never manages this window (it becomes a child of the app's), so it
    // would never acknowledge a frame: without this, GDK's frame clock freezes after the first
    // frame on compositors with frame sync (mutter) and the page stops painting and animating.
    gdk_x11_window_set_frame_sync_enabled(gw, FALSE);

    XWindowAttributes host;
    gdk_x11_display_error_trap_push(display);
    Status ok = XGetWindowAttributes(S.dpy, S.host, &host);
    if (gdk_x11_display_error_trap_pop(display) || !ok) {
        LOG("host window 0x%lx not found", (unsigned long)S.host);
        return FALSE;
    }
    int scale = gdk_window_get_scale_factor(gw);
    if (scale < 1) scale = 1;
    gtk_window_resize(GTK_WINDOW(S.window), MAX(1, host.width / scale), MAX(1, host.height / scale));

    // Reparent through GDK, so it knows the new parent and keeps dispatching pointer events.
    GdkWindow *host_gdk = gdk_x11_window_foreign_new_for_display(display, S.host);
    if (host_gdk) {
        gdk_window_reparent(gw, host_gdk, 0, 0);
    } else {
        LOG("couldn't wrap the host window; reparenting directly");
        XReparentWindow(S.dpy, S.xid, S.host, 0, 0);
    }
    gtk_widget_show_all(S.window);
    // Hidden until the app asks: it positions and shows the interface itself.
    gdk_window_hide(gw);
    gdk_window_set_event_compression(gw, FALSE);
    GdkCursor *cursor = gdk_cursor_new_from_name(display, "default");
    if (cursor) {
        gdk_window_set_cursor(gw, cursor);
        g_object_unref(cursor);
    }
    XFlush(S.dpy);
    return TRUE;
}

int main(int argc, char **argv) {
    if (argc < 3) {
        fprintf(stderr, "usage: %s <host-xid|0> <page-url> [data-dir]\n", argv[0]);
        return 2;
    }
    // Keep the protocol channel to ourselves; everything else that writes to fd 1 goes to stderr.
    S.out_fd = dup(STDOUT_FILENO);
    if (S.out_fd < 0) return 3;
    fcntl(S.out_fd, F_SETFD, FD_CLOEXEC);
    dup2(STDERR_FILENO, STDOUT_FILENO);

    S.host = (Window)g_ascii_strtoull(argv[1], NULL, 0);
    S.standalone = S.host == 0;
    S.page_url = g_strdup(argv[2]);
    S.page_base = g_strdup(argv[2]);
    char *cut = strpbrk(S.page_base, "?#");
    if (cut) *cut = '\0';
    S.pending = g_ptr_array_new_with_free_func(g_free);
    apply_render_mode();

    // The app window is an X11 window (XWayland on Wayland sessions), so this one must be too.
    gdk_set_allowed_backends("x11");
    if (!gtk_init_check(&argc, &argv)) {
        LOG("no display");
        emit("{\"event\":\"failed\",\"reason\":\"display\"}");
        return 4;
    }

    S.window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(S.window), "Nuvio");
    GtkCssProvider *css = gtk_css_provider_new();
    gtk_css_provider_load_from_data(css, "window { background-color: #07080a; }", -1, NULL);
    gtk_style_context_add_provider(gtk_widget_get_style_context(S.window), GTK_STYLE_PROVIDER(css),
                                   GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
    g_object_unref(css);
    g_signal_connect(S.window, "destroy", G_CALLBACK(on_destroy), NULL);

    S.view = create_view(argc > 3 ? argv[3] : NULL);
    gtk_container_add(GTK_CONTAINER(S.window), GTK_WIDGET(S.view));

    if (S.standalone) {
        gtk_window_set_default_size(GTK_WINDOW(S.window), 1440, 900);
        gtk_widget_show_all(S.window);
        S.visible = TRUE;
    } else {
        gtk_window_set_decorated(GTK_WINDOW(S.window), FALSE);
        if (!embed()) {
            emit("{\"event\":\"failed\",\"reason\":\"window\"}");
            return 5;
        }
        g_timeout_add(120, on_size_tick, NULL);
    }

    GIOChannel *input = g_io_channel_unix_new(STDIN_FILENO);
    g_io_channel_set_encoding(input, NULL, NULL);
    g_io_channel_set_flags(input, g_io_channel_get_flags(input) | G_IO_FLAG_NONBLOCK, NULL);
    g_io_add_watch(input, G_IO_IN | G_IO_HUP | G_IO_ERR, on_stdin, NULL);

    webkit_web_view_load_uri(S.view, S.page_url);
    emit("{\"event\":\"created\"}");
    gtk_main();
    return 0;
}
