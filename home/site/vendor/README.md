# Vendored libraries

`three.min.js` is [three.js](https://threejs.org) r186 (MIT, `LICENSE-three.txt`) with the few addons the hub's vivarium uses (post-processing, bloom, rounded box, room environment, glTF loader, ground-projected skybox), bundled into one ES module. `three-entry.js` lists them. To rebuild it, in an empty folder:

```sh
npm i three@0.186.1 esbuild
npx esbuild three-entry.js --bundle --format=esm --minify --legal-comments=eof --outfile=three.min.js
```
