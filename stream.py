"""
stream.py — STREAM (Simulator of Train Response for Evaluating Aerosol Measurements): minimal prototype of a composable aerosol measurement-system simulator.

Setup modeled (one train):
    aerosol -> sampling line (diffusion, settling, bends) -> inlet impactor
            -> bipolar neutralizer -> DMA (scanning) -> plumbing -> CPC

Forward model: given a true number size distribution dN/dlnDp (spherical particles),
predict raw CPC counts per time bin during an exponential up-scan.

Inversion: regularized non-negative least squares with a kernel built from a
*chosen* set of physics assumptions, so "legacy" and "current" assumption sets
can be compared on the same simulated data.

Units: SI internally (m, s, Pa, K); diameters reported in nm; concentrations in #/cm^3.

Physics sources (prototype implementations, to be reviewed):
  - Slip correction: Kim et al. (2005) J. Nanopart. Res.
  - Bipolar charging: Wiedensohler (1988) fit for |k|<=2; Gunn (1956) for |k|>=3,
    ion mobility ratio 0.875
  - DMA transfer function: Knutson & Whitby (1975) triangle; Stolzenburg (1988)
    diffusing form (as implemented in Petters, DifferentialMobilityAnalyzers.jl)
  - Scanning: residence-time-averaged voltage approximation (simplified; a full
    scanning transfer function, e.g. Dubey & Dhaniyala 2008, is a planned upgrade)
  - Tube diffusion: Gormley & Kennedy (1949); settling: Thomas/Fuchs horizontal
    laminar; bends: Crane & Evans laminar approximation
  - CPC mixing: first-order (exponential) response
"""
import numpy as np
from math import erf

KB = 1.380649e-23
E = 1.602176634e-19
EPS0 = 8.8541878128e-12
G = 9.81

# ---------------------------------------------------------------- gas & particle

def gas(T=296.15, P=101325.0):
    mu = 1.83245e-5 * (T / 296.15) ** 1.5 * (296.15 + 110.4) / (T + 110.4)
    lam = 67.3e-9 * (T / 296.15) * (101325.0 / P) * (1 + 110.4 / 296.15) / (1 + 110.4 / T)
    return dict(T=T, P=P, mu=mu, lam=lam)


def slip(d, g):
    kn = 2 * g["lam"] / d
    return 1 + kn * (1.165 + 0.483 * np.exp(-0.997 / kn))


def mobility(d, k, g):
    return k * E * slip(d, g) / (3 * np.pi * g["mu"] * d)


def diffusivity(d, g):
    return KB * g["T"] * slip(d, g) / (3 * np.pi * g["mu"] * d)


def d_from_mobility(Z, k, g):
    """Invert Z(d) by bisection in log space (vectorized)."""
    Z = np.atleast_1d(Z).astype(float)
    lo = np.full_like(Z, np.log(0.3e-9))
    hi = np.full_like(Z, np.log(50e-6))
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        zm = mobility(np.exp(mid), k, g)
        big = zm > Z           # mobility too high -> particle too small -> go up
        lo = np.where(big, mid, lo)
        hi = np.where(big, hi, mid)
    return np.exp(0.5 * (lo + hi))

# ---------------------------------------------------------------- components

def line_penetration(d, g, L, Dt, Q, rho, n_bends, settle=True):
    """Sampling line: diffusion (Gormley-Kennedy) x horizontal settling x 90-deg bends."""
    D = diffusivity(d, g)
    mu_ = np.pi * D * L / Q
    p_diff = np.where(
        mu_ < 0.009,
        1 - 2.56 * mu_ ** (2 / 3) + 1.2 * mu_ + 0.177 * mu_ ** (4 / 3),
        0.819 * np.exp(-3.657 * mu_) + 0.097 * np.exp(-22.3 * mu_) + 0.032 * np.exp(-57 * mu_),
    )
    U = Q / (np.pi * Dt ** 2 / 4)
    cc = slip(d, g)
    p = p_diff
    if settle:
        vts = rho * d ** 2 * G * cc / (18 * g["mu"])
        eps = np.clip(3 * L * vts / (4 * Dt * U), 0, 1)
        e13 = eps ** (1 / 3)
        s = np.sqrt(np.clip(1 - eps ** (2 / 3), 0, None))
        p_set = 1 - (2 / np.pi) * (2 * eps * s - e13 * s + np.arcsin(e13))
        p = p * np.clip(p_set, 0, 1)
    if n_bends > 0:
        stk = rho * d ** 2 * cc * U / (9 * g["mu"] * Dt)
        p = p * np.clip(1 - stk * n_bends * np.pi / 2, 0, 1)
    return np.clip(p, 0, 1)


def impactor(d, d50, slope=8.0):
    """Smooth impactor penetration (logistic in ln d)."""
    if d50 is None or d50 <= 0:
        return np.ones_like(d)
    return 1 / (1 + (d / d50) ** slope)


W88 = {  # Wiedensohler (1988) coefficients a0..a5, k = -2..2
    -2: [-26.3328, 35.9044, -21.4608, 7.0867, -1.3088, 0.1051],
    -1: [-2.3197, 0.6175, 0.6201, -0.1105, -0.1260, 0.0297],
    0: [-0.0003, -0.1014, 0.3073, -0.3372, 0.1023, -0.0105],
    1: [-2.3484, 0.6044, 0.4800, 0.0013, -0.1553, 0.0320],
    2: [-44.4756, 79.3772, -62.8900, 26.4492, -5.7480, 0.5049],
}


def charge_fraction(d, k, g, zratio=0.875):
    """Fraction of particles carrying k elementary charges (k>0 positive)."""
    if abs(k) <= 2:
        x = np.log10(d * 1e9)
        f = 10 ** sum(a * x ** i for i, a in enumerate(W88[k]))
        if abs(k) == 2:
            f = np.where(d < 20e-9, 0.0, f)  # fit not valid below 20 nm; negligible there
        return f
    a = 2 * np.pi * EPS0 * d * KB * g["T"] / E ** 2
    return (E / np.sqrt(4 * np.pi ** 2 * EPS0 * d * KB * g["T"])
            * np.exp(-(k - a * np.log(zratio)) ** 2 / (2 * a)))


def _eps(x):
    return x * np.vectorize(erf)(x) + np.exp(-x ** 2) / np.sqrt(np.pi)


def dma_transfer(Zt, beta, sigma=None):
    """Transfer function vs. normalized mobility Zt = Z/Z*. sigma=None -> triangle."""
    if sigma is None:
        return np.clip(1 - np.abs(Zt - 1) / beta, 0, 1)
    s2 = np.sqrt(2) * sigma
    return sigma / (np.sqrt(2) * beta) * (
        _eps((Zt - (1 + beta)) / s2) + _eps((Zt - (1 - beta)) / s2) - 2 * _eps((Zt - 1) / s2)
    )


def cpc_efficiency(d, d50, d0):
    x = np.clip((d - d0) / (d50 - d0), 0, None)
    return 1 - np.exp(-np.log(2) * x)

# ---------------------------------------------------------------- setup

DEFAULT = dict(
    T=296.15, P=101325.0,
    # sampling line
    line_L=2.0, line_Dt=4.6e-3, line_Q=0.3 / 60000, line_bends=2, rho=1000.0,
    impactor_d50=700e-9,
    # DMA (TSI 3081 long column geometry)
    r1=9.37e-3, r2=1.961e-2, L=0.44369, dma_Leff=13.0,
    qa=0.3 / 60000, qsh=3.0 / 60000,
    V1=10.0, V2=9500.0, t_scan=60.0, t_bin=0.5,
    # plumbing and CPC
    t_plumb=1.0, cpc_tau=0.6, cpc_d50=7e-9, cpc_d0=3e-9,
    max_charge=6,
    noise=True, seed=1,
)

PHYSICS_ALL = dict(diffusing_tf=True, multiple_charge=True, scanning=True,
                   cpc_mixing=True, line_losses=True, dma_losses=True,
                   cpc_eff=True, impactor=True)
PHYSICS_LEGACY = {k: False for k in PHYSICS_ALL}


class Setup:
    def __init__(self, **kw):
        self.p = dict(DEFAULT)
        self.p.update(kw)
        p = self.p
        self.g = gas(p["T"], p["P"])
        self.d = np.logspace(np.log10(1e-9), np.log10(3e-6), 400)
        self.dlnd = np.gradient(np.log(self.d))
        self.beta = p["qa"] / p["qsh"]
        self.tres = np.pi * (p["r2"] ** 2 - p["r1"] ** 2) * p["L"] / (p["qsh"] + p["qa"])
        self.tau_s = p["t_scan"] / np.log(p["V2"] / p["V1"])
        self.dt = 0.05
        # data window: counts recorded over [0, t_scan + t_shift]
        self.t_shift = self.effective_delay()
        self.nbins = int(round((p["t_scan"] + self.t_shift) / p["t_bin"]))
        self.edges = np.arange(self.nbins + 1) * p["t_bin"]
        t0 = -(self.tres + p["t_plumb"] + 8 * p["cpc_tau"] + 2)
        self.t_exit = np.arange(t0, self.edges[-1] + self.dt, self.dt)

    def effective_delay(self):
        """Delay a user would calibrate: plumbing + CPC mean response + half residence."""
        p = self.p
        return p["t_plumb"] + p["cpc_tau"] + 0.5 * self.tres

    def V(self, t):
        p = self.p
        t = np.clip(t, 0, p["t_scan"])
        return p["V1"] * np.exp(t / self.tau_s)

    def Zstar_from_V(self, V):
        p = self.p
        return p["qsh"] * np.log(p["r2"] / p["r1"]) / (2 * np.pi * p["L"] * V)

    def Vbar(self, t):
        """Voltage averaged over the residence time preceding exit time t."""
        s = np.linspace(0, 1, 41)
        return np.mean(self.V(t[:, None] - self.tres * s[None, :]), axis=1)

    # -------------------------------------------------------- linear operator
    def operator(self, ph):
        """Matrix F (nbins x nd): counts = F @ (dN/dlnd on self.d)."""
        p, g, d = self.p, self.g, self.d
        pen = np.ones_like(d)
        if ph["line_losses"]:
            pen *= line_penetration(d, g, p["line_L"], p["line_Dt"], p["line_Q"], p["rho"], p["line_bends"])
        if ph["impactor"]:
            pen *= impactor(d, p["impactor_d50"])
        if ph["dma_losses"]:
            pen *= line_penetration(d, g, p["dma_Leff"], 1.0, p["qa"], p["rho"], 0, settle=False)
        if ph["cpc_eff"]:
            pen *= cpc_efficiency(d, p["cpc_d50"], p["cpc_d0"])

        if ph["scanning"] or ph["cpc_mixing"]:
            t_ex = self.t_exit
        else:
            t_ex = self.t_exit
        if ph["scanning"]:
            Zs = self.Zstar_from_V(self.Vbar(t_ex))
        else:
            Zs = self.Zstar_from_V(self.V(t_ex))

        kmax = p["max_charge"] if ph["multiple_charge"] else 1
        R = np.zeros((len(t_ex), len(d)))
        for k in range(1, kmax + 1):
            fk = charge_fraction(d, k, g)
            Zk = mobility(d, k, g)
            if ph["diffusing_tf"]:
                gam = (p["r1"] / p["r2"]) ** 2
                I = 0.5 * (1 + gam)
                kap = p["L"] * p["r2"] / (p["r2"] ** 2 - p["r1"] ** 2)
                Gf = 4 * (1 + self.beta) ** 2 / (1 - gam) * (I + (2 * (1 + self.beta) * kap) ** -2)
                sig = np.sqrt(Gf * 2 * np.pi * p["L"] * diffusivity(d, g) / p["qsh"])
            else:
                sig = None
            Zt = Zk[None, :] / Zs[:, None]
            if sig is None:
                Om = dma_transfer(Zt, self.beta)
            else:
                Om = dma_transfer(Zt, self.beta, np.broadcast_to(sig[None, :], Zt.shape))
            R += Om * (fk * pen * self.dlnd)[None, :]

        # exit concentration -> CPC concentration (delay + mixing) -> bin counts
        if ph["cpc_mixing"]:
            delay, tau = p["t_plumb"], p["cpc_tau"]
        else:
            delay, tau = self.t_shift, 0.0
        return self._time_map(t_ex, delay, tau) @ R

    def _time_map(self, t_ex, delay, tau):
        p = self.p
        dt = self.dt
        nl = int(np.ceil((8 * tau) / dt)) + 1 if tau > 0 else 1
        if tau > 0:
            m = np.arange(nl)
            w = np.exp(-m * dt / tau) - np.exp(-(m + 1) * dt / tau)
        else:
            w = np.array([1.0])
        M = np.zeros((self.nbins, len(t_ex)))
        qa_cc = p["qa"] * 1e6  # cm^3/s
        for j, te in enumerate(t_ex):
            tc = te + delay + np.arange(len(w)) * dt   # arrival times at detector
            idx = np.floor(tc / p["t_bin"]).astype(int)
            ok = (tc >= 0) & (idx < self.nbins)
            np.add.at(M[:, j], idx[ok], w[ok] * qa_cc * dt)
        return M

    # -------------------------------------------------------- forward + inverse
    def simulate(self, n_true):
        F = self.operator(PHYSICS_ALL)
        mean = F @ n_true
        if self.p["noise"]:
            rng = np.random.default_rng(self.p["seed"])
            return rng.poisson(mean).astype(float), mean
        return mean.copy(), mean

    def inversion_grid(self, m=64):
        p = self.p
        dlo = d_from_mobility(self.Zstar_from_V(p["V1"]), 1, self.g)[0]
        dhi = d_from_mobility(self.Zstar_from_V(p["V2"]), 1, self.g)[0]
        return np.logspace(np.log10(dlo), np.log10(dhi), m)

    def hat_basis(self, dj):
        x = np.log(self.d)
        xj = np.log(dj)
        H = np.zeros((len(self.d), len(dj)))
        for j in range(len(dj)):
            e = np.zeros(len(dj)); e[j] = 1
            H[:, j] = np.interp(x, xj, e, left=0, right=0)
        return H

    def invert(self, counts, ph, m=64, lam=None):
        from scipy.optimize import nnls
        dj = self.inversion_grid(m)
        A = self.operator(ph) @ self.hat_basis(dj)
        w = 1 / np.sqrt(np.maximum(counts, 1.0))
        Aw, yw = A * w[:, None], counts * w
        L2 = np.diff(np.eye(m), 2, axis=0)
        if lam is None:
            lam = 3e-2 * np.linalg.norm(Aw, 2)
        Aaug = np.vstack([Aw, lam * L2])
        yaug = np.concatenate([yw, np.zeros(L2.shape[0])])
        x, _ = nnls(Aaug, yaug, maxiter=20 * m)
        return dj, x


def lognormal(d, modes):
    out = np.zeros_like(d)
    for N, gmd, gsd in modes:
        out += N / (np.sqrt(2 * np.pi) * np.log(gsd)) * np.exp(-(np.log(d / gmd)) ** 2 / (2 * np.log(gsd) ** 2))
    return out  # dN/dlnd


if __name__ == "__main__":
    s = Setup()
    n = lognormal(s.d, [(3000, 40e-9, 1.6), (1500, 150e-9, 1.5)])
    c, _ = s.simulate(n)
    for name, ph in [("legacy", PHYSICS_LEGACY), ("current", PHYSICS_ALL)]:
        dj, x = s.invert(c, ph)
        Ntot = np.trapezoid(x, np.log(dj))
        print(name, "N_total =", round(Ntot), "  (true in range:",
              round(np.trapezoid(np.interp(np.log(dj), np.log(s.d), n), np.log(dj))), ")")
