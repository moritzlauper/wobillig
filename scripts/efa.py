#!/usr/bin/env python3
"""Reproducible, offline exploratory factor analysis of the checked-in price data.

Run with Python dependencies from efa-requirements.txt and Node >=22.18.
No prices are imputed and no production datasets are modified.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import importlib.metadata
import json
from pathlib import Path
import subprocess
import sys
import warnings
from urllib.parse import urlparse

import numpy as np
import pandas as pd
from scipy import stats
from scipy.optimize import linear_sum_assignment
from statsmodels.multivariate.factor import Factor
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[1]
SEED = 20261102
COFFEE = [f"coffee_{s}" for s in ["espresso", "creme", "double", "cappuccino", "latte"]]
LABELS = {
    "coffee_espresso": "Espresso", "coffee_creme": "Café crème",
    "coffee_double": "Doppelter Espresso", "coffee_cappuccino": "Cappuccino",
    "coffee_latte": "Latte macchiato", "coffee_milk": "Milchkaffee",
    "beer_draft_300": "Offenbier 3 dl", "beer_draft_500": "Offenbier 5 dl",
}


def native(value):
    if isinstance(value, np.ndarray):
        return native(value.tolist())
    if isinstance(value, (np.integer, np.floating, np.bool_)):
        return native(value.item())
    if isinstance(value, float) and not np.isfinite(value):
        return None
    if isinstance(value, dict):
        return {str(k): native(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [native(v) for v in value]
    return value


def write_json(path, value):
    path.write_text(json.dumps(native(value), ensure_ascii=False, indent=2, allow_nan=False) + "\n")


def frame(rows, raw=False, aggregation="min"):
    records = []
    for row in rows:
        prices = {}
        for key, offers in row["rawOffers" if raw else "offers"].items():
            values = [o["price"] for o in offers if isinstance(o["price"], (int, float)) and np.isfinite(o["price"]) and o["price"] > 0]
            if values:
                prices[key] = min(values) if aggregation == "min" else float(np.median(values))
        records.append({"key": row["key"], "city": row["city"], "name": row["name"], **prices})
    return pd.DataFrame(records).set_index("key")


def source_clusters(rows, keys, columns):
    """Connected components sharing a selected source URL/hash or venue website host.

    These are conservative dependence proxies, not verified business ownership.
    """
    parent = {key: key for key in keys}
    def find(key):
        while parent[key] != key:
            parent[key] = parent[parent[key]]
            key = parent[key]
        return key
    seen = {}
    for row in rows:
        key = row["key"]
        if key not in parent:
            continue
        tokens = {"id:" + row["id"]}
        host = (urlparse(row.get("website") or "").hostname or "").removeprefix("www.")
        if host and host not in {"facebook.com", "instagram.com", "google.com", "maps.google.com", "linktr.ee"}:
            tokens.add("host:" + host)
        for col in columns:
            for o in row["offers"].get(col, []):
                if o["source"]:
                    tokens.add("url:" + o["source"])
                if o.get("sourceSha256"):
                    tokens.add("hash:" + o["sourceSha256"])
        for token in sorted(tokens):
            if token in seen:
                a, b = find(key), find(seen[token])
                parent[max(a, b)] = min(a, b)
            else:
                seen[token] = key
    return pd.Series({key: find(key) for key in keys}, name="source_cluster")


def corr_matrix(x):
    if not np.isfinite(x).all() or np.any(x.std(axis=0, ddof=1) < 1e-10):
        raise ValueError("Non-finite or constant variable")
    r = np.corrcoef(x, rowvar=False)
    if np.linalg.eigvalsh(r).min() <= 1e-8:
        raise ValueError("Singular/non-positive-definite correlation matrix; no smoothing")
    return r


def spectrum(r, common=False):
    work = r.copy()
    if common:
        np.fill_diagonal(work, 1 - 1 / np.diag(np.linalg.inv(r)))
    return np.linalg.eigvalsh(work)[::-1]


def parallel_analysis(x, repetitions, seed):
    """Independent column permutations; FA uses SMC diagonals in observed and null R.

    PC and SMC-FA parallel analysis are both reported, not silently interchanged.
    Retain consecutive leading roots above the pointwise 95th percentile.
    """
    rng = np.random.default_rng(seed)
    r = corr_matrix(x)
    null_pc, null_fa = [], []
    for _ in range(repetitions):
        permuted = np.column_stack([rng.permutation(x[:, j]) for j in range(x.shape[1])])
        rp = corr_matrix(permuted)
        null_pc.append(spectrum(rp))
        null_fa.append(spectrum(rp, True))
    result = {}
    for name, null, common in [("pc", null_pc, False), ("smc_fa", null_fa, True)]:
        observed = spectrum(r, common)
        threshold = np.quantile(null, .95, axis=0)
        keep = int(np.cumprod(observed > threshold).sum())
        result[name] = {"observed": observed, "null_p95": threshold, "retained": keep}
    return result


def diagnostics(r, n):
    inv = np.linalg.inv(r)
    partial = -inv / np.sqrt(np.outer(np.diag(inv), np.diag(inv)))
    np.fill_diagonal(partial, 0)
    squares = r**2
    np.fill_diagonal(squares, 0)
    kmo_items = squares.sum(axis=0) / (squares.sum(axis=0) + (partial**2).sum(axis=0))
    kmo = squares.sum() / (squares.sum() + (partial**2).sum())
    p = len(r)
    chi2 = -(n - 1 - (2 * p + 5) / 6) * np.linalg.slogdet(r)[1]
    df = p * (p - 1) // 2
    return {"kmo": kmo, "kmo_items": kmo_items, "bartlett_chi2": chi2,
            "bartlett_df": df, "bartlett_p": stats.chi2.sf(chi2, df),
            "minimum_eigenvalue": np.linalg.eigvalsh(r).min()}


def fit_factor(r, n, k):
    with warnings.catch_warnings(record=True) as caught:
        fit = Factor(corr=r, n_factor=k, method="pa", nobs=n).fit(maxiter=2000, tol=1e-9)
        if k > 1:
            fit.rotate("oblimin")
    loadings = fit.loadings.copy()
    phi = fit.rotation_matrix.T @ fit.rotation_matrix
    signs = np.where(loadings.sum(axis=0) >= 0, 1., -1.)
    loadings *= signs
    phi *= np.outer(signs, signs)
    common = loadings @ phi @ loadings.T
    # Check the fixed point rather than assuming maxiter implies convergence.
    reduced = r.copy()
    np.fill_diagonal(reduced, np.diag(common))
    ev, vec = np.linalg.eigh(reduced)
    next_l = vec[:, -k:] * np.sqrt(np.maximum(ev[-k:], 0))
    fixed_point_error = float(np.linalg.norm(np.sum(next_l**2, axis=1) - np.diag(common)))
    uniqueness = 1 - np.diag(common)
    residual = r - common
    offdiag = residual[np.triu_indices(len(r), 1)]
    df = ((len(r) - k)**2 - len(r) - k) // 2
    return {"k": k, "df": df, "loadings": loadings, "phi": phi,
            "structure": loadings @ phi, "communalities": np.diag(common),
            "uniqueness": uniqueness, "mean_communality": np.trace(common) / len(r),
            "offdiag_rmsr": np.sqrt(np.mean(offdiag**2)), "max_abs_residual": np.max(np.abs(offdiag)),
            "residual_correlation": residual - np.diag(np.diag(residual)),
            "admissible": bool(np.all(uniqueness > 0) and fixed_point_error < 1e-6 and df >= 0),
            "heywood": bool(np.any(uniqueness <= 0)), "fixed_point_error": fixed_point_error,
            "warnings": [str(w.message) for w in caught]}


def analyse(data, columns, repetitions, seed, x=None):
    x = data[columns].to_numpy(float) if x is None else np.asarray(x, float)
    r = corr_matrix(x)
    return {"n": len(x), "p": len(columns), "columns": columns,
            "cities": data.city.value_counts().to_dict() if "city" in data else {},
            "correlation": r, "diagnostics": diagnostics(r, len(x)),
            "parallel_analysis": parallel_analysis(x, repetitions, seed),
            "models": {str(k): fit_factor(r, len(x), k) for k in (1, 2)}}


def bootstrap_loadings(data, columns, clusters, k, repetitions, seed):
    """Cluster bootstrap, conditional on k; align signs/factor order to the reference."""
    rng = np.random.default_rng(seed)
    x = data[columns].to_numpy(float)
    reference = fit_factor(corr_matrix(x), len(x), k)
    groups = [np.flatnonzero(clusters.to_numpy() == label) for label in clusters.unique()]
    loadings, variance, correlations = [], [], []
    rejected = Counter()
    for _ in range(repetitions):
        indices = np.concatenate([groups[i] for i in rng.integers(len(groups), size=len(groups))])
        try:
            fit = fit_factor(corr_matrix(x[indices]), len(indices), k)
        except (ValueError, np.linalg.LinAlgError):
            rejected["numerical"] += 1
            continue
        if not fit["admissible"]:
            rejected["inadmissible"] += 1
            continue
        l = fit["loadings"]
        similarities = reference["loadings"].T @ l
        _, order = linear_sum_assignment(-np.abs(similarities))
        l = l[:, order]
        signs = np.where(np.sum(reference["loadings"] * l, axis=0) >= 0, 1., -1.)
        l *= signs
        loadings.append(l)
        variance.append(fit["mean_communality"])
        correlations.append(fit["phi"][np.ix_(order, order)] * np.outer(signs, signs))
    if not loadings:
        raise ValueError("No admissible bootstrap solutions")
    return {"requested": repetitions, "accepted": len(loadings), "rejected": dict(rejected),
            "clusters": len(groups), "loadings_ci95": np.quantile(loadings, [.025, .975], axis=0),
            "mean_communality_ci95": np.quantile(variance, [.025, .975]),
            "phi_ci95": np.quantile(correlations, [.025, .975], axis=0)}


def plot_results(result, out):
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "axes.spines.top": False,
                         "axes.spines.right": False, "savefig.dpi": 170})
    main = result["panels"]["coffee5"]
    labels = [LABELS[c] for c in main["columns"]]
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.7), constrained_layout=True)
    im = axes[0].imshow(main["correlation"], vmin=0, vmax=1, cmap="YlGnBu")
    axes[0].set_xticks(range(5), labels, rotation=35, ha="right")
    axes[0].set_yticks(range(5), labels)
    for i in range(5):
        for j in range(5):
            value = main["correlation"][i, j]
            axes[0].text(j, i, f"{value:.2f}", ha="center", va="center", color="white" if value > .7 else "black")
    axes[0].set_title(f"Korrelationen der Kaffeepreise · {main['n']} Lokale")
    loadings = main["models"]["1"]["loadings"][:, 0]
    ci = result["bootstrap"]["coffee5_one_factor"]["loadings_ci95"][:, :, 0]
    y = np.arange(5)
    axes[1].barh(y, loadings, color="#187d75", height=.6)
    axes[1].hlines(y, ci[0], ci[1], color="#182c32", linewidth=2)
    axes[1].plot(ci[0], y, "|", color="#182c32")
    axes[1].plot(ci[1], y, "|", color="#182c32")
    axes[1].set_yticks(y, labels)
    axes[1].invert_yaxis()
    axes[1].set_xlim(0, 1.03)
    axes[1].set_xlabel("Faktorladung\n95%-Intervall aus Quellen-Cluster-Bootstrap", fontsize=9)
    axes[1].set_title("Gemeinsamer Faktor: Kaffeepreisniveau")
    fig.savefig(out / "coffee-factor.png")
    plt.close(fig)
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.2), constrained_layout=True)
    for ax, name, title in zip(axes, ["pc", "smc_fa"], ["Parallelanalyse: volle Korrelationsmatrix", "Parallelanalyse: SMC-reduzierte Matrix"]):
        pa = main["parallel_analysis"][name]
        x = np.arange(1, 6)
        ax.plot(x, pa["observed"], "o-", color="#187d75", label="Beobachtet")
        ax.plot(x, pa["null_p95"], "o--", color="#bb603b", label="Zufall: 95. Perzentil")
        ax.set_xticks(x)
        ax.set_xlabel("Geordnete Eigenwerte")
        ax.set_ylabel("Eigenwert")
        ax.set_title(title, fontsize=11)
        ax.legend()
    fig.savefig(out / "parallel-analysis.png")
    plt.close(fig)
    six = result["panels"]["coffee6"]
    fig, ax = plt.subplots(figsize=(7.7, 4.6), constrained_layout=True)
    l = six["models"]["2"]["loadings"]
    ax.imshow(l, vmin=-1, vmax=1, cmap="RdBu", aspect="auto")
    ax.set_yticks(range(6), [LABELS[c] for c in six["columns"]])
    ax.set_xticks([0, 1], ["Milchgetränke-geprägte\nPreisachse", "Espresso-geprägte\nPreisachse"])
    for i in range(6):
        for j in range(2):
            ax.text(j, i, f"{l[i, j]:.2f}", ha="center", va="center", color="white" if abs(l[i,j]) > .6 else "black", fontsize=12)
    phi = six["models"]["2"]["phi"][0, 1]
    ax.set_title(f"Ergänzende EFA: sechs Kaffeepreise · {six['n']} Lokale\nZwei korrelierte Faktoren (r = {phi:.2f}); Faktorenzahl methodenabhängig", fontsize=11)
    ax.set_xlabel("Oblimin-rotierte Musterladungen; Bezeichnungen sind Interpretationen", fontsize=9)
    fig.savefig(out / "coffee-six-factors.png")
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--as-of", default="2026-11-02")
    parser.add_argument("--output", type=Path, default=ROOT / "output/efa/2026-11-02")
    parser.add_argument("--permutations", type=int, default=1000)
    parser.add_argument("--bootstraps", type=int, default=1000)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    raw = json.loads(subprocess.check_output(["node", str(ROOT / "scripts/efa-features.mjs"), args.as_of], cwd=ROOT))
    data = frame(raw["rows"])
    panels = {"coffee5": COFFEE, "coffee6": COFFEE + ["coffee_milk"],
              "coffee_beer7": COFFEE + ["beer_draft_300", "beer_draft_500"]}
    result = {"as_of": args.as_of, "seed": SEED, "permutations": args.permutations, "bootstraps": args.bootstraps,
              "python_version": sys.version, "node_version": subprocess.check_output(["node", "--version"], text=True).strip(),
              "versions": {p: importlib.metadata.version(p) for p in ["numpy", "pandas", "scipy", "statsmodels", "matplotlib"]},
              "inventory": raw["inventory"], "exclusions": raw["exclusions"], "coverage": {},
              "panels": {}, "sensitivity": {}, "bootstrap": {},
              "code_sha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path(__file__), ROOT / "scripts/efa-features.mjs"]}}
    for prefix in ["coffee_", "pizza_", "cocktail_", "softdrink_", "beer_"]:
        columns = [c for c in data if c.startswith(prefix)]
        counts = data[columns].notna().sum().sort_values(ascending=False)
        chosen = counts.index[:5].tolist()
        result["coverage"][prefix] = {"priced_venues": int(data[columns].notna().any(axis=1).sum()),
            "per_variable": counts.to_dict(), "top5_columns": chosen,
            "complete_top5": len(data.dropna(subset=chosen))}
    for i, (name, columns) in enumerate(panels.items()):
        complete = data.dropna(subset=columns).copy()
        clusters = source_clusters(raw["rows"], complete.index, columns)
        result["panels"][name] = analyse(complete, columns, args.permutations, SEED + i)
        result["panels"][name]["source_clusters"] = clusters.nunique()
        result["panels"][name]["descriptive"] = complete[columns].describe().to_dict()
        result["panels"][name]["cluster_sizes"] = clusters.value_counts().tolist()
        export = complete[["city", "name"] + columns].copy()
        export["source_cluster"] = clusters
        fit = result["panels"][name]["models"]["1"]
        x = complete[columns].to_numpy()
        z = (x - x.mean(axis=0)) / x.std(axis=0, ddof=1)
        weights = np.linalg.solve(corr_matrix(x), fit["loadings"])
        export["one_factor_regression_score"] = (z @ weights)[:, 0]
        write_json(args.output / f"{name}-rows.json", export.reset_index().to_dict(orient="records"))
        # Minimal per-cell provenance makes every selected price inspectable.
        selected = set(complete.index)
        write_json(args.output / f"{name}-provenance.json", [
            {"key": row["key"], "name": row["name"], "offers": {c: row["offers"][c] for c in columns}}
            for row in raw["rows"] if row["key"] in selected])
        print(name, "n", len(complete), "KMO", round(result["panels"][name]["diagnostics"]["kmo"], 3),
              "PA", {key: value["retained"] for key, value in result["panels"][name]["parallel_analysis"].items()}, flush=True)

    complete = data.dropna(subset=COFFEE).copy()
    clusters = source_clusters(raw["rows"], complete.index, COFFEE)
    x = complete[COFFEE].to_numpy(float)
    variants = {
        "uncleaned_prices": (frame(raw["rows"], raw=True).dropna(subset=COFFEE), None),
        "median_instead_of_minimum": (frame(raw["rows"], aggregation="median").dropna(subset=COFFEE), None),
        "log_prices": (complete, np.log(x)),
        "spearman": (complete, stats.rankdata(x, axis=0)),
        "within_city_centered": (complete, (complete[COFFEE] - complete.groupby("city")[COFFEE].transform("mean")).to_numpy()),
        "winsorized_1_99": (complete, np.clip(x, *np.quantile(x, [.01, .99], axis=0))),
        "source_cluster_medians": (complete[COFFEE].groupby(clusters).median(), None),
        "zurich_only": (complete[complete.city == "zurich"], None),
    }
    for city in sorted(complete.city.unique()):
        variants[f"leave_out_{city}"] = (complete[complete.city != city], None)
    for i, (name, (subset, transformed)) in enumerate(variants.items()):
        result["sensitivity"][name] = analyse(subset, COFFEE, args.permutations, SEED + 100 + i, transformed)
    # Repeat the smaller six-item panel under city adjustment and dependence control.
    six = data.dropna(subset=panels["coffee6"])
    six_clusters = source_clusters(raw["rows"], six.index, panels["coffee6"])
    for i, (name, subset, transformed) in enumerate([
        ("coffee6_within_city", six, (six[panels["coffee6"]] - six.groupby("city")[panels["coffee6"]].transform("mean")).to_numpy()),
        ("coffee6_source_clusters", six[panels["coffee6"]].groupby(six_clusters).median(), None),
        ("coffee6_spearman", six, stats.rankdata(six[panels["coffee6"]].to_numpy(), axis=0)),
    ]):
        result["sensitivity"][name] = analyse(subset, panels["coffee6"], args.permutations, SEED + 200 + i, transformed)
    print("Sensitivity analyses complete", flush=True)
    result["bootstrap"]["coffee5_one_factor"] = bootstrap_loadings(complete, COFFEE, clusters, 1, args.bootstraps, SEED + 300)
    result["bootstrap"]["coffee6_two_factors"] = bootstrap_loadings(six, panels["coffee6"], six_clusters, 2, args.bootstraps, SEED + 301)

    ml = Factor(corr=corr_matrix(x), n_factor=1, method="ml", nobs=len(x)).fit()
    ml_loadings = np.abs(ml.loadings[:, 0])
    result["verification"] = {"ml_one_factor_converged": bool(ml.mle_retvals.success),
        "ml_one_factor_loadings": ml_loadings,
        "max_loading_difference_pa_vs_ml": np.max(np.abs(ml_loadings - result["panels"]["coffee5"]["models"]["1"]["loadings"][:, 0]))}

    coffee_any = data[data[[c for c in data if c.startswith("coffee_")]].notna().any(axis=1)]
    result["selection"] = {"coffee_venues": len(coffee_any), "complete_fraction": len(complete) / len(coffee_any),
        "all_coffee_cities": coffee_any.city.value_counts().to_dict(),
        "all_espresso_median": coffee_any.coffee_espresso.median(),
        "complete_espresso_median": complete.coffee_espresso.median()}
    # Provenance integrity: fail if a source file changed during the analysis.
    for entry in raw["inventory"]:
        actual = hashlib.sha256((ROOT / entry["file"]).read_bytes()).hexdigest()
        if actual != entry["sha256"]:
            raise RuntimeError(f"Dataset changed during analysis: {entry['file']}")
    write_json(args.output / "results.json", result)
    plot_results(result, args.output)
    print("Results:", args.output, flush=True)


if __name__ == "__main__":
    main()
