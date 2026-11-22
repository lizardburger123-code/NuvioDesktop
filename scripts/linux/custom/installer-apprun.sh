#!/usr/bin/env bash
# What runs when the Nuvio setup file (an AppImage) is opened: it installs the app for the person
# who opened it, the way a setup program does, and needs no administrator rights for that.
#
#   The app            ~/.local/share/nuvio          (its own Java runtime included)
#   The menu entry     ~/.local/share/applications/nuvio.desktop
#   The command        ~/.local/bin/nuvio
#
# The app draws with libraries every desktop distribution packages (mpv, WebKitGTK, GStreamer).
# The setup checks for them and, where some are missing, offers to install exactly those with the
# system's package manager (which asks for the password), or shows the command to run.
#
#   Nuvio-Setup.AppImage                 install (or update), asking first
#   Nuvio-Setup.AppImage --install       the same;  --yes answers every question with yes
#   Nuvio-Setup.AppImage --uninstall     remove the app (settings and profiles are kept)
#   Nuvio-Setup.AppImage --check         say which system parts are missing, change nothing
#   Nuvio-Setup.AppImage --install-deps  install the missing system parts only
#   Nuvio-Setup.AppImage --run [args]    start the app from this file without installing it
#   --no-launch                          don't offer to open the app when done
set -uo pipefail

here="${APPDIR:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)}"
source_app="$here/app"
version="$(cat "$here/VERSION" 2>/dev/null || echo "")"

data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
dest="$data_home/nuvio"
desktop_file="$data_home/applications/nuvio.desktop"
bin_dir="$HOME/.local/bin"
command_link="$bin_dir/nuvio"
title="Nuvio setup"

action="install"
assume_yes=0
launch=1
run_args=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --install) action="install" ;;
        --uninstall | --remove) action="uninstall" ;;
        --check) action="check" ;;
        --install-deps) action="deps" ;;
        --run) action="run"; shift; run_args=("$@"); break ;;
        --yes | -y) assume_yes=1 ;;
        --no-launch) launch=0 ;;
        --help | -h) sed -n '2,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        # A link the desktop hands over (nuvio://…) when this file is still the handler.
        *) action="run"; run_args=("$@"); break ;;
    esac
    shift
done

# ---- Talking to the person ---------------------------------------------------------------------
# A window when the desktop has a tool for one (zenity on GNOME and most others, kdialog on KDE),
# the terminal when started from one, and otherwise a notification.
ui="none"
if [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" && "${NUVIO_SETUP_UI:-}" != "terminal" ]]; then
    if command -v zenity >/dev/null 2>&1; then ui="zenity"
    elif command -v kdialog >/dev/null 2>&1; then ui="kdialog"
    fi
fi
if [[ "$ui" == "none" && -t 0 && -t 1 ]]; then ui="terminal"; fi

say() {
    case "$ui" in
        zenity) zenity --info --title="$title" --width=420 --text="$1" 2>/dev/null ;;
        kdialog) kdialog --title "$title" --msgbox "$1" 2>/dev/null ;;
        terminal) printf '%s\n' "$1" ;;
        *)
            printf '%s\n' "$1"
            command -v notify-send >/dev/null 2>&1 && notify-send "$title" "$1" 2>/dev/null
            ;;
    esac
    return 0
}

fail() {
    case "$ui" in
        zenity) zenity --error --title="$title" --width=420 --text="$1" 2>/dev/null ;;
        kdialog) kdialog --title "$title" --error "$1" 2>/dev/null ;;
        *)
            printf '%s\n' "$1" >&2
            [[ "$ui" == "none" ]] && command -v notify-send >/dev/null 2>&1 && notify-send "$title" "$1" 2>/dev/null
            ;;
    esac
    exit 1
}

# ask <question> <yes label> <no label>: true for yes. With nobody to ask, the answer is $4
# (yes unless given): opening a setup file is already asking for the install.
ask() {
    [[ "$assume_yes" == 1 ]] && return 0
    case "$ui" in
        zenity) zenity --question --title="$title" --width=420 --text="$1" --ok-label="$2" --cancel-label="$3" 2>/dev/null ;;
        kdialog) kdialog --title "$title" --yesno "$1" --yes-label "$2" --no-label "$3" 2>/dev/null ;;
        terminal)
            local answer
            read -r -p "$1 [$2/$3] (y/n) " answer
            [[ "$answer" =~ ^[Yy] ]]
            ;;
        *) [[ "${4:-yes}" == "yes" ]] ;;
    esac
}

# ---- The system parts the app needs --------------------------------------------------------------
lib_dirs=(/usr/lib/x86_64-linux-gnu /usr/lib64 /usr/lib /lib/x86_64-linux-gnu /lib64 /lib)

known_libs=""
has_lib() {
    if [[ -z "$known_libs" ]]; then
        known_libs="$( (ldconfig -p || /sbin/ldconfig -p || /usr/sbin/ldconfig -p) 2>/dev/null)"
        [[ -n "$known_libs" ]] || known_libs="-"
    fi
    grep -qF -- "$1" <<< "$known_libs" && return 0
    local dir
    for dir in "${lib_dirs[@]}"; do
        compgen -G "$dir/$1*" >/dev/null && return 0
    done
    return 1
}

# A file in one of the library folders' subfolders (a GStreamer plugin, a GIO module).
has_module() {
    local dir
    for dir in "${lib_dirs[@]}"; do
        [[ -e "$dir/$1" ]] && return 0
    done
    return 1
}

package_manager=""
if command -v apt-get >/dev/null 2>&1; then package_manager="apt"
elif command -v pacman >/dev/null 2>&1; then package_manager="pacman"
elif command -v dnf >/dev/null 2>&1; then package_manager="dnf"
fi

# name | what it is, in plain words | apt | pacman | dnf
parts=(
    "mpv|the video player (mpv)|libmpv2|mpv|mpv-libs"
    "webkit|the page engine the interface is drawn with (WebKitGTK 4.1)|libwebkit2gtk-4.1-0|webkit2gtk-4.1|webkit2gtk4.1"
    "xcomposite|a window library (libXcomposite)|libxcomposite1|libxcomposite|libXcomposite"
    "xext|a window library (libXext)|libxext6|libxext|libXext"
    "gst-good|sound and video support (GStreamer good plugins)|gstreamer1.0-plugins-good|gst-plugins-good|gstreamer1-plugins-good"
    "gst-libav|sound and video formats (GStreamer libav)|gstreamer1.0-libav|gst-libav|gstreamer1-plugin-libav"
    "tls|secure connections for the interface (glib-networking)|glib-networking|glib-networking|glib-networking"
)

part_present() {
    case "$1" in
        mpv) has_lib "libmpv.so.2" ;;
        webkit) has_lib "libwebkit2gtk-4.1.so.0" ;;
        xcomposite) has_lib "libXcomposite.so.1" ;;
        xext) has_lib "libXext.so.6" ;;
        gst-good) has_module "gstreamer-1.0/libgstautodetect.so" ;;
        gst-libav) has_module "gstreamer-1.0/libgstlibav.so" ;;
        tls) has_module "gio/modules/libgiognutls.so" || has_module "gio/modules/libgioopenssl.so" ;;
    esac
}

missing_words=()
missing_packages=()
find_missing() {
    missing_words=()
    missing_packages=()
    known_libs=""
    local part name words apt pacman dnf
    for part in "${parts[@]}"; do
        IFS='|' read -r name words apt pacman dnf <<< "$part"
        part_present "$name" && continue
        missing_words+=("$words")
        case "$package_manager" in
            apt) missing_packages+=("$apt") ;;
            pacman) missing_packages+=("$pacman") ;;
            dnf) missing_packages+=("$dnf") ;;
        esac
    done
}

# The command that installs the missing parts, as someone would type it.
deps_command() {
    case "$package_manager" in
        apt) echo "sudo apt install ${missing_packages[*]}" ;;
        pacman) echo "sudo pacman -S --needed ${missing_packages[*]}" ;;
        dnf) echo "sudo dnf install ${missing_packages[*]}" ;;
    esac
}

missing_list() {
    local words
    for words in "${missing_words[@]}"; do printf '  - %s\n' "$words"; done
}

# Installs the missing parts with the package manager: directly when already the administrator,
# else through the desktop's password prompt. True when it ran and succeeded.
install_deps() {
    local -a command
    case "$package_manager" in
        apt) command=(apt-get install -y "${missing_packages[@]}") ;;
        pacman) command=(pacman -S --needed --noconfirm "${missing_packages[@]}") ;;
        dnf) command=(dnf install -y "${missing_packages[@]}") ;;
        *) return 1 ;;
    esac
    if [[ "$(id -u)" == 0 ]]; then
        "${command[@]}"
    elif command -v pkexec >/dev/null 2>&1 && [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
        pkexec "${command[@]}"
    elif [[ "$ui" == "terminal" ]] && command -v sudo >/dev/null 2>&1; then
        sudo "${command[@]}"
    else
        return 1
    fi
}

# Checks the system parts and deals with what is missing. Prints nothing when all are there.
settle_deps() {
    find_missing
    [[ ${#missing_words[@]} -eq 0 ]] && return 0
    local list
    list="$(missing_list)"
    if [[ -z "$package_manager" ]]; then
        say "Nuvio needs these parts, which this computer doesn't have yet:
$list

Install them with your system's package manager, then open Nuvio."
        return 1
    fi
    local command
    command="$(deps_command)"
    if ask "Nuvio needs these parts, which this computer doesn't have yet:
$list

Install them now? The system will ask for your password." "Install them" "Not now" no; then
        if install_deps; then
            find_missing
            [[ ${#missing_words[@]} -eq 0 ]] && return 0
        fi
        command="$(deps_command)"
    fi
    say "Nuvio won't start until these are installed:
$(missing_list)

Run this in a terminal:
$command"
    return 1
}

# ---- Installing ----------------------------------------------------------------------------------
app_running() {
    pgrep -u "$(id -u)" -f "^$dest/lib/runtime/bin/java|^$dest/bin/Nuvio" >/dev/null 2>&1
}

write_desktop_entry() {
    mkdir -p "$(dirname "$desktop_file")"
    # The same entry the .deb and Arch packages ship; under the same name, so with one of those
    # installed too there is still one "Nuvio" in the menu (the person's own entry wins).
    cat > "$desktop_file" <<EOF
[Desktop Entry]
Type=Application
Name=Nuvio
Comment=Nuvio Media Player
Exec="$dest/bin/Nuvio" %u
Icon=$dest/lib/Nuvio.png
Terminal=false
Categories=AudioVideo;
StartupNotify=true
StartupWMClass=com-nuvio-app-MainKt
MimeType=x-scheme-handler/nuvio;x-scheme-handler/stremio;
EOF
    chmod 644 "$desktop_file"
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$desktop_file")" >/dev/null 2>&1
    return 0
}

copy_app() {
    local staging="$dest.new"
    rm -rf "$staging"
    mkdir -p "$(dirname "$dest")" || return 1
    cp -a "$source_app" "$staging" || { rm -rf "$staging"; return 1; }
    printf '%s\n' "$version" > "$staging/VERSION"
    # The way to remove it again, kept with the app for when this setup file is long gone.
    cat > "$staging/uninstall.sh" <<EOF
#!/usr/bin/env bash
# Removes Nuvio as its setup installed it. Settings and profiles (~/.config/nuvio) are kept.
rm -f "$desktop_file" "$command_link"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$desktop_file")" >/dev/null 2>&1
rm -rf "$dest"
echo "Nuvio was removed. Your settings and profiles are still in ~/.config/nuvio."
EOF
    chmod +x "$staging/uninstall.sh"
    # Swapped in whole, so a copy that stops half way never leaves a broken app behind.
    rm -rf "$dest.old"
    if [[ -e "$dest" ]]; then mv "$dest" "$dest.old" || { rm -rf "$staging"; return 1; }; fi
    mv "$staging" "$dest" || { [[ -e "$dest.old" ]] && mv "$dest.old" "$dest"; return 1; }
    rm -rf "$dest.old"
    return 0
}

do_install() {
    [[ -x "$source_app/bin/Nuvio" ]] || fail "This setup file is damaged: the app is not inside it. Download it again."
    [[ -n "${HOME:-}" && -d "$HOME" ]] || fail "No home folder to install into."

    local had="" question
    [[ -f "$dest/VERSION" ]] && had="$(cat "$dest/VERSION")"
    if [[ -n "$had" && "$had" == "$version" ]]; then
        question="Nuvio $version is already installed. Install it again?"
    elif [[ -n "$had" ]]; then
        question="Update Nuvio from $had to $version?"
    else
        question="Install Nuvio $version?

It goes into your own folder ($dest) and gets an entry in the app menu. No administrator rights are needed for that."
    fi
    ask "$question" "Install" "Cancel" || exit 0

    if app_running; then
        fail "Nuvio is open. Close it, then open this setup file again."
    fi

    local free_kb need_kb
    need_kb="$(du -sk "$source_app" 2>/dev/null | awk '{ print $1 }')"
    mkdir -p "$data_home" 2>/dev/null
    free_kb="$(df -Pk "$data_home" 2>/dev/null | awk 'NR == 2 { print $4 }')"
    if [[ -n "$need_kb" && -n "$free_kb" && "$free_kb" -lt $((need_kb + 51200)) ]]; then
        fail "Not enough room: Nuvio needs about $((need_kb / 1024 + 50)) MB in $data_home, and $((free_kb / 1024)) MB are free."
    fi

    if [[ "$ui" == "zenity" ]]; then
        # A moving bar while the files are copied (a few hundred MB on a slow disk takes a moment).
        local result
        result="$(mktemp)"
        ( copy_app; echo $? > "$result" ) > >(zenity --progress --pulsate --auto-close --no-cancel --title="$title" --width=420 --text="Installing Nuvio…" 2>/dev/null)
        wait
        local copied
        copied="$(cat "$result" 2>/dev/null)"
        rm -f "$result"
        [[ "$copied" == 0 ]] || fail "Nuvio could not be copied to $dest. Check that the folder can be written to and has room."
    else
        [[ "$ui" == "terminal" ]] && echo "Installing Nuvio $version to $dest …"
        copy_app || fail "Nuvio could not be copied to $dest. Check that the folder can be written to and has room."
    fi

    write_desktop_entry
    mkdir -p "$bin_dir" 2>/dev/null && ln -sfn "$dest/bin/Nuvio" "$command_link" 2>/dev/null

    local ready=1
    settle_deps || ready=0

    if [[ "$ready" == 1 ]]; then
        local done_words="Nuvio $version is installed. You'll find it in the app menu."
        if [[ "$launch" == 1 && -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
            if [[ "$ui" == "none" ]]; then
                say "$done_words"
                start_installed
            elif [[ "$assume_yes" == 0 ]] && ask "$done_words" "Open Nuvio" "Close"; then
                start_installed
            elif [[ "$assume_yes" == 1 ]]; then
                say "$done_words"
            fi
        else
            say "$done_words"
        fi
    fi
    # Installed either way; without its system parts it is not ready, and the caller is told.
    [[ "$ready" == 1 ]]
}

start_installed() {
    (setsid "$dest/bin/Nuvio" >/dev/null 2>&1 &)
}

do_uninstall() {
    if [[ ! -e "$dest" && ! -e "$desktop_file" ]]; then
        say "Nuvio is not installed for this user."
        exit 0
    fi
    ask "Remove Nuvio? Your settings and profiles are kept." "Remove" "Cancel" || exit 0
    if app_running; then
        fail "Nuvio is open. Close it, then try again."
    fi
    rm -f "$desktop_file"
    # Only the link this setup made, not a command of the same name from somewhere else.
    if [[ -L "$command_link" && "$(readlink "$command_link")" == "$dest/bin/Nuvio" ]]; then rm -f "$command_link"; fi
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$desktop_file")" >/dev/null 2>&1
    rm -rf "$dest" "$dest.new" "$dest.old"
    say "Nuvio was removed. Your settings and profiles are still in ~/.config/nuvio."
}

case "$action" in
    run)
        exec "$source_app/bin/Nuvio" "${run_args[@]}"
        ;;
    check)
        find_missing
        if [[ ${#missing_words[@]} -eq 0 ]]; then
            echo "Nothing is missing: this computer has every part Nuvio needs."
            exit 0
        fi
        echo "Missing:"
        missing_list
        [[ -n "$package_manager" ]] && echo "Install with: $(deps_command)"
        exit 3
        ;;
    deps)
        find_missing
        if [[ ${#missing_words[@]} -eq 0 ]]; then
            echo "Nothing is missing: this computer has every part Nuvio needs."
            exit 0
        fi
        assume_yes=1
        settle_deps
        ;;
    uninstall)
        do_uninstall
        ;;
    *)
        do_install
        ;;
esac
