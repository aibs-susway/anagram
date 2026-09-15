/*
 * Localhost tester for the Anagram "Stocks" tab buy/sell flow.
 * Spawns the real server on an isolated port, then drives the exact HTTP
 * calls the Stocks tab makes and asserts balances + holdings change correctly.
 * Run:  node tests/stocks-tester.js   (exit 0 = all passed)
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = Number(process.env.TEST_PORT || 3999);
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.join(__dirname, '..');
// Throwaway data file so the tester never reads or writes the real data.json.
const TEST_DATA = path.join(os.tmpdir(), 'anagram-test-data-' + Date.now() + '.json');

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) { passed += 1; console.log('  PASS  ' + name); }
  else { failed += 1; console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); }
}

async function api(pathname, options) {
  options = options || {};
  const res = await fetch(BASE + pathname, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body };
}

async function waitForServer(timeoutMs) {
  timeoutMs = timeoutMs || 15000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const res = await fetch(BASE + '/health'); if (res.ok) return true; }
    catch (e) { /* not up yet */ }
    await new Promise(function (r) { setTimeout(r, 200); });
  }
  return false;
}

function startServer() {
  return new Promise(function (resolve, reject) {
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), DATA_FILE: TEST_DATA },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', function (chunk) { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', function (code) {
      if (code !== 0 && code !== null) reject(new Error('Server exited early (code ' + code + '): ' + stderr));
    });
    waitForServer().then(function (ok) {
      if (ok) resolve(child); else reject(new Error('Server not ready.\n' + stderr));
    });
  });
}

async function main() {
  const stamp = Date.now();
  const username = 'swtest' + stamp;
  const password = 'Passw0rd!';

  console.log('\nStarting Anagram server on ' + BASE + ' ...');
  const server = await startServer();
  console.log('Server is up.\n');

  try {
    const created = await api('/api/accounts', { method: 'POST', body: JSON.stringify({ username, email: username + '@example.com', password }) });
    check('create account returns 201', created.status === 201, 'status ' + created.status + ' body=' + JSON.stringify(created.body));
    const accountId = created.body && created.body.account && created.body.account.id;
    check('account has an id', Boolean(accountId), JSON.stringify(created.body));

    const funded = await api('/api/transfers', { method: 'POST', body: JSON.stringify({ senderId: 'admin-despawn', recipientId: accountId, amount: 100000 }) });
    check('admin funds the test account', funded.status === 201, 'status ' + funded.status + ' body=' + JSON.stringify(funded.body));

    let accountsRes = await api('/api/accounts');
    let account = (accountsRes.body.accounts || []).find(function (a) { return a.id === accountId; });
    const startBalance = Number(account && account.eCash || 0);
    check('funded balance is 100000', startBalance === 100000, 'balance ' + startBalance);

    const quotes = await api('/api/stocks');
    check('GET /api/stocks returns 200', quotes.status === 200, 'status ' + quotes.status);
    const stocks = (quotes.body && quotes.body.stocks) || [];
    check('stock list is non-empty', stocks.length > 0, 'count ' + stocks.length);
    const stock = stocks[0];
    check('first stock has a positive price', stock && Number(stock.price) > 0, JSON.stringify(stock));

    const buyQty = 2;
    const buy = await api('/api/stocks/trade', { method: 'POST', body: JSON.stringify({ accountId, symbol: stock.symbol, side: 'buy', quantity: buyQty }) });
    check('buy returns 200', buy.status === 200, 'status ' + buy.status + ' body=' + JSON.stringify(buy.body));
    const buyResult = buy.body && buy.body.result;
    check('buy reports side=buy', buyResult && buyResult.side === 'buy', JSON.stringify(buyResult));
    check('buy reports requested quantity', Number(buyResult && buyResult.quantity) === buyQty, JSON.stringify(buyResult));
    check('holding after buy equals buyQty', Number(buyResult && buyResult.holding && buyResult.holding.quantity) === buyQty, JSON.stringify(buyResult && buyResult.holding));

    const expectedCost = Number(stock.price) * buyQty;
    accountsRes = await api('/api/accounts');
    account = (accountsRes.body.accounts || []).find(function (a) { return a.id === accountId; });
    const balanceAfterBuy = Number(account && account.eCash || 0);
    check('balance decreased by price x qty', Math.abs((startBalance - balanceAfterBuy) - expectedCost) < 0.001, 'expected -' + expectedCost + ', got -' + (startBalance - balanceAfterBuy));

    const holdingsAfterBuy = account && account.stocks && account.stocks[stock.symbol];
    const qtyAfterBuy = typeof holdingsAfterBuy === 'number' ? holdingsAfterBuy : Number(holdingsAfterBuy && holdingsAfterBuy.quantity || 0);
    check('persisted holding matches after buy', qtyAfterBuy === buyQty, 'persisted ' + qtyAfterBuy);

    const sellQty = 1;
    const balanceBeforeSell = balanceAfterBuy;
    const sell = await api('/api/stocks/trade', { method: 'POST', body: JSON.stringify({ accountId, symbol: stock.symbol, side: 'sell', quantity: sellQty }) });
    check('sell returns 200', sell.status === 200, 'status ' + sell.status + ' body=' + JSON.stringify(sell.body));
    const sellResult = sell.body && sell.body.result;
    check('sell reports side=sell', sellResult && sellResult.side === 'sell', JSON.stringify(sellResult));
    check('holding after sell is buyQty - sellQty', Number(sellResult && sellResult.holding && sellResult.holding.quantity) === buyQty - sellQty, JSON.stringify(sellResult && sellResult.holding));

    const expectedProceeds = Number(stock.price) * sellQty;
    accountsRes = await api('/api/accounts');
    account = (accountsRes.body.accounts || []).find(function (a) { return a.id === accountId; });
    const balanceAfterSell = Number(account && account.eCash || 0);
    check('balance increased by price x qty on sell', Math.abs((balanceAfterSell - balanceBeforeSell) - expectedProceeds) < 0.001, 'expected +' + expectedProceeds + ', got +' + (balanceAfterSell - balanceBeforeSell));

    const oversell = await api('/api/stocks/trade', { method: 'POST', body: JSON.stringify({ accountId, symbol: stock.symbol, side: 'sell', quantity: 9999 }) });
    check('selling more than owned is rejected', oversell.status === 400, 'status ' + oversell.status + ' body=' + JSON.stringify(oversell.body));

    const zeroQty = await api('/api/stocks/trade', { method: 'POST', body: JSON.stringify({ accountId, symbol: stock.symbol, side: 'buy', quantity: 0 }) });
    check('zero quantity is rejected', zeroQty.status === 400, 'status ' + zeroQty.status + ' body=' + JSON.stringify(zeroQty.body));

    const badSymbol = await api('/api/stocks/trade', { method: 'POST', body: JSON.stringify({ accountId, symbol: 'NOPE', side: 'buy', quantity: 1 }) });
    check('unknown symbol is rejected', badSymbol.status === 400, 'status ' + badSymbol.status + ' body=' + JSON.stringify(badSymbol.body));

    const poorUser = 'poor' + stamp;
    const poorCreated = await api('/api/accounts', { method: 'POST', body: JSON.stringify({ username: poorUser, email: poorUser + '@example.com', password }) });
    const poorId = poorCreated.body && poorCreated.body.account && poorCreated.body.account.id;
    const poorBuy = await api('/api/stocks/trade', { method: 'POST', body: JSON.stringify({ accountId: poorId, symbol: stock.symbol, side: 'buy', quantity: 1 }) });
    check('buy with insufficient e-cash is rejected', poorBuy.status === 400, 'status ' + poorBuy.status + ' body=' + JSON.stringify(poorBuy.body));

    const allStocksBuy = [];
    for (const s of stocks) {
      const r = await api('/api/stocks/trade', { method: 'POST', body: JSON.stringify({ accountId, symbol: s.symbol, side: 'buy', quantity: 1 }) });
      allStocksBuy.push({ symbol: s.symbol, status: r.status });
    }
    const allOk = allStocksBuy.every(function (r) { return r.status === 200; });
    check('can buy every listed symbol', allOk, JSON.stringify(allStocksBuy));
  } finally {
    server.kill();
    try { fs.unlinkSync(TEST_DATA); } catch (e) { /* ignore */ }
  }

  console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed.\n');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(function (error) { console.error('\nTester crashed:', error); process.exit(1); });
