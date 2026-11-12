#!/bin/sh
# Install (or update) the fakes timer. Run from anywhere: sudo ./install.sh
set -eu
project=$(cd "$(dirname "$0")/.." && pwd)
sed "s|@PROJECT@|$project|" "$project/fakes/mediaserver-fakes.service" \
    > /etc/systemd/system/mediaserver-fakes.service
cp "$project/fakes/mediaserver-fakes.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mediaserver-fakes.timer
systemctl start mediaserver-fakes.service
journalctl -u mediaserver-fakes.service -n 5 --no-pager -o cat
