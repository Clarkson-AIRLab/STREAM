// Quick engine checks. Run: node tests/engine_check.js
const S = require("../src/engine.js");
const modes = [[3000, 40e-9, 1.6], [1500, 150e-9, 1.5]];
const r = S.run({ params: {}, modes, truth: S.CURRENT, cfgA: S.LEGACY, cfgB: S.CURRENT, noise: false });
const dj = r.invB.dj, tr = S.lognormal(dj, modes);
let a = 0, b = 0;
for (let i = 0; i < dj.length - 1; i++) { const w = Math.log(dj[i + 1] / dj[i]); a += 0.5 * (r.invB.x[i] + r.invB.x[i + 1]) * w; b += 0.5 * (tr[i] + tr[i + 1]) * w; }
const err = Math.abs(a / b - 1);
console.log(`Current-model inversion recovers total number within ${(err * 100).toFixed(1)}%`);
const gf = S.growthFactor(100e-9, 0.3, 0.3, 296.15);
console.log(`Growth factor, 100 nm, kappa 0.3, RH 30%: ${gf.toFixed(3)}`);
if (err > 0.05) { console.error("FAIL: inversion error above 5%"); process.exit(1); }
console.log("OK");
