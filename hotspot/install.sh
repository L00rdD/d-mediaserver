#!/bin/sh
# Install (or update) the wifi fallback service. Run from anywhere: sudo ./install.sh
set -eu
project=$(cd "$(dirname "$0")/.." && pwd)
grep -q '^HOTSPOT_PASSWORD=.\{8,\}' "$project/.env" || {
    echo "Add HOTSPOT_PASSWORD=<8+ characters> (and optionally HOTSPOT_SSID) to $project/.env first" >&2
    exit 1
}
sed "s|@PROJECT@|$project|" "$project/hotspot/wifi-fallback.service" \
    > /etc/systemd/system/wifi-fallback.service
systemctl daemon-reload
systemctl enable wifi-fallback.service
systemctl restart wifi-fallback.service
sleep 3
journalctl -u wifi-fallback.service -n 5 --no-pager -o cat
