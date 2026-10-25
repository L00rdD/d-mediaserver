#!/usr/bin/env python3
"""Open a local wifi from the Pi when the home network is gone, until it comes back.

Runs as a service (wifi-fallback.service, root). Every few seconds:

1. checks that the home network really works, over the Ethernet cable or the
   wifi (connected and the router answers a ping). If neither has worked for
   GRACE seconds, the Pi switches wlan0 to access point mode and opens its own network
   (HOTSPOT_SSID, 5 GHz channel 36), with the same address as at home, so the
   home page, Jellyfin and the apps' saved server addresses keep working for
   whoever joins it; its DNS answers <hostname>.lan with that address, as the
   router does at home. No internet on it: only the Pi and its films.
   The home address is read from the interface that works (eth0 first) and
   kept in ADDRESS_FILE, so it is still known after a reboot without network.
2. while the hotspot is up: closes it as soon as the Ethernet works again,
   and scans for the known wifis (the NetworkManager profiles). When one is
   back in range, the hotspot is closed and the Pi joins it again; if that
   fails, the hotspot comes back. A scan made in
   access point mode can miss a wifi (the Pi 4's chip sometimes only sees
   neighbours), so it also tries blindly every BLIND_EVERY seconds (the
   hotspot drops for about a minute each time).
3. posts to Discord once the Pi is back online, saying how long it lasted.

Settings come from the project's .env (next to this folder):
  HOTSPOT_SSID          name of the Pi's own network (dpi-hotspot)
  HOTSPOT_PASSWORD      its WPA2 password, 8 characters or more (required)
  WATCHDOG_WEBHOOK_URL  Discord webhook (falls back on AUTOHEAL_WEBHOOK_URL)
  HOTSPOT_ADDRESS       fixed address for the hotspot, e.g. 192.168.1.229/24
                        (default: the last address the Pi had at home)

Only the Python standard library, plus nmcli, iw and ping.
"""

import json
import re
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
IFACE = "wlan0"
WIRED = "eth0"
HOTSPOT = "wifi-fallback-hotspot"  # NetworkManager profile name
ADDRESS_FILE = Path("/var/lib/wifi-fallback/address")  # last address seen at home
DEFAULT_ADDRESS = "10.42.0.1/24"  # NetworkManager's own default, until home was seen
DNS_FILE = Path("/etc/NetworkManager/dnsmasq-shared.d/wifi-fallback.conf")

TICK = 15          # seconds between checks
GRACE = 180        # wifi broken this long -> hotspot
SCAN_EVERY = 60    # look for the home wifi this often while on hotspot
BLIND_EVERY = 1200  # try to rejoin this often even when the scan sees nothing
JOIN_TIMEOUT = 60  # seconds given to NetworkManager to rejoin a wifi


def log(msg):
    print(msg, flush=True)


def run(*cmd, timeout=30):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout
    except (subprocess.TimeoutExpired, OSError) as e:
        return 1, str(e)


def read_env():
    env = {}
    try:
        for line in (PROJECT / ".env").read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip("'\"")
    except OSError:
        pass
    return env


def post(url, text):
    """Send text to a Discord webhook (native or its /slack variant)."""
    key = "text" if url.rstrip("/").endswith("/slack") else "content"
    body = json.dumps({key: text, "username": "Mediaserver watchdog"}).encode()
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json", "User-Agent": "mediaserver-watchdog"}
    )
    urllib.request.urlopen(req, timeout=15)


def active_connection(iface=IFACE):
    _, out = run("nmcli", "-g", "GENERAL.CONNECTION", "device", "show", iface)
    return out.strip()


def link_works(iface):
    """iface is connected (not as the hotspot) and the router answers through it."""
    _, out = run("nmcli", "-g", "GENERAL.STATE,GENERAL.CONNECTION,IP4.GATEWAY", "device", "show", iface)
    lines = out.strip().splitlines() + ["", "", ""]
    state, conn, gateway = lines[0], lines[1], lines[2]
    if not state.startswith("100") or conn == HOTSPOT or not gateway:
        return False
    code, _ = run("ping", "-c", "2", "-W", "2", "-I", iface, gateway, timeout=10)
    return code == 0


def home_link():
    """The interface the home network works on (the cable first), or None."""
    return next((i for i in (WIRED, IFACE) if link_works(i)), None)


def known_wifis():
    """SSID -> profile name, for the client wifi profiles NetworkManager knows."""
    _, out = run("nmcli", "-t", "-f", "NAME,TYPE", "connection", "show")
    known = {}
    for line in out.splitlines():
        name, _, kind = line.rpartition(":")
        name = name.replace("\\:", ":")
        if kind != "802-11-wireless" or name == HOTSPOT:
            continue
        _, info = run("nmcli", "-g", "802-11-wireless.ssid,802-11-wireless.mode", "connection", "show", name)
        fields = info.strip().splitlines() + ["", ""]
        if fields[0] and fields[1] in ("", "infrastructure"):
            known[fields[0]] = name
    return known


def scan():
    """SSIDs in range, or None when the chip refuses to scan."""
    for extra in ((), ("ap-force",)):
        code, out = run("iw", "dev", IFACE, "scan", *extra, timeout=30)
        if code == 0:
            return set(re.findall(r"^\s*SSID: (.+)$", out, re.M))
    return None


def home_address(iface):
    """The address iface has on the home network, e.g. 192.168.1.229/24."""
    _, out = run("nmcli", "-g", "IP4.ADDRESS", "device", "show", iface)
    return out.strip().split(" | ")[0]


def saved_address():
    try:
        return ADDRESS_FILE.read_text().strip()
    except OSError:
        return ""


def set_hotspot_address(address):
    """Give the hotspot this address, and make its DNS answer <hostname>.lan with it."""
    code, out = run("nmcli", "connection", "modify", HOTSPOT, "ipv4.addresses", address)
    if code != 0:
        log(f"cannot set the hotspot address {address}: {out.strip()}")
    DNS_FILE.parent.mkdir(parents=True, exist_ok=True)
    DNS_FILE.write_text(f"address=/{socket.gethostname()}.lan/{address.split('/')[0]}\n")


def ensure_hotspot_profile(env):
    ssid = env.get("HOTSPOT_SSID") or "dpi-hotspot"
    password = env.get("HOTSPOT_PASSWORD", "")
    if len(password) < 8:
        sys.exit("HOTSPOT_PASSWORD (8 characters or more) is missing from .env")
    settings = [
        "connection.autoconnect", "no",
        "connection.interface-name", IFACE,
        "802-11-wireless.ssid", ssid,
        "802-11-wireless.mode", "ap",
        # 5 GHz: the Pi 4's firmware (firmware-brcm80211 20260519+rpt1) sends
        # no beacon at all on 2.4 GHz, RPi-Distro/firmware-nonfree#58
        "802-11-wireless.band", "a",
        "802-11-wireless.channel", "36",
        "wifi-sec.key-mgmt", "wpa-psk",
        "wifi-sec.proto", "rsn",
        "wifi-sec.pairwise", "ccmp",
        "wifi-sec.group", "ccmp",
        "wifi-sec.psk", password,
        "wifi-sec.pmf", "disable",  # the Pi's brcmfmac chip mishandles it in AP mode
        "ipv4.method", "shared",
        "ipv6.method", "disabled",
    ]
    code, _ = run("nmcli", "connection", "show", HOTSPOT)
    if code != 0:
        run("nmcli", "connection", "add", "type", "wifi", "con-name", HOTSPOT, "ifname", IFACE, "ssid", ssid)
    code, out = run("nmcli", "connection", "modify", HOTSPOT, *settings)
    if code != 0:
        sys.exit(f"cannot set up the hotspot profile: {out}")
    return ssid


def start_hotspot():
    code, out = run("nmcli", "connection", "up", HOTSPOT, timeout=JOIN_TIMEOUT)
    if code != 0:
        log(f"hotspot failed to start: {out.strip()}")
    return code == 0


def try_rejoin(profile):
    """Close the hotspot and join a wifi (any known one if profile is None).
    Returns the interface the home network works on again, or None."""
    run("nmcli", "connection", "down", HOTSPOT)
    if profile:
        run("nmcli", "--wait", str(JOIN_TIMEOUT), "connection", "up", profile, timeout=JOIN_TIMEOUT + 5)
    else:
        # let NetworkManager's autoconnect pick whatever it can find
        time.sleep(JOIN_TIMEOUT)
    for _ in range(4):
        link = home_link()
        if link:
            return link
        time.sleep(5)
    return None


def main():
    env = read_env()
    ssid = ensure_hotspot_profile(env)
    fixed = env.get("HOTSPOT_ADDRESS")
    address = fixed or saved_address() or DEFAULT_ADDRESS
    set_hotspot_address(address)
    webhook = env.get("WATCHDOG_WEBHOOK_URL") or env.get("AUTOHEAL_WEBHOOK_URL")
    host = socket.gethostname()

    hotspot_since = time.time() if active_connection() == HOTSPOT else None
    broken_since = None
    last_scan = last_blind = 0
    pending_message = None
    log(f"started, {'hotspot up' if hotspot_since else 'on the home network'}, hotspot address {address}")

    while True:
        now = time.time()

        if hotspot_since is None:
            link = home_link()
            if link:
                broken_since = None
                current = home_address(link)
                if not fixed and current and current != address:
                    log(f"address at home is now {current} ({link}), the hotspot will use it")
                    address = current
                    ADDRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
                    ADDRESS_FILE.write_text(address + "\n")
                    set_hotspot_address(address)
                if pending_message and webhook:
                    try:
                        post(webhook, pending_message)
                        pending_message = None
                    except Exception as e:
                        log(f"Discord post failed: {e}")
            elif active_connection() == HOTSPOT:
                # opened by hand, or the service restarted: take it over
                log("hotspot already up")
                hotspot_since = broken_since or now
                last_scan = last_blind = now
            else:
                broken_since = broken_since or now
                if now - broken_since >= GRACE:
                    log(f"home network down for {int(now - broken_since)} s, opening hotspot {ssid}")
                    if start_hotspot():
                        hotspot_since = broken_since
                        last_scan = last_blind = now
                    else:
                        broken_since = now  # try again after another GRACE

        else:
            back = None
            if link_works(WIRED):
                log("the cable works again, closing the hotspot")
                run("nmcli", "connection", "down", HOTSPOT)
                back = WIRED
            elif active_connection() != HOTSPOT:
                back = home_link()
                if not back:
                    log("hotspot went down on its own, restarting it")
                    start_hotspot()
            elif now - last_scan >= SCAN_EVERY:
                last_scan = now
                known = known_wifis()
                seen = scan()
                target = next((known[s] for s in known if s in (seen or ())), None)
                due = target is not None or now - last_blind >= BLIND_EVERY
                if due:
                    last_blind = now
                    log(f"trying to rejoin {target or 'any known wifi'}")
                    back = try_rejoin(target)
                    if not back:
                        log("rejoin failed, reopening the hotspot")
                        if not start_hotspot():
                            # back to the wifi branch: GRACE, then try again
                            hotspot_since, broken_since = None, time.time()
            if back:
                minutes = int((time.time() - hotspot_since) / 60)
                via = active_connection(back) or back
                log(f"back on {via}, hotspot closed after {minutes} min")
                pending_message = (
                    f"📶 **{host}**: lost the home network, ran its own hotspot `{ssid}` "
                    f"for {minutes} min, now back on `{via}`."
                )
                hotspot_since = broken_since = None
                continue

        time.sleep(TICK)


if __name__ == "__main__":
    main()
