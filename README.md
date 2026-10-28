# 🍿 Ultimate Home Media Server

![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white)
![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)
![Raspberry Pi](https://img.shields.io/badge/-RaspberryPi-C51A4A?style=for-the-badge&logo=Raspberry-Pi)

Welcome to your fully automated, Dockerized home media server! This stack provides everything you need to request, download, manage, and stream your favorite movies and TV shows securely. It turns a Raspberry Pi 4 into a small **virtual NAS**: any number of USB drives are pooled into a single path (`/mnt/storage`) with [mergerfs](https://github.com/trapexit/mergerfs), used by every container and shared on the network over SMB.

> **Not on a Raspberry Pi?** [DEPLOY.md](DEPLOY.md) is the short path for a NAS or any machine that already runs Docker.

## 🧭 Where to Start

| You want to | Read |
| :--- | :--- |
| Install it on a Raspberry Pi with USB drives | [Installation & Deployment](#%EF%B8%8F-installation--deployment), then [Keep the Pi Up](#-keep-the-pi-up) |
| Install it on a NAS or a PC that already runs Docker | [DEPLOY.md](DEPLOY.md) |
| Use it day to day | [Accessing Your Apps](#-accessing-your-apps) |
| Update a running install | [Updating the Pi](#-updating-the-pi) |
| Run your own project next to it | [Add Your Own Apps](#-add-your-own-apps) |

Options, each one off until you turn it on:

| Option | What it does | Turn it on |
| :--- | :--- | :--- |
| [VPN](#%EF%B8%8F-vpn-optional) | Transmission, and only Transmission, goes through a VPN. | 4 lines in `.env` |
| [Watchdog](#watchdog) | Brings the apps back after a USB drive drop and alerts you on Discord. | `sudo ./watchdog/install.sh` |
| [Wifi fallback hotspot](#wifi-fallback-hotspot) | The Pi opens its own wifi when the home network is gone, so the films stay watchable. | `sudo ./hotspot/install.sh` |
| [One Piece scans](#%EF%B8%8F-one-piece-scans-optional) | A home page card and a Discord post for each new chapter. | 2 lines in `.env` |
| [No login at home](#-passwords) | Radarr, Sonarr and Prowlarr open without a password on the home network. | 1 line in `.env` |

Every setting goes in one `.env` file next to `docker-compose.yml`: copy [`.env.example`](.env.example), which lists them all.

---

## 🚀 The Stack

This environment is powered by the *Arr* suite and Jellyfin:

| Service | Description | Port |
| :--- | :--- | :--- |
| **Home page** | One page that links to every app below, served by [Caddy](https://caddyserver.com/). It shows how full the data disk is. | `80` |
| **[Jellyfin](https://jellyfin.org/)** | Open-source media streaming server. | `8096` |
| **[Sonarr](https://sonarr.tv/)** | Smart PVR for automatic TV Show downloading and sorting. | `8989` |
| **[Radarr](https://radarr.video/)** | Smart PVR for automatic Movie downloading and sorting. | `7878` |
| **[Transmission](https://transmissionbt.com/)**| Fast, easy, and free BitTorrent client. | `9091` |
| **[Bazarr](https://www.bazarr.media/)** | Fetches subtitles matched to each release and re-times them on the audio. | `6767` |
| **[Prowlarr](https://prowlarr.com/)** | Indexer manager/proxy built to integrate with Sonarr/Radarr. | `9696` |
| **[FlareSolverr](https://github.com/FlareSolverr/)**| Proxy server to bypass Cloudflare protection for indexers. | `8191` |
| **[Gluetun](https://github.com/qdm12/gluetun)** | Optional VPN client that Transmission goes through (see VPN). | |

---

## 📁 Storage Layout

Each USB drive is mounted on its own under `/mnt/disks/`, and mergerfs merges them all into one pool. Apps, Docker and the network share only ever use the pool.

```text
/mnt/
├── disks/               # Physical drives (never used directly)
│   ├── disk1/
│   ├── disk2/
│   └── ...
└── storage/             # The pool = every disk merged (the only path you use)
    ├── complete/        # Finished downloads
    ├── incomplete/      # Active downloads
    ├── movies/          # Sorted movies
    └── shows/           # Sorted TV shows
```

Inside every container the pool is mounted at `/data` (`/data/movies`, `/data/shows`, `/data/complete`, `/data/incomplete`).

Good to know:

- **No RAID.** Files are stored whole on one of the drives. If a drive dies you only lose what was on that drive, and every drive stays readable on its own.
- **Adding a drive** = mount it under `/mnt/disks/diskN` and remount the pool. Nothing to change in Docker.
- **Prefer `ext4`** for every drive. `exFAT` works but has no permissions, no hardlinks and no journal.
- **Power:** a Pi 4 can only feed about 1.2 A across all its USB ports. With more than one drive, use a powered USB hub or self-powered enclosures, plugged into the blue USB 3 ports.

---

## 🛠️ Installation & Deployment

### 1. Mount the Drives

Find your drives' UUIDs:
```bash
sudo blkid
```

Create the mount points and install mergerfs:
```bash
sudo apt install -y mergerfs
sudo mkdir -p /mnt/disks/disk1 /mnt/disks/disk2 /mnt/storage
```

Add one line per drive to `/etc/fstab`, then the pool line:

```text
# Physical drives (ext4)
UUID=YOUR-UUID-HERE /mnt/disks/disk1 ext4 defaults,noatime,nofail,x-systemd.device-timeout=10 0 2
# Physical drives (exfat - needs uid/gid for Docker write access)
UUID=YOUR-UUID-HERE /mnt/disks/disk2 exfat defaults,noatime,nofail,x-systemd.device-timeout=10,uid=1000,gid=1000,umask=002 0 0

# The pool
/mnt/disks/* /mnt/storage fuse.mergerfs allow_other,cache.files=partial,dropcacheonclose=true,category.create=mfs,moveonenospc=true,minfreespace=20G,fsname=storage,nofail,x-systemd.requires-mounts-for=/mnt/disks/disk1,x-systemd.requires-mounts-for=/mnt/disks/disk2 0 0
```

> **⚠️ CRITICAL:** keep `nofail` on every line. Without it, a missing or unpowered drive drops the Pi into emergency mode at boot and it never joins the network.

Apply the mounts and create the folders:
```bash
sudo systemctl daemon-reload
sudo mount -a
sudo mkdir -p /mnt/storage/{movies,shows,complete,incomplete}
sudo chown -R 1000:1000 /mnt/storage
```

Make Docker wait for the pool, so containers never write to the SD card when a drive is missing:
```bash
sudo mkdir -p /etc/systemd/system/docker.service.d
printf '[Unit]\nRequiresMountsFor=/mnt/storage\n' | sudo tee /etc/systemd/system/docker.service.d/wait-for-storage.conf
sudo systemctl daemon-reload
```

The flip side: when a drive drops off the USB bus, even for a second, systemd unmounts it and stops Docker with every app, and nothing starts them again once the drive is back. Install the [watchdog](#watchdog), which brings everything back within a minute and tells you on Discord:
```bash
sudo ./watchdog/install.sh
```

Cap the container logs, so an app that loops on an error can never fill the SD card (30 MB per container at most):
```bash
printf '{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "10m", "max-file": "3" }\n}\n' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
```

Containers that already exist keep their old log settings: after this, run `docker compose up -d --force-recreate` once in each project folder.

### 2. Share the Pool on the Network (SMB)

```bash
sudo apt install -y samba
sudo smbpasswd -a $USER
```

Append to `/etc/samba/smb.conf`:
```ini
[storage]
   path = /mnt/storage
   read only = no
   valid users = YOUR-USER
   force user = YOUR-USER
   create mask = 0664
   directory mask = 0775
```

And in its `[global]` section:
```ini
   server min protocol = SMB3
   use sendfile = yes
   aio read size = 1
   aio write size = 1
```

```bash
sudo systemctl restart smbd
```

The NAS is then reachable at `smb://<YOUR-SERVER-IP>/storage`.

### 3. Network Tuning

Plug the Pi in with an **Ethernet cable** (gigabit) and check the negotiated speed, it must say `1000Mb/s`:
```bash
ethtool eth0 | grep Speed
```

Enable BBR and larger TCP buffers:
```bash
echo tcp_bbr | sudo tee /etc/modules-load.d/bbr.conf
sudo tee /etc/sysctl.d/99-nas-network.conf <<'CONF'
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 131072 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
CONF
sudo modprobe tcp_bbr && sudo sysctl --system
```

Finally, give the Pi a fixed address with a DHCP reservation on your router.

### 4. Deploy the Server

```bash
git clone <this-repo> mediaserver && cd mediaserver
docker compose up -d
```

To run the stack on another machine (a NAS, a PC), override the defaults with a `.env` file next to `docker-compose.yml`. Copy `.env.example` to start from; [DEPLOY.md](DEPLOY.md) walks through the whole install:

```text
# Folder that holds movies/, shows/, complete/ and incomplete/
DATA_ROOT=/volume1/media
# User and group that own that folder (run `id` on the machine)
PUID=1026
PGID=100
TZ=Europe/Paris
# No login for Radarr, Sonarr and Prowlarr on the home network (see Passwords)
SKIP_LOCAL_LOGIN=1
# Port of the home page, if 80 is already taken (a NAS often uses it)
HOME_PORT=8088
```

Every line is optional. Without a `.env` the stack uses the Pi defaults: `/mnt/storage`, `1000:1000`, `Europe/Paris` and a home page at `http://dpi.lan`.

### 5. Point the Apps at `/data`

| App | Setting | Value |
| :--- | :--- | :--- |
| Transmission | Download / incomplete directory | `/data/complete`, `/data/incomplete` |
| Radarr | Root folder | `/data/movies` |
| Sonarr | Root folder | `/data/shows` |
| Jellyfin | Libraries | `/data/movies`, `/data/shows` |

---

## 🌐 Accessing Your Apps

Once Docker confirms all containers are `Started`, open your web browser and go to the home page:
`http://dpi.lan`

It is the only address to remember: it links to every app. Each app opens in its own tab, so the home page is always one tab away. It comes in three looks, *Reactor*, *Cyberpunk* and *Hogwarts*; the switch at the top right changes it and each device remembers its own choice.

Your own projects served on the same machine can take the same look and follow the switch: see [Add Your Own Apps](#-add-your-own-apps).

The search bar sends what you type straight to the right app: **Watch** looks for it in your Jellyfin library, **+ Movie** opens Radarr and **+ TV show** opens Sonarr with the search already running, ready to add.

**Online**, at the top right, opens the list of every container running on the machine (this stack and your own projects), its state and its ports as links: a new app shows up there by itself, without touching the page. A small `services` container reads it from Docker every 30 seconds (read-only socket, only the name, image, state and ports leave Docker). The counter next to *Online* turns to the warning colour when a container is stopped.

Under the apps, a bar shows how full the data disk is: a small `storage` container measures `DATA_ROOT` every minute and the page reads the result at `/disk.json`. The bar turns to the warning colour at 90 %.

The links follow the address you typed to reach the home page: open it by name, by IP or through a private network such as ZeroTier, and every link and search goes to that same address.

Each app is also reachable directly at `http://<YOUR-SERVER-IP>:<PORT>`. *Example:* To access Sonarr, type `http://192.168.1.50:8989`.

---

## 🛡️ VPN (optional)

The VPN option sends **Transmission, and only Transmission**, through a VPN. It adds one container, [Gluetun](https://github.com/qdm12/gluetun), that holds the VPN connection; Transmission borrows its network and has no other way out.

- **No leak:** when the VPN is down, Transmission is offline instead of downloading with your own address.
- **No script to babysit it:** Gluetun checks the connection and reconnects by itself. When a server keeps refusing the login, Gluetun would retry that same server forever, so a small watchdog ([autoheal](https://github.com/willfarrell/docker-autoheal)) restarts it, which makes it pick another server, and restarts Transmission so it re-attaches to the new tunnel.
- **Nothing else changes:** Jellyfin, the home page and the other apps keep their direct connection, and Radarr and Sonarr still reach Transmission under the same name.

Add these lines to your `.env`, then run `docker compose up -d`:

```text
COMPOSE_FILE=docker-compose.yml:docker-compose.vpn.yml
VPN_USER=your-service-username
VPN_PASSWORD=your-service-password
VPN_COUNTRY=Switzerland
```

`VPN_USER` and `VPN_PASSWORD` are the *service credentials* of your VPN account (NordVPN: *Set up NordVPN manually* in your account page), not the e-mail and password you log in with. `VPN_COUNTRY` is optional. The provider is NordVPN unless you set `VPN_PROVIDER` to another one [supported by Gluetun](https://github.com/qdm12/gluetun-wiki/tree/main/setup/providers). It needs Docker Compose 2.24 or newer.

Check that it works: the two addresses must be different.

```bash
curl -s https://ipinfo.io/ip                                # your own address
docker exec transmission curl -s https://ipinfo.io/ip       # the VPN's address
```

To be told about these restarts, add `AUTOHEAL_WEBHOOK_URL=` to `.env` with a webhook URL (for a Discord channel, append `/slack` to the webhook URL Discord gives you).

Good to know: NordVPN has no port forwarding, so Transmission downloads normally but uploads less. And as long as the VPN lines are wrong or empty, Transmission does not start at all: read `docker compose logs --tail 30 gluetun` to see why.

How long a VPN drop lasts, with the default settings:

| Step | Delay |
| :--- | :--- |
| Gluetun reports itself unhealthy | about 15 s (checks every 5 s, 3 failures) |
| autoheal notices and restarts it | up to 30 s (`AUTOHEAL_INTERVAL`), 2 min after Docker started (`AUTOHEAL_START_PERIOD`) |
| Gluetun is connected to another server | 5 to 25 s |
| Transmission is back on the new tunnel | 3 to 4 min more (its check runs every minute, 3 failures, then autoheal) |

---

## 🩺 Keep the Pi Up

Two small services run on the Pi itself, outside Docker, for the failures that Docker cannot fix: a USB drive that drops off, and a home network that goes away. Both are optional, both install with one command and both report on the same Discord channel.

### Watchdog

A Raspberry Pi with USB drives has one weak spot: a drive that drops off the bus for a second (a cable touched, a power dip) gets unmounted, and Docker stops with it (it waits for the pool, see [Mount the Drives](#1-mount-the-drives)). The drive comes back, the apps do not, and nobody notices. The watchdog is a systemd timer that runs [`watchdog/watchdog.py`](watchdog/watchdog.py) on the host every minute.

**It repairs**, in this order: a drive that is plugged in again but not mounted, the pool, then Docker. Docker starts every app again by itself. A drive that came back under a new device name while its old mount stayed behind (the drive looks mounted but every read fails with *Input/output error*) has that mount and the pool detached first, then everything is mounted again. A udev rule runs the watchdog as soon as a USB drive is plugged in, so a USB drop is over in seconds, a minute at most.

**It checks**, and posts to Discord when a problem lasts:

| Problem | Reported after |
| :--- | :--- |
| A drive is missing or will not mount | 2 min |
| The pool is not mounted, or Docker is stopped | 2 min |
| A container of a Compose project is stopped | 2 min |
| The home page does not answer | 2 min |
| A container stays unhealthy (autoheal could not fix it) | 10 min |

While a problem lasts it reminds you every 6 hours, and it posts once more when everything is back. Every repair it makes is posted too, so you know a drive dropped even when nothing stayed broken. If Discord cannot be reached, the message goes out on a later run.

Install it, or update it after a `git pull` (it also installs the udev rule):

```bash
sudo ./watchdog/install.sh
```

Settings, in `.env`:

| Setting | What it does |
| :--- | :--- |
| `WATCHDOG_WEBHOOK_URL` | Discord webhook for the alerts. Without it, the watchdog uses `AUTOHEAL_WEBHOOK_URL` (with or without `/slack`). |
| `WATCHDOG_PING_URL` | Optional. A Pi that is off or offline cannot post anything: create a free check on [healthchecks.io](https://healthchecks.io) (period 1 minute, grace 5 minutes, Discord integration) and put its ping URL here. The watchdog pings it while all is well, and healthchecks.io warns you when the pings stop. |
| `HOME_PORT` | Port of the home page it checks (80). |

See what it did: `journalctl -u mediaserver-watchdog -n 20`. Run it now: `sudo systemctl start mediaserver-watchdog`. Stop it: `sudo systemctl disable --now mediaserver-watchdog.timer`.

> Stopping a container on purpose (`docker compose stop transmission`) also gets reported, once. Use `docker compose down` on a project you no longer run, so its containers are removed.

### Wifi Fallback Hotspot

When the home network goes away (router reset, power cut, new wifi password), the Pi drops off it and nobody can reach it, even though it still runs fine. With this service, after **3 minutes** without a working home network (neither the Ethernet cable nor the wifi reaches the router) the Pi opens **its own wifi** with its wifi chip: join it from a phone, a TV or a laptop and the home page, Jellyfin and the films are there as usual. There is no internet on it, only the Pi.

- **Same address as at home.** The hotspot takes the address the Pi last had at home (on the cable when it is plugged in, else on the wifi), and its DNS answers `<hostname>.lan` (`dpi.lan`) with it, so bookmarks and the server saved in the Jellyfin apps keep working. The address is learned by itself and survives a reboot; set `HOTSPOT_ADDRESS` to force one.
- **It goes back by itself.** As soon as the cable reaches the router again, the hotspot closes. Every minute it also looks for the wifis the Pi knows, and as soon as one is back it closes the hotspot and joins it. The Pi 4's chip does not always see them in hotspot mode, so it also tries blindly every 20 minutes (the hotspot is off for about a minute each time).
- **It tells you.** Once back online it posts to Discord how long the hotspot lasted.

Add the password of the hotspot to `.env`, then install it (run again after a `git pull` that changed `hotspot/`):

```text
HOTSPOT_PASSWORD=at-least-8-characters
```
```bash
sudo ./hotspot/install.sh
```

| Setting | What it does |
| :--- | :--- |
| `HOTSPOT_PASSWORD` | Required. WPA2 password of the hotspot, 8 characters or more. |
| `HOTSPOT_SSID` | Name of the hotspot (`dpi-hotspot`). |
| `HOTSPOT_ADDRESS` | Optional. Fixed address for the hotspot, e.g. `192.168.1.229/24`. By default, the last address the Pi had at home. |
| `WATCHDOG_WEBHOOK_URL` | Discord webhook for the "back online" message, shared with the watchdog. |

Good to know:

- The hotspot is on **5 GHz** (channel 36): the current Pi 4 firmware sends nothing on 2.4 GHz in hotspot mode. Very old devices that only do 2.4 GHz will not see it.
- It needs NetworkManager (the default on Raspberry Pi OS since Bookworm). It works the same on a Pi on Ethernet or on wifi: the wifi chip is only needed for the hotspot itself.
- See what it did: `journalctl -u wifi-fallback -n 20`. Stop it: `sudo systemctl disable --now wifi-fallback`.

---

## 🔄 Updating the Pi

Run these from the `mediaserver` folder on the Pi.

| To | Command |
| :--- | :--- |
| Get the latest version of this project | `git pull && docker compose up -d` |
| ... and the home page changed | nothing more: reload the page |
| ... and `watchdog/` or `hotspot/` changed | `sudo ./watchdog/install.sh` or `sudo ./hotspot/install.sh` |
| Update the apps themselves | `docker compose pull && docker compose up -d` |
| Apply a change made in `.env` | `docker compose up -d` (and the `install.sh` of the watchdog or hotspot if it is their setting) |
| See what an app says | `docker compose logs --tail 50 radarr` |

Keep the Pi's checkout clean: change files on your computer, push, then `git pull` on the Pi. A file edited or copied by hand on the Pi makes the next `git pull` refuse to run.

**Backup:** every setting, account and database of the apps is in the `config/` folder, and your settings in `.env`. Copy both somewhere safe from time to time.

---

## 🧩 Add Your Own Apps

The Pi has room for your own projects next to the media stack: a dashboard, a bot, a tracker. Each one runs in its own container, can wear the hub's look and can get a live card on the home page.

### 1. Run it in its own Compose project

Keep your project in its own folder with its own `docker-compose.yml`, so it is started, updated and stopped without touching the media stack:

```yaml
services:
  my-app:
    build: .                     # or image: <your image>
    container_name: my-app
    ports:
      - 8080:8080                # a free port, see below
    volumes:
      - ./data:/app/data         # or /mnt/storage/... for bulky files
    restart: unless-stopped
```

```bash
docker compose up -d
```

Ports already taken by the stack: 80 (home page), 8096, 7878, 8989, 6767, 9696, 9091, 8191 and 51413. `restart: unless-stopped` brings the app back after a reboot or after the [watchdog](#watchdog) restarts Docker, and the watchdog reports it on Discord if it stays stopped, like any container of a Compose project.

### 2. Give it the hub's look

Your pages can take the *Reactor*, *Cyberpunk* or *Hogwarts* look and follow the switch of the home page, without copying any style: load the theme kit the hub serves at `http://<host>/theme/`, put `class="t-app"` on `<body>` and use the `--t-*` colours and `.t-*` components. Everything is in [home/site/theme/README.md](home/site/theme/README.md).

### 3. Show a card on the home page

The home page can show a live summary of your app, which opens the app when clicked.

1. **Serve a status file.** Your app answers `GET /api/status.json` on its port, with the header `Access-Control-Allow-Origin: *` (the home page reads it from another port). The content is up to you: the figures you want on the card and an `updated_at` date.
2. **Add the card to all three looks**, [`reactor.html`](home/site/reactor.html), [`cyberpunk.html`](home/site/cyberpunk.html) and [`hogwarts.html`](home/site/hogwarts.html). Copy the card that points at port `8081` (`id="sapling-sunrise"`), give it your own `id`, title and port, and keep `hidden`: the card only shows once your app answers. In `reactor.html`, also give it a place in the three `grid-template-areas` lists (wide screen, tablet, phone): copy the `sap` line. In `hogwarts.html` the cards sit inside the Marauder's Map (`<div class="rooms">`), which has no named areas: just paste the card there; add its `id` to the `#trading-bot, .sapling, .bifrost` rule if it should take the full width.
3. **Fill it with a script.** Copy [`sapling-sunrise.js`](home/site/sapling-sunrise.js): it fetches `http://<host>:8081/api/status.json`, writes the values into the card's `data-*` elements and removes `hidden`. When the app does not answer, it does nothing and the card stays hidden. Load your script at the bottom of the three pages, next to the other ones.
4. **Deploy:** `git pull` on the Pi. The site folder is mounted into the `home` container, so a reload of the page is enough.

The page already holds two such cards, on ports 8080 and 8081, for projects of the author. On a machine where nothing answers on those ports they stay hidden: replace them with yours or leave them.

## 🏴‍☠️ One Piece Scans (optional)

A small `kpiece` container watches [KPIECE](https://www.kpiece.fr/) for the new One Piece chapter (French scans). The home page then shows a card with the latest scan out (number, title, date), the next one with its announced date and a live countdown; the card opens the scan on KPIECE. When a new scan comes out, its link is posted to Discord.

It reads the same JSON files as the site itself, every 5 minutes and every minute around the announced release. The first run only remembers the current scan: Discord gets a message for the scans that come out after that, once each, even across restarts.

Add these lines to your `.env`, then run `docker compose up -d` (with the VPN option too, list the three files: `docker-compose.yml:docker-compose.vpn.yml:docker-compose.kpiece.yml`):

```text
COMPOSE_FILE=docker-compose.yml:docker-compose.kpiece.yml
KPIECE_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

`KPIECE_WEBHOOK_URL` is optional: it is the webhook URL Discord gives you, as is (no `/slack` here). Without it the card still works. `docker compose logs kpiece` shows each scan it found.

## 📺 Living-room Screen

The Pi's small HDMI screen shows what happens on the server and in the house, with [Errol](https://github.com/L00rdD/errol). It shows what plays on Jellyfin, a lamp that switches, the projection screen coming down, a download that finished, a film or an episode that entered the library, the next One Piece scan and Draupnir. When something happens, it takes the screen for a minute; while a film plays, it shows a cinema marquee.

The `screen` service of the stack does the reading: [`screen/feed.py`](screen/feed.py) reads Jellyfin, Bifrost and Transmission every 3 s, Radarr and Sonarr every 30 s, and the files of the other cards. It writes `screen.json`, which the home page serves at `/screen.json`. Errol itself is a separate project that runs on the Pi as a systemd service. It draws straight on the screen with the GPU, without a browser.

The cinema mode needs a Jellyfin API key (Jellyfin: *Dashboard → API Keys*), in `.env`:

```text
JELLYFIN_API_KEY=...
```

Then install Errol on the Pi:

```bash
git clone https://github.com/L00rdD/errol ~/errol
sh ~/errol/deploy/install.sh friday        # or cyberpunk
```

**Claude Code sessions (optional).** With [Cerebro](https://github.com/L00rdD/cerebro) running on a Mac, the screen and the home page show its Claude Code sessions: a card with each session, its room of the X-Mansion and what it does, and on the screen a notice whenever a session waits for your answer. In Cerebro's panel, turn on the network the Pi can reach (ZeroTier if the Pi has joined it, its address does not change; otherwise the local network) and copy its link, `http://<address>:4243/?key=<key>`. Put both halves in `.env`, then run `docker compose up -d`:

```text
CEREBRO_URL=http://10.147.17.5:4243
CEREBRO_KEY=...
```

While the Mac sleeps or is away, the feed has no `cerebro` and the card stays hidden; it asks the Mac again every 30 s. The card opens Cerebro's phone page: its link, key included, is in `screen.json`, so anyone on the home network can follow the sessions (the key only lets one read them).

`curl -s localhost/screen.json` shows what the screen gets. Its `errors` field lists the sources the feed could not read.

The home page has an **Errol** card in every look: it shows what the screen shows now, and switches its look (Friday, Cyberpunk, Hogwarts) within a few seconds. With *Follow this page's look* ticked, opening the home page in a look sets the screen to the same one. The settings are kept by the `screen` service (`/screen/settings`, in the `disk-status` volume).

## 🔑 Passwords

By default Radarr, Sonarr and Prowlarr each ask you to set up a login the first time you open them. If you would rather have no password to remember, add this line to your `.env` and run `docker compose up -d` again:

```text
SKIP_LOCAL_LOGIN=1
```

The three apps then open without a login from any device on your home network, even if a password was set before. To get the login back, delete the line (do not set it to `0` or `false`) and run `docker compose up -d`.

> **⚠️ CRITICAL:** with this option, never forward these ports to the internet on your router. Anyone who can reach them controls the apps.

Jellyfin is the only account to remember. If you lose its password, click **Forgot Password** on the Jellyfin login page from a device on your home network: Jellyfin writes a PIN to a file in its `config/jellyfin/` folder and tells you which one.

---
*Disclaimer: This repository and configuration are intended for managing personal, legally obtained media. Please respect the copyright laws of your country.*
