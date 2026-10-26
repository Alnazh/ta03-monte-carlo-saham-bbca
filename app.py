"""
Alur:
  Langkah 1  Data yang sudah dibersihkan -> parameter mu & sigma dari return harian
  Langkah 2  Simulasi: price_t = price_t-1 * (1 + return_acak), return ~ Normal(mu, sigma)
  Langkah 3  Probabilitas = skenario yang memenuhi kondisi / total skenario
"""
from pathlib import Path

import numpy as np
import pandas as pd
from flask import Flask, jsonify, render_template, request

BASE_DIR = Path(__file__).resolve().parent
DATA_PATH = BASE_DIR / "data" / "BBCA_clean.csv"

# ------------------------------------------------------------------ batas input
SEED_DEFAULT = 301240010          # NIM
LIMITS = {
    "n_sim": (5000, 100000),      # modul: minimal 5.000 iterasi
    "n_days": (5, 120),
    "threshold_pct": (1.0, 50.0),
}
IQR_FACTOR = 3                    # outlier ekstrem (sama dengan notebook)

app = Flask(__name__)


# ------------------------------------------------------------------ data
def load_data():
    df = pd.read_csv(DATA_PATH, parse_dates=["Date"])
    df = df.sort_values("Date").reset_index(drop=True)
    return df


DF = load_data()
RETURNS_ALL = DF["Return"].dropna().to_numpy()
S0 = float(DF["Close"].iloc[-1])
LAST_DATE = DF["Date"].iloc[-1]


def iqr_bounds(r, factor=IQR_FACTOR):
    q1, q3 = np.percentile(r, [25, 75])
    iqr = q3 - q1
    return q1 - factor * iqr, q3 + factor * iqr


def get_params(remove_outlier):
    """mu & sigma dari return harian (std sampel, sama dengan pandas .std())."""
    r = RETURNS_ALL
    low, high = iqr_bounds(r)
    mask = (r >= low) & (r <= high)
    used = r[mask] if remove_outlier else r
    return {
        "mu": float(used.mean()),
        "sigma": float(used.std(ddof=1)),
        "n_return": int(used.size),
        "n_outlier": int((~mask).sum()),
        "low": float(low),
        "high": float(high),
    }


# ------------------------------------------------------------------ simulasi
def run_simulation(n_sim, n_days, threshold_pct, seed, remove_outlier):
    p = get_params(remove_outlier)
    rng = np.random.RandomState(seed)
    rets = rng.normal(p["mu"], p["sigma"], size=(n_sim, n_days))

    paths = np.empty((n_sim, n_days + 1))
    paths[:, 0] = S0
    paths[:, 1:] = S0 * np.cumprod(1 + rets, axis=1)

    final = paths[:, -1]
    threshold = S0 * (1 - threshold_pct / 100)
    hit = final < threshold
    return p, paths, final, threshold, hit


def build_response(n_sim, n_days, threshold_pct, seed, remove_outlier):
    p, paths, final, threshold, hit = run_simulation(
        n_sim, n_days, threshold_pct, seed, remove_outlier
    )
    n_hit = int(hit.sum())
    prob = n_hit / n_sim

    # histogram harga akhir
    counts, edges = np.histogram(final, bins=50)

    # pita persentil per hari (untuk grafik jalur)
    pct = np.percentile(paths, [5, 25, 50, 75, 95], axis=0)
    sample_idx = np.arange(min(40, n_sim))

    # tabel probabilitas untuk beberapa batas penurunan
    change = (final - S0) / S0
    table = [
        {"batas": b, "prob": float((change < -b / 100).mean())}
        for b in (5, 10, 15, 20)
    ]

    # pembanding: hasil bila pengaturan outlier dibalik (seed sama)
    _, _, _, _, hit_alt = run_simulation(
        n_sim, n_days, threshold_pct, seed, not remove_outlier
    )

    return {
        "input": {
            "n_sim": n_sim, "n_days": n_days, "threshold_pct": threshold_pct,
            "seed": seed, "remove_outlier": remove_outlier,
        },
        "params": {"mu": p["mu"], "sigma": p["sigma"], "n_return": p["n_return"], "s0": S0},
        "threshold": float(threshold),
        "n_hit": n_hit,
        "prob": prob,
        "prob_touch": float((paths.min(axis=1) < threshold).mean()),
        "prob_alt": float(hit_alt.mean()),
        "stats": {
            "mean": float(final.mean()),
            "median": float(np.median(final)),
            "min": float(final.min()),
            "max": float(final.max()),
            "p5": float(np.percentile(final, 5)),
            "p95": float(np.percentile(final, 95)),
        },
        "hist": {
            "edges": [float(x) for x in edges],
            "counts": [int(x) for x in counts],
        },
        "bands": {
            "days": list(range(n_days + 1)),
            "p5": pct[0].round(1).tolist(),
            "p25": pct[1].round(1).tolist(),
            "p50": pct[2].round(1).tolist(),
            "p75": pct[3].round(1).tolist(),
            "p95": pct[4].round(1).tolist(),
            "paths": paths[sample_idx].round(1).tolist(),
        },
        "table": table,
    }


def parse_inputs(payload):
    """Validasi input dari form. Mengembalikan (nilai, pesan_error)."""
    try:
        n_sim = int(payload.get("n_sim", 10000))
        n_days = int(payload.get("n_days", 30))
        threshold_pct = float(payload.get("threshold_pct", 10))
        seed = int(payload.get("seed", SEED_DEFAULT))
    except (TypeError, ValueError):
        return None, "Semua isian harus berupa angka."

    remove_outlier = bool(payload.get("remove_outlier", True))

    for key, val in (("n_sim", n_sim), ("n_days", n_days), ("threshold_pct", threshold_pct)):
        lo, hi = LIMITS[key]
        if not lo <= val <= hi:
            names = {"n_sim": "Jumlah skenario", "n_days": "Jumlah hari",
                     "threshold_pct": "Batas penurunan (%)"}
            return None, f"{names[key]} harus antara {lo:,.0f} dan {hi:,.0f}.".replace(",", ".")
    if not 0 <= seed <= 2**32 - 1:
        return None, "Seed harus antara 0 dan 4294967295."

    return (n_sim, n_days, threshold_pct, seed, remove_outlier), None


# ------------------------------------------------------------------ halaman
@app.route("/")
def simulasi():
    return render_template(
        "simulasi.html", page="simulasi", s0=S0, last_date=LAST_DATE.strftime("%d %b %Y"),
        limits=LIMITS, seed=SEED_DEFAULT,
    )


@app.route("/data")
def data_page():
    return render_template("data.html", page="data")


@app.route("/metode")
def metode():
    return render_template("metode.html", page="metode", s0=S0, seed=SEED_DEFAULT)


# ------------------------------------------------------------------ API
@app.route("/api/simulate", methods=["POST"])
def api_simulate():
    values, err = parse_inputs(request.get_json(silent=True) or {})
    if err:
        return jsonify({"error": err}), 400
    return jsonify(build_response(*values))


@app.route("/api/data")
def api_data():
    p_clean = get_params(True)
    p_raw = get_params(False)
    r = RETURNS_ALL
    low, high = p_clean["low"], p_clean["high"]
    mask = (r >= low) & (r <= high)
    r_clean = r[mask]

    # histogram return + kurva normal
    counts, edges = np.histogram(r_clean, bins=60, density=True)
    centers = (edges[:-1] + edges[1:]) / 2
    mu, sigma = p_clean["mu"], p_clean["sigma"]
    pdf = np.exp(-0.5 * ((centers - mu) / sigma) ** 2) / (sigma * np.sqrt(2 * np.pi))

    z = (r_clean - r_clean.mean()) / r_clean.std()   # skew & kurtosis populasi (seperti scipy)
    skew = float((z ** 3).mean())
    kurt = float((z ** 4).mean() - 3)

    # daftar outlier terbesar
    d = DF.dropna(subset=["Return"])
    out = d[(d["Return"] < low) | (d["Return"] > high)].copy()
    out = out.reindex(out["Return"].abs().sort_values(ascending=False).index).head(8)
    outliers = [
        {"date": row.Date.strftime("%d %b %Y"), "close": float(row.Close),
         "ret": float(row.Return), "volume": int(row.Volume)}
        for row in out.itertuples()
    ]

    return jsonify({
        "periode": [DF["Date"].iloc[0].strftime("%d %b %Y"), LAST_DATE.strftime("%d %b %Y")],
        "n_price_rows": int(len(DF)),
        "params": {**p_clean, "s0": S0, "skew": skew, "kurt": kurt},
        "params_raw": {"mu": p_raw["mu"], "sigma": p_raw["sigma"], "n_return": p_raw["n_return"]},
        "cleaning": [
            {"tahap": "Data awal (dataset Kaggle)", "baris": 1896, "ubah": 0,
             "ket": "Tidak ada null, duplikat, atau harga tidak valid"},
            {"tahap": "Hapus hari tanpa transaksi", "baris": 1881, "ubah": -15,
             "ket": "Volume = 0 (hari libur bursa, harga hanya salinan hari sebelumnya)"},
            {"tahap": "Hitung return harian", "baris": 1880, "ubah": -1,
             "ket": "Baris pertama tidak punya hari sebelumnya"},
            {"tahap": "Buang outlier ekstrem (IQR x 3)", "baris": int(r_clean.size),
             "ubah": int(r_clean.size - r.size),
             "ket": f"Return di luar {low*100:.2f}% sampai {high*100:.2f}%"},
        ],
        "price": {
            "dates": DF["Date"].dt.strftime("%Y-%m-%d").tolist(),
            "close": DF["Close"].tolist(),
        },
        "hist": {
            "centers": [round(float(c), 5) for c in centers],
            "density": [float(x) for x in counts],
            "pdf": [float(x) for x in pdf],
        },
        "outliers": outliers,
    })


if __name__ == "__main__":
    app.run(debug=True)
