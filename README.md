# 🍿 Ultimate Home Media Server

![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white)
![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)
![Raspberry Pi](https://img.shields.io/badge/-RaspberryPi-C51A4A?style=for-the-badge&logo=Raspberry-Pi)

Welcome to your fully automated, Dockerized home media server! This stack provides everything you need to request, download, manage, and stream your favorite movies and TV shows securely. It turns a Raspberry Pi 4 into a small **virtual NAS**: any number of USB drives are pooled into a single path (`/mnt/storage`) with [mergerfs](https://github.com/trapexit/mergerfs), used by every container and shared on the network over SMB.

> **Not on a Raspberry Pi?** [DEPLOY.md](DEPLOY.md) is the short path for a NAS or any machine that already runs Docker.

---

## 🚀 The Stack

This environment is powered by the *Arr* suite and Jellyfin:

| Service | Description | Port |
| :--- | :--- | :--- |
| **Home page** | One page that links to every app below, served by [Caddy](https://caddyserver.com/). | `80` |
| **[Jellyfin](https://jellyfin.org/)** | Open-source media streaming server. | `8096` |
| **[Sonarr](https://sonarr.tv/)** | Smart PVR for automatic TV Show downloading and sorting. | `8989` |
| **[Radarr](https://radarr.video/)** | Smart PVR for automatic Movie downloading and sorting. | `7878` |
| **[Transmission](https://transmissionbt.com/)**| Fast, easy, and free BitTorrent client. | `9091` |
| **[Prowlarr](https://prowlarr.com/)** | Indexer manager/proxy built to integrate with Sonarr/Radarr. | `9696` |
| **[FlareSolverr](https://github.com/FlareSolverr/)**| Proxy server to bypass Cloudflare protection for indexers. | `8191` |

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
# Name or IP of this machine on your network, used by the home page links
HOME_HOST=nas.lan
# Port of the home page, if 80 is already taken (a NAS often uses it)
HOME_PORT=8080
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

It is the only address to remember: it links to every app. It comes in two looks, *Reactor* and *Cyberpunk*; the switch at the top right changes it and each device remembers its own choice.

The search bar sends what you type straight to the right app: **Watch** looks for it in your Jellyfin library, **+ Movie** opens Radarr and **+ TV show** opens Sonarr with the search already running, ready to add.

The links point at `dpi.lan` by default. If your server answers to another name, set `HOME_HOST` in your `.env` (a name or an IP, without `http://`) and run `docker compose up -d` again. `HOME_HOST` does not create the name: it has to be one your network already resolves, usually the machine's hostname followed by your router's suffix (`.lan`, `.home`, `.local`).

Each app is also reachable directly at `http://<YOUR-SERVER-IP>:<PORT>`. *Example:* To access Sonarr, type `http://192.168.1.33:8989`.

---

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
