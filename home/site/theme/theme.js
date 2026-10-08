// Hub theme kit: tells a page which look the hub is showing, and keeps it in step.
//
// The hub stores the look in the "style" cookie. Cookies ignore the port, so a project
// on another port of the same host (dpi.lan:8080) reads the same cookie as the hub
// (dpi.lan). "?theme=<name>" in the URL forces a look without storing it.
//
// Loaded synchronously in <head> (see README.md), it sets <html data-theme> before the
// page is drawn. On a <body class="t-app"> it also adds the hub bar: a link back to the
// hub and a theme switch. window.Theme is there for scripts: Theme.name, Theme.set(name),
// Theme.color("accent") and Theme.onChange(fn).
(() => {
  const THEMES = ["reactor", "cyberpunk"];
  const LABELS = { reactor: "Reactor", cyberpunk: "Cyberpunk" };
  const script = document.currentScript;
  const hub = script ? new URL(script.src, location.href).origin : location.origin;
  const root = document.documentElement;
  const listeners = [];
  let bar = null;

  const read = () => {
    const forced = new URLSearchParams(location.search).get("theme");
    if (THEMES.includes(forced)) return forced;
    const m = document.cookie.match(/(?:^|;\s*)style=([a-z]+)/);
    return m && THEMES.includes(m[1]) ? m[1] : "reactor";
  };

  const apply = (name) => {
    if (root.dataset.theme === name) return;
    root.dataset.theme = name;
    if (bar) for (const b of bar.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.value === name));
    for (const fn of listeners) fn(name);
  };

  const set = (name) => {
    if (!THEMES.includes(name)) return;
    // Same cookie as the hub's /style/<name> (Path=/, a year): the hub follows too
    document.cookie = `style=${name}; Path=/; Max-Age=31536000; SameSite=Lax`;
    apply(name);
  };

  apply(read());
  // Switched on the hub or in another project: pick it up when coming back to this tab
  document.addEventListener("visibilitychange", () => { if (!document.hidden) apply(read()); });

  const addBar = () => {
    const body = document.body;
    if (!body.classList.contains("t-app") || body.hasAttribute("data-t-no-bar")) return;
    bar = document.createElement("nav");
    bar.className = "t-hubbar";
    bar.setAttribute("aria-label", "Hub");
    const home = document.createElement("a");
    home.className = "t-hubbar-home";
    home.href = hub + "/";
    home.textContent = "Hub";
    const name = document.createElement("span");
    name.className = "t-hubbar-name";
    name.textContent = body.dataset.tName || document.title;
    const themes = document.createElement("span");
    themes.className = "t-hubbar-themes";
    themes.setAttribute("role", "group");
    themes.setAttribute("aria-label", "Style");
    for (const t of THEMES) {
      const b = document.createElement("button");
      b.type = "button";
      b.value = t;
      b.textContent = LABELS[t];
      b.setAttribute("aria-pressed", String(t === root.dataset.theme));
      b.addEventListener("click", () => set(t));
      themes.append(b);
    }
    bar.append(home, name, themes);
    body.prepend(bar);
  };
  if (document.body) addBar();
  else document.addEventListener("DOMContentLoaded", addBar);

  window.Theme = {
    themes: THEMES,
    hub,
    get name() { return root.dataset.theme; },
    set,
    color: (token) => getComputedStyle(root).getPropertyValue("--t-" + token).trim(),
    onChange: (fn) => listeners.push(fn),
  };
})();
