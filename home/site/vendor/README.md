# Vendored libraries

`three-r186.min.js` is [three.js](https://threejs.org) r186 (MIT, `LICENSE-three.txt`) with the few addons the hub's vivarium uses (post-processing, bloom, rounded box, room environment, glTF loader, ground-projected skybox, meshopt decoder), bundled into one ES module. `three-entry.js` lists them. To rebuild it, in an empty folder:

```sh
npm i three@0.186.1 esbuild
npx esbuild three-entry.js --bundle --format=esm --minify --legal-comments=eof --outfile=three-r186.min.js
```

The hub serves `vendor/` with a month of cache and no revalidation (Caddyfile): a rebuild with other contents must get a new file name, and `vivarium.js` and the `modulepreload` of `hogwarts.html` must follow.
