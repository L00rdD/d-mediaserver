#!/bin/sh
# Keeps Transmission's peer port on the port the VPN forwards. Gluetun writes
# that port to /vpn-port/port each time it gets one (a new one at every
# reconnection); every 30 s this compares it with Transmission's and sets it
# when they differ. Without a port file (a VPN without forwarding) it idles.
RPC=http://localhost:9091/transmission/rpc
FILE=/vpn-port/port

# Transmission's RPC wants the session id it hands out in a 409 first.
rpc() {
  sid=$(curl -s -o /dev/null -D - "$RPC" | tr -d '\r' |
    awk 'tolower($1) == "x-transmission-session-id:" { print $2 }')
  curl -fs -H "X-Transmission-Session-Id: $sid" -d "$1" "$RPC"
}

while true; do
  port=$(cat "$FILE" 2>/dev/null)
  case "$port" in
    '' | *[!0-9]*) ;;
    *)
      current=$(rpc '{"method":"session-get","arguments":{"fields":["peer-port"]}}' |
        grep -o '"peer-port":[0-9]*' | cut -d: -f2)
      if [ -n "$current" ] && [ "$current" != "$port" ]; then
        # UPnP/NAT-PMP from inside the tunnel would only fight the VPN's port
        rpc "{\"method\":\"session-set\",\"arguments\":{\"peer-port\":$port,\"port-forwarding-enabled\":false}}" >/dev/null &&
          echo "peer port $current -> $port"
      fi
      ;;
  esac
  sleep 30
done
