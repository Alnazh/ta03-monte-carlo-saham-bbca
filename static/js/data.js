/* Halaman Data dan cleaning */
const $ = (id) => document.getElementById(id);
const fmtSigned = (p, d = 2) => (p >= 0 ? "+" : "") + nf(d).format(p * 100) + "%";

fetch("/api/data").then((r) => r.json()).then((d) => {
  const p = d.params;

  /* ---- kartu ringkas ---- */
  const tile = (cls, label, value, sub) =>
    `<div class="tile tile-${cls}"><div class="tile-label">${label}</div><div class="tile-value">${value}</div><div class="tile-sub">${sub}</div></div>`;
  $("kpis").innerHTML =
    tile("cobalt", "Periode data", `${d.periode[0]}`, `sampai ${d.periode[1]}`) +
    tile("violet", "Jumlah return dipakai", fmtInt(p.n_return), `dari ${fmtInt(d.n_price_rows)} hari perdagangan`) +
    tile("sun", "Harga awal simulasi", fmtRp(p.s0), "Penutupan terakhir") +
    tile("mint", "Mean return harian (mu)", nf(4).format(p.mu * 100) + "%", "Rata-rata kenaikan per hari") +
    tile("coral", "Standar deviasi (sigma)", nf(4).format(p.sigma * 100) + "%", "Seberapa besar harga bergoyang per hari") +
    tile("cobalt", "Kurtosis berlebih", nf(2).format(p.kurt), `Skewness ${nf(2).format(p.skew)}`);

  /* ---- grafik harga ---- */
  new Chart($("priceChart"), {
    type: "line",
    data: {
      labels: d.price.dates,
      datasets: [{
        label: "Harga penutupan", data: d.price.close, borderColor: COLORS.cobalt, borderWidth: 2,
        pointRadius: 0, tension: 0.15, fill: true,
        backgroundColor: (ctx) => {
          const a = ctx.chart.chartArea; if (!a) return "rgba(61,90,254,.1)";
          const g = ctx.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
          g.addColorStop(0, "rgba(61,90,254,.28)"); g.addColorStop(1, "rgba(61,90,254,0)"); return g;
        },
      }],
    },
    options: {
      maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, callback(v) { return this.getLabelForValue(v).slice(0, 7); } } },
        y: { ticks: { callback: (v) => fmtInt(v) }, title: { display: true, text: "Harga (Rp)" } },
      },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (it) => fmtRp(it.parsed.y) } } },
    },
  });
  const first = d.price.close[0], last = d.price.close[d.price.close.length - 1];
  $("priceNote").textContent =
    `Dari ${fmtRp(first)} pada awal periode menjadi ${fmtRp(last)} di hari terakhir. Harga hari terakhir menjadi harga awal simulasi.`;

  /* penjelasan grafik harga */
  const closes = d.price.close, dates = d.price.dates;
  let imax = 0, imin = 0;
  closes.forEach((c, i) => { if (c > closes[imax]) imax = i; if (c < closes[imin]) imin = i; });
  const bulan = (iso) => new Date(iso).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  const fromPeak = (last - closes[imax]) / closes[imax];
  $("priceExplain").innerHTML =
    `Garis naik berarti harga naik, garis turun berarti harga turun. ` +
    `Harga tertinggi pernah mencapai <b>${fmtRp(closes[imax])}</b> (${bulan(dates[imax])}) dan terendah <b>${fmtRp(closes[imin])}</b> (${bulan(dates[imin])}). ` +
    `Harga terakhir <b>${fmtRp(last)}</b>, ${fromPeak < 0 ? "turun" : "naik"} <b>${nf(1).format(Math.abs(fromPeak) * 100)}%</b> dari titik tertingginya. ` +
    `Angka terakhir inilah yang dipakai sebagai titik awal simulasi.`;

  /* ---- histogram return + kurva normal ---- */
  new Chart($("retChart"), {
    data: {
      labels: d.hist.centers,
      datasets: [
        { type: "bar", label: "Data return", data: d.hist.density, backgroundColor: "rgba(139,92,246,.65)", borderRadius: 2, categoryPercentage: 1, barPercentage: 0.95, order: 2 },
        { type: "line", label: "Kurva normal", data: d.hist.pdf, borderColor: "#f5a700", borderWidth: 3, pointRadius: 0, tension: 0.35, order: 1 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false }, title: { display: true, text: "Return harian" },
             ticks: { maxTicksLimit: 7, callback(v) { return nf(1).format(this.getLabelForValue(v) * 100) + "%"; } } },
        y: { title: { display: true, text: "Kepadatan" }, ticks: { display: false }, grid: { display: false } },
      },
      plugins: {
        legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } },
        tooltip: { callbacks: { title: (it) => "Return " + fmtSigned(Number(it[0].label)), label: () => "" } },
      },
    },
  });
  const lo = p.mu - p.sigma, hi = p.mu + p.sigma;
  $("retExplain").innerHTML =
    `Return harian adalah persentase naik-turunnya harga dalam sehari. Batang di sebelah kanan angka 0 adalah hari harga naik, di sebelah kiri adalah hari harga turun, dan makin tinggi batang berarti makin sering terjadi. ` +
    `Rata-rata per hari hanya <b>${nf(4).format(p.mu * 100)}%</b> (hampir nol), tetapi harga bergoyang sekitar <b>${nf(2).format(p.sigma * 100)}%</b> per hari (sigma). ` +
    `Pada distribusi normal, sekitar 68% hari berada di antara ${fmtSigned(lo)} dan ${fmtSigned(hi)}. ` +
    `Kurtosis berlebih ${nf(2).format(p.kurt)} ${p.kurt > 0 ? "(positif) berarti ekornya sedikit lebih tebal dari kurva normal: kejadian ekstrem bisa lebih sering dari perkiraan model." : "berarti ekornya tidak lebih tebal dari kurva normal."}`;

  /* ---- tabel cleaning ---- */
  $("cleanTable").querySelector("tbody").innerHTML = d.cleaning.map((c) =>
    `<tr><td>${c.tahap}<small>${c.ket}</small></td><td class="num">${fmtInt(c.baris)}</td>
     <td class="num ${c.ubah < 0 ? "neg" : ""}">${c.ubah === 0 ? "-" : fmtInt(c.ubah)}</td></tr>`).join("");

  /* ---- tabel outlier ---- */
  $("outNote").innerHTML =
    `Metode IQR dengan faktor 3: return di luar ${fmtSigned(p.low)} sampai ${fmtSigned(p.high)} dianggap ekstrem. Ada <b>${p.n_outlier}</b> return seperti ini; berikut 8 yang terbesar. ` +
    `Banyak di antaranya kejadian pasar yang nyata, jadi membuangnya adalah keputusan analisis: sigma menjadi ${nf(4).format(p.sigma * 100)}% (dibuang) dibanding ${nf(4).format(d.params_raw.sigma * 100)}% (tidak dibuang).`;
  $("outTable").querySelector("tbody").innerHTML = d.outliers.map((o) =>
    `<tr><td>${o.date}</td><td class="num">${fmtRp(o.close)}</td>
     <td class="num ${o.ret < 0 ? "neg" : "pos"}">${fmtSigned(o.ret)}</td><td class="num">${fmtInt(o.volume)}</td></tr>`).join("");
});
