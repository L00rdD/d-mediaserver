#!/bin/sh
# Opens Ohara to the internet through a Cloudflare quick tunnel, behind ohara-gate's
# password, under a new address every day at TUNNEL_HOUR: each new link is said on the
# Discord channel linked in Ohara's settings. Should the tunnel fall, it comes back
# under a new address, said as well.
STATE=/manga/.ohara/state.json
LOG=/tmp/cloudflared.log
HOUR=${TUNNEL_HOUR:-8}

say() {
	hook=$(jq -r '.settings.discord // empty' "$STATE" 2>/dev/null)
	if [ -z "$hook" ]; then
		echo "no Discord channel linked in Ohara"
		return
	fi
	jq -n --arg c "$1" '{content: $c}' \
		| curl -fsS --retry 3 --retry-delay 20 -H 'Content-Type: application/json' -d @- "$hook" >/dev/null \
		|| echo "Discord did not take the link"
}

# the next TUNNEL_HOUR o'clock, in seconds
next_change() {
	at=$(date -d "$(date +%Y-%m-%d) $HOUR:00" +%s)
	[ "$at" -gt "$(date +%s)" ] || at=$((at + 86400))
	echo "$at"
}

# the tunnel's address, once Cloudflare has given one (two minutes at most)
address() {
	for _ in $(seq 60); do
		url=$(grep -Eo 'https://[a-z0-9]+(-[a-z0-9]+)+\.trycloudflare\.com' "$LOG" | head -1)
		[ -n "$url" ] && echo "$url" && return
		kill -0 "$1" 2>/dev/null || return
		sleep 2
	done
}

while true; do
	cloudflared tunnel --no-autoupdate --url http://ohara-gate:8080 >"$LOG" 2>&1 &
	pid=$!
	url=$(address "$pid")
	if [ -n "$url" ]; then
		until=$(next_change)
		echo "open at $url until $(date -d "@$until" '+%d/%m %H:%M')"
		say "📚 Le lien d'Ohara jusqu'à demain ${HOUR} h : $url"
		while kill -0 "$pid" 2>/dev/null && [ "$(date +%s)" -lt "$until" ]; do
			sleep 30
		done
	else
		echo "no address from Cloudflare:"; tail -5 "$LOG"
	fi
	kill "$pid" 2>/dev/null
	wait "$pid" 2>/dev/null
	sleep 10
done
