// Fills the trading bot card and shows it. The bot serves its own dashboard and
// state on port 8080 of the same host (CORS open); when it does not answer, the
// card stays hidden. Prices come straight from Binance so the equity is live even
// between two bot cycles; when that call fails, the prices the bot saved are used.
(async () => {
  const card = document.getElementById("trading-bot");
  if (!card) return;

  let s;
  try {
    const r = await fetch(`http://${location.hostname}:8080/api/status.json`, { cache: "no-store" });
    if (!r.ok) return;
    s = await r.json();
  } catch {
    return;
  }

  // Live prices from Binance, over the ones the bot saved
  const livePrices = async (symbols) => {
    const prices = { ...(s.prices || {}) };
    try {
      const ids = symbols.map((x) => x.replace("/", ""));
      const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbols=" + encodeURIComponent(JSON.stringify(ids)));
      if (r.ok) {
        for (const t of await r.json()) {
          const sym = symbols[ids.indexOf(t.symbol)];
          if (sym) prices[sym] = parseFloat(t.price);
        }
      }
    } catch { /* keep the saved prices */ }
    return prices;
  };

  const positions = s.positions || {};
  const prices = await livePrices([...new Set([...Object.keys(positions), ...(s.symbols || [])])]);
  const held = Object.entries(positions).filter(([, p]) => p.amount > 0);
  const priceOf = (sym, p) => prices[sym] ?? p.avg_price;
  const equity = s.cash + held.reduce((sum, [sym, p]) => sum + p.amount * priceOf(sym, p), 0);
  const pnl = equity - s.initial_cash;
  const pct = (pnl / s.initial_cash) * 100;
  const unrealized = held.reduce((sum, [sym, p]) => sum + p.amount * (priceOf(sym, p) - p.avg_price), 0);

  const money = (v) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = (v) => (v >= 0 ? "+" : "");
  const signed = (v) => sign(v) + money(v);
  const trend = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
  const ago = (iso) => {
    const min = Math.round((Date.now() - new Date(iso)) / 60000);
    if (min < 1) return "just now";
    if (min < 60) return min + " min ago";
    if (min < 48 * 60) return Math.round(min / 60) + " h ago";
    return Math.round(min / 1440) + " d ago";
  };
  const until = (iso) => {
    const min = Math.round((new Date(iso) - Date.now()) / 60000);
    if (min <= 0) return "any moment";
    return min < 60 ? "in " + min + " min" : "in " + Math.round(min / 60) + " h";
  };

  const set = (key, text, cls) => {
    const el = card.querySelector(`[data-tb="${key}"]`);
    if (!el) return;
    el.textContent = text;
    if (cls !== undefined) el.className = cls;
  };

  // Stale = no update for more than two candles: the bot is probably stopped.
  const stale = () => {
    const ageSec = (Date.now() - new Date(s.updated_at)) / 1000;
    return ageSec > 2 * (s.timeframe_sec || 86400) + 600;
  };
  const fill = () => {
    const realized = s.realized_pnl || 0;
    const old = stale();
    set("mode", s.mode.toUpperCase());
    set("state", old ? "Stale" : "Running", old ? "down" : "up");
    set("equity", money(equity) + " USDT");
    set("pnl", signed(pnl) + " USDT", trend(pnl));
    set("pct", sign(pct) + pct.toFixed(2) + " %", trend(pnl));
    set("positions", String(held.length));
    set("unrealized", signed(unrealized), trend(unrealized));
    set("realized", signed(realized), trend(realized));
    set("trades", String(s.trades || 0));
    set("fees", money(s.fees_paid || 0));
    set("strategy", `${s.strategy} @ ${s.timeframe}`);
    set("updated", "updated " + ago(s.updated_at) + (s.next_check_at ? ", next check " + until(s.next_check_at) : ""));
  };

  const row = (sym, p) => {
    const price = priceOf(sym, p);
    const diff = ((price - p.avg_price) / p.avg_price) * 100;
    const li = document.createElement("li");
    li.innerHTML =
      `<span>${sym}</span><span>${p.amount.toFixed(6)}</span>` +
      `<span>${money(p.amount * price)} USDT</span>` +
      `<span class="${trend(diff)}">${sign(diff) + diff.toFixed(2)} %</span>`;
    return li;
  };
  const fillList = (list) => {
    list.textContent = "";
    for (const [sym, p] of held) list.appendChild(row(sym, p));
    if (!held.length) list.innerHTML = "<li><span>In cash, waiting for a signal</span></li>";
  };

  fill();
  const list = card.querySelector('[data-tb="list"]');
  if (list) fillList(list);
  card.hidden = false;
})();
