/* Halaman Simulasi: kirim pengaturan ke server, lalu gambar hasilnya */
const DEFAULTS = { n_sim: 10000, n_days: 30, threshold_pct: 10, seed: window.APP.seed, remove_outlier: true };
const $ = (id) => document.getElementById(id);

const form = $("simForm");
const runBtn = $("runBtn");
const errBox = $("formError");
let fanChart = null, histChart = null;

/* ---------- waffle 10x10 ---------- */
const waffle = $("waffle");
for (let i = 0; i < 100; i++) waffle.appendChild(document.createElement("span"));

function paintWaffle(prob) {
  const risk = Math.round(prob * 100);
  [...waffle.children].forEach((el, i) => {
    const row = Math.floor(i / 10), col = i % 10;
    const rank = (9 - row) * 10 + col;           // isi dari baris bawah ke atas
    const on = rank < risk;
    el.style.transitionDelay = on ? `${rank * 6}ms` : "0ms";
    el.classList.toggle("risk", on);
  });
  waffle.setAttribute("aria-label", `Sekitar ${risk} dari 100 titik berwarna merah, artinya peluang turun melewati batas sekitar ${risk} persen`);
}

/* ---------- baca & validasi form ---------- */
function readForm() {
  return {
    n_sim: Number($("n_sim").value),
    n_days: Number($("n_days").value),
    threshold_pct: Number($("threshold_pct").value),
    seed: Number($("seed").value),
    remove_outlier: $("remove_outlier").checked,
  };
}
function showError(msg) { errBox.textContent = msg; errBox.hidden = !msg; }

function setForm(v) {
  $("n_sim").value = v.n_sim; $("n_days").value = v.n_days;
  $("threshold_pct").value = v.threshold_pct; $("seed").value = v.seed;
  $("remove_outlier").checked = v.remove_outlier;
  updateHints();
}
function updateHints() {
  const days = Number($("n_days").value), thr = Number($("threshold_pct").value);
  $("daysOut").textContent = days;
  $("thrOut").textContent = thr;
  const bulan = days / 21;
  $("daysNote").textContent = `Sekitar ${nf(1).format(bulan)} bulan kalender (1 bulan = 21 hari bursa).`;
  $("thrNote").textContent = `Berarti harga di bawah ${fmtRp(window.APP.s0 * (1 - thr / 100))} dianggap berisiko.`;
}
$("n_days").addEventListener("input", updateHints);
$("threshold_pct").addEventListener("input", updateHints);
$("resetBtn").addEventListener("click", () => { setForm(DEFAULTS); showError(""); run(); });

form.addEventListener("submit", (e) => { e.preventDefault(); run(); });

async function run() {
  const body = readForm();
  if (!Number.isInteger(body.n_sim) || body.n_sim < 5000) {
    showError("Jumlah skenario minimal 5.000."); return;
  }
  if (!Number.isInteger(body.seed) || body.seed < 0) {
    showError("Seed harus berupa bilangan bulat 0 atau lebih."); return;
  }
  showError("");
  runBtn.disabled = true; runBtn.textContent = "Menghitung...";
  try {
    const res = await fetch("/api/simulate", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { showError(data.error || "Simulasi gagal dijalankan."); return; }
    render(data);
  } catch (err) {
    showError("Tidak bisa terhubung ke server. Pastikan aplikasi Flask masih berjalan.");
  } finally {
    runBtn.disabled = false; runBtn.textContent = "Jalankan simulasi";
  }
}

/* ---------- tampilkan hasil ---------- */
function render(d) {
  const inp = d.input;
  $("heroQ").textContent = `Berapa peluang harga BBCA turun lebih dari ${nf(0).format(inp.threshold_pct)}% dalam ${inp.n_days} hari?`;
  countUp($("probBig"), d.prob, (v) => fmtPct(v));
  $("probSentence").innerHTML =
    `Dari <b>${fmtInt(inp.n_sim)}</b> skenario, <b>${fmtInt(d.n_hit)}</b> berakhir di bawah <b>${fmtRp(d.threshold)}</b> pada hari ke-${inp.n_days}.`;
  $("chipTouch").innerHTML = `Sempat menyentuh batas di hari mana pun: <b>${fmtPct(d.prob_touch)}</b>`;
  $("chipAlt").innerHTML = inp.remove_outlier
    ? `Jika outlier tidak dibuang: <b>${fmtPct(d.prob_alt)}</b>`
    : `Jika outlier dibuang: <b>${fmtPct(d.prob_alt)}</b>`;
  paintWaffle(d.prob);

  renderTiles(d);
  renderFan(d);
  renderHist(d);
  renderTable(d);
  renderExplain(d);
}

/* ---------- kalimat penjelasan (berubah mengikuti hasil) ---------- */
function perSeratus(p) {
  const n = Math.round(p * 100);
  if (n === 0) return p > 0 ? "kurang dari 1" : "hampir tidak ada";
  return `sekitar ${n}`;
}
function renderExplain(d) {
  const inp = d.input, s0 = d.params.s0, last = d.bands.days.length - 1;
  const b = d.bands, st = d.stats;
  const p25 = b.p25[last], p75 = b.p75[last];
  const nSim = fmtInt(inp.n_sim);

  // kartu ringkasan
  $("tilesExplain").innerHTML =
    `Median adalah harga di tengah-tengah, separuh skenario berakhir lebih tinggi dan separuhnya lebih rendah. ` +
    `Skenario buruk (persentil 5) berarti hanya 5% skenario yang berakhir lebih rendah dari <b>${fmtRp(st.p5)}</b>. ` +
    `Skenario baik (persentil 95) berarti hanya 5% skenario yang berakhir lebih tinggi dari <b>${fmtRp(st.p95)}</b>.`;

  // grafik jalur harga
  const lowTail = st.p5 < d.threshold
    ? `Ujung bawah pita ungu muda sudah turun melewati garis merah, itulah skenario yang berisiko.`
    : `Ujung bawah pita ungu muda masih di atas garis merah, jadi skenario berisiko sangat sedikit.`;
  $("fanExplain").innerHTML =
    `Bayangkan harga hari ini (<b>${fmtRp(s0)}</b>) dimainkan ${nSim} kali untuk ${inp.n_days} hari ke depan. ` +
    `Setiap garis tipis adalah satu kemungkinan. Garis biru tebal (median) berakhir di <b>${fmtRp(st.median)}</b>. ` +
    `Pita ungu tua memuat 50% skenario (harga akhir ${fmtRp(p25)} sampai ${fmtRp(p75)}), pita ungu muda memuat 90% skenario (${fmtRp(st.p5)} sampai ${fmtRp(st.p95)}). ` +
    `Pita melebar ke kanan karena makin jauh ke depan, makin tidak pasti. ` +
    `Garis merah putus-putus adalah batas risiko <b>${fmtRp(d.threshold)}</b>. ${lowTail}`;

  // histogram
  const { edges, counts } = d.hist;
  let mi = 0; counts.forEach((c, i) => { if (c > counts[mi]) mi = i; });
  const mode = (edges[mi] + edges[mi + 1]) / 2;
  const n100 = perSeratus(d.prob);
  const verdict = d.n_hit === 0
    ? `Tidak ada satu pun skenario yang jatuh melewati batas, jadi menurut model ini risikonya sangat kecil (bukan berarti mustahil).`
    : `Artinya, kalau pola harga selama ini terus berlaku, ${n100} dari 100 kemungkinan membuat harga turun lebih dari ${nf(0).format(inp.threshold_pct)}% dalam ${inp.n_days} hari. Sebaliknya, <b>${fmtPct(1 - d.prob)}</b> skenario tidak melewati batas.`;
  $("histExplain").innerHTML =
    `Tinggi setiap batang menunjukkan berapa banyak skenario yang harganya berakhir di kisaran itu pada hari ke-${inp.n_days}. ` +
    `Batang merah berada di bawah batas ${fmtRp(d.threshold)}, jumlahnya <b>${fmtInt(d.n_hit)}</b> dari ${nSim} skenario, atau <b>${fmtPct(d.prob)}</b>. ${verdict} ` +
    `Batang tertinggi ada di sekitar ${fmtRp(mode)}, artinya paling banyak skenario berakhir di harga itu.`;

  // tabel
  const t = d.table, first = t[0], lastRow = t[t.length - 1];
  const cur = t.find((r) => Math.abs(r.batas - inp.threshold_pct) < 1e-9);
  const curTxt = cur
    ? `Baris yang disorot kuning adalah pengaturanmu sekarang (${cur.batas}%).`
    : `Pengaturanmu sekarang (${nf(0).format(inp.threshold_pct)}%) tidak ada di tabel, hasilnya ada di angka besar bagian atas halaman.`;
  $("tableExplain").innerHTML =
    `Makin besar penurunan yang ditanyakan, makin kecil peluangnya, karena penurunan besar lebih jarang terjadi. ` +
    `Peluang turun lebih dari ${first.batas}% adalah <b>${fmtPct(first.prob)}</b>, sedangkan turun lebih dari ${lastRow.batas}% hanya <b>${fmtPct(lastRow.prob)}</b>. ${curTxt}`;
}

function tile(cls, label, value, sub) {
  return `<div class="tile tile-${cls}"><div class="tile-label">${label}</div>
          <div class="tile-value">${value}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ""}</div>`;
}
function renderTiles(d) {
  const ch = (v) => { const c = (v - d.params.s0) / d.params.s0; return (c >= 0 ? "+" : "") + nf(1).format(c * 100) + "% dari harga awal"; };
  $("tiles").innerHTML =
    tile("coral", "Batas risiko", fmtRp(d.threshold), `Harga awal ${fmtRp(d.params.s0)}`) +
    tile("cobalt", "Median harga akhir", fmtRp(d.stats.median), ch(d.stats.median)) +
    tile("sun", "Skenario buruk (persentil 5)", fmtRp(d.stats.p5), ch(d.stats.p5)) +
    tile("mint", "Skenario baik (persentil 95)", fmtRp(d.stats.p95), ch(d.stats.p95));
}

/* ---------- grafik jalur harga ---------- */
function renderFan(d) {
  const b = d.bands, n = b.days.length;
  const base = { pointRadius: 0, tension: 0.25 };
  const ds = [
    { ...base, label: "Persentil 5", data: b.p5, borderWidth: 0, fill: false },
    { ...base, label: "Persentil 95", data: b.p95, borderWidth: 0, fill: "-1", backgroundColor: "rgba(139,92,246,.20)" },
    { ...base, label: "Persentil 25", data: b.p25, borderWidth: 0, fill: false },
    { ...base, label: "Persentil 75", data: b.p75, borderWidth: 0, fill: "-1", backgroundColor: "rgba(139,92,246,.38)" },
    ...b.paths.map((p) => ({ ...base, label: "Jalur", data: p, borderColor: "rgba(61,90,254,.16)", borderWidth: 1, fill: false })),
    { ...base, label: "Median", data: b.p50, borderColor: COLORS.cobalt, borderWidth: 3, fill: false },
    { ...base, label: "Batas risiko", data: Array(n).fill(d.threshold), borderColor: COLORS.coral, borderWidth: 2.5, borderDash: [8, 6], fill: false },
  ];
  const cfg = {
    type: "line",
    data: { labels: b.days, datasets: ds },
    options: {
      maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      scales: {
        x: { title: { display: true, text: "Hari ke-" }, grid: { display: false }, ticks: { maxTicksLimit: 10 } },
        y: { ticks: { callback: (v) => fmtInt(v) }, title: { display: true, text: "Harga (Rp)" } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (it) => it.dataset.label !== "Jalur",
          callbacks: {
            title: (items) => `Hari ke-${items[0].label}`,
            label: (it) => `${it.dataset.label}: ${fmtRp(it.parsed.y)}`,
          },
        },
      },
    },
  };
  if (fanChart) fanChart.destroy();
  fanChart = new Chart($("fanChart"), cfg);
}

/* ---------- histogram harga akhir ---------- */
function renderHist(d) {
  const { edges, counts } = d.hist;
  const mids = counts.map((_, i) => (edges[i] + edges[i + 1]) / 2);
  const colors = mids.map((m) => (m < d.threshold ? COLORS.coral : COLORS.cobalt));
  const min = edges[0], max = edges[edges.length - 1];
  const cfg = {
    type: "bar",
    data: { labels: mids, datasets: [{ data: counts, backgroundColor: colors, borderRadius: 3, categoryPercentage: 1, barPercentage: 0.94 }] },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false }, title: { display: true, text: `Harga pada hari ke-${d.input.n_days} (Rp)` },
             ticks: { maxTicksLimit: 8, callback(v) { return fmtInt(this.getLabelForValue(v)); } } },
        y: { title: { display: true, text: "Jumlah skenario" }, ticks: { callback: (v) => fmtInt(v) } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => { const i = items[0].dataIndex; return `${fmtRp(edges[i])} sampai ${fmtRp(edges[i + 1])}`; },
            label: (it) => `${fmtInt(it.parsed.y)} skenario`,
          },
        },
        vlines: {
          min, max,
          lines: [
            { value: d.threshold, color: COLORS.coral, dash: true, label: `Batas ${fmtRp(d.threshold)}`, align: "left", row: 0 },
            { value: d.params.s0, color: COLORS.ink, label: `Awal ${fmtRp(d.params.s0)}`, row: 1 },
          ],
        },
      },
    },
  };
  if (histChart) histChart.destroy();
  histChart = new Chart($("histChart"), cfg);

  const outside = d.threshold < min;
  $("histNote").textContent = outside
    ? "Batas risiko berada di bawah semua hasil simulasi, jadi tidak ada skenario yang melewatinya (peluang 0%)."
    : "Batang merah adalah skenario yang harganya jatuh di bawah batas risiko. Peluang = jumlah skenario merah dibagi total skenario.";
}

/* ---------- tabel peluang ---------- */
function renderTable(d) {
  const rows = d.table.map((r) => {
    const price = d.params.s0 * (1 - r.batas / 100);
    const cur = Math.abs(r.batas - d.input.threshold_pct) < 1e-9 ? "current" : "";
    return `<tr class="${cur}">
      <td>${r.batas}%</td>
      <td>Di bawah ${fmtRp(price)}</td>
      <td><div class="bar"><div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, r.prob * 100)}%"></div></div>
          <span class="bar-val">${fmtPct(r.prob)}</span></div></td></tr>`;
  }).join("");
  document.querySelector("#probTable tbody").innerHTML = rows;
}

setForm(DEFAULTS);
run();
