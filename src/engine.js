// engine.js — STREAM physics engine (JavaScript port of stream.py, with selectable models).
// Every component takes a model id; contributed models arrive as data (tables or parameters), never code.
(function (root) {
  "use strict";
  const KB = 1.380649e-23, E = 1.602176634e-19, EPS0 = 8.8541878128e-12, GRAV = 9.81;

  function erf(x) { // Abramowitz & Stegun 7.1.26
    const s = x < 0 ? -1 : 1; x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  }
  const epsF = (x) => x * erf(x) + Math.exp(-x * x) / Math.sqrt(Math.PI);
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

  function gas(T, P) {
    return {
      T, P,
      mu: 1.83245e-5 * Math.pow(T / 296.15, 1.5) * (296.15 + 110.4) / (T + 110.4),
      lam: 67.3e-9 * (T / 296.15) * (101325 / P) * (1 + 110.4 / 296.15) / (1 + 110.4 / T),
    };
  }
  const SLIP = {
    kim2005: (kn) => 1 + kn * (1.165 + 0.483 * Math.exp(-0.997 / kn)),
    davies1945: (kn) => 1 + kn * (1.257 + 0.400 * Math.exp(-1.10 / kn)),
  };
  function physics(g, slipModel, chi) {
    chi = chi || 1;
    const sf = SLIP[slipModel] || SLIP.kim2005;
    const slip = (d) => sf(2 * g.lam / d);
    // d is the volume-equivalent diameter; chi is the dynamic shape factor (1 for spheres)
    const mobility = (d, k) => k * E * slip(d) / (3 * Math.PI * g.mu * chi * d);
    const diffusivity = (d) => KB * g.T * slip(d) / (3 * Math.PI * g.mu * chi * d);
    const dFromMobility = (Z, k) => {
      let lo = Math.log(0.3e-9), hi = Math.log(50e-6);
      for (let i = 0; i < 80; i++) { const mid = 0.5 * (lo + hi); if (mobility(Math.exp(mid), k) > Z) lo = mid; else hi = mid; }
      return Math.exp(0.5 * (lo + hi));
    };
    return { slip, mobility, diffusivity, dFromMobility, chi };
  }

  // ---- humidity: kappa-Köhler growth (Petters & Kreidenweis 2007) ----
  function growthFactor(dDry, kappa, rh, T) {
    if (!(kappa > 0) || !(rh > 0)) return 1;
    rh = Math.min(rh, 0.99);
    const A = 4 * 0.072 * 0.018015 / (8.314 * T * 997);
    const f = (x) => (x * x * x - 1) / (x * x * x - 1 + kappa) * Math.exp(A / (dDry * x)) - rh;
    let lo = 1, hi = 15;
    for (let i = 0; i < 60; i++) { const m = 0.5 * (lo + hi); if (f(m) < 0) lo = m; else hi = m; }
    return 0.5 * (lo + hi);
  }
  // particle at a given RH: wet diameter and density (volume-additive mixing with water)
  function wetState(cfg, p, dDry, rh, T) {
    const gf = cfg.growth === "kappa" ? growthFactor(dDry, p.kappa, rh, T) : 1;
    const g3 = gf * gf * gf;
    return { d: dDry * gf, rho: (p.rho + (g3 - 1) * 997) / g3, gf };
  }

  // ---- transport ----
  function diffPen(D, L, Q) {
    const m = Math.PI * D * L / Q;
    return m < 0.009 ? 1 - 2.56 * Math.pow(m, 2 / 3) + 1.2 * m + 0.177 * Math.pow(m, 4 / 3)
      : 0.819 * Math.exp(-3.657 * m) + 0.097 * Math.exp(-22.3 * m) + 0.032 * Math.exp(-57 * m);
  }
  function settlePen(vts, L, Dt, U) {
    const eps = clamp(3 * L * vts / (4 * Dt * U), 0, 1);
    const e13 = Math.cbrt(eps), s = Math.sqrt(Math.max(1 - Math.pow(eps, 2 / 3), 0));
    return clamp(1 - (2 / Math.PI) * (2 * eps * s - e13 * s + Math.asin(e13)), 0, 1);
  }
  function bendPen(model, stk, phiRad) {
    if (model === "crane1977") return clamp(1 - stk * phiRad, 0, 1);
    if (model === "pui1987") { const r = stk / 0.171; return Math.pow(1 + Math.pow(r, 0.452 * r + 2.242), -2 * phiRad / Math.PI); }
    return 1;
  }
  function tableInterp(tab, dnm) { // tab.x ascending diameters in nm, tab.y values; log-d interpolation, clamped ends
    const x = tab.x, y = tab.y, n = x.length; if (!n) return 1;
    if (dnm <= x[0]) return y[0]; if (dnm >= x[n - 1]) return y[n - 1];
    let i = 0; while (i < n - 2 && dnm > x[i + 1]) i++;
    const f = (Math.log(dnm) - Math.log(x[i])) / (Math.log(x[i + 1]) - Math.log(x[i]));
    return y[i] + f * (y[i + 1] - y[i]);
  }

  // ---- charging ----
  const W88 = {
    0: [-0.0003, -0.1014, 0.3073, -0.3372, 0.1023, -0.0105],
    1: [-2.3484, 0.6044, 0.4800, 0.0013, -0.1553, 0.0320],
    2: [-44.4756, 79.3772, -62.8900, 26.4492, -5.7480, 0.5049],
  };
  const poly10 = (coef, d) => { const x = Math.log10(d * 1e9); let s = 0; coef.forEach((a, i) => { s += a * Math.pow(x, i); }); return Math.pow(10, s); };
  function gunn(d, k, T, zr = 0.875) {
    const a = 2 * Math.PI * EPS0 * d * KB * T / (E * E);
    return E / Math.sqrt(4 * Math.PI * Math.PI * EPS0 * d * KB * T) * Math.exp(-Math.pow(k - a * Math.log(zr), 2) / (2 * a));
  }
  function chargeFraction(model, d, k, T, custom) {
    if (model === "gunn1956") return gunn(d, k, T);
    let c1 = W88[1], c2 = W88[2], min2 = 20e-9;
    if (model && model.startsWith("user:")) { const cm = custom[model]; if (cm) { c1 = cm.k1; c2 = cm.k2; min2 = (cm.min2 || 20) * 1e-9; } }
    if (k === 0) return d > 1e-6 ? gunn(d, 0, T) : poly10(W88[0], d);
    if (k === 1) return poly10(c1, d);
    if (k === 2) return d < min2 ? 0 : poly10(c2, d);
    return gunn(d, k, T);
  }

  const DEFAULT = {
    T: 296.15, P: 101325,
    line_L: 2.0, line_Dt: 4.6e-3, line_bends: 2, rho: 1000,
    impactor_d50: 700e-9, impactor_slope: 8, impactor_W: 0.508e-3, impactor_Q: null,
    r1: 9.37e-3, r2: 1.961e-2, L: 0.44369, dma_Leff: 13.0,
    qa: 0.3 / 60000, qsh: 3.0 / 60000,
    V1: 10, V2: 9500, t_scan: 60, t_bin: 0.5,
    t_plumb: 1.0, cpc_tau: 0.6, cpc_d50: 7e-9, cpc_d0: 3e-9,
    max_charge: 6,
    kappa: 0.3, rh_src: 0.3, rh_inst: 0.3, chi: 1.0, dil: 1, segments: null,
  };
  // model ids per component
  const CURRENT = { slip: "kim2005", line_diff: "gk1949", line_settle: "thomas", line_bend: "pui1987", impactor: "stk50",
    charging: "w88", charges: "multiple", dma_tf: "stolzenburg1988", dma_loss: "gk_leff", scanning: "residence",
    cpc_eff: "exp_d50", cpc_response: "mixing", growth: "kappa", aps_conv: "stokes", aps_eff: "curve", shape: "chi" };
  const LEGACY = { slip: "davies1945", line_diff: "none", line_settle: "none", line_bend: "none", impactor: "none",
    charging: "w88", charges: "single", dma_tf: "triangle", dma_loss: "none", scanning: "steady",
    cpc_eff: "none", cpc_response: "fixed_delay", growth: "none", aps_conv: "none", aps_eff: "none", shape: "sphere" };

  function logspace(a, b, n) { const out = new Float64Array(n); for (let i = 0; i < n; i++) out[i] = Math.pow(10, a + (b - a) * i / (n - 1)); return out; }

  function Setup(params, custom) {
    const p = Object.assign({}, DEFAULT, params || {});
    custom = custom || {};
    const g = gas(p.T, p.P);
    const nd = 480, d = logspace(Math.log10(1e-9), Math.log10(20e-6), nd);
    const lnd = Array.from(d, Math.log), dlnd = new Float64Array(nd);
    for (let i = 0; i < nd; i++) dlnd[i] = i === 0 ? lnd[1] - lnd[0] : i === nd - 1 ? lnd[nd - 1] - lnd[nd - 2] : 0.5 * (lnd[i + 1] - lnd[i - 1]);
    const beta = p.qa / p.qsh;
    const tres = Math.PI * (p.r2 * p.r2 - p.r1 * p.r1) * p.L / (p.qsh + p.qa);
    const tauS = p.t_scan / Math.log(p.V2 / p.V1);
    const dt = 0.05;
    const tShift = p.t_plumb + p.cpc_tau + 0.5 * tres;   // the delay a user would calibrate
    const nbins = Math.round((p.t_scan + tShift) / p.t_bin);
    const t0 = -(tres + p.t_plumb + 8 * p.cpc_tau + 2), tEnd = nbins * p.t_bin;
    const tEx = []; for (let t = t0; t <= tEnd + 1e-9; t += dt) tEx.push(t);
    const S = { p, g, d, lnd, dlnd, nd, beta, tres, tauS, dt, tShift, nbins, tEx };

    S.V = (t) => p.V1 * Math.exp(clamp(t, 0, p.t_scan) / tauS);
    S.Zstar = (V) => p.qsh * Math.log(p.r2 / p.r1) / (2 * Math.PI * p.L * V);
    S.Vbar = (t) => { let s = 0; for (let i = 0; i <= 40; i++) s += S.V(t - tres * i / 40); return s / 41; };

    S.timeMap = (delay, tau) => {
      let w;
      if (tau > 0) { const nl = Math.ceil(8 * tau / dt) + 1; w = []; for (let m = 0; m < nl; m++) w.push(Math.exp(-m * dt / tau) - Math.exp(-(m + 1) * dt / tau)); }
      else w = [1];
      const qcc = p.qa * 1e6;
      const M = Array.from({ length: nbins }, () => new Float64Array(tEx.length));
      tEx.forEach((te, j) => {
        for (let m = 0; m < w.length; m++) {
          const tc = te + delay + m * dt, idx = Math.floor(tc / p.t_bin);
          if (tc >= 0 && idx < nbins) M[idx][j] += w[m] * qcc * dt;
        }
      });
      return M;
    };

    const chiOf = (cfg) => (cfg.shape === "chi" ? Math.max(1, p.chi || 1) : 1);
    // impactor: penetration on aerodynamic diameter; d50 either rated (aerodynamic) or from the jet Stokes number
    S.impactorCut = (cfg) => {
      if (cfg.impactor === "stk50") {
        const W = p.impactor_W, Q = p.impactor_Q || p.qa, U = 4 * Q / (Math.PI * W * W);
        const target = 9 * g.mu * W * 0.24 / (1000 * U);         // Stk50 = 0.24 for a round jet
        const sl = physics(g, cfg.slip).slip;
        let lo = Math.log(1e-8), hi = Math.log(1e-4);
        for (let i = 0; i < 60; i++) { const m = 0.5 * (lo + hi), x = Math.exp(m); if (x * x * sl(x) < target) lo = m; else hi = m; }
        return Math.exp(0.5 * (lo + hi));
      }
      return p.impactor_d50;
    };
    // tubing as a list of segments, each with its own length, diameter, flow, bends and RH
    S.segmentsFor = (Qdefault) => (Array.isArray(p.segments) && p.segments.length ? p.segments
      : [{ L: p.line_L, D: p.line_Dt, Q: Qdefault, bends: p.line_bends, rh: p.rh_src }]);
    S.linePen = (cfg, ph, dDry, segs) => {
      let v = 1;
      for (const sg of segs) {
        if (!(sg.L > 0)) continue;
        const w = wetState(cfg, p, dDry, sg.rh == null ? p.rh_src : sg.rh, g.T), dw = w.d, cc = ph.slip(dw);
        const Q = sg.Q, D = sg.D || 4.6e-3, U = Q / (Math.PI * D * D / 4);
        if (cfg.line_diff === "gk1949") v *= clamp(diffPen(ph.diffusivity(dw), sg.L, Q), 0, 1);
        if (cfg.line_settle === "thomas") v *= settlePen(w.rho * dw * dw * GRAV * cc / (18 * g.mu * ph.chi), sg.L, D, U);
        if (cfg.line_bend !== "none" && sg.bends > 0) v *= bendPen(cfg.line_bend, w.rho * dw * dw * cc * U / (9 * g.mu * D * ph.chi), sg.bends * Math.PI / 2);
      }
      if (cfg.line_diff && cfg.line_diff.startsWith("user:") && custom[cfg.line_diff]) v *= clamp(tableInterp(custom[cfg.line_diff], dDry * 1e9), 0, 1);
      return v;
    };
    S.penetration = (cfg) => {
      const ph = physics(g, cfg.slip, chiOf(cfg));
      const pen = new Float64Array(nd), dw = new Float64Array(nd), segs = S.segmentsFor(p.qa), impCut = S.impactorCut(cfg);
      for (let i = 0; i < nd; i++) {
        const di = d[i], w = wetState(cfg, p, di, p.rh_inst, g.T), dd = w.d, dnm = dd * 1e9;
        let v = S.linePen(cfg, ph, di, segs);
        if (cfg.impactor === "logistic" || cfg.impactor === "stk50") v *= 1 / (1 + Math.pow(aeroFromWet(ph, dd, w.rho, ph.chi) / impCut, p.impactor_slope));
        else if (cfg.impactor === "geometric") v *= 1 / (1 + Math.pow(dd / p.impactor_d50, p.impactor_slope));
        else if (cfg.impactor && cfg.impactor.startsWith("user:") && custom[cfg.impactor]) v *= clamp(tableInterp(custom[cfg.impactor], dnm), 0, 1);
        if (cfg.dma_loss === "gk_leff") v *= clamp(diffPen(ph.diffusivity(dd), p.dma_Leff, p.qa), 0, 1);
        if (cfg.cpc_eff === "exp_d50") v *= 1 - Math.exp(-Math.LN2 * Math.max((dd - p.cpc_d0) / (p.cpc_d50 - p.cpc_d0), 0));
        else if (cfg.cpc_eff && cfg.cpc_eff.startsWith("user:") && custom[cfg.cpc_eff]) v *= clamp(tableInterp(custom[cfg.cpc_eff], dnm), 0, 1);
        pen[i] = v; dw[i] = dd;
      }
      return { pen, ph, dw };
    };

    // F: nbins x nd matrix, counts per unit dN/dlnd (#/cm3); optional per-charge pieces
    S.operator = (cfg, perCharge) => {
      const { pen, ph, dw } = S.penetration(cfg);
      const Zs = tEx.map((t) => S.Zstar(cfg.scanning === "residence" ? S.Vbar(t) : S.V(t)));
      const kmax = cfg.charges === "multiple" ? p.max_charge : 1;
      const gam = Math.pow(p.r1 / p.r2, 2), I = 0.5 * (1 + gam), kap = p.L * p.r2 / (p.r2 * p.r2 - p.r1 * p.r1);
      const Gf = 4 * Math.pow(1 + beta, 2) / (1 - gam) * (I + Math.pow(2 * (1 + beta) * kap, -2));
      const M = cfg.cpc_response === "mixing" ? S.timeMap(p.t_plumb, p.cpc_tau) : S.timeMap(tShift, 0);
      const parts = [];
      for (let k = 1; k <= kmax; k++) {
        const R = Array.from({ length: tEx.length }, () => new Float64Array(nd));
        for (let i = 0; i < nd; i++) {
          const fk = chargeFraction(cfg.charging, dw[i], k, g.T, custom) * pen[i] * dlnd[i];
          if (!(fk > 1e-14)) continue;
          const Zk = ph.mobility(dw[i], k);
          const sig = cfg.dma_tf === "stolzenburg1988" ? Math.sqrt(Gf * 2 * Math.PI * p.L * ph.diffusivity(dw[i]) / p.qsh) : null;
          const reach = beta + (sig ? 6 * sig : 0);
          for (let j = 0; j < tEx.length; j++) {
            const Zt = Zk / Zs[j];
            if (Math.abs(Zt - 1) < reach) R[j][i] = transfer(Zt, beta, sig) * fk;
          }
        }
        parts.push(matmul(M, R));
      }
      const F = parts.reduce((a, b) => addM(a, b));
      return perCharge ? { F, parts } : { F };
    };

    S.inversionGrid = (m = 64, cfg) => {
      const ph = physics(g, "kim2005", cfg ? chiOf(cfg) : 1);
      let dlo = ph.dFromMobility(S.Zstar(p.V1), 1), dhi = ph.dFromMobility(S.Zstar(p.V2), 1);
      if (cfg && cfg.growth === "kappa") { dlo /= growthFactor(dlo, p.kappa, p.rh_inst, g.T); dhi /= growthFactor(dhi, p.kappa, p.rh_inst, g.T); }
      return logspace(Math.log10(dlo), Math.log10(dhi), m);
    };
    S.hat = (dj) => {
      const m = dj.length, xj = Array.from(dj, Math.log);
      const H = Array.from({ length: nd }, () => new Float64Array(m));
      for (let i = 0; i < nd; i++) {
        const x = lnd[i]; if (x < xj[0] || x > xj[m - 1]) continue;
        let j = 0; while (j < m - 2 && x > xj[j + 1]) j++;
        const f = (x - xj[j]) / (xj[j + 1] - xj[j]); H[i][j] = 1 - f; H[i][j + 1] = f;
      }
      return H;
    };
    S.invert = (counts, cfg, m = 64) => {
      const dj = S.inversionGrid(m, cfg);
      const A = matmul(S.operator(cfg).F, S.hat(dj));
      const n = A.length;
      // Weighted, smoothed NNLS. Weights start from the counts and are then recomputed from the
      // fitted counts (Pearson weighting), which avoids the low bias of weighting by noisy counts.
      let wsrc = Array.from(counts), x = null, lam = null;
      for (let pass = 0; pass < 3; pass++) {
        const w = wsrc.map((c) => 1 / Math.sqrt(Math.max(c, 1)));
        const Aw = A.map((row, i) => row.map((v) => v * w[i]));
        const yw = Array.from(counts, (c, i) => c * w[i]);
        if (lam == null) lam = 3e-2 * specNorm(Aw);
        const AtA = Array.from({ length: m }, () => new Float64Array(m)), Atb = new Float64Array(m);
        for (let i = 0; i < n; i++) for (let a = 0; a < m; a++) {
          const va = Aw[i][a]; if (va === 0) continue;
          Atb[a] += va * yw[i];
          for (let b = 0; b < m; b++) AtA[a][b] += va * Aw[i][b];
        }
        for (let r = 0; r < m - 2; r++) { const idx = [r, r + 1, r + 2], c = [1, -2, 1];
          for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) AtA[idx[a]][idx[b]] += lam * lam * c[a] * c[b]; }
        x = nnlsNormal(AtA, Atb);
        wsrc = matvec(A, x);
      }
      return { dj: Array.from(dj), x: Array.from(x), fit: wsrc };
    };

    // ---- APS (time-of-flight aerodynamic sizing; Stokes-regime conversion) ----
    const RHO0 = 1000;
    const apsEdges = Array.from({ length: 52 }, (_, k) => 0.523e-6 * Math.pow(10, k / 32));
    const aeroFromWet = (ph, dw, rho, chi) => { // solve da^2 Cc(da) = rho/(rho0 chi) dw^2 Cc(dw)
      const T = rho / (RHO0 * chi) * dw * dw * ph.slip(dw);
      let lo = Math.log(dw) - 3, hi = Math.log(dw) + 3;
      for (let i = 0; i < 60; i++) { const m = 0.5 * (lo + hi), x = Math.exp(m); if (x * x * ph.slip(x) < T) lo = m; else hi = m; }
      return Math.exp(0.5 * (lo + hi));
    };
    const apsEff = (a, da) => 1 / (1 + Math.pow(a.d50lo / da, 6)) / (1 + Math.pow(da / a.cut, 6));
    S.apsForward = (cfg, a) => {
      const ph = physics(g, cfg.slip, chiOf(cfg)), segs = a.segments && a.segments.length ? a.segments : S.segmentsFor(a.Q);
      const nc = apsEdges.length - 1, lne = apsEdges.map(Math.log), sig = Math.log(Math.max(a.res, 1.001));
      const rows = Array.from({ length: nc }, () => new Float64Array(nd));
      const qcc = a.Q * 1e6;
      for (let i = 0; i < nd; i++) {
        if (d[i] < 0.15e-6) continue;
        const w = wetState(cfg, p, d[i], a.rh, g.T);
        const da = aeroFromWet(ph, w.d, w.rho, ph.chi);
        const wgt = S.linePen(cfg, ph, d[i], segs) * apsEff(a, da) * dlnd[i] * qcc * a.t;
        if (!(wgt > 1e-14)) continue;
        const x = Math.log(da);
        for (let c = 0; c < nc; c++) {
          const pr = 0.5 * (erf((lne[c + 1] - x) / (Math.SQRT2 * sig)) - erf((lne[c] - x) / (Math.SQRT2 * sig)));
          if (pr > 1e-9) rows[c][i] = pr * wgt;
        }
      }
      return rows;
    };
    S.apsInvert = (counts, cfg, a) => {
      const ph = physics(g, cfg.slip, chiOf(cfg)), segs = a.segments && a.segments.length ? a.segments : S.segmentsFor(a.Q);
      const toDry = (da) => {
        if (cfg.aps_conv !== "stokes") return da;           // report aerodynamic size as if it were the particle size
        let dDry = da / Math.sqrt(p.rho / RHO0);
        for (let it = 0; it < 30; it++) {                      // fixed point on dry diameter
          const w = wetState(cfg, p, dDry, a.rh, g.T);
          const daGuess = aeroFromWet(ph, w.d, w.rho, ph.chi);
          dDry *= da / daGuess;
        }
        return dDry;
      };
      const out = { d: [], y: [], da: [] };
      for (let c = 0; c < counts.length; c++) {
        const lo = apsEdges[c], hi = apsEdges[c + 1], dac = Math.sqrt(lo * hi);
        const eff = cfg.aps_eff === "curve" ? apsEff(a, dac) : 1;
        const dl = toDry(lo), dh = toDry(hi), dc = Math.sqrt(dl * dh);
        const pen = S.linePen(cfg, ph, dc, segs);
        if (eff < 0.05 || pen < 0.05) continue;
        out.d.push(dc); out.da.push(dac);
        out.y.push(counts[c] / (a.Q * 1e6 * a.t * eff * pen * Math.log(dh / dl)));
      }
      return out;
    };
    S.apsEdges = apsEdges;

    // ---- probe: the aerosol at any point of the setup ----
    // pr = { segments, rh, dil, impactor, neutralized, dmaV (volts or null), cpc, dmaLoss }
    S.probe = (cfg, n, pr) => {
      const ph = physics(g, cfg.slip, chiOf(cfg)), segs = pr.segments || [];
      const cut = pr.impactor && cfg.impactor !== "none" ? S.impactorCut(cfg) : null;
      const kmax = cfg.charges === "multiple" ? p.max_charge : 1;
      const gam = Math.pow(p.r1 / p.r2, 2), I = 0.5 * (1 + gam), kap = p.L * p.r2 / (p.r2 * p.r2 - p.r1 * p.r1);
      const Gf = 4 * Math.pow(1 + beta, 2) / (1 - gam) * (I + Math.pow(2 * (1 + beta) * kap, -2));
      const Zs = pr.dmaV ? S.Zstar(pr.dmaV) : null;
      const dil = Math.max(1, pr.dil || 1);
      const x = new Float64Array(nd), pen = new Float64Array(nd), here = new Float64Array(nd), single = new Float64Array(nd);
      for (let i = 0; i < nd; i++) {
        const w = wetState(cfg, p, d[i], pr.rh, g.T); x[i] = w.d;
        let v = S.linePen(cfg, ph, d[i], segs);
        if (cut) v *= cfg.impactor === "geometric" ? 1 / (1 + Math.pow(w.d / p.impactor_d50, p.impactor_slope)) : 1 / (1 + Math.pow(aeroFromWet(ph, w.d, w.rho, ph.chi) / cut, p.impactor_slope));
        if (pr.factor) v *= pr.factor[i];
        if (Zs) {
          if (pr.dmaLoss && cfg.dma_loss === "gk_leff") v *= clamp(diffPen(ph.diffusivity(w.d), p.dma_Leff, p.qa), 0, 1);
          const sig = cfg.dma_tf === "stolzenburg1988" ? Math.sqrt(Gf * 2 * Math.PI * p.L * ph.diffusivity(w.d) / p.qsh) : null;
          let tot = 0, one = 0;
          for (let k = 1; k <= kmax; k++) {
            const Zt = ph.mobility(w.d, k) / Zs;
            const om = Math.abs(Zt - 1) < beta + (sig ? 6 * sig : 0) ? transfer(Zt, beta, sig) : 0;
            const c = chargeFraction(cfg.charging, w.d, k, g.T, custom) * om;
            tot += c; if (k === 1) one = c;
          }
          single[i] = v * one; v *= tot;
        }
        if (pr.cpc && cfg.cpc_eff === "exp_d50") { const e = 1 - Math.exp(-Math.LN2 * Math.max((w.d - p.cpc_d0) / (p.cpc_d50 - p.cpc_d0), 0)); v *= e; single[i] *= e; }
        pen[i] = v; here[i] = n[i] * v / dil; single[i] = n[i] * single[i] / dil;
      }
      // re-express per log interval of the size at this point's humidity
      const jac = (i) => { const a = Math.max(0, i - 1), b = Math.min(nd - 1, i + 1); const r = Math.log(x[b] / x[a]) / Math.log(d[b] / d[a]); return r > 0 ? r : 1; };
      const integ = (arr, lo, hi) => { let t = 0; for (let i = 0; i < nd; i++) if (x[i] >= lo && x[i] <= hi) t += arr[i] * dlnd[i]; return t; };
      const out = {
        x: Array.from(x), d: Array.from(d), pen: Array.from(pen),
        here: Array.from(here, (v, i) => v / jac(i)), single: Zs ? Array.from(single, (v, i) => v / jac(i)) : null,
        src: Array.from(n),
        Nsrc: integ(n, 0, 1), Nhere: integ(here, 0, 1), cut, cutGeo: cut ? S.geometricCut(cfg) : null,
        gf100: growthFactor(100e-9, cfg.growth === "kappa" ? p.kappa : 0, pr.rh, g.T),
      };
      if (Zs) {
        const k1 = ph.dFromMobility(Zs, 1), k2 = kmax >= 2 ? ph.dFromMobility(Zs, 2) : null, k3 = kmax >= 3 ? ph.dFromMobility(Zs, 3) : null;
        out.dma = { V: pr.dmaV, d1: k1, d2: k2, d3: k3, N: out.Nhere, Nsingle: integ(single, 0, 1) };
      }
      if (pr.neutralized) {
        out.charges = [20e-9, 50e-9, 100e-9, 300e-9, 1000e-9].map((dd) => {
          const f = [1, 2, 3].map((k) => chargeFraction(cfg.charging, dd, k, g.T, custom));
          return { d: dd, f0: chargeFraction("w88", dd, 0, g.T, custom), f1: f[0], f2: f[1], f3: f[2] };
        });
      }
      return out;
    };
    // geometric (dry, volume-equivalent) size at which the truth impactor removes half the particles
    S.geometricCut = (cfg) => {
      const ph = physics(g, cfg.slip, chiOf(cfg)), cut = S.impactorCut(cfg);
      if (cfg.impactor === "geometric") return cut;
      let lo = Math.log(1e-8), hi = Math.log(1e-4);
      for (let i = 0; i < 60; i++) { const m = 0.5 * (lo + hi), w = wetState(cfg, p, Math.exp(m), p.rh_inst, g.T); if (aeroFromWet(ph, w.d, w.rho, ph.chi) < cut) lo = m; else hi = m; }
      return Math.exp(0.5 * (lo + hi));
    };
    // ---- transfer function of a single block, as a function of dry particle diameter ----
    // spec.kind: tube | impactor | dryer | neutralizer | dma | cpc | aps | diluter
    S.blockCurves = (cfg, spec) => {
      const ph = physics(g, cfg.slip, chiOf(cfg)), x = Array.from(d, (v) => v * 1e9);
      const out = { x, series: [], yLabel: "Transmission (fraction)", yMax: 1.05, notes: [] };
      const each = (f) => Array.from(d, f);
      const rh = spec.rh == null ? p.rh_inst : spec.rh;
      const wet = (di, r) => wetState(cfg, p, di, r == null ? rh : r, g.T);
      if (spec.kind === "tube" || spec.kind === "dryer") {
        const L = spec.kind === "dryer" ? spec.L : spec.L, D = spec.D || 4.6e-3, Q = spec.Q || p.qa, U = Q / (Math.PI * D * D / 4);
        const rhT = spec.kind === "dryer" ? spec.rhOut : rh;
        const dif = each((di) => { const w = wet(di, rhT); return cfg.line_diff === "gk1949" ? clamp(diffPen(ph.diffusivity(w.d), L, Q), 0, 1) : 1; });
        const set = each((di) => { const w = wet(di, rhT); return cfg.line_settle === "thomas" ? settlePen(w.rho * w.d * w.d * GRAV * ph.slip(w.d) / (18 * g.mu * ph.chi), L, D, U) : 1; });
        const bnd = each((di) => { const w = wet(di, rhT); return cfg.line_bend !== "none" && spec.bends > 0 ? bendPen(cfg.line_bend, w.rho * w.d * w.d * ph.slip(w.d) * U / (9 * g.mu * D * ph.chi), spec.bends * Math.PI / 2) : 1; });
        out.series.push({ name: "Total", y: dif.map((v, i) => v * set[i] * bnd[i]), main: true },
          { name: "Diffusion", y: dif }, { name: "Settling", y: set });
        if (spec.bends > 0) out.series.push({ name: "Bends", y: bnd });
        out.notes.push(`L = ${(+L).toFixed(2)} m, inner diameter ${(D * 1e3).toFixed(2)} mm, flow ${(Q * 60000).toFixed(2)} L/min${spec.bends ? `, ${spec.bends} × 90° bends` : ""}, RH ${Math.round(rhT * 100)}%.`);
        if (spec.kind === "dryer") {
          out.growth = { name: "Growth factor", yIn: each((di) => wet(di, spec.rhIn).gf), yOut: each((di) => wet(di, spec.rhOut).gf), rhIn: spec.rhIn, rhOut: spec.rhOut };
          out.notes.push(`Particles enter at ${Math.round(spec.rhIn * 100)}% RH and leave at ${Math.round(spec.rhOut * 100)}% RH (κ = ${p.kappa}).`);
        }
      } else if (spec.kind === "impactor") {
        const cut = cfg.impactor === "none" ? null : S.impactorCut(cfg);
        if (!cut) { out.notes.push("The selected Truth model ignores the impactor."); out.series.push({ name: "Penetration", y: each(() => 1), main: true }); }
        else {
          out.series.push({ name: "Penetration", main: true, y: each((di) => { const w = wet(di); const dd = cfg.impactor === "geometric" ? w.d : aeroFromWet(ph, w.d, w.rho, ph.chi); return 1 / (1 + Math.pow(dd / cut, p.impactor_slope)); }) });
          out.series.push({ name: "Against aerodynamic diameter", y: each((di) => 1 / (1 + Math.pow(di / cut, p.impactor_slope))) });
          out.notes.push(`Cut ${Math.round(cut * 1e9)} nm aerodynamic = ${Math.round(S.geometricCut(cfg) * 1e9)} nm particle size at density ${p.rho} kg/m³, χ ${chiOf(cfg)}, RH ${Math.round(rh * 100)}%. The dashed curve uses aerodynamic diameter on the x axis.`);
        }
      } else if (spec.kind === "neutralizer") {
        out.yLabel = "Fraction of particles";
        const ks = [0, 1, 2, 3];
        ks.forEach((k) => out.series.push({ name: k === 0 ? "Neutral" : `+${k}`, main: k === 1, y: each((di) => { const w = wet(di); return k === 2 && cfg.charges === "single" ? 0 : chargeFraction(k === 0 ? "w88" : cfg.charging, w.d, k, g.T, custom); }) }));
        out.notes.push("Positive charge states; the negative side is similar. Multiple charges are only counted when the Multiple charging model is on.");
      } else if (spec.kind === "dma") {
        const V = spec.V, Zs = S.Zstar(V), kmax = cfg.charges === "multiple" ? p.max_charge : 1;
        const gam = Math.pow(p.r1 / p.r2, 2), I = 0.5 * (1 + gam), kap = p.L * p.r2 / (p.r2 * p.r2 - p.r1 * p.r1);
        const Gf = 4 * Math.pow(1 + beta, 2) / (1 - gam) * (I + Math.pow(2 * (1 + beta) * kap, -2));
        const om = (w, k) => { const sig = cfg.dma_tf === "stolzenburg1988" ? Math.sqrt(Gf * 2 * Math.PI * p.L * ph.diffusivity(w.d) / p.qsh) : null; const Zt = ph.mobility(w.d, k) / Zs; return Math.abs(Zt - 1) < beta + (sig ? 6 * sig : 0) ? transfer(Zt, beta, sig) : 0; };
        const loss = (w) => cfg.dma_loss === "gk_leff" ? clamp(diffPen(ph.diffusivity(w.d), p.dma_Leff, p.qa), 0, 1) : 1;
        out.yLabel = "Fraction transmitted";
        out.series.push({ name: "Transfer function Ω (+1)", main: true, y: each((di) => om(wet(di), 1)) });
        out.series.push({ name: "With charging and losses, all charges", y: each((di) => { const w = wet(di); let t = 0; for (let k = 1; k <= kmax; k++) t += chargeFraction(cfg.charging, w.d, k, g.T, custom) * om(w, k); return t * loss(w); }) });
        const d1 = ph.dFromMobility(Zs, 1);
        out.notes.push(`At ${V < 100 ? V.toFixed(1) : Math.round(V)} V the DMA selects ${Math.round(d1 * 1e9)} nm singly charged particles (β = ${beta.toFixed(2)}, ${cfg.dma_tf === "stolzenburg1988" ? "diffusing" : "triangular"} transfer function). Peaks at larger sizes in the second curve are multiply charged particles.`);
      } else if (spec.kind === "cpc") {
        out.yLabel = "Counting efficiency";
        out.series.push({ name: "Counting efficiency", main: true, y: each((di) => { const w = wet(di); return cfg.cpc_eff === "exp_d50" ? 1 - Math.exp(-Math.LN2 * Math.max((w.d - p.cpc_d0) / (p.cpc_d50 - p.cpc_d0), 0)) : cfg.cpc_eff && cfg.cpc_eff.startsWith("user:") && custom[cfg.cpc_eff] ? clamp(tableInterp(custom[cfg.cpc_eff], w.d * 1e9), 0, 1) : 1; }) });
        out.notes.push(`d50 ${(p.cpc_d50 * 1e9).toFixed(1)} nm, no counts below ${(p.cpc_d0 * 1e9).toFixed(1)} nm. Mixing time ${p.cpc_tau} s smears the signal in time; that is not shown here.`);
      } else if (spec.kind === "aps") {
        const a = spec;
        out.yLabel = "Counting efficiency";
        out.series.push({ name: "Against particle size", main: true, y: each((di) => { const w = wet(di, a.rh); return di < 0.15e-6 ? 0 : apsEff(a, aeroFromWet(ph, w.d, w.rho, ph.chi)); }) });
        out.series.push({ name: "Against aerodynamic diameter", y: each((di) => apsEff(a, di)) });
        const dpOfDa = (da) => { let lo = Math.log(1e-8), hi = Math.log(1e-4); for (let i = 0; i < 60; i++) { const m = 0.5 * (lo + hi), w = wet(Math.exp(m), a.rh); if (aeroFromWet(ph, w.d, w.rho, ph.chi) < da) lo = m; else hi = m; } return Math.exp(0.5 * (lo + hi)); };
        out.notes.push(`1 µm aerodynamic corresponds to ${(dpOfDa(1e-6) * 1e6).toFixed(2)} µm dry particles at density ${p.rho} kg/m³, χ ${chiOf(cfg)}. Lower detection d50 ${(a.d50lo * 1e6).toFixed(2)} µm, inlet cut ${(a.cut * 1e6).toFixed(0)} µm.`);
      } else if (spec.kind === "diluter") {
        out.yLabel = "Concentration ratio";
        out.yMax = 1.05;
        out.series.push({ name: "Output / input", main: true, y: each(() => 1 / Math.max(1, spec.factor || 1)) });
        out.notes.push(`Dilution by ${spec.factor}× lowers all sizes equally in this model; diluter losses are not yet modeled.`);
      }
      return out;
    };

    return S;
  }

  function transfer(Zt, beta, sigma) {
    if (sigma == null) return clamp(1 - Math.abs(Zt - 1) / beta, 0, 1);
    const s2 = Math.SQRT2 * sigma;
    return sigma / (Math.SQRT2 * beta) * (epsF((Zt - (1 + beta)) / s2) + epsF((Zt - (1 - beta)) / s2) - 2 * epsF((Zt - 1) / s2));
  }
  function matmul(A, B) {
    const n = A.length, k = B.length, m = B[0].length;
    const C = Array.from({ length: n }, () => new Float64Array(m));
    for (let i = 0; i < n; i++) { const Ai = A[i], Ci = C[i];
      for (let t = 0; t < k; t++) { const a = Ai[t]; if (a === 0) continue; const Bt = B[t]; for (let j = 0; j < m; j++) Ci[j] += a * Bt[j]; } }
    return C;
  }
  const addM = (A, B) => A.map((r, i) => r.map((v, j) => v + B[i][j]));
  const matvec = (A, x) => A.map((r) => { let s = 0; for (let j = 0; j < r.length; j++) s += r[j] * x[j]; return s; });
  function specNorm(A) {
    const m = A[0].length; let v = new Float64Array(m).fill(1 / Math.sqrt(m)), s = 0;
    for (let it = 0; it < 60; it++) {
      const u = matvec(A, v), w = new Float64Array(m);
      for (let i = 0; i < A.length; i++) for (let j = 0; j < m; j++) w[j] += A[i][j] * u[i];
      let nw = 0; for (let j = 0; j < m; j++) nw += w[j] * w[j]; nw = Math.sqrt(nw);
      if (!nw) return 0; s = Math.sqrt(nw); v = w.map((x) => x / nw);
    }
    return s;
  }
  function cholSolve(M, b) {
    const n = b.length, L = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
      let s = M[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) L[i][i] = Math.sqrt(Math.max(s, 1e-300)); else L[i][j] = s / L[j][j];
    }
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s / L[i][i]; }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
    return x;
  }
  // Lawson–Hanson active-set NNLS on the normal equations: min ½x'Qx − c'x, x ≥ 0
  function nnlsNormal(Q, c) {
    const n = c.length; let cmax = 0; for (const v of c) cmax = Math.max(cmax, Math.abs(v));
    const tol = 1e-10 * Math.max(cmax, 1);
    const x = new Float64Array(n), P = new Array(n).fill(false);
    const solveP = () => {
      const idx = []; for (let i = 0; i < n; i++) if (P[i]) idx.push(i);
      const zs = cholSolve(idx.map((i) => idx.map((j) => Q[i][j])), idx.map((i) => c[i]));
      const z = new Float64Array(n); idx.forEach((i, k) => { z[i] = zs[k]; }); return { z, idx };
    };
    for (let outer = 0; outer < 3 * n; outer++) {
      let t = -1, best = tol;
      for (let i = 0; i < n; i++) { if (P[i]) continue; let wv = c[i]; for (let j = 0; j < n; j++) wv -= Q[i][j] * x[j]; if (wv > best) { best = wv; t = i; } }
      if (t < 0) break;
      P[t] = true;
      for (let inner = 0; inner < 3 * n; inner++) {
        const { z, idx } = solveP();
        if (idx.every((i) => z[i] > 0)) { for (let i = 0; i < n; i++) x[i] = P[i] ? z[i] : 0; break; }
        let alpha = Infinity;
        idx.forEach((i) => { if (z[i] <= 0) alpha = Math.min(alpha, x[i] / (x[i] - z[i])); });
        for (let i = 0; i < n; i++) { x[i] += alpha * ((P[i] ? z[i] : 0) - x[i]); if (P[i] && x[i] <= 1e-12) { P[i] = false; x[i] = 0; } }
      }
    }
    return x;
  }

  function lognormal(d, modes) {
    return Array.from(d, (di) => modes.reduce((s, [N, gmd, gsd]) =>
      s + N / (Math.sqrt(2 * Math.PI) * Math.log(gsd)) * Math.exp(-Math.pow(Math.log(di / gmd), 2) / (2 * Math.pow(Math.log(gsd), 2))), 0));
  }
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function poisson(lam, rnd) {
    if (lam < 30) { const L = Math.exp(-lam); let k = 0, q = 1; do { k++; q *= rnd(); } while (q > L); return k - 1; }
    const z = Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
    return Math.max(0, Math.round(lam + Math.sqrt(lam) * z));
  }

  // Full experiment: simulate counts with the truth configuration, invert with two chosen configurations.
  function run(job) {
    const S = Setup(job.params, job.custom);
    const nTrue = lognormal(S.d, job.modes);
    const dil = Math.max(1, job.params.dil || 1);
    const { F, parts } = S.operator(job.truth, true);
    const mean = matvec(F, nTrue).map((v) => v / dil);
    const single = matvec(parts[0], nTrue).map((v) => v / dil);
    const rnd = mulberry32(job.seed || 1);
    const counts = job.noise ? mean.map((m) => poisson(m, rnd)) : mean.slice();
    const scale = (inv) => { inv.x = inv.x.map((v) => v * dil); inv.fit = inv.fit.map((v) => v / dil); return inv; };
    const invA = scale(S.invert(counts, job.cfgA));
    const invB = scale(S.invert(counts, job.cfgB));
    const tBins = Array.from({ length: S.nbins }, (_, i) => (i + 0.5) * S.p.t_bin);
    let aps = null;
    if (job.aps) {
      const a = job.aps, adil = Math.max(1, a.dil || 1);
      const rows = S.apsForward(job.truth, a);
      const amean = matvec(rows, nTrue).map((v) => v / adil);
      const acounts = job.noise ? amean.map((m) => poisson(m, rnd)) : amean.slice();
      const sc = (o) => { o.y = o.y.map((v) => v * adil); return o; };
      aps = { edges: S.apsEdges, counts: acounts, mean: amean, A: sc(S.apsInvert(acounts, job.cfgA, a)), B: sc(S.apsInvert(acounts, job.cfgB, a)) };
    }
    return {
      d: Array.from(S.d), nTrue, tBins, counts, mean, single,
      invA, invB, aps,
      info: { tres: S.tres, tShift: S.tShift, nbins: S.nbins, dRange: [S.inversionGrid(2, job.cfgB)[0], S.inversionGrid(2, job.cfgB)[1]],
        impCut: (job.truth.impactor === "none") ? null : S.impactorCut(job.truth), impCutGeo: (job.truth.impactor === "none") ? null : S.geometricCut(job.truth),
        gfInst: growthFactor(100e-9, S.p.kappa, S.p.rh_inst, S.g.T) },
    };
  }

  function blockResponse(job) {
    const S = Setup(job.params, job.custom);
    return S.blockCurves(job.truth, job.block);
  }
  function probe(job) {
    const S = Setup(job.params, job.custom);
    return S.probe(job.truth, lognormal(S.d, job.modes), job.probe);
  }

  const api = { Setup, run, probe, blockResponse, lognormal, CURRENT, LEGACY, DEFAULT, chargeFraction, gas, physics, tableInterp, growthFactor };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.STREAM = api;
})(typeof self !== "undefined" ? self : this);
