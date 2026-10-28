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

`models/`: the 1k glTF models, each turned into one GLB with `gltf-transform optimize --compress meshopt --texture-compress webp --texture-size 512 --simplify false`: `rock_moss_set_01`, `tree_stump_01`, `fern_02`, `moss_01`, `moon_rock_03`, `WoodenTable_03`, `desk_lamp_arm_01`, `seeding_tray_01`, `watering_can_metal_01`, `wooden_bookshelf_worn`, `treasure_chest`, `Lantern_01`, `wooden_lantern_01`, `brass_candleholders`, `wooden_candlestick`, `large_iron_gate`, `wooden_crate_01`, `wicker_basket_01`, `vintage_oil_lamp`, `gothic_statue`, `wine_bottles_01` (the potions), `wooden_broom`.

`places/`: the Harry Potter sets, from Sketchfab (same optimisation, `--texture-size 1024`, the castle and hut simplified), credited at the bottom of the page:

| File | Model | Author | Licence |
|---|---|---|---|
| `castle.glb` | [Hogwarts 3D](https://sketchfab.com/3d-models/hogwarts-3d-70dcec840f8444dda2974aa6a9b049e2) (simplified to 20 %): far off in the night | Ju Designer | CC BY |
| `vault_door.glb` | [Bank vault, Armored Door, Low poly](https://sketchfab.com/3d-models/bank-vault-armored-door-low-poly-627c684249a848f99f84b6941caddc49): Gringotts | tasha.kosaykina | CC BY |
| `dragon.glb` | [Ukrainian Ironbelly Dragon](https://sketchfab.com/3d-models/ukrainian-ironbelly-dragon-8c5923a4c1c64c60b22509d44e072d8e): behind the vault door | LunaEagle | CC BY |
| `torch.glb` | [Medieval Wall Torch](https://sketchfab.com/3d-models/medieval-wall-torch-77db436da2844cbfb4dde0bb9b396835) | Kigha | CC BY |
| `cauldron.glb` | [Smoking Cauldron](https://sketchfab.com/3d-models/smoking-cauldron-56216e7ae645454ca2061c017d9678f5) (its sculpted smoke is hidden) | RachelC | CC BY-NC |
| `hut.glb` | [Rubeus Hagrid's Hut](https://sketchfab.com/3d-models/rubeus-hagrids-hut-2ed10a0ff460441d810578bb4ad482bd) | adiraj00764 | CC BY |
| `pumpkins.glb` | [Spooky Pumpkin patch](https://sketchfab.com/3d-models/spooky-pumpkin-patch-c1ae123c3aa345bdb4c4649ba0efdbc0) (simplified to 50 %) | Kevin.Popescu | CC BY |
| `books.glb` | [Harry Potter Books Stack](https://sketchfab.com/3d-models/harry-potter-books-stack-b08a7135cad84e0ca222a8cff075109b) (30 %) | Milkislegit | CC BY |
| `frog.glb` | [Harry potter chocolate frog box cards](https://sketchfab.com/3d-models/harry-potter-chocolate-frog-box-cards-608c402a7f974a6fa58ea925a208321f) | Batuhan13 | CC BY |
| `nimbus.glb` | [Nimbus 2,000](https://sketchfab.com/3d-models/nimbus-2000-0d9dce12f44f4aa49c229c5045d1d0d0) | Andrew Parker | CC BY |

The flames, the floating candles, the smoke, the lit windows of the castle and the light pools are drawn by `vivarium.js` itself.

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
