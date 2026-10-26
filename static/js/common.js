/* Helper bersama: format angka ala Indonesia, warna, dan pengaturan Chart.js */
const COLORS = {
  ink: "#1e1b4b", inkSoft: "#4b4a7a", line: "#e3e0f8",
  cobalt: "#3d5afe", coral: "#ff5a6e", sun: "#ffc531", mint: "#12c9a0", violet: "#8b5cf6",
};

const nf = (d = 0) => new Intl.NumberFormat("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtInt = (v) => nf(0).format(v);
const fmtRp = (v) => "Rp " + nf(0).format(Math.round(v));
const fmtPct = (p, d = 2) => nf(d).format(p * 100) + "%";   // p dalam bentuk pecahan (0.0894)

/* Pengaturan dasar semua grafik */
if (window.Chart) {
  Chart.defaults.font.family = '"DM Sans", system-ui, sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = COLORS.inkSoft;
  Chart.defaults.borderColor = COLORS.line;
  Chart.defaults.animation.duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 500;
  Chart.defaults.plugins.tooltip.backgroundColor = COLORS.ink;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 10;
  Chart.defaults.plugins.tooltip.titleFont = { weight: "700" };
}

/* Plugin: garis vertikal bertanda (dipakai untuk batas risiko & harga awal di histogram).
   Kategori histogram dibuat sama lebar dan mencakup min..max, sehingga posisi x
   bisa dihitung linear dari nilai harga. */
const vlinesPlugin = {
  id: "vlines",
  afterDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea } = chart;
    if (!opts || !opts.lines) return;
    const { min, max, lines } = opts;
    lines.forEach((ln) => {
      if (ln.value < min || ln.value > max) return;
      const x = chartArea.left + ((ln.value - min) / (max - min)) * (chartArea.right - chartArea.left);
      ctx.save();
      ctx.strokeStyle = ln.color;
      ctx.lineWidth = 2.5;
      if (ln.dash) ctx.setLineDash([7, 5]);
      ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '700 12px "DM Sans", sans-serif';
      const w = ctx.measureText(ln.label).width + 14;
      let bx = ln.align === "left" ? x - w - 6 : x + 6;
      if (bx < chartArea.left) bx = chartArea.left;
      if (bx + w > chartArea.right) bx = chartArea.right - w;
      ctx.fillStyle = ln.color;
      ctx.beginPath(); ctx.roundRect(bx, chartArea.top + 4 + (ln.row || 0) * 26, w, 22, 6); ctx.fill();
      ctx.fillStyle = ln.textColor || "#fff";
      ctx.textBaseline = "middle";
      ctx.fillText(ln.label, bx + 7, chartArea.top + 15 + (ln.row || 0) * 26);
      ctx.restore();
    });
  },
};
if (window.Chart) Chart.register(vlinesPlugin);

/* Animasi angka naik (hanya jika pengguna tidak mematikan animasi) */
function countUp(el, to, render, ms = 600) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) { el.textContent = render(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = render(to * eased);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
