/*
 * Pre-deploy check for Azure App Service.
 * Verifies the things that most often break an Azure Node deployment.
 * Run: node tests/deploy-check.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let failed = 0;

function ok(name, cond, detail) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : (detail ? ' -> ' + detail : '')));
  if (!cond) failed += 1;
}

function bytes(p) { return fs.readFileSync(p); }
function hasBom(buf) { return buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF; }

// 1. No source file may carry a UTF-8 BOM.
['package.json', 'server.js', 'index.html', 'README.md', '.github/workflows/main_aibs-anagram.yml'].forEach(function (rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) { ok('exists: ' + rel, false, 'missing'); return; }
  ok('no BOM: ' + rel, !hasBom(bytes(p)), 'UTF-8 BOM present');
});

// 2. package.json must be valid JSON and declare a Node engine >= 18.
let pkg = null;
try { pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); ok('package.json is valid JSON', true); }
catch (e) { ok('package.json is valid JSON', false, e.message); }
if (pkg) {
  ok('engines.node declared', Boolean(pkg.engines && pkg.engines.node), JSON.stringify(pkg.engines));
  const major = Number((String(pkg.engines && pkg.engines.node).match(/\d+/) || [0])[0]);
  ok('engines.node requires >= 18 (fetch usage)', major >= 18, String(pkg.engines && pkg.engines.node));
  ok('start script present', Boolean(pkg.scripts && pkg.scripts.start), JSON.stringify(pkg.scripts));
  ok('main points at server.js', pkg.main === 'server.js', String(pkg.main));
}

// 3. Windows App Service needs web.config with an iisnode handler for server.js.
const wc = path.join(root, 'web.config');
ok('web.config exists (Windows App Service)', fs.existsSync(wc));
if (fs.existsSync(wc)) {
  const x = fs.readFileSync(wc, 'utf8');
  ok('web.config registers iisnode for server.js', /modules="iisnode"/.test(x) && /path="server\.js"/.test(x));
}

// 4. Kudu build file.
ok('.deployment exists (Kudu build)', fs.existsSync(path.join(root, '.deployment')));

// 5. Entry point must not hardcode a port (Azure injects PORT).
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
ok('server.js reads process.env.PORT', /process\.env\.PORT/.test(server));

console.log('\n' + (failed === 0 ? 'All deploy checks passed.' : failed + ' deploy check(s) failed.') + '\n');
process.exit(failed === 0 ? 0 : 1);