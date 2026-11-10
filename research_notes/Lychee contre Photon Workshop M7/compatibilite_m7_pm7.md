# Lychee Slicer vs Anycubic Photon Workshop: compatibility with the Photon Mono M7 family (.pm7 / .pm7m / .pwsz)

Researched 2026-10-29. Few primary sources exist: Anycubic publishes almost no format or firmware documentation, Lychee changelogs are terse, and no Reddit threads came up in search (the search tool did not index them). The best technical material is in the UVtools GitHub discussions (2024-2025).

## Q1. Does Lychee export native files for the M7 (.pm7), and since when? Are there limitations?

### Takeaway
Yes. Lychee added the Photon Mono M7 and M7 Max as supported resin printers in 7.1 (30 Oct 2024), and fixed an "M7 bug" in 7.1.1 (7 Nov 2024). A Lychee export for the base M7 is a .pm7 zip with the same structure as Workshop's. Lychee has no wireless or cloud sending to Anycubic printers. No source says whether the free version is limited for this printer; export to the native format works in the free version (after an ad).

### Cited Findings
- **Lychee 7.1 (30 Oct 2024)** added "New Resin Printer Compatibility": Photon Mono M7, M7 Max, M4 and M4 Ultra. The same release added the Chitu SDCP 3.0 Wi-Fi protocol, which covers Elegoo Saturn 4 Ultra and Mars 5 Ultra only. Release date confirmed on the changelog page. — [Lychee 7.1 changelog](https://lychee.co/changelogs/lychee-slicer-version-7-1); compatibility list quoted via [mango3d changelogs](https://lychee.mango3d.io/changelogs/lychee-slicer-version-7-1)
- **Lychee 7.1.1 (7 Nov 2024)** "addresses the key issues (wifi and M7 bug fixed)". It also adds "support for a new printer: Anycubic Photon Mono M7 Max". The nature of the M7 bug is not described. — [Lychee on X](https://x.com/lychee3d/status/1854536470603710537)
- **29 Nov 2024:** a base-M7 owner (rncwind) found that a file sliced in Lychee is "mostly the same" as the M7 Pro format, but with a .pm7 extension instead of .pwsz. Renamed to .zip it shows the same contents, and the layer images are `.pw0Img`. — [UVtools discussion #892](https://github.com/sn4k3/UVtools/discussions/892)
- **15-16 Dec 2024:** Psychokiller1888 said he was working on `.pwsz`/`pwszImg` export for Lychee for the M7 Pro, "helping them integrate the full ecosystem". At the time, the missing piece was the `pwszImg` layer encoding. — [UVtools #892](https://github.com/sn4k3/UVtools/discussions/892)
- **Layer encodings (UVtools maintainer sn4k3, Dec 2024):**
  - Workshop 3.4.2 writes `pw0Img` (RLE raster) for the M7 Max, and `pwszImg` for the M7 and M7 Pro.
  - `pwszImg` is a vector, line-segment encoding. It carries "no grey pixel information": Workshop uses AA=4 internally, and the firmware may or may not apply AA when rasterising.
  - Choosing AA 8-16 in Workshop falls back to `pw0` with a file-size warning.
  - sn4k3 chose `pw0` for UVtools output because it is usually smaller. — [UVtools #892](https://github.com/sn4k3/UVtools/discussions/892)
- **Free version and export:** Lychee Lite is free on Windows, macOS and Linux. Exporting a slice in the free version shows an ad first. Plus (subscription) adds advanced supports, support painting and one-click hollowing. These details come from a university studio guide written for the M7 Pro. — [RPS wiki: How to use Lychee](https://wiki.rapidprototypingstudio.com/xwiki/bin/view/How%20to%20Use%20Lychee%20Slicer/)
- **No Wi-Fi printing from Lychee to the M7.** Printer-Hub (20 Jul 2026) says Lychee's developers attribute this to Anycubic never supplying the protocol information. — [Printer-Hub M7 issues](https://printer-hub.com/posts/anycubic-photon-mono-m7-known-issues)
- **Lychee network printing scope:** Lychee's own docs say resin-printer network printing is "only possible on few and latest Chitubox based printers". — [Lychee doc: Network/Wi-fi issues](https://doc.mango3d.io/doc/technical-documentation/technical-issues/network-wifi-issues-with-lychee-slicer/)
- **Anycubic M7 product pages** list Lychee support as "Scheduled" (Printer-Hub, Jul 2026, and a search summary of the store page). The anycubic.com M7 Pro page itself lists only Photon Workshop, Slicer Next and the Anycubic App. — [Printer-Hub](https://printer-hub.com/posts/anycubic-photon-mono-m7-known-issues); [anycubic.com M7 Pro](https://www.anycubic.com/en/photon-m7-pro)
- **ChiTuBox** also saves .pm7 for the M7. — [Printer-Hub](https://printer-hub.com/posts/anycubic-photon-mono-m7-known-issues)
- **Lychee 8.0.0 (24 Sep 2026):** new engine (CEF + Vulkan) and a new connection layer for TCP/UDP/Wi-Fi/serial. Its Anycubic items are 3MF production extension and Goo v5 for the Anycubic Jupiter 2. This comes from a third-party summary; no M7 Wi-Fi is mentioned. — [3dwork Lychee 2026 guide](https://3dwork.io/en/lychee-slicer/)

### Inferences
- The user's local finding ("pm7 = zip of vector layers, 17-byte segment records") fits the `pwszImg` vector encoding that Workshop writes for the M7. Two things are unconfirmed:
  - whether Lychee writes vector `pwszImg` layers or RLE `pw0Img` layers for the base M7. The Nov 2024 report says `.pw0Img` filenames, but the UVtools thread shows the extension and the actual encoding can disagree.
  - whether that changes anti-aliasing or grey levels on the print.
- Because Lychee writes the same container, the printer-side features should behave the same whichever slicer made the file. That holds as long as Lychee fills the metadata (resin/.pwsp, lift block, file version) correctly. The UVtools cases below show the firmware rejects files with incomplete metadata.

### Gaps
- No source states which `pwszImg` vs `pw0Img` encoding and which file version Lychee writes today (8.x) for the M7, M7 Pro and M7 Max. This can be checked locally by unzipping a Lychee .pm7 and comparing it with a Workshop one.
- The exact output extension Lychee uses for the M7 Pro (.pwsz) and M7 Max (.pm7m) is not stated in any Lychee doc that was found. Only the format family is inferred.
- No source says whether the free (Lite) version restricts any Anycubic export setting.

## Q2. Which M7 features only work with Workshop or Anycubic's ecosystem?

### Takeaway
Wireless and cloud features belong to the Anycubic ecosystem: LAN sending, cloud files, remote printing, video monitoring and OTA firmware all come through Workshop or the Anycubic App. The "smart" features (residue detection, resin auto-fill/withdrawal, film peel counter) run in printer firmware, not in the slice file. So they should not depend on the slicer, though no source tests a Lychee file explicitly.

### Cited Findings
- **Workshop features:** Anycubic describes Workshop as supporting "automatic support generation, remote printing, and video monitoring". Requirements are macOS 11.3+ or Win10 1803 x64. — [Anycubic LCD download](https://www.anycubic.com/lcdDownload)
- **Workshop update notes** (version not given) mention:
  - cloud file functions: viewing, uploading, importing and downloading cloud files.
  - "LAN transmission function to support sending print tasks through LAN".
  - direct editing of support trunks and branches.
  — [anycubic.biz Workshop version docs](https://anycubic.biz/photon-workshop-version-update-documentation); [Anycubic firmware & software page](https://store.anycubic.com/pages/firmware-software)
- **Workshop V3.5.0** added LAN transmission and a "minimum distance between support and model" setting. — [Anycubic firmware & software page](https://store.anycubic.com/pages/firmware-software) (via search summary)
- **M7 Pro residue detection** runs before every print and checks the vat for solid residue. Auto-feed adds resin when the level is low, and auto-withdrawal pumps resin out before cleaning. Before printing you must choose between fitting the auto-fill unit or the air filter. The printer counts film peels and reminds the user at 45,000. — [M7 Pro manual (manuals.plus)](https://manuals.plus/anycubic/m7-pro-lcd-photon-mono-manual); [Anycubic M7 Pro store page](https://store.anycubic.com/products/photon-mono-m7-pro)
- **Cloud and app (Printer-Hub, Jul 2026):**
  - The printer's server location defaults to China. It must be set to Global (Network → Server location) before cloud or app work.
  - Wi-Fi is 2.4 GHz WPA/WPA2 only, and OTA firmware updates need the cloud.
  - Sending over the network from Workshop "fails roughly half the time"; owners roll back to Workshop 3.6.5 when network printing breaks after an update. — [Printer-Hub](https://printer-hub.com/posts/anycubic-photon-mono-m7-known-issues)
- **Heated vat:** UVtools contributors (Nov 2024) noted that `anycubic_photon_resins.pwsp` settings and "heated vat" were not supported in UVtools' writer. This means vat-heating parameters live in the slice file's resin block. — [UVtools #892](https://github.com/sn4k3/UVtools/discussions/892)
- **Anycubic strategy:** in 2024 Anycubic announced it was reworking Anycubic Slicer and Photon Workshop to integrate with Anycubic Cloud. — [PR Newswire (FR), Anycubic 2024 strategy](https://www.prnewswire.com/fr/communiques-de-presse/anycubic-devoile-sa-strategie-2024-pour-ameliorer-lexperience-dimpression-3d-302113422.html) (via search summary)

### Inferences
- With Lychee, the workflow is USB only. Cloud upload, remote start and video monitoring need Workshop or the Anycubic App.
- Detection and auto-fill are firmware features and should work with any valid file. Heater and resin-block parameters, however, depend on what the slicer writes into the .pwsp resin block. A slicer that writes a minimal resin block (as UVtools did) can get the file rejected (see Q5).
- The base M7 is the cheaper model. Printer-Hub does not list residue detection or auto-fill for it, so those features may be M7 Pro / M7 Max only.

### Gaps
- No source tests whether M7 Pro vat heating or resin-specific settings are carried through a Lychee-sliced file.
- No source covers AI print-failure detection on M7 models, or whether it depends on the slicer.

## Q3. Lift settings: two-stage lift / TSMC / wait times. Can Lychee set them for the M7 format, and does the firmware honour them?

### Takeaway
The M7-generation file format supports two-stage (TSMC) lift and retract. In Workshop this appears as Control Type → "Advanced", which is only offered on newer models such as the M7. Lychee 7.6.5 (7 May 2026) added separate bottom and normal wait times for Anycubic's "latest printers" after a major Anycubic firmware update. No source explicitly confirms that Lychee's M7 profile exposes TSMC fields, or that M7 firmware honours them in a Lychee file.

### Cited Findings
- **Workshop Control Type:** the drop-down is stuck on "Basic" for older printers such as the Mono X, while newer models like the Photon M7 offer an "Advanced" option that exposes second-stage lift and retract. — [UVtools discussion #971](https://github.com/sn4k3/UVtools/discussions/971) (via search summary)
- **TSMC needs file version 517 or later.** UVtools-converted Anycubic files carried no version, so they defaulted to version 1, and their TSMC values were ignored. The workaround is `FILEVERSION_517` in the printer notes (shown for .pm3n, Sep-Oct 2024). — [UVtools discussion #934](https://github.com/sn4k3/UVtools/discussions/934)
- **The AdvancedMode flag** in Anycubic files switches TSMC on or off, and print-time calculations use the TSMC values when it is on. — [UVtools #971](https://github.com/sn4k3/UVtools/discussions/971) (via search summary)
- **Lychee 7.6.5 (7 May 2026):** "Anycubic has rolled out a major firmware update for their printers, and Lychee Slicer now fully supports it". Users can now set separate wait times for bottom layers and normal layers in resin profiles. The changelog does not name models. — [Lychee 7.6.5 changelog](https://lychee.co/changelogs/lychee-slicer-7-6-5)
- **Lychee's general guidance (all printers):**
  - two-stage lift of 4 mm slow + 4 mm fast (8 mm total); on large printers like the M7 Max add about 2 mm (e.g. 4 + 6).
  - first-stage speed about 45 mm/min, staying under 60; second stage about 250 mm/min.
  - bottom-layer lift about 25 % higher.
  — [Lychee: best resin settings guide](https://lychee.co/whats-new/the-best-resin-settings-for-your-printer-lychee-slicer-guide)
- **Anycubic stock M7 values (single stage):**
  - Standard: 0.05 mm layers, 8 mm lift, 6 mm/s.
  - Fast: 0.1 mm layers, 4 mm lift, 15 mm/s.
  - Below 20 °C: exposure +30 % and Z speed −30 %.
  — [Printer-Hub](https://printer-hub.com/posts/anycubic-photon-mono-m7-known-issues); [Anycubic resin settings page](https://eu.anycubic.com/pages/resin-settings-for-anycubic-photon-series-3d-printer)
- **Bad lift metadata gives bad motion:** a UVtools-reconverted .pm7m on the M7 Max did not retract the plate at the end of the print, and the plate did not release from the film after the last layer. This was UVtools 5.10, not Lychee. — [UVtools discussion #1018](https://github.com/sn4k3/UVtools/discussions/1018) (via search summary)

### Inferences
- If Lychee writes the M7 file with a TSMC-capable version and the AdvancedMode flag set, the firmware should honour two-stage lift. If it writes basic mode, only one stage applies.
- This can be checked locally:
  1. Slice the same model in Lychee and in Workshop 4.2.1.
  2. Unzip both and compare the header and lift block (file version, AdvancedMode flag, second-stage distances and speeds).
  3. Watch the plate motion on a short test.
- The 7.6.5 wait-time change suggests Lychee follows Anycubic firmware changes, with some delay.

### Gaps
- No Lychee documentation was found listing the exact fields of the Anycubic M7 profile (TSMC, light-off delay, rest before lift / after retract).
- No user report was found confirming the M7 actually performs Lychee's two-stage values.
- Which "major firmware update" (version number) 7.6.5 refers to is not stated.
- Per-layer-range exposure in Lychee for Anycubic formats: not documented in the sources found.

## Q4. Anti-aliasing and grey levels: Lychee vs Workshop on the M7

### Takeaway
On the M7 and M7 Pro, Workshop's default layer encoding (`pwszImg`, vector) carries no grey levels: AA is fixed internally at 4 and any smoothing is left to the firmware. Choosing AA 8-16 makes Workshop fall back to the RLE `pw0Img` raster, with a file-size warning. Lychee's behaviour for the M7 is undocumented.

### Cited Findings
- `pwszImg` encodes line segments and "does not contain any grey pixel information". AA=4 is used internally, and the firmware may or may not apply AA to the rasterised lines. — [UVtools #892, sn4k3, 16 Dec 2024](https://github.com/sn4k3/UVtools/discussions/892)
- Selecting AA changes the output: in sn4k3's tests, AA on gave `pw0` and AA off gave `pwsz`. Another contributor says Workshop exports with AA were `pwsz`, and doubts AA can be fully disabled. AA 8-16 produces `pw0` with a size warning. — [UVtools #892](https://github.com/sn4k3/UVtools/discussions/892)
- For a 10 mm cube, a `pw0` layer can be up to about 286 times larger than the vector form, but `pw0` usually wins on irregular shapes. — [UVtools #892](https://github.com/sn4k3/UVtools/discussions/892)
- The M7 Max with Workshop 3.4.2 writes `pw0` by default. — [UVtools #892](https://github.com/sn4k3/UVtools/discussions/892)

### Inferences
- If Lychee writes `pw0Img` (RLE raster) for the M7, as the Nov 2024 filename observation suggests, its AA and blur settings would be baked into grey pixels. That could give smoother edges than Workshop's default vector output, at the cost of bigger files. This is unverified.

### Gaps
- No Lychee documentation was found on AA or grey-level behaviour for Anycubic M7 formats, and no side-by-side print comparisons were found.

## Q5. Known incompatibilities and bugs (files rejected, firmware, layer height, preview)

### Takeaway
Most reported rejections come from wrong-model profiles, incomplete metadata (resin block, file version), USB stick issues, or outdated slicers. No Lychee-specific M7 bug was found after 7.1.1. Lychee's own advice is that Anycubic firmware updates can silently break third-party files.

### Cited Findings
- **CODE 300 "slice file parsing error":**
  - Causes: wrong machine model or format, layer height, pixel size or build size that does not match the firmware, a corrupt file, or an outdated slicer.
  - An M7 Pro file will not open on a base M7.
  - Fix: select the exact model, update the slicer, and re-slice. — [Printer-Hub](https://printer-hub.com/posts/anycubic-photon-mono-m7-known-issues)
- **USB rules:** FAT32 with 4096-byte allocation, under 32 GB, file in the root folder, plain Latin name of 15 characters or fewer. — [Printer-Hub](https://printer-hub.com/posts/anycubic-photon-mono-m7-known-issues)
- **Lychee's advice for unreadable files:**
  - Use a good 16-32 GB FAT32 stick.
  - Check the printer and format; delete and re-add the printer profile to refresh its settings.
  - "Printer manufacturers may update their firmware… without notifying us"; in that case, contact Lychee support. — [Lychee doc: printer does not read the file](https://doc.mango3d.io/doc/technical-documentation/technical-issues/my-printer-does-not-read-recognise-the-file/)
- **Resin block rejection (19-20 Aug 2025, base M7):**
  - A PrusaSlicer → UVtools .pm7 was rejected with "The printer cannot parse the file".
  - Cause: `anycubic_photon_resins.pwsp` was about 8 KB, against about 50 KB in Workshop projects.
  - Fix: export the printer from Workshop as .pwsp, replace it inside the zip, and re-zip the contents with deflate.
  - The maintainer linked PR #1055. — [UVtools discussion #1059](https://github.com/sn4k3/UVtools/discussions/1059)
- **M7 Max "File parameter, incorrect layer thickness"** after re-converting a .pm7m to .pm7m in UVtools. Maintainer: "do not reconvert, simply save it". — [UVtools #1018](https://github.com/sn4k3/UVtools/discussions/1018)
- **PrusaSlicer M7 Max profile** shipped with the format note PM5M instead of PM7M, which broke UVtools auto-conversion. — [UVtools issue #995](https://github.com/sn4k3/UVtools/issues/995)
- **UVtools mis-decodes some .pm7 layers** from Workshop 3.5 (issue #970, Dec 2024), still open as of Jul 2026 per Printer-Hub. UVtools v5.0.0 added PM7, PM7M and PWSZ, and v6.1.0 (27 Jun 2026) fixed re-opening saved Anycubic files. — [UVtools issue #970](https://github.com/sn4k3/UVtools/issues/970); [UVtools v5.0.0 release](https://newreleases.io/project/github/sn4k3/UVtools/release/v5.0.0); [Printer-Hub](https://printer-hub.com/posts/anycubic-photon-mono-m7-known-issues)
- **M7 firmware:**
  - Two updatable parts: main firmware, and a separate FPGA firmware that fixes exposure problems such as uneven layer density or stuttering images.
  - Local upgrade from the root of a USB stick, keeping the original file name; OTA needs the cloud.
  - Firmware 4.0.6.4 is mentioned without a date. — [Printer-Hub](https://printer-hub.com/posts/anycubic-photon-mono-m7-known-issues)
- **Anycubic's public Firmware & Software page** lists only manuals and test files for the M7, M7 Pro and M7 Max, with no firmware downloads or change notes. — [Anycubic firmware & software](https://store.anycubic.com/pages/firmware-software)

### Inferences
- For a Lychee-sliced .pm7 on a base M7, the main risks are:
  1. a stale Lychee profile after an Anycubic firmware change (re-add the printer, update to Lychee 7.6.5 or 8.x).
  2. a minimal or invalid resin block or file version.
  3. wrong model selection.
- Opening the Lychee file in Workshop or UVtools before printing gives a cheap check of layer count, layer height and preview.

### Gaps
- No Reddit or Facebook first-hand reports were retrievable for "Lychee + M7" failures in 2025-2026.
- The firmware version needed for Lychee 7.6.5 wait times is unknown.

## Q6. Photon Workshop vs "Anycubic Slicer" naming, and Workshop releases in 2025-2026

### Takeaway
"Anycubic Photon Workshop" remains the name of the resin (LCD) slicer. "AnycubicSlicer" (PrusaSlicer-based) and "Anycubic Slicer Next" (OrcaSlicer-based) are FDM-only. Anycubic's official page lags far behind: it shows Workshop V3.6.3 (8 Jul 2025), while third parties list 4.0 and 4.1. The user already runs 4.2.1 (per local notes, Oct 2026), and no public release notes for 4.x were found.

### Cited Findings
- **Anycubic Firmware & Software page (titled "Feb 2026"):**
  - Photon Workshop V3.6.3 (8 Jul 2025): "Added resin exposure time calibration function for Mono4 Ultra".
  - AnycubicSlicer V1.4.4 (3 Mar 2025), FDM, PrusaSlicer-based.
  - Anycubic Slicer Next V1.6.1 (22 Jul 2025), FDM, OrcaSlicer-based.
  - Regional pages lag further: AU shows 3.6.2, UK shows 3.3.0. — [Anycubic store firmware-software](https://store.anycubic.com/pages/firmware-software); [Anycubic AU](https://www.anycubic.au/pages/firmware-software); [Anycubic UK](https://uk.anycubic3d.com/pages/firmware-software)
- **Software Informer** lists AnycubicPhotonWorkshop versions up to 4.1 (4.1, 4.0, 3.6 …). — [Software Informer](https://anycubicphotonworkshop.software.informer.com/)
- **Workshop updates** come through in-app Help → Check Update. — [Anycubic LCD download](https://www.anycubic.com/lcdDownload)
- **Workshop has supported .pwsz (M7 Pro) since v3.3.2.** — [UVtools #892](https://github.com/sn4k3/UVtools/discussions/892)
- **Workshop network sending is unreliable** ("fails roughly half the time"); 3.6.5 is the rollback that owners recommend. — [Printer-Hub](https://printer-hub.com/posts/anycubic-photon-mono-m7-known-issues)

### Inferences
- Workshop 4.x appears to be distributed mainly through in-app updates and the anycubic.com/lcdDownload page, not the store's firmware page.

### Gaps
- No public changelog was found for Workshop 4.0, 4.1 or 4.2.x, including the auto-support shrink fix the user saw in 4.2.1.
- Apart from the slicers listed above, no newer Anycubic resin slicer brand was found for 2026.
