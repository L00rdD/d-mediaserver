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

  const positions = s.positions || {};
  const prices = { ...(s.prices || {}) };
  const symbols = [...new Set([...Object.keys(positions), ...(s.symbols || [])])];
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

  const held = Object.entries(positions).filter(([, p]) => p.amount > 0);
  const equity = s.cash + held.reduce((sum, [sym, p]) => sum + p.amount * (prices[sym] ?? p.avg_price), 0);
  const pnl = equity - s.initial_cash;
  const pct = (pnl / s.initial_cash) * 100;
  const unrealized = held.reduce((sum, [sym, p]) => sum + p.amount * ((prices[sym] ?? p.avg_price) - p.avg_price), 0);

  const money = (v) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signed = (v) => (v >= 0 ? "+" : "") + money(v);
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
  const ageSec = (Date.now() - new Date(s.updated_at)) / 1000;
  const stale = ageSec > 2 * (s.timeframe_sec || 86400) + 600;
  set("mode", s.mode.toUpperCase());
  set("state", stale ? "Stale" : "Running", stale ? "down" : "up");
  set("equity", money(equity) + " USDT");
  set("pnl", signed(pnl) + " USDT", trend(pnl));
  set("pct", (pct >= 0 ? "+" : "") + pct.toFixed(2) + " %", trend(pnl));
  set("positions", String(held.length));
  set("unrealized", signed(unrealized), trend(unrealized));
  set("realized", signed(s.realized_pnl || 0), trend(s.realized_pnl || 0));
  set("trades", String(s.trades || 0));
  set("fees", money(s.fees_paid || 0));
  set("strategy", `${s.strategy} @ ${s.timeframe}`);
  set("updated", "updated " + ago(s.updated_at) + (s.next_check_at ? ", next check " + until(s.next_check_at) : ""));

  const list = card.querySelector('[data-tb="list"]');
  if (list) {
    list.textContent = "";
    for (const [sym, p] of held) {
      const price = prices[sym] ?? p.avg_price;
      const diff = ((price - p.avg_price) / p.avg_price) * 100;
      const row = document.createElement("li");
      row.innerHTML =
        `<span>${sym}</span><span>${p.amount.toFixed(6)}</span>` +
        `<span>${money(p.amount * price)} USDT</span>` +
        `<span class="${trend(diff)}">${(diff >= 0 ? "+" : "") + diff.toFixed(2)} %</span>`;
      list.appendChild(row);
    }
    if (!held.length) list.innerHTML = "<li><span>In cash, waiting for a signal</span></li>";
  }
  card.hidden = false;
})();
