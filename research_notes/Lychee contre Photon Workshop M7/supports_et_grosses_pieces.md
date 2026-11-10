# Lychee Slicer vs Anycubic Photon Workshop: supports, rafts and reliability on large resin prints

Research method note (2026-10-29): the web search tool returned almost no Reddit threads, and old.reddit.com could not be fetched. YouTube transcripts and Facebook groups were not reached. So the user-opinion material below comes mostly from review sites and blogs, not first-hand forum threads. Treat the "community consensus" points as thinly sourced.

## 1. Auto-supports: Lychee (Magic / ML Auto-Supports / presets) vs Photon Workshop. Which is more reliable on big parts?

### Takeaway
Reviewers consistently rank Lychee's support tools above Photon Workshop's. A January 2026 M7 Max review says Workshop's auto-supports are "frequently insufficient for large models". Lychee's auto-supports are not reliable on big parts either: testers say they leave islands, so the advice is to use them as a starting point and then check islands layer by layer. I found no controlled head-to-head test on large parts.

### Cited Findings
**Lychee**
- The Magic button is in the Free, Pro and Premium editions (older tier names). In one click it does auto-orientation, auto-supports with the Light, Medium or Heavy preset, "Optimize supports", bracing and a raft. Medium is the recommended default. — [Lychee docs, Magic Button](https://sites.google.com/mango3d.io/lycheesliceredu/magic-button-auto-supports)
- The docs say "Optimize supports" groups several tips onto one shaft, so "if that shaft fails, all the tips attached to it can fail". They recommend turning it OFF for fast print speeds or brittle resins. — [Lychee docs, Magic Button](https://sites.google.com/mango3d.io/lycheesliceredu/magic-button-auto-supports)
- The docs recommend bracing, especially on medium and large models, and say any support taller than 20 mm needs it. — [Lychee docs, Magic Button](https://sites.google.com/mango3d.io/lycheesliceredu/magic-button-auto-supports)
- Auto-orientation aims to point as many faces as possible at 45° to the plate (older docs). It is unpredictable on heavily textured models; the fix is to orient by hand and then run Magic. — [Lychee docs, Magic Button](https://sites.google.com/mango3d.io/lycheesliceredu/magic-button-auto-supports)
- Current tiers (2026): Lite (free), Plus (€9.99/month or €99.90/year), Plus & Library (€19.99/month).
  - ML Auto-Supports, the Suction Cup Detector, 3D hollowing with blockers, support painting and grid/projection supports are Plus-only.
  - Island detection, manual supports and basic hollowing are free.
  - The guide says ML Auto-Supports arrived in v7.5.
  - Presets: Light (fine detail), Medium, Heavy (large parts).
  — [3dwork Lychee 2026 guide](https://3dwork.io/en/lychee-slicer/)
- A third-party review says Lychee's AI places supports "more intelligently than either competitor" (Chitubox, Photon Workshop) and that the gap is most visible on organic or detailed models, meaning minis rather than big flat parts. The same review says Workshop auto-supports are "reasonably reliable for standard models" but have fixed tip presets and limited island detection. — [bestchina3dprinters slicer comparison](https://bestchina3dprinters.com/resin-slicer-comparison-msla/)
- A tester who says he ran Lychee auto-supports on 100+ prints reports the following (the article does not say whether this was the ML version):
  - adequate on simple shapes, but for overhangs steeper than 45° "it often leaves islands" and "gaping holes", especially on organic models;
  - his workflow: Medium preset, then check the island viewer in the slice preview and add a manual support on each red or orange spot;
  - he avoids Heavy unless an island is over 5 mm, citing suction-cup problems;
  - Lychee can use about 8 GB of RAM on complex models and may crash during auto-support generation.
  — [The Industrial Maker, Lychee problems](https://theindustrialmaker.com/software-digital-tools/slicer-software/three-lychee-slicer-problems-and-fixes)

**Photon Workshop**
- M7 Max review, January 2026. Weaknesses listed:
  - "Auto-supports frequently insufficient for large models"
  - manual support placement "clunky compared to Lychee or Chitubox"
  - "limited advanced support editing options"
  - 200 MB+ files lag, and 100 MB+ STLs sometimes crashed it during slicing
  
  Recommended workflow: prepare in Lychee or Chitubox, export .pwmx, then make final exposure tweaks in Workshop. — [3D Tech Valley M7 Max review (2026-01-03)](https://www.3dtechvalley.com/anycubic-photon-mono-m7-max-review/)
- Opposite view: Tom's Hardware (M7 Max review, around late 2024) says Workshop "has improved greatly over the years", gave them no trouble and "can add good supports automatically". — [Tom's Hardware M7 Max review](https://www.tomshardware.com/3d-printing/anycubic-photon-mono-m7-max-review)
- CGMagazine (M7 Max) notes that Workshop now avoids running supports through overhanging parts of the model, which was a problem in older versions. — [CGMagazine M7 Max review](https://www.cgmagonline.com/review/hardware/anycubic-photon-mono-m7-max/)
- Tom's Guide (Photon M3 review, older, about 2022): Workshop auto-supports left parts of the "Thinker" model unsupported, and the print failed with pieces left in the vat. — [Tom's Guide Photon M3 review](https://tomsguide.com/reviews/anycubic-photon-m3); also summarised in [All3DP slicer options](https://all3dp.com/2/anycubic-photon-slicer-options-alternatives/), where All3DP calls auto-supports "a little fiddly at times"
- Anycubic's own test (Workshop 3.0, 2023-10-23):
  - Heavy supports gave the highest print success with both default and ball contacts, but are the hardest to sand.
  - Enabling "Break Point" lowered success, and for "heavy and large" models it "might result in printing failure".
  - Making Top Width much smaller can weaken supports so that "the model falls off the buildplate".
  — [Anycubic blog, support tips comparison](https://store.anycubic.com/blogs/3d-printing-guides/comparison-of-support-tips-in-3d-printing); repeated in [Mr Resin (2024-10-18)](https://mrresin.es/en/blogs/mr-resin-3d-blog/improve-supports-for-your-3d-resin-prints-photon-workshop-tips)
- Anycubic's version notes (version numbers not attached) list these auto-support changes:
  - new parameters: max horizontal offset of the support contact (to make sure supports land on the plate), automatic reduction ratio for narrow areas, model self-support offset (filters out unneeded supports), thin-wall detection, and horizontal-plane anchor-point spacing (to stop flat surfaces deforming);
  - an algorithm that cuts support/model interference and generates faster;
  - fixes for a crash on oversized models and for "the base plate of support is incorrect when add automatic support for some models".
  — [anycubic.biz version update documentation](https://anycubic.biz/photon-workshop-version-update-documentation) (403 when fetched directly; content from search snippets)
- V3.5.0 added a minimum support-to-model distance (to stop supports piercing the model), "single support reinforcement" for tall isolated supports, editing of trunk, branch and connection, and a live preview during manual editing. — same anycubic.biz page, via search snippet

### Inferences
- For large, heavy parts, Anycubic's own data points to the Heavy preset with Break Point off. Lowering contact or reduction ratios may starve big parts of support.
- No source shows either slicer's auto-supports being reliable "as is" on large enclosure-type parts. Every source that covers big parts recommends checking islands by hand after auto-generation.
- Lychee's advantage looks like tooling (island viewer, support painting, grid/projection supports, bracing control, optimize-off) more than a proven higher success rate on big flat parts.

### Gaps
- **Workshop 4.2.1 fix:** I could not find any public changelog for Photon Workshop 4.x (4.0, 4.1, 4.2, 4.2.1). Anycubic's download page (labelled Feb 2026) still lists V3.6.3 (2025-07-08), and Software Informer lists 4.1 as the newest. The "auto-supports shrunken / wrong tip sizes, fixed in 4.2.1" bug is NOT confirmed by any public source I found. The only evidence is the user's own observation (local memory notes, 2026-10-27). [Anycubic firmware/software page](https://store.anycubic.com/pages/firmware-software); [Software Informer](https://anycubicphotonworkshop.software.informer.com/)
- I found no controlled A/B test of the two slicers on large parts, and no published success-rate numbers.
- I could not reach Reddit, YouTube transcripts (Uncle Jessy, 3D Printing Professor, Mike's Making) or Facebook threads.

## 2. Manual support editing ergonomics

### Takeaway
Lychee is described as clearly better for manual editing: support painting, grid and projection supports, per-preset custom support types, and an island viewer. Workshop gained trunk, branch and connection editing with a live preview in 3.5, but reviewers still call it clunky.

### Cited Findings
- Workshop manual placement is "clunky compared to Lychee or Chitubox" with "limited advanced support editing options" (2026). — [3D Tech Valley](https://www.3dtechvalley.com/anycubic-photon-mono-m7-max-review/)
- Workshop 3.5.0 added direct editing of trunk, branch and connection, plus a real-time preview while adding, deleting or editing supports. — [anycubic.biz version notes](https://anycubic.biz/photon-workshop-version-update-documentation) (via search snippet)
- Workshop tip parameters:
  - Default contact: Top Width, Distance in Model (contact depth).
  - Ball contact: Ball Diameter.
  - Break Point: height, width, start and end height.
  - Light, Medium and Heavy strengths.
  — [Anycubic blog](https://store.anycubic.com/blogs/3d-printing-guides/comparison-of-support-tips-in-3d-printing)
- A third-party comparison says Workshop tip sizes are fixed presets. This conflicts with Anycubic's blog, which shows editable Top Width and Ball Diameter. — [bestchina3dprinters](https://bestchina3dprinters.com/resin-slicer-comparison-msla/) vs [Anycubic blog](https://store.anycubic.com/blogs/3d-printing-guides/comparison-of-support-tips-in-3d-printing)
- Lychee typical manual values: tip 0.2–0.4 mm, middle 0.8–1.2 mm, projection grid spacing 1–2 mm, grid support spacing 2–4 mm (for wide bases), and support painting for large continuous overhangs (Plus only). — [3dwork guide](https://3dwork.io/en/lychee-slicer/)
- Lychee 7.6 (2026-01-29): auto-support presets now export and import together with their custom support types. Before this they silently fell back to "Support Medium". — [Lychee 7.6.0 changelog](https://lychee.co/changelogs/lychee-slicer-7-6-0)

### Inferences
- For flat-walled enclosures, Lychee's grid and projection supports and support painting (Plus) are the tools closest to "even dense support under a long wall". The user's 2026-10-29 Lychee slice still had gaps of up to 11 mm under the walls to fill by hand, which fits the reports that auto-supports leave gaps and need manual or painted infill.

### Gaps
- I found no hands-on ergonomics comparison (mouse workflow, undo, speed) from 2024-2026 forum users.

## 3. Raft / base customisation, and Photon Workshop stock raft problems

### Takeaway
Lychee offers many raft shapes, including "Shape Wall" (a skate/sled style raft with a lip), but the advanced ones are paid. Its docs advise thin rafts (0.5–1.5 mm) and warn against big raft surfaces. I found no public documentation or complaints about Workshop's raft options, including the thin honeycomb "Heavy" raft.

### Cited Findings
- Lychee raft types: Disabled, Cylinder, Cube, Pixelate, Rectangle, Grid, Pixelated round, Line triangle, Shape, Shape Wall.
  - Line triangle is recommended for adhesion versus resin use.
  - Rafts are "often unnecessary". Keep them 0.5–1.5 mm thick and avoid large raft surfaces because they raise the delamination risk.
  - Free users get a limited set of raft types.
  — [Lychee docs, Raft](https://docs.mango3d.io/doc/resin-documentation/resin-prepare/raft/)
- J3D Tech's guide (hosted on the Lychee docs) suggests a raft of at least 0.7 mm and the "Sled" or "Line Triangle" raft. The lip lets a scraper get under the print. — [J3D guide, Rafts](https://docs.mango3d.io/doc/j3d-tech-s-guide-to-resin-printing/print-settings/rafts/)
- "Shape Wall" is Lychee's name for Chitubox's "Skate" raft. A preference can add it automatically to every imported model. — [All3DP Chitubox vs Lychee](https://all3dp.com/2/chitubox-vs-lychee-slicer-compared/)
- The fetched pages give no raft chamfer parameter for Lychee; the Raft page says the options depend on the raft type. — [Lychee docs, Raft](https://docs.mango3d.io/doc/resin-documentation/resin-prepare/raft/)
- Workshop: none of the Anycubic or third-party guides I fetched document raft or base shapes, thickness or chamfer. — [Anycubic blog](https://store.anycubic.com/blogs/3d-printing-guides/comparison-of-support-tips-in-3d-printing); [Mr Resin](https://mrresin.es/en/blogs/mr-resin-3d-blog/improve-supports-for-your-3d-resin-prints-photon-workshop-tips)

### Inferences
- Lychee's own guidance (thin raft, small raft area) is the opposite of the "big raft for big part" instinct. With a large footprint, a full-area solid raft adds peel area.

### Gaps
- Workshop's stock "Heavy" raft being a 0.8 mm honeycomb with no foot comes only from the user's local inspection of Workshop profiles (memory notes). I found no public source confirming it or reporting problems with it.
- Lychee raft chamfer and wall-height values and Shape Wall parameters were not on the fetched pages.

## 4. Island, suction-cup, orientation and hollowing tools

### Takeaway
Lychee has free island detection, free deterministic auto-orientation (v8.0, 2026-09-24), a paid Suction Cup Detector with auto-fill (7.6, 2026-01), and voxel 3D hollowing. Workshop has hollowing and drain holes, but I found no evidence of a suction-cup detector, and a review calls its island detection "limited".

### Cited Findings
- Lychee Island detector (Prepare > Support > Island):
  - "Fast" mode finds only large islands (about 3 mm); "Real" mode finds tiny ones, which often should NOT be supported.
  - Rule of thumb: leave islands smaller than a light tip unsupported.
  - Free in all tiers.
  — [Lychee docs, Island](https://docs.mango3d.io/doc/resin-documentation/resin-support/island/); [3dwork](https://3dwork.io/en/lychee-slicer/)
- Lychee 7.6.0 (2026-01-29) and 7.6.1 (2026-02-05):
  - voxel hollowing with automatic resin-trap and suction-cup detection;
  - the Suction Cup Detector flags vacuum-risk areas and can auto-fill the hollow space below them.
  — [Lychee 7.6 changelog](https://lychee.co/changelogs/lychee-slicer-7-6-0)
- Lychee 8.0.0 (2026-09-24):
  - full rebuild, replacing Electron;
  - new auto-orientation that minimises overhanging area and gives the same result for the same model (free);
  - internal supports in hollow cavities;
  - fixes for missed cavities in suction-cup detection and for drain-hole placement offsets.
  — [Lychee 8.0.0 changelog](https://lychee.co/changelogs/lychee-slicer-8-0-0); date via [3dwork](https://3dwork.io/en/lychee-slicer/)
- The Suction Cup Detector and 3D hollowing with blockers are Plus-only. — [3dwork](https://3dwork.io/en/lychee-slicer/)
- A Lychee user reports that hollowing sometimes leaves pinholes, so he always adds an extra drain hole by hand. — [The Industrial Maker](https://theindustrialmaker.com/software-digital-tools/slicer-software/three-lychee-slicer-problems-and-fixes)
- Workshop has hollowing and drain-hole tools (M7 Max review). — [Tom's Hardware](https://www.tomshardware.com/3d-printing/anycubic-photon-mono-m7-max-review)
- A review says Workshop's island detection is limited. — [bestchina3dprinters](https://bestchina3dprinters.com/resin-slicer-comparison-msla/)

### Inferences
- An open-bottom part like an enclosure riser is exactly where suction-cup detection matters. Lychee is the only one of the two with a dedicated tool for it, and that tool is paid.

### Gaps
- I could not verify whether Workshop 4.x added island or suction-cup analysis, because no 4.x changelog was found.

## 5. Failure stories, switches, and Lychee on Anycubic M7 printers

### Takeaway
The common pattern is "prepare in Lychee, export .pwmx, finish in Workshop" or straight Lychee slicing. I found no published "switched back from Lychee to Workshop" story. Lychee support for the M7 Max was late (expected end of December 2024), and Anycubic's FAQ once said Lychee was not supported.

### Cited Findings
- A Slickdeals user on the Photon Mono X (older): Anycubic's own slicer is "crap", use Lychee instead. — [Slickdeals thread](https://slickdeals.net/f/15792886-photon-mono-x-high-speed-resin-3d-printer-376-fs)
- Recommended workflow: prepare in Lychee or Chitubox, export .pwmx, then adjust exposure in Workshop (2026-01). — [3D Tech Valley](https://www.3dtechvalley.com/anycubic-photon-mono-m7-max-review/)
- The 3DWork review team used Lychee on the M7 Max and found it more agile. — [3DWork M7 Max review](https://3dwork.io/en/anycubic-m7-max-review/)
- Anycubic's M7 Max page lists "Lychee Slicer (Scheduled)", and its FAQ said "Lychee is currently not supported". Reviewers at launch expected Lychee support by end of December 2024. — [Anycubic M7 Max product page](https://store.anycubic.com/products/photon-mono-m7-max), as summarised in search results
- The 2026 Lychee guide lists M7 Pro and M7 Max among the supported Anycubic printers. — [3dwork](https://3dwork.io/en/lychee-slicer/)
- Workshop: Tom's Guide failure (unsupported regions, parts floating in the vat; Photon M3 era). — [Tom's Guide](https://tomsguide.com/reviews/anycubic-photon-m3)

### Inferences
- With an M7 (non-Pro or Max), check that the current Lychee version has an up-to-date profile and .pm7 export before relying on it. The user already sliced riser_lychee.pm7 on 2026-10-29, so the export path works.

### Gaps
- I found no 2024-2026 Reddit, Facebook or YouTube first-hand "switched and it fixed my big prints" (or reverse) stories, because the search tool returned no Reddit threads and old.reddit could not be fetched.
- I found no data on success rates for tall enclosures, flat walls or large footprints in either slicer.
