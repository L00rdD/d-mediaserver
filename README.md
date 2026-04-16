```markdown
# 🍿 Ultimate Home Media Server

![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white)
![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)
![Raspberry Pi](https://img.shields.io/badge/-RaspberryPi-C51A4A?style=for-the-badge&logo=Raspberry-Pi)

Welcome to your fully automated, Dockerized home media server! This stack provides everything you need to request, download, manage, and stream your favorite movies and TV shows securely. It is specially configured to handle a **Dual-Drive Setup** (Internal/Primary + External/Expansion drives).

---

## 🚀 The Stack

This environment is powered by the *Arr* suite and dual streaming platforms to give you the best flexibility:

| Service | Description | Port |
| :--- | :--- | :--- |
| **[Plex](https://www.plex.tv/)** | The ultimate media streaming server (Host Network mode). | `32400` |
| **[Jellyfin](https://jellyfin.org/)** | Open-source alternative for local VR & high-res streaming. | `8096` |
| **[Sonarr](https://sonarr.tv/)** | Smart PVR for automatic TV Show downloading and sorting. | `8989` |
| **[Radarr](https://radarr.video/)** | Smart PVR for automatic Movie downloading and sorting. | `7878` |
| **[Transmission](https://transmissionbt.com/)**| Fast, easy, and free BitTorrent client. | `9091` |
| **[Prowlarr](https://prowlarr.com/)** | Indexer manager/proxy built to integrate with Sonarr/Radarr. | `9696` |
| **[FlareSolverr](https://github.com/FlareSolverr/)**| Proxy server to bypass Cloudflare protection for indexers. | `8191` |

---

## 📁 Directory Structure

This setup requires your drives to be mounted to specific paths. The `docker-compose.yml` expects the following structure on your host machine:

```text
/mnt/
├── media/               # Primary Drive (ext4)
│   ├── complete/        # Finished downloads
│   ├── incomplete/      # Active downloads
│   ├── movies/          # Sorted movies
│   └── shows/           # Sorted TV shows
└── disk/                # Secondary Expansion Drive (exFAT)
    ├── complete/
    ├── incomplete/
    ├── movies/
    └── shows/
```

> **⚠️ CRITICAL:** You must create these folders **before** starting Docker to prevent "operation not permitted" permissions errors.

---

## 🛠️ Installation & Deployment

### 1. Prepare Your Drives (Mounting)
Before touching Docker, your drives must be mounted correctly at the OS level so they survive reboots.

Find your drives' UUIDs:
```bash
sudo blkid
```

Open your `fstab` file:
```bash
sudo nano /etc/fstab
```

**Add your drives based on their format:**

*For the native Linux drive (`ext4`):*
```text
UUID=YOUR-UUID-HERE /mnt/media ext4 defaults,auto,nofail,x-systemd.device-timeout=5 0 0
```
*For the expansion drive (`exfat` - requires specific UID/GID for Docker write access):*
```text
UUID=YOUR-UUID-HERE /mnt/disk exfat defaults,nofail,uid=1000,gid=1000,umask=000 0 0
```

Apply the mounts:
```bash
sudo systemctl daemon-reload
sudo mount -a
```

### 2. Create the Folder Structure
Now that the drives are mounted, create the internal folders:

```bash
# Primary Drive
sudo mkdir -p /mnt/media/{movies,shows,complete,incomplete}
sudo chown -R 1000:1000 /mnt/media/*

# Secondary Drive (chown will fail here if exFAT, which is fine)
sudo mkdir -p /mnt/disk/{movies,shows,complete,incomplete}
```

### 3. Deploy the Server
Clone this repository (or create a folder) and place the `docker-compose.yml` inside.

```bash
mkdir mediaserver && cd mediaserver
# Place your docker-compose.yml here

# Start the magic
docker compose up -d
```

---

## 🌐 Accessing Your Apps

Once Docker confirms all containers are `Started`, open your web browser and go to:
`http://<YOUR-SERVER-IP>:<PORT>`

*Example:* To access Sonarr, type `http://192.168.1.33:8989`.

---
*Disclaimer: This repository and configuration are intended for managing personal, legally obtained media. Please respect the copyright laws of your country.*
```
