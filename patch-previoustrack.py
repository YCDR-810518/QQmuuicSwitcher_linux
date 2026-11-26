#!/usr/bin/env python3
"""Fix QQ Music Linux 1.1.8: 'previoustrack' was wired to playNext().

The bug is in resources/app.asar:

    navigator.mediaSession.setActionHandler('previoustrack', () => {
      this.playNext();          // wrong
    });

This script replaces that single call with this.playPrev(). Both strings have
the same length, so the asar archive structure and offsets stay untouched.
A .bak backup is created before the first patch.
"""

import argparse
import os
import sys
from pathlib import Path

OLD = b"setActionHandler('previoustrack', () => {\\n      this.playNext();\\n    });"
NEW = b"setActionHandler('previoustrack', () => {\\n      this.playPrev();\\n    });"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "asar",
        nargs="?",
        default=str(Path.home() / ".local/opt/qqmusic/resources/app.asar"),
        help="path to QQ Music app.asar (default: %(default)s)",
    )
    parser.add_argument(
        "--restore", action="store_true", help="restore from the .bak backup"
    )
    args = parser.parse_args()

    asar = Path(args.asar).expanduser()
    backup = asar.with_suffix(".asar.bak")

    if args.restore:
        if not backup.exists():
            sys.exit(f"No backup found: {backup}")
        backup.replace(asar)
        print(f"Restored {asar} from {backup}")
        return

    if not asar.exists():
        sys.exit(f"Not found: {asar}")

    data = asar.read_bytes()
    count_old, count_new = data.count(OLD), data.count(NEW)

    if count_new == 1 and count_old == 0:
        print("Already patched; nothing to do.")
        return
    if count_old != 1:
        sys.exit(
            f"Unexpected pattern count (old={count_old}, new={count_new}). "
            "This script only supports QQ Music 1.1.8; aborting."
        )

    if not backup.exists():
        backup.write_bytes(data)
        print(f"Backup saved: {backup}")

    patched = data.replace(OLD, NEW, 1)
    assert len(patched) == len(data), "length must stay identical"

    tmp = asar.with_name(asar.name + ".new")
    tmp.write_bytes(patched)
    os.replace(tmp, asar)
    print(f"Patched: {asar}")
    print("Restart QQ Music for the change to take effect.")


if __name__ == "__main__":
    main()
