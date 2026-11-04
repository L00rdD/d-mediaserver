// Tests of the trading bot card (home/site/trading-bot.js) on a fake page
const test = require("node:test");
const assert = require("node:assert");
const { page, run, minutesAgo } = require("./cards-page.cjs");

const BOT = "http://dpi.lan:8080/api/status.json";
const BINANCE = "https://api.binance.com/api/v3/ticker/price";

const status = (more = {}) => ({
  mode: "paper", cash: 500, initial_cash: 1000, strategy: "sma", timeframe: "1d", timeframe_sec: 86400,
  updated_at: minutesAgo(30), next_check_at: minutesAgo(-30), realized_pnl: 12.5, trades: 4, fees_paid: 1.25,
  positions: { "BTC/USDT": { amount: 0.01, avg_price: 50000 }, "ETH/USDT": { amount: 0.1, avg_price: 2000 }, "SOL/USDT": { amount: 0, avg_price: 100 } },
  prices: { "BTC/USDT": 40000, "ETH/USDT": 1000 },
  symbols: ["BTC/USDT", "XRP/USDT"],
  ...more,
});

test("live prices from Binance, a gain, positions listed", async () => {
  const { card, text, part, calls } = page({ id: "trading-bot", answers: {
    [BOT]: status(),
    [BINANCE]: [{ symbol: "BTCUSDT", price: "60000" }, { symbol: "ETHUSDT", price: "2000" }, { symbol: "DOGEUSDT", price: "1" }],
  } });
  await run("trading-bot.js");
  assert.equal(card.hidden, false);
  assert.deepEqual(JSON.parse(decodeURIComponent(calls[1].url.split("symbols=")[1])), ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"]);
  assert.equal(text("mode"), "PAPER");
  assert.equal(text("state"), "Running");
  assert.equal(part("state").className, "up");
  // 500 + 0.01 × 60000 + 0.1 × 2000
  assert.equal(text("equity"), "1,300.00 USDT");
  assert.equal(text("pnl"), "+300.00 USDT");
  assert.equal(part("pnl").className, "up");
  assert.equal(text("pct"), "+30.00 %");
  assert.equal(part("pct").className, "up");
  assert.equal(text("positions"), "2");
  assert.equal(text("unrealized"), "+100.00");
  assert.equal(part("unrealized").className, "up");
  assert.equal(text("realized"), "+12.50");
  assert.equal(text("trades"), "4");
  assert.equal(text("fees"), "1.25");
  assert.equal(text("strategy"), "sma @ 1d");
  assert.equal(text("updated"), "updated 30 min ago, next check in 30 min");
  const rows = part("list").children;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].innerHTML, '<span>BTC/USDT</span><span>0.010000</span><span>600.00 USDT</span><span class="up">+20.00 %</span>');
  assert.equal(rows[1].innerHTML, '<span>ETH/USDT</span><span>0.100000</span><span>200.00 USDT</span><span class="">+0.00 %</span>');
});

test("saved prices when Binance fails, a loss, stale", async () => {
  const { text, part } = page({ id: "trading-bot", answers: {
    [BOT]: status({ updated_at: minutesAgo(3 * 1440), next_check_at: minutesAgo(5), timeframe_sec: 0, realized_pnl: -2 }),
    [BINANCE]: new Error("blocked"),
  } });
  await run("trading-bot.js");
  assert.equal(text("state"), "Stale");
  assert.equal(part("state").className, "down");
  // 500 + 0.01 × 40000 + 0.1 × 1000
  assert.equal(text("equity"), "1,000.00 USDT");
  assert.equal(text("pnl"), "+0.00 USDT");
  assert.equal(part("pnl").className, "");
  assert.equal(text("unrealized"), "-200.00");
  assert.equal(part("unrealized").className, "down");
  assert.equal(text("realized"), "-2.00");
  assert.equal(part("realized").className, "down");
  assert.equal(text("updated"), "updated 3 d ago, next check any moment");
  assert.match(part("list").children[0].innerHTML, /<span class="down">-20.00 %<\/span>$/);
});

test("Binance answers an error: saved prices, or the buying price", async () => {
  const { text, part } = page({ id: "trading-bot", answers: {
    [BOT]: status({ prices: undefined, symbols: undefined, updated_at: minutesAgo(0), next_check_at: minutesAgo(-180), cash: 400, realized_pnl: undefined, trades: undefined, fees_paid: undefined }),
    [BINANCE]: 500,
  } });
  await run("trading-bot.js");
  assert.equal(text("equity"), "1,100.00 USDT");
  assert.equal(text("updated"), "updated just now, next check in 3 h");
  assert.equal(text("realized"), "+0.00");
  assert.equal(part("realized").className, "");
  assert.equal(text("trades"), "0");
  assert.equal(text("fees"), "0.00");
});

test("in cash, no next check, a loss, no list on the card", async () => {
  const { card, text, part } = page({ id: "trading-bot", missing: ["list", "fees"], answers: {
    [BOT]: status({ positions: undefined, cash: 900, updated_at: minutesAgo(120), next_check_at: null }),
    [BINANCE]: [],
  } });
  await run("trading-bot.js");
  assert.equal(card.hidden, false);
  assert.equal(text("pnl"), "-100.00 USDT");
  assert.equal(part("pnl").className, "down");
  assert.equal(text("pct"), "-10.00 %");
  assert.equal(text("positions"), "0");
  assert.equal(text("updated"), "updated 2 h ago");
});

test("in cash: says so in the list", async () => {
  const { part } = page({ id: "trading-bot", answers: { [BOT]: status({ positions: {} }), [BINANCE]: [] } });
  await run("trading-bot.js");
  assert.equal(part("list").innerHTML, "<li><span>In cash, waiting for a signal</span></li>");
});

for (const [why, answer] of [["the bot is off", 404], ["the page cannot reach it", new Error("offline")]]) {
  test(`hidden when ${why}`, async () => {
    const { card } = page({ id: "trading-bot", answers: { [BOT]: answer } });
    await run("trading-bot.js");
    assert.equal(card.hidden, true);
  });
}

test("does nothing on a page without the card", async () => {
  page({});
  await run("trading-bot.js");
});
