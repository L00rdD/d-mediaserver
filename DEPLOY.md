# 📦 Deploy on a NAS (or any machine that runs Docker)

The short path to run the whole stack on a device that already has its own storage: a NAS, a mini PC, an old laptop. Nothing here is specific to the Raspberry Pi: you skip the drive pooling, the SMB share and the network tuning of the [README](README.md), because the device already handles them.

Count about 15 minutes, most of it waiting for the downloads.

---

## ✅ What You Need

- **Docker with Docker Compose.** On a Synology it is the *Container Manager* package, on a QNAP *Container Station*. On a PC, [Docker Engine](https://docs.docker.com/engine/install/).
- **A terminal on the device**, usually over SSH (on a NAS, SSH is switched on in the control panel).
- **A 64-bit processor** (Intel/AMD or ARM), about **2 GB of free memory** and **4 GB of disk** for the apps. Your media needs its own space on top.

> On some NAS systems (Synology for instance) every `docker` command needs `sudo` in front.

---

## 🚀 Install in 5 Steps

The examples use Synology-style paths (`/volume1/...`). Replace them with the paths of your device.

### 1. Get the files

Pick a folder on a data volume (not on the system partition) and download the project into it:

```bash
cd /volume1/docker
git clone https://github.com/L00rdD/d-mediaserver.git mediaserver
cd mediaserver
```

No `git` on the device? This does the same:

```bash
cd /volume1/docker
curl -L https://github.com/L00rdD/d-mediaserver/archive/refs/heads/main.tar.gz | tar xz
mv d-mediaserver-main mediaserver
cd mediaserver
```

### 2. Create the media folders

Choose where your media lives and create the four folders the apps expect:

```bash
mkdir -p /volume1/media/movies /volume1/media/shows \
         /volume1/media/complete /volume1/media/incomplete
```

If you already have movies and TV shows, move them into `movies/` and `shows/` (one folder per movie, one folder per show).

### 3. Write your settings

```bash
cp .env.example .env
id
```

`id` prints the numbers to use for `PUID` and `PGID` (`uid=1026(you) gid=100(users)` gives `1026` and `100`). Open `.env` in an editor, remove the `#` in front of the lines you need and fill them in:

| Setting | What to put | Example |
| :--- | :--- | :--- |
| `DATA_ROOT` | The media folder from step 2. | `/volume1/media` |
| `PUID`, `PGID` | The two numbers printed by `id`. | `1026`, `100` |
| `TZ` | Your time zone. | `Europe/Paris` |
| `HOME_HOST` | The name or IP you type to reach the device, without `http://`. | `nas.lan` or `192.168.1.50` |
| `HOME_PORT` | Port of the home page. Change it when the device already uses port 80, which most NAS do. | `8080` |
| `SKIP_LOCAL_LOGIN` | `1` to open Radarr, Sonarr and Prowlarr without a login at home. | `1` |

`HOME_HOST` does not create a name, it only tells the home page which address to put in its links. Not sure the name works? Use the IP address.

### 4. Start everything

```bash
docker compose up -d
```

The first start downloads the apps. When the command gives the prompt back, check that the seven containers are up:

```bash
docker compose ps
```

### 5. Open the home page

Go to `http://<HOME_HOST>:<HOME_PORT>`, for example `http://nas.lan:8080`. Every app is one click away from there.

---

## 🧩 First-Time Setup of the Apps

A fresh install starts with empty apps. Do this once, in this order. Inside the apps your media folder is always called `/data`, and the apps reach each other by name (`transmission`, `radarr`...), never by IP.

| # | App | Where | What to set |
| :--- | :--- | :--- | :--- |
| 1 | **Jellyfin** | Setup wizard | Create your account, then add two libraries: *Movies* on `/data/movies` and *Shows* on `/data/shows`. |
| 2 | **Transmission** | Preferences → Torrents | Download to `/data/complete`, incomplete torrents in `/data/incomplete`. |
| 3 | **Radarr** | Settings → Media Management | Add the root folder `/data/movies`. |
| | | Settings → Download Clients | Add *Transmission*: host `transmission`, port `9091`. |
| 4 | **Sonarr** | Settings → Media Management | Add the root folder `/data/shows`. |
| | | Settings → Download Clients | Add *Transmission*: host `transmission`, port `9091`. |
| 5 | **Prowlarr** | Settings → Indexers | Add the *FlareSolverr* proxy: host `http://flaresolverr:8191`. Give it a tag (`flaresolverr` for example) and put the same tag on the indexers that need it. |
| | | Settings → Apps | Add *Radarr* (`http://radarr:7878`) and *Sonarr* (`http://sonarr:8989`), with Prowlarr server `http://prowlarr:9696`. Each one asks for an API key: copy it from that app's Settings → General. |
| | | Indexers | Add your indexers. Prowlarr sends them to Radarr and Sonarr by itself. |

Movies and TV shows that were already in your folders: use **Library Import** in Radarr and in Sonarr so they know about them.

---

## 🔄 Everyday Commands

Run them from the `mediaserver` folder.

| To | Command |
| :--- | :--- |
| Update the apps | `docker compose pull && docker compose up -d` |
| Update this project | `git pull && docker compose up -d && docker compose restart home` |
| Apply a change made in `.env` | `docker compose up -d` |
| Stop everything | `docker compose down` |
| See what an app says | `docker compose logs --tail 50 radarr` |

**Backup:** every setting, account and database of the apps lives in the `config/` folder next to `docker-compose.yml`. Copy that folder somewhere safe from time to time.

**Moving from another machine:** stop the stack on the old one, copy its whole `config/` folder into the new `mediaserver` folder before step 4, and the apps come back as you left them.

---

## 🩹 If Something Goes Wrong

| What you see | Likely cause | Fix |
| :--- | :--- | :--- |
| `port is already allocated` at start | The device already uses that port. | For port 80, set `HOME_PORT` in `.env`. For another one, stop the NAS package that uses it (its own Jellyfin or Transmission, for example). |
| The home page opens but its links do not | `HOME_HOST` is a name your network does not know. | Put the device's IP address in `HOME_HOST`, then `docker compose up -d`. |
| An app cannot write, or shows *permission denied* | `PUID`/`PGID` do not own the media folder. | Run `id` as the owner of the folder and copy the two numbers into `.env`. |
| Radarr or Sonarr cannot find a finished download | Transmission still downloads to its default folder. | Set its folders to `/data/complete` and `/data/incomplete` (setup table, line 2). |

> **⚠️ CRITICAL:** never forward these ports to the internet on your router. The apps are meant for your home network only.
