# Hub theme kit

The home page comes in two looks, *Reactor* (Iron Man's helmet HUD) and *Cyberpunk* (Cyberpunk 2077's menus). This kit lets any personal project served on the same machine take the look the hub is showing, without copying its styles.

The hub serves it at `http://<host>/theme/`:

- `theme.css`: the `--t-*` variables of each look, and the `.t-*` components.
- `theme.js`: picks the look and adds the hub bar.
- `fonts/`: Michroma and Rajdhani, both under the SIL Open Font License (`OFL-*.txt`).

## How a page knows the look

The hub stores the choice in the `style` cookie (`reactor` or `cyberpunk`). Cookies ignore the port, so a project on `dpi.lan:8080` reads the same cookie as the hub on `dpi.lan`. With no cookie the look is Reactor, as on the hub.

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

## Add a look

Add its tokens and its component variants in `theme.css` (copy a `[data-theme="reactor"]` block). Then add its name to `THEMES` and `LABELS` in `theme.js` and to the `/style/` regexp in the Caddyfile, and give the hub a page for it, as `reactor.html` and `cyberpunk.html` are.
