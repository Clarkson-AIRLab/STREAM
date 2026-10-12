(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const UI = window.StreamUI;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const NS = "http://www.w3.org/2000/svg";
  const NW = 136, NH = 46, VW = 960, VH = 420;

  // ------------------------------------------------------------ component catalog
  // sim: "yes" = modeled; "pass" = on the path, transmitted unchanged for now; "no" = not simulated yet
  const P = (key, label, unit, def, kind) => ({ key, label, unit, def, kind: kind || "num" });
  const TYPES = {
    source: { label: "Aerosol source", sim: "yes", params: [P("rh_pct", "Relative humidity", "%", 30)] },
    impactor: { label: "Impactor", sim: "yes", params: [P("nozzle_mm", "Nozzle ⌀", "mm", 0.508), P("d50_nm", "Rated d50 (aero.)", "nm", 700), P("steepness", "Steepness", "", 8)] },
    cyclone: { label: "Cyclone", sim: "yes", params: [P("d50_nm", "d50", "nm", 1000), P("steepness", "Steepness", "", 4)] },
    neutralizer: { label: "Neutralizer", sim: "yes", params: [P("charges", "Charges tracked", "", 6), P("kind", "Source", "", "Radioactive", "text")] },
    dma: { label: "DMA", sim: "yes", params: [P("column", "Column", "", "long", "column"), P("sheath_lpm", "Sheath", "L/min", 3), P("aerosol_lpm", "Aerosol", "L/min", 0.3),
      P("v_start", "Voltage start", "V", 10), P("v_end", "Voltage end", "V", 9500), P("scan_s", "Up-scan", "s", 60), P("bin_s", "Count bin", "s", 0.5), P("loss_m", "Loss length", "m", 13)] },
    cpc: { label: "CPC", sim: "yes", params: [P("d50_nm", "d50", "nm", 7), P("d0_nm", "Cutoff d0", "nm", 3), P("tau_s", "Mixing time", "s", 0.6)] },
    diluter: { label: "Diluter", sim: "yes", params: [P("factor", "Dilution factor", "×", 10)] },
    dryer: { label: "Dryer", sim: "yes", params: [P("rh_out_pct", "Outlet RH", "%", 15), P("length_m", "Length", "m", 0.3), P("id_mm", "Flow path ⌀", "mm", 10)] },
    humidifier: { label: "Humidifier", sim: "pass", params: [] },
    mixing_chamber: { label: "Mixing chamber", sim: "pass", params: [] },
    splitter: { label: "Flow splitter", sim: "pass", params: [] },
    valve: { label: "Valve", sim: "pass", params: [] },
    opc: { label: "OPC", sim: "no", params: [] },
    aps: { label: "APS", sim: "yes", params: [P("flow_lpm", "Sample flow", "L/min", 1), P("sample_s", "Sample time", "s", 20), P("d50_lo_um", "Lower d50", "µm", 0.6), P("cut_um", "Inlet cut", "µm", 15), P("res", "Resolution σg", "", 1.05)] },
    electrometer: { label: "Electrometer", sim: "no", params: [] },
    filter: { label: "Filter", sim: "no", params: [] },
    pump: { label: "Pump", sim: "no", params: [] },
    mfc: { label: "Flow controller", sim: "no", params: [] },
    other: { label: "Other", sim: "no", params: [] },
  };
  const defaults = (type) => Object.fromEntries((TYPES[type] || TYPES.other).params.map((p) => [p.key, p.def]));

  // ------------------------------------------------------------ templates
  let uid = 0; const nid = () => "n" + (++uid) + Math.random().toString(36).slice(2, 5);
  function mk(type, label, x, y, params) { return { id: nid(), type, label: label || TYPES[type].label, x, y, params: Object.assign(defaults(type), params || {}) }; }
  function ed(a, b, o) { return Object.assign({ id: nid(), from: a.id, to: b.id, length_m: null, id_mm: null, bends: null, flow_lpm: null }, o || {}); }
  const TEMPLATES = [
    { key: "smps", name: "SMPS, long DMA", desc: "Generator line, impactor, neutralizer, long-column DMA and CPC. The default setup.", build() {
      const s = mk("source", "Aerosol source", 90, 200), i = mk("impactor", null, 270, 200), n = mk("neutralizer", null, 450, 200), d = mk("dma", "DMA (long)", 630, 200), c = mk("cpc", null, 830, 200);
      return { nodes: [s, i, n, d, c], edges: [ed(s, i, { length_m: 2, id_mm: 4.6, bends: 2 }), ed(i, n), ed(n, d), ed(d, c, { length_m: 0.3, id_mm: 4.6 })] }; } },
    { key: "nano", name: "Nano SMPS", desc: "Short line, nano DMA at 15/1.5 L/min and a 2.5 nm CPC for sub-50 nm particles.", aerosol: [[8000, 15e-9, 1.5], [2000, 40e-9, 1.5], [0, 1.5e-6, 1.8]], build() {
      const s = mk("source", "Aerosol source", 120, 200), n = mk("neutralizer", null, 350, 200), d = mk("dma", "DMA (nano)", 580, 200, { column: "nano", sheath_lpm: 15, aerosol_lpm: 1.5, v_start: 10, v_end: 9500, loss_m: 3.6 }), c = mk("cpc", "CPC (2.5 nm)", 810, 200, { d50_nm: 2.5, d0_nm: 1.5, tau_s: 0.3 });
      return { nodes: [s, n, d, c], edges: [ed(s, n, { length_m: 0.5, id_mm: 4.6, bends: 1 }), ed(n, d), ed(d, c, { length_m: 0.3, id_mm: 4.6 })] }; } },
    { key: "fast", name: "Fast-scanning SMPS", desc: "Same train as the default with a 10 s up-scan, where scanning and CPC smearing matter most.", build() {
      const g = TEMPLATES[0].build(); g.nodes.find((x) => x.type === "dma").params.scan_s = 10; g.nodes.find((x) => x.type === "dma").params.bin_s = 0.1; g.nodes.find((x) => x.type === "dma").label = "DMA (fast scan)"; return g; } },
    { key: "ambient", name: "Ambient inlet, SMPS + APS + OPC", desc: "5 m humid inlet at 5 L/min split three ways: APS, OPC, and a dried SMPS branch.", aerosol: [[3000, 40e-9, 1.6], [1500, 150e-9, 1.5], [10, 2e-6, 1.8]], build() {
      const s = mk("source", "Ambient air", 80, 210, { rh_pct: 70 }), sp = mk("splitter", null, 250, 210), o = mk("opc", null, 430, 60), ap = mk("aps", null, 430, 150), dr = mk("dryer", null, 430, 270), i = mk("impactor", null, 600, 270),
        n = mk("neutralizer", null, 600, 370), d = mk("dma", "DMA (long)", 790, 370), c = mk("cpc", null, 790, 270);
      return { nodes: [s, sp, o, ap, dr, i, n, d, c], edges: [ed(s, sp, { length_m: 5, id_mm: 9.5, bends: 3, flow_lpm: 5 }), ed(sp, o, { length_m: 0.5, id_mm: 4.6, flow_lpm: 2.7 }), ed(sp, ap, { length_m: 0.4, id_mm: 9.5 }),
        ed(sp, dr, { length_m: 0.5, id_mm: 4.6 }), ed(dr, i, { length_m: 0.3, id_mm: 4.6 }), ed(i, n), ed(n, d), ed(d, c, { length_m: 0.3, id_mm: 4.6 })] }; } },
    { key: "neutapps", name: "One neutralizer, SMPS + APS", desc: "Humid aerosol dried, neutralized once, then fed to both a DMA–CPC and an APS.", aerosol: [[3000, 40e-9, 1.6], [1500, 150e-9, 1.5], [20, 1.5e-6, 1.8]], build() {
      const s = mk("source", "Aerosol source", 90, 210, { rh_pct: 80 }), dr = mk("dryer", "Diffusion dryer", 270, 210), n = mk("neutralizer", null, 450, 210),
        d = mk("dma", "DMA (long)", 640, 130), c = mk("cpc", null, 840, 130), ap = mk("aps", null, 640, 300);
      return { nodes: [s, dr, n, d, c, ap], edges: [ed(s, dr, { length_m: 1.5, id_mm: 9.5, bends: 1 }), ed(dr, n, { length_m: 0.2, id_mm: 9.5 }), ed(n, d, { length_m: 0.3, id_mm: 6.35 }),
        ed(d, c, { length_m: 0.3, id_mm: 4.6 }), ed(n, ap, { length_m: 0.5, id_mm: 9.5, bends: 1 })] }; } },
    { key: "atomizer", name: "Atomizer with diluter", desc: "Atomizer output diluted 20×, dried and classified. Source concentration set high to match.", aerosol: [[60000, 40e-9, 1.6], [30000, 150e-9, 1.5], [100, 1.5e-6, 1.8]], build() {
      const s = mk("source", "Atomizer", 90, 200), dl = mk("diluter", null, 260, 200, { factor: 20 }), dr = mk("dryer", "Diffusion dryer", 430, 200), n = mk("neutralizer", null, 600, 200), d = mk("dma", "DMA (long)", 770, 120), c = mk("cpc", null, 770, 290);
      return { nodes: [s, dl, dr, n, d, c], edges: [ed(s, dl, { length_m: 0.5, id_mm: 6.35 }), ed(dl, dr, { length_m: 0.3, id_mm: 6.35 }), ed(dr, n, { length_m: 0.5, id_mm: 4.6, bends: 1 }), ed(n, d), ed(d, c, { length_m: 0.3, id_mm: 4.6 })] }; } },
  ];

  // ------------------------------------------------------------ state
  const st = { graph: null, sel: null, image: null, imageName: "", source: "", templateKey: null, dirty: false };

  // ------------------------------------------------------------ path analysis
  function findPath(g, isTarget, mustPass) {
    const out = new Map(); g.edges.forEach((e) => { if (!out.has(e.from)) out.set(e.from, []); out.get(e.from).push(e); });
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    let best = null;
    const dfs = (nodeId, nodes, edges, seen) => {
      const n = byId.get(nodeId);
      if (isTarget(n) && (!mustPass || nodes.some(mustPass))) { if (!best || nodes.length < best.nodes.length) best = { nodes: nodes.slice(), edges: edges.slice() }; return; }
      (out.get(nodeId) || []).forEach((e) => { if (seen.has(e.to) || !byId.has(e.to)) return; seen.add(e.to); nodes.push(byId.get(e.to)); edges.push(e); dfs(e.to, nodes, edges, seen); nodes.pop(); edges.pop(); seen.delete(e.to); });
    };
    g.nodes.filter((n) => n.type === "source").forEach((s) => dfs(s.id, [s], [], new Set([s.id])));
    return best;
  }
  // tube segments along a branch, each at the RH the aerosol has at that point
  function segmentsAlong(path, upto, edgeQ, skipLastNode) {
    let rh = (+path.nodes[0].params.rh_pct || 0) / 100, dil = 1;
    const segs = [], assumed = { d: false };
    for (let k = 0; k < upto; k++) {
      const e = path.edges[k], next = path.nodes[k + 1], Q = edgeQ.get(e.id) || +e.flow_lpm || 1;
      const nodeCounts = !(skipLastNode && k === upto - 1);
      if (+e.length_m > 0) { const D = +e.id_mm || (assumed.d = true, 4.6); segs.push({ L: +e.length_m, D: D * 1e-3, Q: Q / 60000, bends: +e.bends || 0, rh }); }
      if (nodeCounts && next.type === "dryer") {
        if (+next.params.length_m > 0) segs.push({ L: +next.params.length_m, D: (+next.params.id_mm || 10) * 1e-3, Q: Q / 60000, bends: 0, rh: (+next.params.rh_out_pct || 0) / 100 });
        rh = Math.min(rh, (+next.params.rh_out_pct || 0) / 100);
      }
      if (nodeCounts && next.type === "diluter") dil *= Math.max(1, +next.params.factor || 1);
    }
    return { segs, rh, dil, assumed: assumed.d };
  }
  function plan(g) {
    const notes = [];
    if (!g.nodes.some((n) => n.type === "source")) return { ok: false, notes: ["Add an aerosol source block."] };
    const path = findPath(g, (n) => n.type === "cpc", (n) => n.type === "dma");
    if (!path) return { ok: false, notes: ["No connected path from a source through a DMA to a CPC yet. Connect the blocks in flow order."] };
    const apsPath = findPath(g, (n) => n.type === "aps");
    const di = path.nodes.findIndex((n) => n.type === "dma");
    const dma = path.nodes[di], cpc = path.nodes[path.nodes.length - 1];
    const qa = +dma.params.aerosol_lpm || 0.3, qaps = apsPath ? (+apsPath.nodes[apsPath.nodes.length - 1].params.flow_lpm || 1) : 0;
    // flow in each tube: the value written on it, else the sum of the instrument flows that pass through it
    const edgeQ = new Map();
    g.edges.forEach((e) => {
      let q = 0; if (path.edges.includes(e)) q += qa; if (apsPath && apsPath.edges.includes(e)) q += qaps;
      edgeQ.set(e.id, +e.flow_lpm || q || null);
    });
    const sm = segmentsAlong(path, di, edgeQ);
    const ap = apsPath ? segmentsAlong(apsPath, apsPath.edges.length, edgeQ) : null;
    // equivalent single tube for display (diffusion-equivalent length at the DMA aerosol flow)
    let Leq = 0, Lsum = 0, Dw = 0, bends = 0;
    sm.segs.forEach((sg) => { Leq += sg.L * (qa / 60000) / sg.Q; Lsum += sg.L; Dw += sg.L * sg.D * 1e3; bends += sg.bends; });
    let vol = 0, assumedPost = false;
    path.edges.slice(di).forEach((e) => { const L = +e.length_m || 0; if (!L) return; const D = +e.id_mm || (assumedPost = true, 4.6); vol += Math.PI / 4 * Math.pow(D * 1e-3, 2) * L / ((+e.flow_lpm || qa) / 60000); });
    const before = path.nodes.slice(1, di);
    const imp = before.find((n) => n.type === "impactor" || n.type === "cyclone");
    const neu = before.find((n) => n.type === "neutralizer");
    const dryer = path.nodes.slice(0, di).find((n) => n.type === "dryer");
    // flow through the impactor = flow in the tube entering it (it sets the jet velocity and so the cut size)
    let impQ = null;
    if (imp) { const k = path.nodes.indexOf(imp); const eIn = path.edges[k - 1]; impQ = eIn && edgeQ.get(eIn.id) ? edgeQ.get(eIn.id) / 60000 : null; }
    if (!neu) notes.push("No neutralizer before the DMA. The simulation still assumes a bipolar charge distribution.");
    const onAny = new Set(path.nodes.concat(apsPath ? apsPath.nodes : []));
    [...onAny].filter((n) => TYPES[n.type] && TYPES[n.type].sim === "pass").forEach((n) => notes.push(`${n.label}: passed through unchanged for now.`));
    [...onAny].filter((n) => TYPES[n.type] && TYPES[n.type].sim === "no").forEach((n) => notes.push(`${n.label} sits on a simulated path but isn't modeled yet.`));
    const off = g.nodes.filter((n) => !onAny.has(n) && n.type !== "source");
    if (off.length) notes.push(`Shown but not simulated yet: ${off.map((n) => n.label).join(", ")}.`);
    if (g.nodes.filter((n) => n.type === "aps").length > 1 || g.nodes.filter((n) => n.type === "dma").length > 1) notes.push("Only the first DMA–CPC train and the first APS are simulated.");
    if (sm.assumed || assumedPost || (ap && ap.assumed)) notes.push("Some tubes have no inner diameter; 4.6 mm was assumed.");
    return { ok: true, path, apsPath, edgeQ, notes, values: {
      lineL: +Leq.toFixed(3), lineD: +(Lsum ? Dw / Lsum : 4.6).toFixed(2), lineB: bends, dil: sm.dil, rhSrc: +path.nodes[0].params.rh_pct || 0,
      dryer: dryer ? dryer.params : null, impactor: imp ? { d50: +imp.params.d50_nm, s: +imp.params.steepness, nz: +imp.params.nozzle_mm || null } : null,
      kmax: neu ? +neu.params.charges : null, dma: dma.params, cpc: cpc.params, tpl: vol ? +vol.toFixed(2) : null,
      aps: apsPath ? apsPath.nodes[apsPath.nodes.length - 1].params : null,
      branches: { smps: { segments: sm.segs, rh: sm.rh, dil: sm.dil, impactorQ: impQ }, aps: ap ? { segments: ap.segs, rh: ap.rh, dil: ap.dil } : null } } };
  }

  // ------------------------------------------------------------ rendering
  const svg = $("dg-svg");
  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v)); if (parent) parent.appendChild(e); return e; };
  const edgeLabel = (e) => [e.length_m ? `${+e.length_m} m` : "", e.id_mm ? `⌀${+e.id_mm} mm` : "", +e.bends ? `${+e.bends} bend${+e.bends > 1 ? "s" : ""}` : "", e.flow_lpm ? `${+e.flow_lpm} L/min` : ""].filter(Boolean).join(" · ");
  function curve(a, b) {
    const x1 = a.x + NW / 2, y1 = a.y, x2 = b.x - NW / 2, y2 = b.y;
    if (x2 > x1 + 20) { const mx = (x1 + x2) / 2; return { d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 }; }
    // backward or vertical: go from bottom of a to top of b, or around
    const ax = a.x, ay = a.y + (b.y > a.y ? NH / 2 : -NH / 2), bx = b.x, by = b.y + (b.y > a.y ? -NH / 2 : NH / 2);
    const my = (ay + by) / 2;
    return { d: `M${ax},${ay} C${ax},${my} ${bx},${my} ${bx},${by}`, mx: (ax + bx) / 2, my };
  }
  function render() {
    const g = st.graph; svg.innerHTML = "";
    const defs = el("defs", {}, svg);
    const mkr = el("marker", { id: "dg-arrow", viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" }, defs);
    el("path", { d: "M0,0 L10,5 L0,10 z", fill: "var(--ink-3)" }, mkr);
    const mkr2 = el("marker", { id: "dg-arrow2", viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" }, defs);
    el("path", { d: "M0,0 L10,5 L0,10 z", fill: "var(--accent)" }, mkr2);
    if (st.image && $("dg-trace").checked) el("image", { href: st.image, x: 0, y: 0, width: VW, height: VH, preserveAspectRatio: "xMidYMid meet", opacity: "0.28" }, svg);
    const pl = plan(g);
    const pathNodes = pl.ok ? pl.path.nodes.concat(pl.apsPath ? pl.apsPath.nodes : []) : [], pathEdges = pl.ok ? pl.path.edges.concat(pl.apsPath ? pl.apsPath.edges : []) : [];
    const onPath = new Set(pathNodes.map((n) => n.id)), onEdge = new Set(pathEdges.map((e) => e.id));
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    const eg = el("g", {}, svg);
    g.edges.forEach((e) => {
      const a = byId.get(e.from), b = byId.get(e.to); if (!a || !b) return;
      const c = curve(a, b);
      const cls = "edge" + (onEdge.has(e.id) ? " onpath" : "") + (st.sel && st.sel.kind === "edge" && st.sel.id === e.id ? " sel" : "");
      el("path", { d: c.d, class: cls, "marker-end": onEdge.has(e.id) ? "url(#dg-arrow2)" : "url(#dg-arrow)" }, eg);
      const hit = el("path", { d: c.d, class: "edgehit", "data-edge": e.id, tabindex: "0", role: "button", "aria-label": `Connection ${a.label} to ${b.label}` }, eg);
      hit.addEventListener("click", () => select({ kind: "edge", id: e.id }));
      hit.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select({ kind: "edge", id: e.id }); } });
      let lab = edgeLabel(e); if (!e.flow_lpm && pl.ok && pl.edgeQ.get(e.id)) lab = (lab ? lab + " · " : "") + `≈${+pl.edgeQ.get(e.id).toFixed(2)} L/min`; if (lab) { const t = el("text", { x: c.mx, y: c.my - 6, "text-anchor": "middle", class: "elabel" }, eg); t.textContent = lab; }
    });
    g.nodes.forEach((n) => {
      const T = TYPES[n.type] || TYPES.other;
      const cls = "node" + (onPath.has(n.id) ? " onpath" : "") + (T.sim === "no" ? " unsim" : "") + (st.sel && st.sel.kind === "node" && st.sel.id === n.id ? " sel" : "");
      const grp = el("g", { class: cls, transform: `translate(${n.x - NW / 2},${n.y - NH / 2})`, "data-node": n.id, tabindex: "0", role: "button", "aria-label": `${n.label}, ${T.label}` }, svg);
      el("rect", { class: "box", width: NW, height: NH, rx: 5 }, grp);
      const t1 = el("text", { class: "t1", x: 10, y: 19 }, grp); t1.textContent = n.label.length > 19 ? n.label.slice(0, 18) + "…" : n.label;
      const t2 = el("text", { class: "t2", x: 10, y: 35 }, grp); t2.textContent = (T.label.toUpperCase() + (T.sim === "no" ? " · NOT SIMULATED" : T.sim === "pass" ? " · PASS-THROUGH" : "")).slice(0, 26);
      el("circle", { class: "port", cx: NW, cy: NH / 2, r: 6, "data-port": n.id }, grp);
      grp.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select({ kind: "node", id: n.id }); } });
    });
    renderPath(pl);
  }
  function renderPath(pl) {
    const box = $("dg-path");
    if (!pl.ok) { box.innerHTML = pl.notes.map((t) => `<span class="warn">${esc(t)}</span>`).join(""); $("dg-summary").innerHTML = ""; $("dg-apply").disabled = true; return; }
    $("dg-apply").disabled = false;
    box.innerHTML = `<span>SMPS path: ${pl.path.nodes.map((n) => esc(n.label)).join(" → ")}</span>` + (pl.apsPath ? `<span>APS path: ${pl.apsPath.nodes.map((n) => esc(n.label)).join(" → ")}</span>` : "") + pl.notes.map((t) => `<span class="warn">${esc(t)}</span>`).join("");
    const v = pl.values;
    const B = v.branches;
    $("dg-summary").innerHTML = `SMPS: ${B.smps.segments.length} tube segment${B.smps.segments.length === 1 ? "" : "s"} (equivalent ${v.lineL} m, ⌀${v.lineD} mm, ${v.lineB} bends) · RH at DMA ${Math.round(B.smps.rh * 100)}% · dilution ×${v.dil} · ${v.impactor ? `impactor d50 ${v.impactor.d50} nm` : "no impactor"} · DMA ${esc(v.dma.column)} ${v.dma.sheath_lpm}/${v.dma.aerosol_lpm} L/min, ${v.dma.scan_s} s scan · CPC d50 ${v.cpc.d50_nm} nm${v.tpl != null ? ` · plumbing delay ${v.tpl} s from tube volume` : ""}` +
      (B.aps ? `<br>APS: ${B.aps.segments.length} tube segment${B.aps.segments.length === 1 ? "" : "s"} · RH ${Math.round(B.aps.rh * 100)}% · ${v.aps.flow_lpm} L/min, ${v.aps.sample_s} s samples` : "");
  }

  // ------------------------------------------------------------ interaction: drag, connect, select
  function svgPt(ev) { const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); }
  function nodeAt(pt) { return st.graph.nodes.find((n) => Math.abs(pt.x - n.x) <= NW / 2 && Math.abs(pt.y - n.y) <= NH / 2); }
  let drag = null;
  svg.addEventListener("pointerdown", (ev) => {
    const port = ev.target.closest("[data-port]"), node = ev.target.closest("[data-node]");
    if (port) { ev.preventDefault(); const n = st.graph.nodes.find((x) => x.id === port.dataset.port); drag = { kind: "link", from: n, line: el("path", { class: "drag-line" }, svg) }; svg.setPointerCapture(ev.pointerId); return; }
    if (node) { ev.preventDefault(); const n = st.graph.nodes.find((x) => x.id === node.dataset.node); const pt = svgPt(ev); drag = { kind: "move", n, dx: pt.x - n.x, dy: pt.y - n.y, moved: false }; svg.setPointerCapture(ev.pointerId); }
  });
  svg.addEventListener("pointermove", (ev) => {
    if (!drag) return; const pt = svgPt(ev);
    if (drag.kind === "move") {
      const nx = Math.min(Math.max(pt.x - drag.dx, NW / 2), VW - NW / 2), ny = Math.min(Math.max(pt.y - drag.dy, NH / 2), VH - NH / 2);
      if (Math.abs(nx - drag.n.x) + Math.abs(ny - drag.n.y) > 1) drag.moved = true;
      drag.n.x = nx; drag.n.y = ny; if (drag.moved) render();
    } else { const a = drag.from; drag.line.setAttribute("d", `M${a.x + NW / 2},${a.y} L${pt.x},${pt.y}`); }
  });
  svg.addEventListener("pointerup", (ev) => {
    if (!drag) return; const d = drag; drag = null;
    if (d.kind === "move") { if (!d.moved) select({ kind: "node", id: d.n.id }); else changed(false); return; }
    const target = nodeAt(svgPt(ev)); d.line.remove();
    if (target && target.id !== d.from.id) connect(d.from.id, target.id); else render();
  });
  svg.addEventListener("click", (ev) => { if (ev.target === svg) { st.sel = null; render(); inspect(); scheduleProbe(); } });
  function connect(a, b) {
    if (st.graph.edges.some((e) => e.from === a && e.to === b)) { render(); return; }
    const e = { id: nid(), from: a, to: b, length_m: null, id_mm: null, bends: null, flow_lpm: null };
    st.graph.edges.push(e); st.sel = { kind: "edge", id: e.id }; changed(true);
  }
  function select(s) { st.sel = s; render(); inspect(); scheduleProbe(); }
  function changed(reinspect) { st.dirty = true; $("dg-applymsg").textContent = "Diagram changed. Apply to update the simulation."; $("dg-applymsg").className = "formmsg"; if (st.source && !/edited/.test(st.source)) setSource(st.source + " · edited"); render(); if (reinspect) inspect(); scheduleProbe(); }

  // ------------------------------------------------------------ inspector
  function fieldHtml(p, v, idp) {
    if (p.kind === "column") return `<div class="fld"><label for="${idp}">${p.label}</label><select id="${idp}" data-p="${p.key}"><option value="long" ${v === "long" ? "selected" : ""}>Long</option><option value="nano" ${v === "nano" ? "selected" : ""}>Nano</option></select></div>`;
    if (p.kind === "text") return `<div class="fld"><label for="${idp}">${p.label}</label><input type="text" id="${idp}" data-p="${p.key}" value="${esc(v)}"></div>`;
    return `<div class="fld"><label for="${idp}">${p.label}${p.unit ? ` <small>${p.unit}</small>` : ""}</label><input type="number" step="any" id="${idp}" data-p="${p.key}" value="${v == null ? "" : esc(v)}"></div>`;
  }
  function inspect() {
    const box = $("dg-inspector"), g = st.graph;
    if (!st.sel) { box.innerHTML = `<p class="delta">Select a block or a connection to edit it.</p>`; return; }
    if (st.sel.kind === "node") {
      const n = g.nodes.find((x) => x.id === st.sel.id); if (!n) { st.sel = null; inspect(); return; }
      const T = TYPES[n.type] || TYPES.other;
      const others = g.nodes.filter((x) => x.id !== n.id);
      box.innerHTML = `<div class="sec-head"><h3>${esc(n.label)}</h3><span class="pill ${T.sim === "yes" ? "ok" : T.sim === "pass" ? "" : "warn"}">${T.sim === "yes" ? "Simulated" : T.sim === "pass" ? "Pass-through" : "Not simulated yet"}</span></div>
        <div class="fld"><label for="dgi-label">Label</label><input type="text" id="dgi-label" value="${esc(n.label)}"></div>
        <div class="fld"><label for="dgi-type">Type</label><select id="dgi-type">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${k === n.type ? "selected" : ""}>${t.label}</option>`).join("")}</select></div>
        ${T.params.map((p) => fieldHtml(p, n.params[p.key], "dgi-p-" + p.key)).join("")}
        ${others.length ? `<div class="fld"><label for="dgi-to">Connect to</label><span style="display:flex;gap:4px"><select id="dgi-to">${others.map((o) => `<option value="${o.id}">${esc(o.label)}</option>`).join("")}</select><button type="button" class="small" id="dgi-link">Add</button></span></div>` : ""}
        <div class="runbar"><button type="button" class="small" id="dgi-del">Delete block</button></div>`;
      $("dgi-label").addEventListener("input", (e) => { n.label = e.target.value || T.label; changed(false); });
      $("dgi-type").addEventListener("change", (e) => { n.type = e.target.value; n.params = Object.assign(defaults(n.type), n.params); changed(true); });
      box.querySelectorAll("[data-p]").forEach((inp) => inp.addEventListener(inp.tagName === "SELECT" ? "change" : "input", () => {
        const p = T.params.find((x) => x.key === inp.dataset.p);
        n.params[p.key] = p.kind === "num" ? (inp.value === "" ? p.def : parseFloat(inp.value)) : inp.value;
        if (p.key === "column") n.params.loss_m = inp.value === "nano" ? 3.6 : 13;
        changed(p.key === "column");
      }));
      if ($("dgi-link")) $("dgi-link").addEventListener("click", () => connect(n.id, $("dgi-to").value));
      $("dgi-del").addEventListener("click", () => { g.nodes = g.nodes.filter((x) => x.id !== n.id); g.edges = g.edges.filter((e) => e.from !== n.id && e.to !== n.id); st.sel = null; changed(true); });
    } else {
      const e = g.edges.find((x) => x.id === st.sel.id); if (!e) { st.sel = null; inspect(); return; }
      const a = g.nodes.find((x) => x.id === e.from), b = g.nodes.find((x) => x.id === e.to);
      const f = (k, label, unit) => `<div class="fld"><label for="dge-${k}">${label} <small>${unit}</small></label><input type="number" step="any" min="0" id="dge-${k}" data-e="${k}" value="${e[k] == null ? "" : esc(e[k])}" placeholder="—"></div>`;
      box.innerHTML = `<div class="sec-head"><h3>Tubing</h3><span class="delta">${esc(a.label)} → ${esc(b.label)}</span></div>
        <p class="delta">Leave length empty for a direct connection. Flow defaults to the DMA aerosol flow.</p>
        ${f("length_m", "Length", "m")}${f("id_mm", "Inner diameter", "mm")}${f("bends", "90° bends", "")}${f("flow_lpm", "Flow", "L/min")}
        <div class="runbar"><button type="button" class="small" id="dge-rev">Reverse direction</button><button type="button" class="small" id="dge-del">Delete connection</button></div>`;
      box.querySelectorAll("[data-e]").forEach((inp) => inp.addEventListener("input", () => { e[inp.dataset.e] = inp.value === "" ? null : parseFloat(inp.value); changed(false); }));
      $("dge-rev").addEventListener("click", () => { [e.from, e.to] = [e.to, e.from]; changed(true); });
      $("dge-del").addEventListener("click", () => { g.edges = g.edges.filter((x) => x.id !== e.id); st.sel = null; changed(true); });
    }
  }

  // ------------------------------------------------------------ layout
  function tidy(g) {
    const depth = new Map(g.nodes.map((n) => [n.id, 0]));
    for (let it = 0; it < g.nodes.length; it++) g.edges.forEach((e) => { if (depth.has(e.from) && depth.has(e.to) && depth.get(e.to) < depth.get(e.from) + 1 && depth.get(e.from) + 1 < g.nodes.length) depth.set(e.to, depth.get(e.from) + 1); });
    const cols = new Map(); g.nodes.forEach((n) => { const d = depth.get(n.id); if (!cols.has(d)) cols.set(d, []); cols.get(d).push(n); });
    const nc = Math.max(...cols.keys()) + 1, dx = Math.min(185, (VW - NW - 40) / Math.max(nc - 1, 1));
    cols.forEach((list, d) => list.forEach((n, i) => { n.x = 20 + NW / 2 + d * dx; n.y = VH / 2 + (i - (list.length - 1) / 2) * 90; n.y = Math.min(Math.max(n.y, NH / 2 + 6), VH - NH / 2 - 6); }));
  }
  $("dg-layout").addEventListener("click", () => { tidy(st.graph); changed(false); });
  $("dg-add").innerHTML = Object.entries(TYPES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join("");
  $("dg-addbtn").addEventListener("click", () => {
    const type = $("dg-add").value, n = mk(type, null, 120 + (st.graph.nodes.length * 37) % 700, 60 + (st.graph.nodes.length * 53) % 300);
    st.graph.nodes.push(n); st.sel = { kind: "node", id: n.id }; changed(true);
  });

  // ------------------------------------------------------------ apply to simulation
  const setv = (id, v) => { if (v != null && isFinite(v)) $(id).value = +(+v).toPrecision(6); };
  function applyGraph(aerosol) {
    const pl = plan(st.graph); if (!pl.ok) { $("dg-applymsg").textContent = pl.notes[0]; $("dg-applymsg").className = "formmsg err"; return false; }
    const v = pl.values;
    setv("lineL", v.lineL); setv("lineD", v.lineD); setv("lineB", v.lineB); setv("dil", v.dil);
    if (v.impactor) { setv("impD", v.impactor.d50); setv("impS", v.impactor.s); if (v.impactor.nz) setv("impNz", v.impactor.nz); }
    if (v.kmax) setv("kmax", v.kmax);
    $("col").value = v.dma.column === "nano" ? "nano" : "long";
    setv("qsh", v.dma.sheath_lpm); setv("qa", v.dma.aerosol_lpm); setv("V1", v.dma.v_start); setv("V2", v.dma.v_end); setv("tscan", v.dma.scan_s); setv("tbin", v.dma.bin_s); setv("leff", v.dma.loss_m);
    setv("c50", v.cpc.d50_nm); setv("c0", v.cpc.d0_nm); setv("tau", v.cpc.tau_s);
    if (v.tpl != null) setv("tpl", v.tpl);
    setv("rhsrc", v.rhSrc);
    $("dryOn").checked = !!v.dryer; if (v.dryer) { setv("dryRH", v.dryer.rh_out_pct); setv("dryL", v.dryer.length_m); setv("dryD", v.dryer.id_mm); }
    $("apsOn").checked = !!v.aps; if (v.aps) { setv("apsQ", v.aps.flow_lpm); setv("apsT", v.aps.sample_s); setv("apsLo", v.aps.d50_lo_um); setv("apsCut", v.aps.cut_um); setv("apsRes", v.aps.res); }
    UI.state.diagram = v.branches; UI.showDiagramNote();
    if (aerosol) aerosol.slice(0, 3).forEach((m, i) => { setv(`m${i + 1}N`, m[0]); setv(`m${i + 1}G`, m[1] * 1e9); setv(`m${i + 1}S`, m[2]); });
    // the diagram says whether an impactor exists; Truth and any inversion that models impactors follow it
    ["truth", "A", "B"].forEach((c) => {
      const cur = UI.state.cfg[c].impactor;
      if (c !== "truth" && cur === "none") return;                       // an inversion that ignores impactors keeps doing so
      if (!v.impactor) { UI.state.cfg[c].impactor = "none"; return; }
      if (cur === "none" || (cur === "stk50" && !v.impactor.nz)) UI.state.cfg[c].impactor = v.impactor.nz ? "stk50" : "logistic";
    });
    UI.renderLedger(); UI.schedule();
    st.dirty = false;
    $("dg-applymsg").textContent = "Applied. The setup fields and results below now follow this diagram."; $("dg-applymsg").className = "formmsg ok";
    return true;
  }
  $("dg-apply").addEventListener("click", () => { window.streamTrack && window.streamTrack("diagram-apply"); applyGraph(); });

  function setSource(t) { st.source = t; $("dg-src").textContent = t; }
  function loadGraph(g, source, aerosol, apply) {
    st.graph = g; st.sel = null; setSource(source); render(); inspect(); scheduleProbe();
    document.querySelectorAll(".dg-card").forEach((c) => c.setAttribute("aria-pressed", c.dataset.key === st.templateKey ? "true" : "false"));
    if (apply) applyGraph(aerosol);
  }
  $("dg-templates").innerHTML = TEMPLATES.map((t) => `<button type="button" class="dg-card" data-key="${t.key}" aria-pressed="false"><b>${t.name}</b><span>${t.desc}</span></button>`).join("");
  $("dg-templates").addEventListener("click", (e) => {
    const b = e.target.closest(".dg-card"); if (!b) return;
    const t = TEMPLATES.find((x) => x.key === b.dataset.key); st.templateKey = t.key;
    window.streamTrack && window.streamTrack("template-" + t.key);
    loadGraph(t.build(), "Template · " + t.name, t.aerosol || [[3000, 40e-9, 1.6], [1500, 150e-9, 1.5], [5, 1.5e-6, 1.8]], true);
  });

  // ------------------------------------------------------------ upload + read with Claude
  let sample = null, imageBlob = null;
  const drop = $("dg-drop");
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) takeFile(f); });
  $("dg-file").addEventListener("change", (e) => { const f = e.target.files && e.target.files[0]; if (f) takeFile(f); });
  async function takeFile(f) {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) { showRead("That file type isn't supported. Export the schematic as PNG or JPEG, then upload it.", true); $("dg-image-box").hidden = false; return; }
    imageBlob = f; st.imageName = f.name;
    window.streamTrack && window.streamTrack("schematic-upload");
    st.image = await shrink(f);
    $("dg-img").src = st.image; $("dg-image-box").hidden = false; $("dg-trace-wrap").hidden = false;
    showRead(sample ? "Check that the image is clear, then select Read with Claude." : "Reading needs Claude, which isn't available in this view. Build the diagram by hand with the schematic as a guide.", !sample);
    $("dg-read").hidden = !sample;
    setSource("Uploaded · " + f.name); st.templateKey = null;
    document.querySelectorAll(".dg-card").forEach((c) => c.setAttribute("aria-pressed", "false"));
  }
  function shrink(file) { // JPEG data URL small enough to store with a saved setup
    return new Promise((res) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        let w = img.naturalWidth, h = img.naturalHeight, max = 1100, q = 0.75, out = "";
        for (let tries = 0; tries < 6; tries++) {
          const s = Math.min(1, max / Math.max(w, h)), c = document.createElement("canvas");
          c.width = Math.round(w * s); c.height = Math.round(h * s);
          const cx = c.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, c.width, c.height); cx.drawImage(img, 0, 0, c.width, c.height);
          out = c.toDataURL("image/jpeg", q); if (out.length < 180000) break; max *= 0.8; q = Math.max(0.5, q - 0.08);
        }
        URL.revokeObjectURL(url); res(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); res(null); };
      img.src = url;
    });
  }
  const dataUrlToBlob = (u) => { const [h, b] = u.split(","); const bin = atob(b); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: h.match(/:(.*?);/)[1] }); };
  function showRead(t, err) { const m = $("dg-readmsg"); m.textContent = t; m.className = "formmsg " + (err ? "err" : ""); }

  const PROMPT = `You are reading a schematic of an aerosol measurement setup (the attached image). It may be a drawing, a slide figure or a photo of a sketch.
Identify every component and every flow connection between components.

Allowed component types: ${Object.keys(TYPES).join(", ")}.
Use "source" for where the aerosol comes from (atomizer, generator, chamber, ambient inlet). Use "other" for anything that does not fit.

Reply with only JSON in exactly this shape:
{"components":[{"id":"c1","type":"dma","label":"text written on the diagram, short","x":0.5,"y":0.4,"params":{}}],
 "connections":[{"from":"c1","to":"c2","length_m":null,"inner_diameter_mm":null,"bends":null,"flow_lpm":null}],
 "notes":["short notes about anything unclear"]}

Rules:
- x and y are the approximate center of the component as fractions of the image width and height (0 to 1).
- Connections point downstream, in the direction the aerosol flows.
- Fill a number only when it is written on the diagram; otherwise use null. Convert units (inches to mm, cm to m, cc/min to L/min).
- params may include, when written: for source "rh_pct"; for impactor or cyclone "d50_nm"; for dryer "rh_out_pct", "length_m"; for dma "sheath_lpm", "aerosol_lpm", "scan_s", "column" ("long" or "nano"); for cpc "d50_nm"; for aps "flow_lpm", "sample_s"; for diluter "factor"; for neutralizer "kind".
- Do not invent components that are not drawn.`;

  $("dg-read").addEventListener("click", async () => {
    if (!sample || !st.image) return;
    const btn = $("dg-read"); btn.disabled = true; showRead("Reading the schematic… this can take up to a minute.");
    try {
      const blob = imageBlob || dataUrlToBlob(st.image);
      const res = await sample.json(PROMPT, { images: [blob] });
      const g = fromReading(res);
      if (!g.nodes.length) { showRead("Claude couldn't find components in this image. Try a clearer or larger image, or build the diagram by hand.", true); return; }
      st.templateKey = null;
      loadGraph(g, "Read from " + (st.imageName || "schematic"), null, false);
      const notes = Array.isArray(res.notes) ? res.notes.filter((x) => typeof x === "string").slice(0, 5) : [];
      showRead(`Found ${g.nodes.length} components and ${g.edges.length} connections. Check them against the drawing, fix anything wrong, then select Apply to setup.${notes.length ? " Notes: " + notes.join(" ") : ""}`);
      $("dg-applymsg").textContent = "Not applied yet."; $("dg-applymsg").className = "formmsg";
    } catch (e) {
      const code = e && e.code;
      showRead(code === "not_granted" ? "Reading was not allowed, so nothing was sent. You can still build the diagram by hand." :
        code === "image_rejected" ? "That image couldn't be read. Try a PNG or JPEG under 20 MB." :
        code === "rate_limited" ? "Too many requests right now. Wait a minute, then try again." :
        code === "invalid_json" ? "Claude's answer couldn't be turned into a diagram. Try again, or build it by hand." :
        "Reading failed. Try again, or build the diagram by hand.", true);
    } finally { btn.disabled = false; }
  });
  function fromReading(r) {
    const comps = Array.isArray(r && r.components) ? r.components.slice(0, 40) : [];
    const idmap = new Map(), nodes = [];
    comps.forEach((c, i) => {
      if (!c || typeof c !== "object") return;
      const type = TYPES[c.type] ? c.type : "other";
      const n = mk(type, String(c.label || TYPES[type].label).slice(0, 40), 0, 0);
      const fx = +c.x, fy = +c.y;
      n.x = isFinite(fx) ? 30 + NW / 2 + Math.min(Math.max(fx, 0), 1) * (VW - NW - 60) : 100 + i * 150;
      n.y = isFinite(fy) ? 20 + NH / 2 + Math.min(Math.max(fy, 0), 1) * (VH - NH - 40) : VH / 2;
      const prm = c.params && typeof c.params === "object" ? c.params : {};
      (TYPES[type].params).forEach((p) => { const v = prm[p.key]; if (p.kind === "num" && isFinite(+v) && v !== null && v !== "") n.params[p.key] = +v; else if (p.kind !== "num" && typeof v === "string" && v) n.params[p.key] = p.kind === "column" ? (/nano/i.test(v) ? "nano" : "long") : v.slice(0, 40); });
      if (type === "dma" && !prm.column && /nano|3085/i.test(n.label)) { n.params.column = "nano"; n.params.loss_m = 3.6; }
      idmap.set(String(c.id), n); nodes.push(n);
    });
    // nudge overlaps apart
    for (let i = 0; i < nodes.length; i++) for (let j = 0; j < i; j++) {
      const a = nodes[i], b = nodes[j];
      if (Math.abs(a.x - b.x) < NW + 8 && Math.abs(a.y - b.y) < NH + 8) a.y = Math.min(VH - NH / 2 - 4, b.y + NH + 16);
    }
    const num = (v) => (v === null || v === "" || !isFinite(+v)) ? null : +v;
    const edges = (Array.isArray(r && r.connections) ? r.connections : []).map((c) => {
      const a = idmap.get(String(c && c.from)), b = idmap.get(String(c && c.to));
      if (!a || !b || a === b) return null;
      return { id: nid(), from: a.id, to: b.id, length_m: num(c.length_m), id_mm: num(c.inner_diameter_mm), bends: num(c.bends), flow_lpm: num(c.flow_lpm) };
    }).filter(Boolean);
    const overlapping = nodes.some((a, i) => nodes.some((b, j) => j < i && Math.abs(a.x - b.x) < NW + 40 && Math.abs(a.y - b.y) < NH + 10));
    const g = { nodes, edges }; if (overlapping) tidy(g);
    return g;
  }
  $("dg-trace").addEventListener("change", render);

  // ------------------------------------------------------------ saved setups (shared db)
  let db = null, user = null, me = null, canEdit = false, saved = [];
  async function connectDb() {
    if (!window.claude || !window.claude.use) return renderSaved();
    try { sample = await window.claude.use("sample"); if (sample) { const caps = await sample.limits().catch(() => null); if (!caps || !caps.images) sample = null; } } catch (e) { sample = null; }
    $("dg-read").hidden = !sample;
    try { user = await window.claude.use("user"); db = await window.claude.use("db"); } catch (e) { db = null; }
    if (!db) return renderSaved();
    try { me = user ? await user.id() : null; canEdit = user ? !!(await user.canEdit()) : false; } catch (e) { /* stay read-only */ }
    db.collection("setups").onSnapshot((snap) => {
      saved = snap.docs.map((d) => Object.assign({ id: d.id }, d.data())).filter((s) => s && s.graph && Array.isArray(s.graph.nodes) && Array.isArray(s.graph.edges));
      renderSaved();
    }, () => { $("dg-saved").innerHTML = `<div class="empty">Saved setups are unavailable right now.</div>`; });
  }
  async function renderSaved() {
    const box = $("dg-saved");
    if (!db) { box.innerHTML = `<div class="empty">Sign in to claude.ai to save setups and load ones others have shared.</div>`; return; }
    if (!saved.length) { box.innerHTML = `<div class="empty">No saved setups yet. Build or upload one, then save it with a name.</div>`; return; }
    let names = {}; try { const ids = [...new Set(saved.map((s) => s.by).filter(Boolean))]; if (user && ids.length) names = await user.profiles(ids); } catch (e) { names = {}; }
    box.innerHTML = saved.slice().sort((a, b) => String(b.at).localeCompare(String(a.at))).map((s) => `<div class="row"><div class="nm"><b>${esc(s.name)}</b><small>${s.graph.nodes.length} blocks · ${esc((names[s.by] && names[s.by].name) || "Someone")} · ${esc(String(s.at || "").slice(0, 10))}${s.image ? " · with schematic" : ""}</small></div>
      <span class="acts" style="display:flex;gap:6px"><button type="button" class="small" data-load="${s.id}">Load</button>${canEdit || (me && s.by === me) ? `<button type="button" class="small" data-rm="${s.id}">Remove</button>` : ""}</span></div>`).join("");
  }
  $("dg-saved").addEventListener("click", async (e) => {
    const l = e.target.closest("[data-load]"), r = e.target.closest("[data-rm]");
    if (l) {
      const s = saved.find((x) => x.id === l.dataset.load); if (!s) return;
      const g = JSON.parse(JSON.stringify(s.graph));
      g.nodes.forEach((n) => { if (!TYPES[n.type]) n.type = "other"; n.params = Object.assign(defaults(n.type), n.params || {}); });
      st.image = s.image || null; imageBlob = null; st.imageName = s.name;
      $("dg-image-box").hidden = !st.image; $("dg-trace-wrap").hidden = !st.image; if (st.image) $("dg-img").src = st.image;
      st.templateKey = null; loadGraph(g, "Saved · " + s.name, null, true);
    }
    if (r && db) {
      if (r.dataset.confirm !== "1") { r.dataset.confirm = "1"; r.textContent = "Confirm remove"; return; }
      try { await db.doc("setups/" + r.dataset.rm).delete(); } catch (err) { r.textContent = "Couldn't remove"; }
    }
  });
  $("dg-saveform").addEventListener("submit", async (e) => {
    e.preventDefault();
    const m = $("dg-savemsg"), name = $("dg-name").value.trim();
    if (!db) { m.textContent = "Saving needs a signed-in claude.ai view."; m.className = "formmsg err"; return; }
    if (!name) { m.textContent = "Give the setup a name."; m.className = "formmsg err"; return; }
    const graph = { nodes: st.graph.nodes.map((n) => ({ id: n.id, type: n.type, label: n.label, x: Math.round(n.x), y: Math.round(n.y), params: n.params, userTF: n.userTF || null, exp: n.exp || null })), edges: st.graph.edges.map((e) => Object.assign({}, e, { userTF: e.userTF || null, exp: e.exp || null })) };
    try {
      await db.collection("setups").add({ name: name.slice(0, 80), graph, image: st.image || null, by: me || "", at: new Date().toISOString() });
      m.textContent = "Saved to the shared library."; m.className = "formmsg ok"; $("dg-name").value = "";
      setSource("Saved · " + name);
    } catch (err) {
      m.textContent = err && err.code === "invalid_argument" ? "Your access level doesn't allow saving. Ask the owner for Contributor access." : err && err.code === "quota_exceeded" ? "The library is full. Remove an old setup first." : "Couldn't save. Try again in a moment.";
      m.className = "formmsg err";
    }
  });

  // ------------------------------------------------------------ probe
  let probeTimer = null;
  function scheduleProbe() { clearTimeout(probeTimer); probeTimer = setTimeout(runProbe, 120); }
  function runProbe() {
    const body = $("dg-probe-body"), empty = $("dg-probe-empty");
    const g = st.graph, sel = st.sel;
    const hide = (msg) => { body.hidden = true; empty.hidden = false; empty.textContent = msg; $("dg-probe-title").textContent = "Probe"; tfHide(msg.replace(/^Select a block or a tube to see the aerosol at that point.*$/, "Select a block or a tube to see its transfer function: the fraction of particles of each size that it passes, counts or selects.")); };
    if (!sel) return hide("Select a block or a tube to see the aerosol at that point: at a block's outlet, or at the end of a tube.");
    let path, title, skipLast = false;
    if (sel.kind === "node") {
      const n = g.nodes.find((x) => x.id === sel.id); if (!n) return hide("Select a block or a tube.");
      path = n.type === "source" ? { nodes: [n], edges: [] } : findPath(g, (x) => x.id === n.id);
      title = ["cpc", "aps", "opc", "electrometer", "filter"].includes(n.type) ? `Probe at the detector of ${n.label}` : `Probe at the outlet of ${n.label}`;
    } else {
      const e = g.edges.find((x) => x.id === sel.id); if (!e) return hide("Select a block or a tube.");
      const a = g.nodes.find((x) => x.id === e.from), b = g.nodes.find((x) => x.id === e.to);
      const pa = a.type === "source" ? { nodes: [a], edges: [] } : findPath(g, (x) => x.id === a.id);
      path = pa ? { nodes: pa.nodes.concat([b]), edges: pa.edges.concat([e]) } : null;
      title = `Probe at the end of the tube ${a.label} → ${b.label}`; skipLast = true;
    }
    $("dg-probe-title").textContent = title;
    if (!path) return hide("This point isn't connected to an aerosol source yet.");
    let job;
    try { job = UI.readJob(); } catch (err) { return hide(err.message); }
    const pl = plan(g);
    const edgeQ = new Map(g.edges.map((e) => [e.id, +e.flow_lpm || (pl.ok && pl.edgeQ.get(e.id)) || null]));
    const seg = segmentsAlong(path, path.edges.length, edgeQ, skipLast);
    const passed = skipLast ? path.nodes.slice(0, -1) : path.nodes;
    const imp = passed.find((n) => n.type === "impactor" || n.type === "cyclone");
    const neu = passed.some((n) => n.type === "neutralizer");
    const dmaNode = passed.find((n) => n.type === "dma");
    const cpcAfter = passed.some((n) => n.type === "cpc");
    const params = Object.assign({}, job.params, { rh_src: (+path.nodes[0].params.rh_pct || 0) / 100, segments: null });
    if (imp) {
      const k = path.nodes.indexOf(imp), eIn = path.edges[k - 1];
      params.impactor_d50 = (+imp.params.d50_nm || 700) * 1e-9; params.impactor_slope = +imp.params.steepness || 8;
      if (+imp.params.nozzle_mm) params.impactor_W = +imp.params.nozzle_mm * 1e-3;
      params.impactor_Q = eIn && edgeQ.get(eIn.id) ? edgeQ.get(eIn.id) / 60000 : params.qa;
    }
    let V = null;
    $("dg-probe-v").hidden = !dmaNode;
    if (dmaNode) {
      const dp = dmaNode.params;
      Object.assign(params, { qsh: (+dp.sheath_lpm || 3) / 60000, qa: (+dp.aerosol_lpm || 0.3) / 60000, r2: dp.column === "nano" ? 19.05e-3 : 19.61e-3, L: dp.column === "nano" ? 0.04987 : 0.44369, dma_Leff: +dp.loss_m || 13 });
      const v1 = +dp.v_start || 10, v2 = +dp.v_end || 9500, f = +$("dg-pv").value / 1000;
      V = v1 * Math.pow(v2 / v1, f);
      $("dg-pv-out").textContent = `${V < 100 ? V.toFixed(1) : Math.round(V)} V`;
    }
    const truth = Object.assign({}, UI.state.cfg.truth);
    if (imp && truth.impactor === "none") truth.impactor = +imp.params.nozzle_mm ? "stk50" : "logistic";
    if (imp && truth.impactor === "stk50" && !+imp.params.nozzle_mm) truth.impactor = "logistic";
    let r, uf = null;
    try {
      uf = uploadFactor(path, skipLast, edgeQ, params, truth, V, job);
      r = UI.engine().probe({ params, modes: job.modes, truth, custom: job.custom,
        probe: { segments: seg.segs, rh: seg.rh, dil: seg.dil, impactor: !!imp, neutralized: neu, dmaV: V, cpc: cpcAfter, dmaLoss: true, factor: uf ? Array.from(uf.f) : null } });
    } catch (err) { return hide("The probe couldn't be computed for this point."); }
    body.hidden = false; empty.hidden = true;
    try { runTF({ sel, path, edgeQ, job, params, truth, V }); } catch (err) { tfHide("The transfer function couldn't be computed for this block."); }
    drawProbe(r, { title, uf, item: selectedItem(), V, seg, imp, neu, dmaNode, cpcAfter, lastQ: path.edges.length ? edgeQ.get(path.edges[path.edges.length - 1].id) : null });
  }
  function drawProbe(r, ctx) {
    const LN10 = Math.LN10;
    const xs = r.x.map((v) => v * 1e9), ds = r.d.map((v) => v * 1e9);
    const src = r.src.map((v) => v * LN10), here = r.here.map((v) => v * LN10), single = r.single ? r.single.map((v) => v * LN10) : null;
    const exy = ctx.item && ctx.item.exp ? ctx.item.exp.y.filter((v) => v > 0) : [];
    const ymax = Math.max(...src, ...here, ...exy) * 2 || 1, ymin = Math.max(ymax / 1e6, 1e-4);
    const decades = []; for (let e = Math.ceil(Math.log10(ymin)); e <= Math.floor(Math.log10(ymax)); e++) decades.push(Math.pow(10, e));
    const series = [
      { name: "At the source (dry)", x: ds, y: src, color: "var(--s-truth)", width: 1.25, dash: true, at: (v) => UI.interpLog(ds, src, v) },
      { name: ctx.dmaNode ? "Leaving the DMA, all charges" : "At this point", x: xs, y: here, color: "var(--s-b)", area: true, areaOpacity: 0.15, at: (v) => UI.interpLog(xs, here, v) },
    ];
    if (single) series.push({ name: "Singly charged only", x: xs, y: single, color: "var(--s-a)", dash: true, at: (v) => UI.interpLog(xs, single, v) });
    const ex = ctx.item && ctx.item.exp;
    if (ex) series.push({ name: `Measured: ${ex.name}`, x: ex.x, y: ex.y, color: "var(--s-mc)", width: 1.25, markers: ex.x.length <= 80, at: (v) => (v < ex.x[0] || v > ex.x[ex.x.length - 1]) ? NaN : UI.interpLog(ex.x, ex.y, v) });
    $("dg-pexp-rm").hidden = !ex;
    UI.legend($("dg-plg"), series.map((s) => ({ name: s.name, color: s.color, cls: s.dash ? "dash" : "" })));
    UI.drawChart($("dg-pc"), {
      label: "Size distribution at the probed point",
      x: { domain: [3, 20000], log: true, ticks: [3, 10, 100, 1000, 10000], title: `Diameter at this point's humidity (nm)`, fmt: (v) => v.toFixed(v < 10 ? 1 : 0) + " nm" },
      y: { domain: [ymin, ymax], log: true, ticks: decades, title: "dN/dlogDp (cm⁻³)", fmtv: (v) => v >= 10 ? Math.round(v).toLocaleString() : v.toPrecision(2) },
      series,
    });
    const penAt = (dnm) => { const i = r.d.findIndex((v) => v * 1e9 >= dnm); return i < 0 ? NaN : r.pen[i]; };
    const pct = (v) => isFinite(v) ? `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%` : "—";
    const fmtN = (v) => v >= 100 ? Math.round(v).toLocaleString() : v >= 1 ? v.toFixed(1) : v.toPrecision(2);
    const st = (label, val, sub, cls) => `<div class="st ${cls || ""}"><span>${label}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
    let h = st("Number concentration", `${fmtN(r.Nhere)} cm⁻³`, `${pct(r.Nhere / r.Nsrc)} of the source`)
      + st("Relative humidity", `${Math.round(ctx.seg.rh * 100)}%`, `growth ×${r.gf100.toFixed(2)} at 100 nm`)
      + (ctx.dmaNode ? "" : st("Transmission", `${pct(penAt(10))} · ${pct(penAt(100))} · ${pct(penAt(1000))}`, "at 10 nm · 100 nm · 1 µm"))
      + st("Tubing so far", `${ctx.seg.segs.length} segment${ctx.seg.segs.length === 1 ? "" : "s"}`, `${ctx.seg.segs.reduce((a, s) => a + s.L, 0).toFixed(2)} m${ctx.lastQ ? ` · last at ${(+ctx.lastQ).toFixed(2)} L/min` : ""}${ctx.seg.dil > 1 ? ` · diluted ×${ctx.seg.dil}` : ""}`);
    if (r.cut) h += st("Impactor cut", `${Math.round(r.cut * 1e9)} nm aero.`, `= ${Math.round(r.cutGeo * 1e9)} nm dry particle size`);
    if (r.dma) h += st("DMA selects", `${Math.round(r.dma.d1 * 1e9)} nm`, `+2: ${r.dma.d2 ? Math.round(r.dma.d2 * 1e9) + " nm" : "—"} · +3: ${r.dma.d3 ? Math.round(r.dma.d3 * 1e9) + " nm" : "—"}`)
      + st(ctx.cpcAfter ? "CPC counts" : "Leaving the DMA", `${fmtN(r.dma.N)} cm⁻³`, `${pct(r.dma.Nsingle / (r.dma.N || 1))} singly charged`);
    else if (ctx.cpcAfter) h += st("CPC counts", `${fmtN(r.Nhere)} cm⁻³`, "total, no classifier upstream");
    if (r.charges) h += `<div class="st wide"><span>Charge state after the neutralizer (positive side)</span><div class="tblwrap"><table><thead><tr><th class="num">Diameter</th><th class="num">Neutral</th><th class="num">+1</th><th class="num">+2</th><th class="num">+3</th></tr></thead><tbody>${r.charges.map((c) => `<tr><td class="num">${c.d < 1e-6 ? Math.round(c.d * 1e9) + " nm" : (c.d * 1e6).toFixed(0) + " µm"}</td><td class="num">${pct(c.f0)}</td><td class="num">${pct(c.f1)}</td><td class="num">${pct(c.f2)}</td><td class="num">${pct(c.f3)}</td></tr>`).join("")}</tbody></table></div></div>`;
    if (ex) {
      // compare over the measured size range: number concentration and size-resolved ratio (model / measured)
      const lo = ex.x[0], hi = ex.x[ex.x.length - 1];
      const trap = (X, Y) => { let t = 0; for (let i = 1; i < X.length; i++) if (X[i - 1] >= lo && X[i] <= hi) t += 0.5 * (Y[i] + Y[i - 1]) * Math.log10(X[i] / X[i - 1]); return t; };
      const Nm = trap(ex.x, ex.y), Ns = trap(xs, here);
      const lr = ex.x.map((xv, i) => { const m = UI.interpLog(xs, here, xv); return m > 0 && ex.y[i] > 0 ? Math.log(m / ex.y[i]) : null; }).filter((v) => v != null);
      const gmr = lr.length ? Math.exp(lr.reduce((a, b) => a + b, 0) / lr.length) : NaN;
      const rms = lr.length ? Math.sqrt(lr.reduce((a, b) => a + b * b, 0) / lr.length) : NaN;
      h += `<div class="st cmp"><span>Simulated ÷ measured, number</span><b>${isFinite(Ns / Nm) ? (Ns / Nm).toFixed(2) : "—"}</b><small>${fmtN(Ns)} vs ${fmtN(Nm)} cm⁻³, ${fmtD(lo)}–${fmtD(hi)}</small></div>`
        + `<div class="st cmp"><span>Size-resolved ratio</span><b>×${isFinite(gmr) ? gmr.toFixed(2) : "—"}</b><small>geometric mean over ${lr.length} points; typical spread ×${isFinite(rms) ? Math.exp(rms).toFixed(2) : "—"}</small></div>`;
    }
    if (ctx.uf) h += `<div class="st wide cmp"><span>Uploaded transfer functions in use</span><b>${esc(ctx.uf.names.join(", "))}</b><small>Replacing the model for these blocks within their uploaded size ranges.</small></div>`;
    $("dg-pstats").innerHTML = h;
    // keep for download
    const cols = [["diameter_at_local_RH_nm", xs], ["dry_diameter_nm", ds], ["source_dry_dNdlogDp_cm-3", src], ["here_dNdlogDp_cm-3", here]];
    if (single) cols.push(["here_singly_charged_dNdlogDp_cm-3", single]);
    cols.push(["penetration_so_far", Array.from(r.pen)]);
    if (ex) { cols.push(["measured_diameter_nm", ex.x], ["measured_dNdlogDp_cm-3", ex.y], ["simulated_at_measured_diameter", ex.x.map((xv) => UI.interpLog(xs, here, xv))]); }
    const meta = [`RH at this point ${Math.round(ctx.seg.rh * 100)}%; number concentration here ${+r.Nhere.toPrecision(4)} cm-3 (${pct(r.Nhere / r.Nsrc)} of source)`];
    if (r.cut) meta.push(`Impactor cut ${Math.round(r.cut * 1e9)} nm aerodynamic = ${Math.round(r.cutGeo * 1e9)} nm dry particle size`);
    if (r.dma) meta.push(`DMA at ${ctx.V < 100 ? ctx.V.toFixed(1) : Math.round(ctx.V)} V selects ${Math.round(r.dma.d1 * 1e9)} nm singly charged`);
    if (ctx.uf) meta.push(`Uploaded transfer functions in use: ${ctx.uf.names.join(", ")}`);
    if (ex) meta.push(`Measured data: ${ex.name}`);
    meta.push("Simulated columns have one row per size bin; measured columns, when present, have their own rows.");
    lastProbe = { title: ctx.title, cols, meta };
  }
  let lastProbe = null;

  // ------------------------------------------------------------ transfer function of the selected block
  function tfHide(msg) { $("dg-tf-body").hidden = true; const e = $("dg-tf-empty"); e.hidden = false; e.textContent = msg; $("dg-tf-title").textContent = "Transfer function"; }
  // Builds the engine spec for one block or tube. `path` ends at the block (for a tube: at its downstream node).
  function blockSpec(item, isEdge, path, edgeQ, baseParams, baseTruth, V) {
    const g = st.graph, params = Object.assign({}, baseParams), truth = Object.assign({}, baseTruth), extra = [];
    if (isEdge) {
      const e = item, a = g.nodes.find((x) => x.id === e.from), b = g.nodes.find((x) => x.id === e.to);
      const rhIn = segmentsAlong(path, path.edges.length - 1, edgeQ, false).rh, Q = (edgeQ.get(e.id) || +e.flow_lpm || 1) / 60000;
      if (!(+e.length_m > 0)) extra.push("This connection has no tubing length set, so it passes every size. Set a length in the panel on the right.");
      if (+e.length_m > 0 && !+e.id_mm) extra.push("Inner diameter not set; 4.6 mm assumed.");
      return { title: `Transfer function of the tube ${a.label} → ${b.label}`, params, truth, extra, replaceable: true,
        spec: { kind: "tube", L: +e.length_m || 0, D: (+e.id_mm || 4.6) * 1e-3, Q, bends: +e.bends || 0, rh: rhIn } };
    }
    const n = item, T = TYPES[n.type] || TYPES.other, np = n.params;
    const k = path.nodes.indexOf(n), eIn = k > 0 ? path.edges[k - 1] : null;
    const rhIn = segmentsAlong(path, path.edges.length, edgeQ, true).rh;
    const Qin = eIn && edgeQ.get(eIn.id) ? edgeQ.get(eIn.id) / 60000 : null;
    const out = { title: `Transfer function of ${n.label}`, params, truth, extra, replaceable: true };
    if (n.type === "source") return { msg: "The aerosol source has no transfer function. Select a block downstream of it or a tube." };
    if (T.sim === "pass") return { msg: `${n.label}: modeled as passing every size unchanged for now, so its transfer function is 1 at all sizes.`, uploadOK: true, title: out.title };
    if (T.sim === "no") return { msg: `${n.label} is not simulated yet, so STREAM has no transfer function for it. You can upload a measured one and use it when probing.`, uploadOK: true, title: out.title };
    if (n.type === "impactor" || n.type === "cyclone") {
      params.impactor_d50 = (+np.d50_nm || 700) * 1e-9; params.impactor_slope = +np.steepness || 8;
      if (n.type === "impactor" && +np.nozzle_mm) params.impactor_W = +np.nozzle_mm * 1e-3; else delete params.impactor_W;
      params.impactor_Q = Qin || params.qa;
      if (truth.impactor === "none") truth.impactor = params.impactor_W ? "stk50" : "logistic";
      if (truth.impactor === "stk50" && !params.impactor_W) truth.impactor = "logistic";
      out.spec = { kind: "impactor", rh: rhIn };
    } else if (n.type === "neutralizer") { out.spec = { kind: "neutralizer", rh: rhIn }; out.replaceable = false; }
    else if (n.type === "dma") { out.spec = { kind: "dma", V, rh: rhIn }; out.replaceable = false; }
    else if (n.type === "cpc") {
      Object.assign(params, { cpc_d50: (+np.d50_nm || 7) * 1e-9, cpc_d0: (+np.d0_nm || 3) * 1e-9, cpc_tau: +np.tau_s || 0.6 });
      if (params.cpc_d0 >= params.cpc_d50) params.cpc_d0 = params.cpc_d50 * 0.5;
      out.spec = { kind: "cpc", rh: rhIn };
    } else if (n.type === "aps") out.spec = { kind: "aps", Q: (+np.flow_lpm || 1) / 60000, t: +np.sample_s || 20, d50lo: (+np.d50_lo_um || 0.6) * 1e-6, cut: (+np.cut_um || 15) * 1e-6, res: +np.res || 1.05, rh: rhIn };
    else if (n.type === "diluter") out.spec = { kind: "diluter", factor: Math.max(1, +np.factor || 1), rh: rhIn };
    else if (n.type === "dryer") {
      out.spec = { kind: "dryer", L: +np.length_m || 0, D: (+np.id_mm || 10) * 1e-3, Q: Qin || params.qa, rhIn, rhOut: Math.min(rhIn, (+np.rh_out_pct || 0) / 100), rh: rhIn };
      if ((+np.rh_out_pct || 0) / 100 > rhIn) extra.push(`The air entering is already drier (${Math.round(rhIn * 100)}% RH) than the dryer's outlet setting, so the dryer does not change the humidity.`);
    } else return { msg: `${n.label} has no transfer function yet.`, uploadOK: true, title: out.title };
    return out;
  }
  // What the probe already applies for this block (so an uploaded curve can replace it): the main curve, except
  // where the probe does not apply the model (APS efficiency, CPC curves other than exp_d50, pass-through blocks).
  function builtinApplied(item, isEdge, bs, job) {
    if (bs.msg) return null;
    if (!isEdge && item.type === "aps") return null;
    if (!isEdge && item.type === "cpc" && bs.truth.cpc_eff !== "exp_d50") return null;
    const r = UI.engine().blockResponse({ params: bs.params, truth: bs.truth, custom: job.custom, block: bs.spec });
    return (r.series.find((s) => s.main) || r.series[0]).y;
  }
  // Uploaded curve on the engine's dry-size grid (nm). Outside the uploaded range returns null.
  function onGrid(u, xs) {
    const lx = u.x.map(Math.log);
    return xs.map((v) => {
      if (v < u.x[0] || v > u.x[u.x.length - 1]) return null;
      const t = Math.log(v); let i = 1; while (i < lx.length - 1 && lx[i] < t) i++;
      const f = lx[i] === lx[i - 1] ? 0 : (t - lx[i - 1]) / (lx[i] - lx[i - 1]);
      return u.y[i - 1] + f * (u.y[i] - u.y[i - 1]);
    });
  }
  // Product over the blocks on the probed path whose uploaded curve is switched on: uploaded / model.
  function uploadFactor(path, skipLast, edgeQ, baseParams, baseTruth, V, job) {
    const users = [];
    path.edges.forEach((e, j) => { if (e.userTF && e.userTF.use) users.push({ item: e, isEdge: true, sub: { nodes: path.nodes.slice(0, j + 2), edges: path.edges.slice(0, j + 1) } }); });
    path.nodes.forEach((n, k) => { if (skipLast && k === path.nodes.length - 1) return; if (n.userTF && n.userTF.use) users.push({ item: n, isEdge: false, sub: { nodes: path.nodes.slice(0, k + 1), edges: path.edges.slice(0, k) } }); });
    if (!users.length) return null;
    const xs = gridNm();
    const f = new Float64Array(xs.length).fill(1), names = [];
    users.forEach((u) => {
      const bs = blockSpec(u.item, u.isEdge, u.sub, edgeQ, baseParams, baseTruth, V);
      if (bs.replaceable === false) return;
      const base = builtinApplied(u.item, u.isEdge, bs, job), up = onGrid(u.item.userTF, xs);
      names.push(u.isEdge ? "a tube" : u.item.label);
      for (let i = 0; i < xs.length; i++) {
        if (up[i] == null) continue;
        const m = base ? base[i] : 1;
        f[i] *= m > 1e-9 ? Math.max(0, up[i]) / m : 0;
      }
    });
    return names.length ? { f, names } : null;
  }
  let GRID = null;
  function gridNm() { if (!GRID) { const r = UI.engine().blockResponse({ params: UI.readJob().params, truth: UI.state.cfg.truth, custom: {}, block: { kind: "diluter", factor: 1 } }); GRID = r.x; } return GRID; }

  let lastTF = null;
  function selectedItem() {
    const s = st.sel; if (!s) return null;
    return s.kind === "node" ? st.graph.nodes.find((x) => x.id === s.id) : st.graph.edges.find((x) => x.id === s.id);
  }
  function runTF(c) {
    const isEdge = c.sel.kind === "edge", item = selectedItem();
    const bs = blockSpec(item, isEdge, c.path, c.edgeQ, c.params, c.truth, c.V);
    lastTF = null;
    tfControls(item, bs);
    if (bs.msg) {
      if (item.userTF) { $("dg-tf-title").textContent = bs.title; $("dg-tf-empty").hidden = false; $("dg-tf-empty").textContent = bs.msg; $("dg-tf-body").hidden = false; drawTF(null, [], null, item); return; }
      tfHide(bs.msg); if (bs.uploadOK) { $("dg-tf-title").textContent = bs.title; $("dg-tf-body").hidden = false; $("dg-tflg").innerHTML = ""; $("dg-tfc").innerHTML = ""; $("dg-tfg").hidden = true; $("dg-tfnotes").innerHTML = ""; }
      return;
    }
    const r = UI.engine().blockResponse({ params: bs.params, truth: bs.truth, custom: c.job.custom, block: bs.spec });
    $("dg-tf-title").textContent = bs.title;
    $("dg-tf-empty").hidden = true; $("dg-tf-body").hidden = false;
    drawTF(r, bs.extra, bs.spec, item);
  }
  function tfControls(item, bs) {
    const has = !!(item && item.userTF);
    $("dg-tfrm").hidden = !has;
    $("dg-tfuse-wrap").hidden = !has || bs.replaceable === false;
    $("dg-tfuse").checked = has && !!item.userTF.use;
    $("dg-tfdl").hidden = !!bs.msg && !has;
    if (!has) { $("dg-tfmsg").textContent = ""; }
    else if (bs.replaceable === false) $("dg-tfmsg").textContent = `Uploaded: ${item.userTF.name} (shown for comparison; the probe keeps the model for this block).`;
    else $("dg-tfmsg").textContent = `Uploaded: ${item.userTF.name}`;
    $("dg-tfmsg").className = "formmsg";
  }
  const TF_COLORS = ["var(--s-b)", "var(--s-a)", "var(--s-mc)", "var(--s-truth)", "var(--ink-3)"];
  const fmtD = (v) => v < 1000 ? v.toFixed(v < 10 ? 1 : 0) + " nm" : (v / 1000).toFixed(2) + " µm";
  function drawTF(r, extra, spec, item) {
    const pctf = (v) => isFinite(v) ? (v >= 0.995 && v <= 1.005 ? "100%" : v < 0.001 && v > 0 ? "<0.1%" : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`) : "—";
    const xs = r ? r.x : gridNm();
    const series = r ? r.series.map((s, i) => ({ name: s.name, x: xs, y: Array.from(s.y), color: TF_COLORS[i % TF_COLORS.length], dash: !s.main && i > 0, width: s.main ? 2.25 : 1.5, at: (v) => UI.interpLog(xs, Array.from(s.y), v) })) : [];
    const u = item && item.userTF;
    if (u) series.push({ name: `Uploaded: ${u.name}`, x: u.x, y: u.y, color: "var(--s-truth)", width: 1.25, markers: u.x.length <= 60, at: (v) => (v < u.x[0] || v > u.x[u.x.length - 1]) ? NaN : UI.interpLog(u.x, u.y, v) });
    UI.legend($("dg-tflg"), series.map((s) => ({ name: s.name, color: s.color, cls: s.dash ? "dash" : "" })));
    const yMax = Math.max(r ? r.yMax || 1.05 : 1.05, u ? Math.max(...u.y) * 1.05 : 0);
    const yLabel = r ? r.yLabel : "Fraction";
    UI.drawChart($("dg-tfc"), {
      label: `${yLabel} against particle size`,
      x: { domain: [1, 20000], log: true, ticks: [1, 10, 100, 1000, 10000], title: spec && (spec.kind === "aps" || spec.kind === "impactor") ? "Dry particle size (nm); dashed: aerodynamic diameter" : "Dry particle size (nm)", fmt: fmtD },
      y: { domain: [0, yMax], log: false, ticks: UI.niceTicks(0, Math.min(yMax, Math.max(1, yMax / 1.05)), 5), title: yLabel, fmtv: pctf },
      series,
    });
    let gi = null, go = null;
    if (r && r.growth) {
      $("dg-tfg").hidden = false;
      gi = Array.from(r.growth.yIn); go = Array.from(r.growth.yOut);
      const gmax = Math.max(...gi, ...go, 1.1) * 1.05;
      const gs = [{ name: `Entering, ${Math.round(r.growth.rhIn * 100)}% RH`, x: xs, y: gi, color: "var(--s-a)", dash: true, at: (v) => UI.interpLog(xs, gi, v) },
        { name: `Leaving, ${Math.round(r.growth.rhOut * 100)}% RH`, x: xs, y: go, color: "var(--s-b)", at: (v) => UI.interpLog(xs, go, v) }];
      UI.legend($("dg-tfglg"), gs.map((s) => ({ name: s.name, color: s.color, cls: s.dash ? "dash" : "" })));
      UI.drawChart($("dg-tfgc"), { label: "Hygroscopic growth factor entering and leaving the dryer",
        x: { domain: [1, 20000], log: true, ticks: [1, 10, 100, 1000, 10000], title: "Dry particle size (nm)", fmt: fmtD },
        y: { domain: [1, gmax], log: false, ticks: UI.niceTicks(1, gmax, 4), title: "Growth factor (wet / dry size)", fmtv: (v) => "×" + v.toFixed(2) }, series: gs });
    } else $("dg-tfg").hidden = true;
    const notes = r ? r.notes.concat(extra) : [];
    if (u && u.use) notes.push("The uploaded curve replaces the model for this block when you probe at or after it. Outside its size range the model is used.");
    if (r) notes.push("Curves use the Truth column of the model ledger. Change a model there to see how the block's response changes.");
    $("dg-tfnotes").innerHTML = notes.map((t) => `<li>${esc(t)}</li>`).join("");
    // keep for download
    const cols = [["dry_diameter_nm", xs]];
    if (r) r.series.forEach((s) => cols.push([s.name, Array.from(s.y)]));
    if (gi) { cols.push([`growth_factor_in_${Math.round(r.growth.rhIn * 100)}pctRH`, gi], [`growth_factor_out_${Math.round(r.growth.rhOut * 100)}pctRH`, go]); }
    if (u) { const ug = onGrid(u, xs); cols.push([`uploaded_${u.name}`, ug]); }
    lastTF = { title: $("dg-tf-title").textContent, cols, notes, yLabel };
  }

  // ------------------------------------------------------------ CSV in and out
  function csvCell(v) { if (v == null || (typeof v === "number" && !isFinite(v))) return ""; if (typeof v === "number") return +v.toPrecision(6) + ""; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
  function toCSV(meta, cols) {
    const head = meta.map((m) => "# " + m.replace(/\n/g, " ")).join("\n");
    const n = Math.max(...cols.map((c) => c[1].length));
    const rows = [cols.map((c) => csvCell(c[0])).join(",")];
    for (let i = 0; i < n; i++) rows.push(cols.map((c) => csvCell(c[1][i])).join(","));
    return head + "\n" + rows.join("\n") + "\n";
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "stream"; }
  function download(name, text) {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" }), url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }
  function setupMeta() {
    const when = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const t = UI.state.cfg.truth, models = Object.entries(t).map(([k, v]) => `${k}=${v}`).join("; ");
    return [`STREAM (Simulator of Train Response for Evaluating Aerosol Measurements), unvalidated prototype`, `Exported ${when} from ${location.href.split("#")[0]}`, `Setup: ${st.source || "diagram"}`, `Truth models: ${models}`];
  }
  // Parses two numeric columns. Returns {x (nm, ascending), y, notes[]}.
  function parseTwoCol(text, kind) {
    const lines = text.split(/\r?\n/), x = [], y = [], notes = [];
    let um = false, pct = false, header = "";
    for (const raw of lines) {
      const line = raw.trim(); if (!line || line.startsWith("#")) continue;
      const parts = line.split(/[,;\t]|\s+/).map((v) => v.trim()).filter((v) => v !== "");
      const a = parseFloat(parts[0]), b = parseFloat(parts[1]);
      if (parts.length < 2 || !isFinite(a) || !isFinite(b)) { if (!x.length) header += " " + line.toLowerCase(); continue; }
      x.push(a); y.push(b);
    }
    if (x.length < 3) throw new Error("Couldn't find at least three rows with two numbers (diameter, value).");
    const hx = header.split(/[,;\t]/)[0] || header;
    if (/µm|um\b|micro/.test(hx)) { um = true; }
    if (kind === "tf" && /%|percent/.test(header)) pct = true;
    let pts = x.map((v, i) => [um ? v * 1000 : v, y[i]]).filter((p) => p[0] > 0).sort((p, q) => p[0] - q[0]);
    pts = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0]);
    if (!um && pts[pts.length - 1][0] < 50 && kind === "dist") notes.push("Diameters look small for nanometres; if they are micrometres, add µm to the header.");
    let ys = pts.map((p) => p[1]);
    if (kind === "tf") {
      const mx = Math.max(...ys);
      if (!pct && mx > 1.5 && mx <= 100.5) pct = true;
      if (pct) { ys = ys.map((v) => v / 100); notes.push("Values read as percent."); }
      if (Math.min(...ys) < 0) notes.push("Negative values set to zero when probing.");
    }
    if (um) notes.push("Diameters read as µm.");
    return { x: pts.map((p) => p[0]), y: ys, notes };
  }
  $("dg-tfdl").addEventListener("click", () => {
    if (!lastTF) return;
    download(`stream-tf-${slug(lastTF.title.replace(/^Transfer function of /, ""))}.csv`, toCSV(setupMeta().concat([lastTF.title, `Values: ${lastTF.yLabel}; x is dry particle size`], lastTF.notes), lastTF.cols));
    if (window.streamTrack) window.streamTrack("download-tf");
  });
  $("dg-tfup").addEventListener("change", async (ev) => {
    const f = ev.target.files[0]; ev.target.value = ""; const item = selectedItem(); if (!f || !item) return;
    try {
      const p = parseTwoCol(await f.text(), "tf");
      item.userTF = { name: f.name.replace(/\.[^.]+$/, "").slice(0, 60), x: p.x, y: p.y, use: false };
      changedData(); runProbe();
      $("dg-tfmsg").textContent = `Uploaded ${p.x.length} points from ${f.name}.${p.notes.length ? " " + p.notes.join(" ") : ""}`; $("dg-tfmsg").className = "formmsg ok";
      if (window.streamTrack) window.streamTrack("upload-tf");
    } catch (err) { $("dg-tfmsg").textContent = err.message; $("dg-tfmsg").className = "formmsg err"; }
  });
  $("dg-tfuse").addEventListener("change", () => { const item = selectedItem(); if (item && item.userTF) { item.userTF.use = $("dg-tfuse").checked; changedData(); scheduleProbe(); } });
  $("dg-tfrm").addEventListener("click", () => { const item = selectedItem(); if (item) { delete item.userTF; changedData(); scheduleProbe(); } });
  $("dg-pexp").addEventListener("change", async (ev) => {
    const f = ev.target.files[0]; ev.target.value = ""; const item = selectedItem(); if (!f || !item) return;
    try {
      const p = parseTwoCol(await f.text(), "dist");
      item.exp = { name: f.name.replace(/\.[^.]+$/, "").slice(0, 60), x: p.x, y: p.y };
      changedData(); runProbe();
      $("dg-pmsg").textContent = `Loaded ${p.x.length} points from ${f.name}.${p.notes.length ? " " + p.notes.join(" ") : ""}`; $("dg-pmsg").className = "formmsg ok";
      if (window.streamTrack) window.streamTrack("upload-measured");
    } catch (err) { $("dg-pmsg").textContent = err.message; $("dg-pmsg").className = "formmsg err"; }
  });
  $("dg-pexp-rm").addEventListener("click", () => { const item = selectedItem(); if (item) { delete item.exp; $("dg-pmsg").textContent = ""; changedData(); runProbe(); } });
  $("dg-pdl").addEventListener("click", () => {
    if (!lastProbe) return;
    download(`stream-probe-${slug(lastProbe.title.replace(/^Probe at (the )?/, ""))}.csv`, toCSV(setupMeta().concat([lastProbe.title], lastProbe.meta), lastProbe.cols));
    if (window.streamTrack) window.streamTrack("download-probe");
  });
  // Uploaded data change the diagram's content but not its structure: mark it for saving without asking to re-apply.
  function changedData() { st.dirty = true; }
  $("dg-pv").addEventListener("input", scheduleProbe);
  UI.onRun.push(scheduleProbe);

  // ------------------------------------------------------------ start
  st.templateKey = "smps";
  loadGraph(TEMPLATES[0].build(), "Template · SMPS, long DMA", null, false);
  document.querySelector('.dg-card[data-key="smps"]').setAttribute("aria-pressed", "true");
  $("dg-applymsg").textContent = "This diagram matches the current setup.";
  connectDb();
})();
