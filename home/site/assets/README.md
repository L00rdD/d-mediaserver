# Assets of the Hogwarts look

Used by `vivarium.js`, one world per section of the hub page. Places and props come from [Poly Haven](https://polyhaven.com) under CC0 (public domain); the creatures from Sketchfab under CC BY 4.0, credited at the bottom of the page.

`hdri/`: the tonemapped JPGs of these HDRIs, as WebP: `<name>.webp` at 3072 × 1536 (q78) and `<name>-low.webp` at 1024 × 512 (q60), which shows first while the sharp one comes. Used both as the ground-projected sky and as the light of each world.

| File | World |
|---|---|
| `rogland_clear_night` | the starry night (the media apps) |
| `hikers_cave` | the Niffler's den (the trading bot) |
| `mossy_forest` | the Bowtruckle's tree (Sapling Sunrise) |
| `misty_pines` | the Hippogriff's forest (Bifrost) |
| `hayloft` | Newt's shed (Errol) |

`models/`: the 1k glTF models, each turned into one GLB with `gltf-transform optimize --compress meshopt --texture-compress webp --texture-size 512`: `rock_moss_set_01`, `tree_stump_01`, `fern_02`, `moss_01`, `moon_rock_03`, `WoodenTable_03`, `desk_lamp_arm_01`, `seeding_tray_01`, `watering_can_metal_01`, `wooden_bookshelf_worn`.

`creatures/`: models from Sketchfab, CC BY 4.0, turned into one GLB each with `gltf-transform optimize --compress meshopt --texture-compress webp --texture-size 1024` (and `--simplify-ratio` for the heavy ones):

| File | Model | Author |
|---|---|---|
| `phoenix.glb` | [Phoenix](https://sketchfab.com/3d-models/phoenix-243fea4f846f44d18d37bf371272b7ec) (animated): Fawkes, in every world | NORBERTO-3D |
| `niffler.glb` | [FB Niffler](https://sketchfab.com/3d-models/fb-niffler-e3769cd0a14a4a0d9a4cd2220483738a) | Gisduyg |
| `coins.glb` | [Pile Of Coins](https://sketchfab.com/3d-models/pile-of-coins-57696781b083431685ff74889156d371) | SebastianSosnowski |
| `bowtruckle.glb` | [Pickett the Bowtruckle](https://sketchfab.com/3d-models/pickett-the-bowtruckle-3e5cac2cfc11416bad6f5d9864c565f8) (simplified to 4 %) | rodolpotter |
| `hippogriff.glb` | [HIPPOGRIF ANIMATION](https://sketchfab.com/3d-models/hippogrif-animation-80c2109fe4a84dda8211d4084ab66adb) (6 animations) | hino |
| `owl.glb` | [Owl](https://sketchfab.com/3d-models/owl-ff30f2fdb2644f19ab6de5a3a3989e48) (animated): Hedwig, and Errol tinted grey-brown | smart1llc |

Sketchfab downloads need an account's API token (`GET https://api.sketchfab.com/v3/models/<uid>/download` with `Authorization: Token …`). Keep the credits line of `hogwarts.html` in step with this table.

Poly Haven: to add one: `https://api.polyhaven.com/files/<id>` lists its files (send a User-Agent); take `tonemapped` for an HDRI, `gltf` → `1k` for a model.

The hub serves `assets/` with a month of cache and no revalidation (Caddyfile): a file whose contents change must get a new name.
