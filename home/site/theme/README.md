# Hub theme kit

The home page comes in three looks, *Reactor* (Iron Man's helmet HUD), *Cyberpunk* (Cyberpunk 2077's menus) and *Hogwarts* (Harry Potter: the Great Hall at night, candles, parchment). This kit lets any personal project served on the same machine take the look the hub is showing, without copying its styles.

The hub serves it at `http://<host>/theme/`:

- `theme.css`: the `--t-*` variables of each look, and the `.t-*` components.
- `theme.js`: picks the look and adds the hub bar.
- `magic.js`: the Great Hall behind a Hogwarts page and its moving magic. `theme.js` loads it by itself (see below).
- `fonts/`: Michroma, Rajdhani, Cinzel and IM Fell English, all under the SIL Open Font License (`OFL-*.txt`).

## How a page knows the look

The hub stores the choice in the `style` cookie (`reactor`, `cyberpunk` or `hogwarts`). Cookies ignore the port, so a project on `dpi.lan:8080` reads the same cookie as the hub on `dpi.lan`. With no cookie the look is Reactor, as on the hub.

The theme switch in the hub bar writes that same cookie, so switching in a project switches the hub too. A tab that comes back to the front picks up a switch made elsewhere. Adding `?theme=cyberpunk` to a URL forces a look without storing it, which is handy for testing.

The cookie belongs to the name used in the address. A page opened as `192.168.1.229:8080` does not see a choice made on `dpi.lan`. The hub behaves the same way.

## Use it in a project

1. In `<head>`, before the project's own `<style>`, load the kit from the hub on the same host:

   ```html
   <script>document.write(`<link rel="stylesheet" href="//${location.hostname}/theme/theme.css"><script src="//${location.hostname}/theme/theme.js"><\/script>`)</script>
   ```

   Loading it synchronously sets the look before the page is drawn, so nothing flashes. If the hub does not answer, both requests fail at once and the page keeps its own style. This assumes the hub is on port 80 (`HOME_PORT`).

2. Put `class="t-app"` on `<body>`. This applies the look's background, text and scanlines, and adds the hub bar: a back link, the page name (`data-t-name`, or else `<title>`) and the theme switch. To get the look without the bar, add `data-t-no-bar`.

3. Point the project's own variables at the tokens, keeping the current values as fallback:

   ```css
   :root { --accent: var(--t-accent, #6fe3ff); --muted: var(--t-muted, #7fa9b8); }
   ```

4. Add the component classes next to the project's own:

   | Class | For |
   |---|---|
   | `t-title` | the page title |
   | `t-heading` | a section title; an `<i>` inside is shown as a counter: `<h2 class="t-heading"><i>01</i>Recap</h2>` |
   | `t-label` | small caps text |
   | `t-panel` | a card; `t-panel t-main` for the one that matters most |
   | `t-stats` | figures: `<dl class="t-stats"><div><dt>Equity</dt><dd>…</dd></div></dl>` |
   | `t-badge` | a short status tag |
   | `t-btn` | a button or link button; `t-btn t-main` for the main action |
   | `t-callout` | a remark set apart; `t-callout t-main` for a highlighted one |
   | `t-bar` | a gauge: `<span class="t-bar"><i style="width: 40%"></i></span>` |
   | `t-table` | a table |
   | `t-up` / `t-down` | a rise or a fall |

   Every kit rule starts with `[data-theme]`, so it wins over the project's rule on the same element. The project keeps layout and sizes; the kit gives colours, fonts, frames and shapes.

5. For colours drawn by scripts (SVG charts, canvas), use the variables rather than hex values: `style="stroke: var(--t-series-1)"`. Then a theme switch repaints the chart without reloading. For a canvas, call `Theme.color("series-1")` and redraw in `Theme.onChange(fn)`.

## Tokens

| Token | Used for |
|---|---|
| `--t-bg`, `--t-surface`, `--t-line` | background, panel fill, thin lines |
| `--t-text`, `--t-muted` | text, secondary text |
| `--t-accent`, `--t-accent-soft`, `--t-accent-faint` | the look's main colour, as text, frame and tint |
| `--t-accent-2` | its second colour (hover) |
| `--t-highlight`, `--t-on-highlight` | the one thing that matters, and text on it |
| `--t-progress` | gauges |
| `--t-up`, `--t-down` | rises and falls |
| `--t-series-1` … `--t-series-4` | chart lines, in order |
| `--t-font-display`, `--t-font-body`, `--t-font-mono` | fonts |
| `--t-glow` | text-shadow for titles |

## Ink on parchment (Hogwarts)

In the Hogwarts look a `.t-panel` is a sheet of old parchment: aged paper with fibres, stains and a scorched rim (its own `background`), torn deckled edges (a `mask`), laid a little askew (`rotate`, never for a panel holding a `<table>`). The paper and the mask belong to the panel itself, so nothing is added to the page, nothing sticking out of the panel is shadowed, and a panel the page redraws is dressed at once. Because of the mask, a box-shadow or anything drawn outside the panel's box does not show.

Inside the sheet the tokens turn to ink: `--t-text`, `--t-muted`, `--t-accent`, `--t-line`, `--t-up`, `--t-down`, `--t-series-*`… are redeclared on `.t-panel`, so `.t-stats`, `.t-table`, `.t-bar`, `.t-badge`, `.t-up`/`.t-down`, links and anything written with `var(--t-…)` stay readable.

A project's own aliases (`--text: var(--t-text)` on `:root`) are resolved on `:root`, in candlelight colours. So that they write in ink too, the kit also redeclares inside the sheet the alias names the projects use: `--text`, `--muted`, `--line`, `--accent`, `--cyan`, `--cyan-soft`, `--cyan-faint`, `--green`, `--up`, `--down`, `--s1` to `--s4`. A project with other names should declare its aliases on `:root, .t-panel` rather than `:root` alone.

`.t-panel.t-main` gets a gilt double rule inside its edge, like an illuminated page.

## The Great Hall (Hogwarts)

While the look is Hogwarts, `theme.js` also loads `magic.js`, and stops it when the look changes. It puts the Great Hall behind the page, in a fixed `<div class="t-hall">` (styled in `theme.css`):

- the enchanted ceiling: a night sky with twinkling stars and clouds drifting slowly, melting into the dark of the hall (the sky gradient is the page background);
- floating candles at three depths, kept in the side margins: tall ivory tapers with melted tops and drips, a teardrop flame and a warm halo; each bobs and flickers at its own pace.

The hall is there even for a still page; it just does not move. A page may put its own `<div class="t-hall" data-candles="40">` in its body to choose the number of candles (the hub spreads them over the whole hall with `data-spread="hall"`).

When the page may move, `magic.js` also draws on one canvas laid over the page, which lets clicks through and pauses while the tab is hidden: golden dust in the candlelight, a trail of sparks behind the mouse (not on touch screens), a *Lumos* burst where you click, the Golden Snitch (click it to catch it). Now and then: a shooting star, a candle guttering and relighting, a draught bending every flame, the owl post flying through and dropping a letter, a ghost gliding through the walls, a silver Patronus. The hall moves with the mouse and the scroll, near candles more than far ones. `<body data-t-hall="rich">` makes all that come more often (the hub does).

It also animates the kit components, without changing their layout:

- each `.t-panel` gets an ink flourish drawn in its corners, and is laid down (fades in) when it comes into view. For this `magic.js` adds a `<span class="t-filigree">` inside the panel, and sets `position: relative` on it if it had none. Panels that scroll (`overflow: auto`) are left alone. Panels a page draws later get it too, without fading in, so a page that redraws its panels does not flicker;
- `.t-title` shimmers like liquid gold, `.t-heading` stars twinkle, and `.t-bar` gauges ripple with a glint passing through.

To keep a page still, put `data-t-calm` on its `<body>` (a page where people read figures for a long time, a kiosk). Reduced motion in the system settings (`prefers-reduced-motion`) keeps every page still too. The look itself stays, hall and candles included: only the movement goes.

A page can add its own magic through `window.Magic`, which exists once `magic.js` is loaded:

| Call | Does |
|---|---|
| `Magic.running` | `true` while the magic plays |
| `Magic.emit(x, y, { n, color, speed, life, size, dir, spread, gravity })` | sparks at a point of the window; `color` is `"gold"`, `"silver"` or `"white"`; a negative `gravity` makes them rise |
| `Magic.burst(x, y, color)` | a *Lumos* burst |
| `Magic.snitch()`, `Magic.owl()`, `Magic.ghost()`, `Magic.patronus()`, `Magic.shootingStar()` | sends one now |
| `Magic.gust()` | a draught: flames lean, `html.t-gust` for 3 s and a `magic:gust` event on `document` |
| `Magic.onFrame(fn)` | runs `fn(time, dt, pointer, view)` in the same animation frame as the canvas; `view` is `{ px, py, scroll }`, the smoothed mouse (-0.5 to 0.5) and the scroll. The hub's portraits, lectern and parallax use it |

The kit also exposes the pictures of the hall as variables, for a page that draws more of it (the hub): `--t-paper` (the paper texture, a 520 px tile), `--t-edge-top`, `--t-edge-right`, `--t-edge-bottom`, `--t-edge-left` (torn edges as mask half-planes, intersected) and `--t-flame`.

A page that sets `<html data-theme="hogwarts">` by itself, as the hub's `hogwarts.html` does, can load `magic.js` with a plain `<script src="/theme/magic.js" defer>`: it starts by itself.

## Add a look

Add its tokens and its component variants in `theme.css` (copy a `[data-theme="reactor"]` block). Then add its name to `THEMES` and `LABELS` in `theme.js` and to the `/style/` regexp in the Caddyfile, and give the hub a page for it, as `reactor.html`, `cyberpunk.html` and `hogwarts.html` are.
