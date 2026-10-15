#!/bin/sh
# Install (or update) the watchdog timer. Run from anywhere: sudo ./install.sh
set -eu
project=$(cd "$(dirname "$0")/.." && pwd)
sed "s|@PROJECT@|$project|" "$project/watchdog/mediaserver-watchdog.service" \
    > /etc/systemd/system/mediaserver-watchdog.service
cp "$project/watchdog/mediaserver-watchdog.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mediaserver-watchdog.timer
systemctl start mediaserver-watchdog.service
journalctl -u mediaserver-watchdog.service -n 5 --no-pager -o cat
