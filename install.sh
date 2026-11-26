#!/bin/sh
# Install the GNOME Shell extension from this repository.
set -eu

SRC="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/qqmusic-panel@local"
DST="$HOME/.local/share/gnome-shell/extensions/qqmusic-panel@local"

if [ ! -f "$SRC/extension.js" ]; then
    echo "Missing $SRC/extension.js" >&2
    exit 1
fi

mkdir -p "$(dirname "$DST")"
cp -R "$SRC" "$DST"
gnome-extensions enable qqmusic-panel@local

echo "Installed and enabled qqmusic-panel@local."
echo "GNOME Shell caches JS modules: log out and log back in once to load it."
