# Lychee Slicer vs Anycubic Photon Workshop: pricing, ergonomics, Mac performance, stability, community sentiment

Research date: 2026-10-29. Reddit could not be reached (old.reddit.com blocked for the fetch tool; web search returned no Reddit threads), so the community sentiment below comes from reviews, forums and GitHub issue trackers rather than Reddit threads.

## 1. Current Lychee tiers, prices and feature locks

### Takeaway
Lychee has renamed its tiers. Free/Pro/Premium are now **Lite (free, ads on export) / Plus (EUR 9.99/month or EUR 99.90/year) / Plus & Library (EUR 19.99/month or EUR 199.90/year)**. Since 7.5 (Nov 2025), the redesigned auto-support system ("Plus Auto Support") is paid-only (Plus, Library or trial). Also paid: 3D/voxel hollowing with blockers, support painting, grid/projection/inline supports, "Premium Rafts", full multi-plate and ad-free export. New installs get a 30-day Plus trial.

### Cited Findings
- Official pricing page: Lite is free and includes a 30-day Plus trial. Plus costs EUR 9.99/month or EUR 99.90/year (EUR 8.33/month, "save 2 months"). Plus & Library costs EUR 19.99/month or EUR 199.90/year (EUR 16.66/month). Local taxes are extra. — [Lychee pricing](https://lychee.co/pricing-and-subscription)
- Official feature list:
  - Lite has "Multi-Plate (Limited)" (no plate count given), a basic "Magic Button", "Auto support", the island detector, basic "Rafts", "Hollowing 2D", Layer Thickness Preview, Cloud & Local Backups, "Ads on export" and 3 user activations.
  - Plus adds the "Batch Button", Grid support, Inline supports, Proximity detection, "Premium Rafts", Hollowing 3D / Voxels with automatic hollow blockers, Boolean/ironing/split/planar cut, Physical Size Mode, Assembly Keys, Support Painting, Projection Support, priority support and "No ads on export".
  - Library adds 3,600+ pre-supported models.
  - The page is internally inconsistent: the pricing cards and the detailed lists don't match. — [Lychee pricing](https://lychee.co/pricing-and-subscription)
- Lychee 7.5 (announcement dated 2025-11-13) brought "a completely redesigned Auto Support system". It is "Available on: Lychee Slicer Plus, Lychee Library, Trial plans" via Prepare → Supports → "Plus" Auto Support. — [Lychee 7.5.0](https://lychee.co/whats-new/lychee-slicer-7-5-0)
- An official article says "Auto Supports is a Lychee Slicer Plus (or Complete Bundle with Lychee Library) exclusive feature", and the downloadable expert auto-support presets need Plus. — [Lychee: Auto Supports presets](https://lychee.co/whats-new/4-auto-supports-to-import)
- 3dwork's 2026 tier table (posted May 2026, table labelled June 2026):
  - Lite includes basic slicing, manual supports, island detection, anti-aliasing, community profiles and basic hollowing.
  - Lite excludes ML auto-supports, the suction cup detector, 3D hollowing with blockers, full multiplate, support painting and grid/projection supports.
  - It calls Lite "completely free for personal and commercial use". — [3dwork guide](https://3dwork.io/en/lychee-slicer/)
- **Conflict:** the official page lists "Auto support" under Lite, while 3dwork and Lychee's own 7.5 notes say the (new/ML) auto-support is Plus-only. The likely reading is that Lite keeps some basic/legacy auto support and the new ML "Plus Auto Support" is paid. This is not confirmed explicitly by Lychee. — [Lychee pricing](https://lychee.co/pricing-and-subscription); [Lychee 7.5.0](https://lychee.co/whats-new/lychee-slicer-7-5-0); [3dwork](https://3dwork.io/en/lychee-slicer/)
- Older pricing (pre-rename, likely 2022-2024, as reported by All3DP):
  - Pro resin about $6/month or $76/year; Premium about $4/month or $43/year on top.
  - Pro resin + FDM about $11/month or $109/year.
  - Old Premium = Pro + up to 4 computers + personalised support.
  - Older free versions showed full-screen 20-second ads before slicing. — [All3DP Chitubox vs Lychee](https://all3dp.com/2/chitubox-vs-lychee-slicer-compared/) (as summarised by search; flag: older)
- The third-party site lycheeslicer.net lists Library at EUR 14.99/month or EUR 149.99/year. It looks unofficial or outdated and contradicts the official EUR 19.99. — [lycheeslicer.net](https://lycheeslicer.net/)
- Lychee 8.0 (dated 2026-09-24):
  - Replaces Electron with an in-house architecture (Chromium Embedded 150 UI + proprietary Vulkan rendering engine).
  - Claims vs 7: 22x less resource use while slicing, 8.4x faster manual supports, 8.7x smoother navigation, 6.7x faster auto-supports, 7x faster bracing. Test hardware is not disclosed.
  - The new Auto-Orientation tool is free for all users. — [Lychee 8 highlights](https://lychee.co/whats-new/lychee-slicer-8-is-here-the-key-highlights)
- Current version is 8.0.3. Lychee updates itself automatically, and 8.0.2 is still offered for Windows, macOS and Linux. Per search summaries, 8.0.2 fixed auto-supports passing through models. — [Lychee download](https://lychee.co/download-lychee-slicer); [8.0.2 changelog](https://lychee.mango3d.io/changelogs/lychee-slicer-8-0-2)
- Toolradar (2026) calls Lite "generous for basic users" but notes friction where Plus pricing is shown as "Contact us". An openelab comparison (2026-08-06) notes that "most headline automation requires a subscription" and points non-payers to SatelLite or CHITUBOX Basic. — [Toolradar](https://toolradar.com/tools/lychee-slicer); [openelab](https://openelab.io/blogs/learn/best-resin-slicer-in-2026-satellite-vs-chitubox-vs-lychee)

### Inferences
- For this user (big M7 enclosure parts where auto-supports matter), Lite alone probably will not deliver the "good" Lychee auto-supports: the ML/Plus auto-support is the part people praise, and it is paid. The 30-day trial is the cheap way to test it on the riser.
- Lite's "Rafts" vs Plus "Premium Rafts" matters for big flat-bottom parts. Plus probably unlocks the raft shapes/options the user would want, though the exact difference is not documented on the page.

### Gaps
- Whether Lite needs an account or an internet connection to slice/export. Official pages don't say. The trial is activated "within the software", and 3dwork mentions a trial "with a new account", which suggests account login at least for the trial and cloud features.
- Exact Lite multi-plate limit (number of plates) and whether legacy auto-supports in Lite have preset limits.
- No user-forum reaction to the Lite/Plus rename or the 7.5 auto-support paywall was found (Reddit unreachable).
- Whether "layer-based settings" (per-layer exposure/lift) are tier-locked. The official page doesn't list them.

## 2. Photon Workshop: price, reputation, known bugs 2024-2026, macOS

### Takeaway
Photon Workshop is free and bundled with Anycubic printers. Reviewers find it adequate for everyday slicing, but its supports and manual support tools are considered weak. On macOS, 4.x has an open 2026 report of crashes in every version after 4.0, and 4.2.1 on Apple Silicon was involved in a 2026-10 "corrupt file" issue with UVtools-edited files.

### Cited Findings
- **Official GitHub, issue #28 "Mac: Version > 4 always crash"** (opened 2026-07-31). A macOS 26.5.2 user says earlier 4.x versions crash on slicing and later 4.x versions crash on import, and they are "stuck … on 4.0". — [GitHub #28](https://github.com/ANYCUBIC-3D/PhotonWorkshop/issues/28)
- **Other open issues on the official tracker:**
  - "Unable to login to Photonworkshop (3.5)" (2025-01-07)
  - "Backup Scene Location" (2024-07-28)
  - "text and face reconstruction not working on last version" (2024-03-16)
  - "3.2.2 – Selecting Text Option Closes Application Instantly" (2023-12-18)
  - "PhotoWorkshop dmg file considered unsafe by macOS" (2022-04-01)
  - old support complaints: "Supports don't work well" (2020), "Broken editing the supports" (2021)
  - None of the issues concerns auto-update. — [GitHub issues](https://github.com/ANYCUBIC-3D/PhotonWorkshop/issues)
- A Ventura user reported that the macOS binary could not open because of missing libraries. The issue was closed as "not planned". — [GitHub #21](https://github.com/ANYCUBIC-3D/PhotonWorkshop/issues/21)
- **UVtools issue #1155** (2026-10-11): Photon Workshop 4.2.1 says files repaired in UVtools are corrupt. The setup is an M7 Pro, Lychee 7.6.7 and macOS 15.6.1 on an Apple M2 Pro. The reporter says "I've been having this problem for a long time whenever updating". The UVtools developer pushed a related commit on 2026-10-13. — [UVtools #1155](https://github.com/sn4k3/UVtools/issues/1155)
- Anycubic's release notes:
  - V3.2.1 (Nov 2023) fixed import failures, a crash when applying manual supports, and a crash with oversized models during layout.
  - V3.1.0 (Mar 2023) fixed crashes while moving/rotating/scaling. — [Anycubic version notes](https://anycubic.biz/photon-workshop-version-update-documentation)
- The Mac version requires macOS 11.3+. — [Anycubic download page](https://www.anycubic.com/lcdDownload)
- In the early Apple Silicon days, a user found PW v2.1.24 "3 times SLOWER" slicing on an M1 than on a 2014 MacBook Pro, probably because it ran under Rosetta. Old data (2020-21). — [Apple Community](https://discussions.apple.com/thread/252087385)
- **Reviews of the M7 family:**
  - Tom's Hardware (M7 Pro): Workshop "has improved greatly over the years and I didn't have any problems using it"; "can add good supports automatically", with hollowing and drain holes. — [Tom's Hardware M7 Pro](https://www.tomshardware.com/3d-printing/anycubic-photon-mono-m7-pro-review)
  - Fabbaloo (M7 Pro hands-on): the auto-support algorithm "simply does not take the envelope of the model into consideration", and the embedded supports caused "a lot of surface scarring". It suggests Chitubox/Lychee for supports, "but then that defeats the purpose of the slicer". — [Fabbaloo part 4](https://www.fabbaloo.com/news/hands-on-with-the-anycubic-photon-mono-m7-pro-3d-printer-part-4) (page returned 403 on direct fetch; quotes via search snippet)
  - TechRadar (M7 Pro): Workshop "generally does a great job with plenty of options". — [TechRadar](https://www.techradar.com/pro/anycubic-photon-mono-m7-pro-3d-printer-review)
- A 2026 guide says Workshop "can crash or slow down significantly on STL files above ~100 MB — use CHITUBOX or Lychee for large terrain models". A 2026 buying guide calls Workshop "not best-in-class (use CHITUBOX or Lychee)" for the base M7. — [3dtechvalley M7 Max review](https://www.3dtechvalley.com/anycubic-photon-mono-m7-max-review/); [filamino guide](https://filamino.com/blog/anycubic-resin-printers-photon-mono-series-guide) (secondary blog sources; attribution of each quote to a specific one of these two is from search summaries)
- **User-local fact, not web-sourced:** the user's own notes record that the 4.2.0 auto-update was broken on their Mac and that 4.2.1 (installed 2026-10-27) fixed a bug that shrank auto-supports.

### Inferences
- Workshop on macOS is fragile across 4.x versions. Pinning a known-good version (keeping the dmg) is advisable, since the official tracker shows little response from Anycubic.
- Workshop is still useful as the final step (exposure/lift tweaks, M7-native features), even if supports come from elsewhere.

### Gaps
- No official Anycubic acknowledgement of 4.x Mac crashes or of auto-update failures was found.
- Native Apple Silicon (arm64) status of current Workshop 4.x was not confirmed by any source.

## 3. macOS / Apple Silicon performance and stability with large STLs

### Takeaway
There are no independent Mac benchmarks for either slicer. Lychee 8's rewrite (Vulkan engine, Sept 2026) claims large speedups, and Lychee publishes a Mac build plus an M1+ recommendation. Workshop has documented Mac crash regressions and is reported to struggle with STLs above ~100 MB.

### Cited Findings
- 3dwork recommends an M1+ / M1 Pro-class Mac for Lychee. Installation is the .dmg plus approval in Privacy & Security. — [3dwork](https://3dwork.io/en/lychee-slicer/)
- Lychee 8 performance claims (vendor, test hardware not disclosed): 22x less resource use while slicing and 8.7x smoother navigation. The article does not mention macOS. — [Lychee 8 highlights](https://lychee.co/whats-new/lychee-slicer-8-is-here-the-key-highlights)
- A 2026 M7 Max review reports Lychee had "no compatibility issues encountered across 200+ sliced models". It describes the common workflow of preparing in Lychee/Chitubox, exporting .pwmx, then doing final exposure tweaks in Workshop. It says Workshop's manual support tools "feel clunky". — [3dtechvalley](https://www.3dtechvalley.com/anycubic-photon-mono-m7-max-review/)
- Workshop large-STL weakness (~100 MB+) and Mac 4.x crash reports: see section 2. — [GitHub #28](https://github.com/ANYCUBIC-3D/PhotonWorkshop/issues/28)
- The SatelLite (Elegoo) alternative needs 16 GB RAM per Elegoo's own requirements. — [openelab](https://openelab.io/blogs/learn/best-resin-slicer-in-2026-satellite-vs-chitubox-vs-lychee)

### Inferences
- Lychee 8.0.x is only about 5 weeks old, and 8.0.2 already fixed auto-supports passing through models. Early 8.x Mac stability is unproven, and keeping 7.6.x available as a fallback is prudent.

### Gaps
- No independent slicing-time benchmarks on Apple Silicon for either slicer.
- No reports found of Lychee 8 crashing (or not) on macOS 26.

## 4. Community verdict, usage share, alternatives, advice for M7 owners

### Takeaway
No usage-share statistics exist publicly. The qualitative consensus in reviews and forums: Workshop is "enough" for simple prints and is needed for M7-specific features, while Lychee (or Chitubox) is preferred for supports, especially on complex/large parts. The common power-user workflow is Lychee for supports, then export to Anycubic format, with Workshop or the printer handling the rest.

### Cited Findings
- Tom's Hardware:
  - At the M7 Pro launch, Lychee support was "still waiting". Anycubic's page listed "Lychee Slicer (Scheduled)".
  - In the later M7 Max review, the printer "can be used with Chitubox and Lychee Slicer".
  - The M7 Max's fastest presets need thin high-speed resin and 0.1 mm layers. — [Tom's HW M7 Pro](https://www.tomshardware.com/3d-printing/anycubic-photon-mono-m7-pro-review); [Tom's HW M7 Max](https://www.tomshardware.com/3d-printing/anycubic-photon-mono-m7-max-review)
- 3dtechvalley (2026) rates Lychee "Best support tools, recommended for complex models". It says "most serious users prepare files in Lychee Slicer or Chitubox, export to .pwmx … then make final exposure adjustments in Photon Workshop". — [3dtechvalley](https://www.3dtechvalley.com/anycubic-photon-mono-m7-max-review/)
- 3DSourced (2024): the free Lychee has "a steady stream of ads and stripped-back functionality", but "we have no issues recommending the free version for most if you can tolerate the ads". — [3DSourced 2024](https://www.3dsourced.com/3d-software/best-resin-3d-slicers/)
- All3DP's Anycubic slicer roundup: ads won't bother occasional users, and heavy users may want Pro. Pro historically added support painting, rafts and variable layer height (older tier naming). — [All3DP Anycubic slicers](https://all3dp.com/2/anycubic-photon-slicer-options-alternatives/)
- Older user sentiment (2022, Slickdeals, Photon Mono X): "They have their own slicer, I think it's crap. Supported by Lychee slicer." — [Slickdeals](https://slickdeals.net/f/15792886-photon-mono-x-high-speed-resin-3d-printer-376-fs) (flag: 2022)
- AlternativeTo lists Lychee as the top ChituBox alternative. Users praise more flexible support editing and faster support for new printers. — [AlternativeTo Lychee](https://www.alternativeto.net/software/lychee-slicer/)
- **Alternatives:**
  - CHITUBOX Basic is free (Win/macOS/Ubuntu) and Pro is paid. — [openelab](https://openelab.io/blogs/learn/best-resin-slicer-in-2026-satellite-vs-chitubox-vs-lychee)
  - VoxelDance Tango is paid only, with a 15-day free trial. It natively supports Anycubic (partnership; 70% discount for Anycubic users in 2022, expired). Its supports include V-supports, tree supports (4.0, June 2023), Light/Medium/Heavy presets and support scripts. — [VoxelDance trial](https://voxeldance.com/mobile/3015071.html); [Tango 4.0](https://voxeldance.com/newsinfo/23062615.html); [lesimprimantes3d forum 2022](https://www.lesimprimantes3d.fr/forum/topic/49792-anycubic-voxeldance-tango-dlplcd-3d-slicer-code-promo-70-pour-voxeldance-tango-jusquau-16112022-et-des-mod%C3%A8les-3d-gratuits-sur-le-discord-de-tango/)
  - UVtools is used as a post-processor and repairer for Anycubic files. As of 2026-10 there was a compatibility issue with Workshop 4.2.1 on Mac (UVtools #1155). — [UVtools #1155](https://github.com/sn4k3/UVtools/issues/1155)
- A comparison blog says auto-supports in Workshop are "reasonably reliable for standard models" but lack Lychee's "AI sophistication". It also warns that with Lychee you must check that the M7's features (auto-fill, heated vat) are handled. — [bestchina3dprinters comparison](https://bestchina3dprinters.com/resin-slicer-comparison-msla/) (low-authority blog)

### Inferences
- The user's 2026-10-29 situation (supports failing on every big part in Workshop) matches the reviewer critique of Workshop supports (Fabbaloo) and the standard recommendation to move support generation to Lychee. Getting good Lychee auto-supports now requires Plus (or the 30-day trial).
- Export from Lychee to .pm7 is the workflow the user already uses (riser_lychee.pm7). The UVtools/Workshop 4.2.1 "corrupt" issue suggests not round-tripping Lychee output through UVtools and then Workshop on Mac without checking.

### Gaps
- No quantitative share of Anycubic owners using Lychee vs Workshop vs Chitubox vs Tango was found (no surveys located).
- No 2024-2026 Reddit quotes could be retrieved, so the "Lychee is better" vs "Workshop is enough" debate is represented by reviewers and older forum posts only.
