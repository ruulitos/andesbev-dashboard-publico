/* AndesBev · dashboard de diagnóstico.
   Todos los números vienen de window.DASH (generado por build_dashboard.py a partir de los CSV). */
(function () {
  "use strict";
  const D = window.DASH;
  const MODO = document.body.dataset.modo; // "sitio" | "uno"
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  const CAT_COLOR = { "Gaseosas": "#2a78d6", "Cervezas": "#eb6834", "Aguas": "#1baf7a", "Piscos y Licores": "#eda100", "Vinos": "#e87ba4" };
  const ANIO_COLOR = { 2023: "#86b6ef", 2024: "#2a78d6", 2025: "#104281" };
  const S1 = "#2a78d6", S2 = "#eb6834", S3 = "#1baf7a", GRIS = "#a9a8a3", CRIT = "#d03b3b";
  const SEQ = [[0, "#cde2fb"], [0.5, "#5598e7"], [1, "#0d366b"]];
  const DIV = [[0, "#256abf"], [0.5, "#f0efec"], [1, "#d03b3b"]];

  // ---------------- utilidades ----------------
  const $ = (s, el) => (el || document).querySelector(s);
  const filas = (t) => t.filas.map((r) => Object.fromEntries(t.columnas.map((c, i) => [c, r[i]])));
  const nf = (n, d = 0) => (n === null || n === undefined || Number.isNaN(n)) ? "Dato no disponible"
    : Number(n).toLocaleString("es-CL", { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pct = (a, d = 1) => nf(a, d) + " %";
  const q = (arr, p) => { const s = arr.filter((x) => x !== null).slice().sort((a, b) => a - b); if (!s.length) return null;
    const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
  const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

  let state = { anio: "Todos", cat: "Todas" };
  try { const s = JSON.parse(sessionStorage.getItem("andesbev-filtros")); if (s) state = Object.assign(state, s); } catch (e) { /* sin almacenamiento */ }
  const guardar = () => { try { sessionStorage.setItem("andesbev-filtros", JSON.stringify(state)); } catch (e) { /* ok */ } };

  const BASE_LAYOUT = () => ({
    paper_bgcolor: "#fcfcfb", plot_bgcolor: "#fcfcfb", separators: ",.",
    font: { family: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif", size: 12, color: "#0b0b0b" },
    margin: { l: 56, r: 16, t: 28, b: 44 }, hoverlabel: { bgcolor: "#fff", bordercolor: "#e3e2de", font: { color: "#0b0b0b" } },
    legend: { orientation: "h", y: 1.12, x: 0, font: { color: "#52514e" } },
    xaxis: { gridcolor: "#ebeae6", linecolor: "#c9c8c3", zeroline: false, tickfont: { color: "#52514e" } },
    yaxis: { gridcolor: "#ebeae6", linecolor: "#c9c8c3", zeroline: false, tickfont: { color: "#52514e" } },
    bargap: 0.25, bargroupgap: 0.08,
  });
  const merge = (a, b) => { for (const k in b) { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k]) merge(a[k], b[k]); else a[k] = b[k]; } return a; };
  function plot(cid, traces, layout) {
    const el = document.getElementById("g-" + cid); if (!el || !window.Plotly) return;
    Plotly.react(el, traces, merge(BASE_LAYOUT(), layout || {}), { displaylogo: false, responsive: true,
      modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d", "toggleSpikelines"] });
  }
  const bar = (o) => Object.assign({ type: "bar", marker: { line: { color: "#fcfcfb", width: 2 } } }, o);

  function setTabla(cid, rows, cols, destino) {
    const el = destino || document.getElementById("t-" + cid); if (!el) return;
    cols = cols || (rows[0] ? Object.keys(rows[0]) : []);
    const num = (v) => typeof v === "number";
    // Vacío ≠ dato faltante: una nota vacía queda en blanco; un % o tasa sin base (división por 0) o un
    // paso de la cascada que no se mide en líneas/cantidad es "No aplica". Solo lo demás es "Dato no disponible".
    const vacio = (c, r) => /^nota/i.test(c) ? ""
      : (/pct|tasa/i.test(c) || ("paso" in r && /^(lineas|cantidad)$/.test(c))) ? "No aplica" : "Dato no disponible";
    const fmt = (v, c, r) => num(v) ? (/pct|tasa/i.test(c) ? nf(v, 2) : Number.isInteger(v) ? nf(v) : nf(v, Math.abs(v) < 10 ? 3 : 1)) : esc(v === null || v === undefined ? vacio(c, r) : (v === true ? "Sí" : v === false ? "No" : v));
    el.innerHTML = `<div class="tabla-wrap"><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${
      rows.map((r) => `<tr>${cols.map((c) => `<td class="${num(r[c]) ? "num" : ""}">${fmt(r[c], c, r)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  // ---------------- hilo conductor desde la bitácora ----------------
  function hilo(card) {
    const ids = (card.dataset.ids || "").split(/\s+/).filter(Boolean);
    const box = card.querySelector(".hilo"); if (!box || !ids.length) return;
    box.innerHTML = ids.map((id) => {
      const r = D.bitacora[id];
      if (!r) return `<div class="reg"><span class="rid">${esc(id)}</span><span class="no-disp">Registro no encontrado en la bitácora</span></div>`;
      const corr = id.includes(".1");
      const alc = corr ? '<span class="alc alc-corr">alcance corregido</span>'
        : (D.bitacora[id + ".1"] ? '<span class="alc alc-ant">superado: ver ' + esc(id) + '.1</span>'
          : '<span class="alc alc-ant">registrado con el alcance anterior; las cifras del gráfico pueden diferir</span>');
      return `<div class="reg"><span class="rid">${esc(id)}</span>${esc(r.tema)}${alc}
        <dl><dt>Hallazgo</dt><dd>${esc(r.hallazgo)}</dd><dt>Implicancia</dt><dd>${esc(r.implicancia)}</dd><dt>Condicionante</dt><dd>${esc(r.condicionante)}</dd></dl>
        <details><summary>Fuente y análisis</summary><dl><dt>Fuente</dt><dd>${esc(r.fuente)}</dd><dt>Análisis</dt><dd>${esc(r.analisis)}</dd><dt>Estado</dt><dd>${esc(r.estado)}</dd></dl></details></div>`;
    }).join("");
  }

  // ---------------- serie diaria filtrada ----------------
  function serie(conAnio = true) {
    const S = D.serie, cats = state.cat === "Todas" ? S.categorias : [state.cat];
    const out = { f: [], p: [], c: [] };
    S.fechas.forEach((f, i) => {
      if (conAnio && state.anio !== "Todos" && f.slice(0, 4) !== state.anio) return;
      let p = 0, c = 0; cats.forEach((k) => { p += S.pallets[k][i] || 0; c += S.cajas[k][i] || 0; });
      out.f.push(f); out.p.push(p); out.c.push(c);
    });
    return out;
  }
  const textoFiltro = (conAnio = true) => `${conAnio && state.anio !== "Todos" ? state.anio : "2023-2025"} · ${state.cat === "Todas" ? "todas las categorías" : state.cat}`;

  // ================= PÁGINAS =================
  const R = {};

  R.index = function () {
    const s = serie(), K = D.kpis_fijos;
    const kp = [
      ["Pallets por día (promedio)", nf(mean(s.p), 1), textoFiltro(), "Resultado calculado", "C2.1"],
      ["Pallets por día P50 / P90", `${nf(q(s.p, 0.5), 0)} / ${nf(q(s.p, 0.9), 0)}`, textoFiltro(), "Resultado calculado", "C2.1 B4"],
      ["Cajas por día (promedio)", nf(mean(s.c), 0), textoFiltro() + " · UNIDAD = CJ", "Resultado calculado", "C2.1"],
      ["% devolución sobre venta efectiva", pct(K.pct_devolucion_total, 2), `anulaciones ${pct(K.pct_anulaciones, 2)} + subestándar ${pct(K.pct_subestandar, 3)}`, "Resultado calculado", "C11.1"],
      ["Clientes georreferenciados", pct(K.pct_clientes_georref, 1), `${nf(K.n_clientes_georref)} de ${nf(K.n_clientes)} clientes con venta`, "Resultado calculado", "C14.1"],
      ["Demanda georreferenciada", pct(K.pct_demanda_georref, 1), "% de los pallets con coordenada", "Resultado calculado", "C14.1"],
      ["Factor de recargue", nf(K.factor_recargue, 2), "vueltas por camión por día", "Resultado calculado", "B10.1"],
      ["Capacidad observada P50 / P90", `${nf(K.cap_p50, 2)} / ${nf(K.cap_p90, 2)}`, "pallets por viaje (no es capacidad nominal)", "Resultado calculado", "C10.1"],
      ["Camiones necesarios (modelo)", `${nf(K.camiones_p50, 1)} / ${nf(K.camiones_p90, 1)}`, `con P50 / P90 · reales activos por día: ${nf(K.camiones_reales, 1)}`, "Supuesto", "B10.1"],
    ];
    $("#kpis").innerHTML = kp.map(([t, v, sub, lab, ids]) => `<div class="kpi"><span class="k-t">${t}</span><span class="k-v">${v}</span>
      <span class="k-s">${esc(sub)}</span><span class="badge badge-${lab.split(" ")[0].toLowerCase()}">${lab}</span><span class="k-ids">Bitácora: ${ids}</span></div>`).join("");
    const claves = ["pallets_venta_efectiva_2023_2025", "cajas_dia_promedio", "var_pct_may_dic_2025_vs_2024", "clientes_perdidos_2025",
      "pct_volumen_historico_clientes_perdidos", "supermercados_mayoristas_pct_volumen", "pallets_por_viaje_P50", "pct_volumen_georref_a_10_km"];
    const rows = filas(D.alcance_cifras).filter((r) => claves.includes(r.metrica))
      .map((r) => ({ "Métrica": r.metrica.replace(/_/g, " "), "Alcance anterior": r.valor_actual, "Alcance corregido": r.valor_corregido, "Registro": r.registro_bitacora }));
    setTabla("hilo-inicio", rows, null, $("#x-hilo-inicio"));
    $("#no-disp").innerHTML = "<ul>" + D.no_disponible.map((x) => `<li><strong>${esc(x.dato)}:</strong> ${esc(x.detalle)}</li>`).join("") + "</ul>";
    buscador();
  };

  let IDX = null;
  function buscador() {
    if (!IDX) {
      const C = D.clientes, P = D.productos;
      IDX = { cli: new Map(C.filas.map((r) => [String(r[0]), Object.fromEntries(C.columnas.map((c, i) => [c, r[i]]))])),
        pro: new Map(P.filas.map((r) => [String(r[0]), Object.fromEntries(P.columnas.map((c, i) => [c, r[i]]))])) };
    }
    const inp = $("#q"), sug = $("#q-sug"), ficha = $("#ficha");
    const buscar = (v) => {
      v = v.trim(); sug.innerHTML = "";
      if (!v) { ficha.innerHTML = ""; return; }
      const c = IDX.cli.get(v), p = IDX.pro.get(v);
      if (!c && !p) {
        const pref = [...IDX.cli.keys()].filter((k) => k.startsWith(v)).slice(0, 6).map((k) => ["cliente", k])
          .concat([...IDX.pro.keys()].filter((k) => k.startsWith(v)).slice(0, 6).map((k) => ["producto", k]));
        ficha.innerHTML = `<p class="no-disp">Sin coincidencia exacta para “${esc(v)}”.${pref.length ? " ¿Quisiste decir…?" : ""}</p>`;
        sug.innerHTML = pref.map(([t, k]) => `<button type="button" data-k="${esc(k)}">${t} ${esc(k)}</button>`).join("");
        sug.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { inp.value = b.dataset.k; buscar(b.dataset.k); }));
        return;
      }
      ficha.innerHTML = (c ? fichaCliente(v, c) : "") + (p ? fichaProducto(v, p) : "");
    };
    $("#q-btn").onclick = () => buscar(inp.value);
    inp.onkeydown = (e) => { if (e.key === "Enter") buscar(inp.value); };
    if (D.anonimizado) $("label[for=q]").textContent = "ID de cliente (seudonimizado, ej. CL-…) o código de producto";
  }
  function fichaCliente(id, c) {
    const perd = c.perdido_2025 ? '<span class="estado estado-critical">✕ Cliente perdido 2025</span>' : '<span class="estado estado-good">✓ No perdido en 2025</span>';
    const it = [["Segmento", c.segmento], ["Canal (agrupación supuesta)", c.canal], ["Pallets 2023-2025", nf(c.pallets_totales, 1)],
      ["Pallets 2023 / 2024 / 2025", `${nf(c.p2023, 1)} / ${nf(c.p2024, 1)} / ${nf(c.p2025, 1)}`], ["Pedidos (cliente-día)", nf(c.n_pedidos)],
      ["% de días operativos con compra", pct(c.tasa_frecuencia_pct, 2)], ["Tamaño promedio de pedido", nf(c.tamano_promedio_pedido, 3) + " pallets"],
      ["Primera / última compra", `${c.primera_compra} / ${c.ultima_compra}`],
      ["Distancia al centro de gravedad", c.dist_cg_km === null ? "Dato no disponible (sin coordenada)" : nf(c.dist_cg_km, 1) + " km"]];
    return `<div class="f-card"><h3>Cliente ${esc(id)} ${perd}</h3><dl>${it.map(([a, b]) => `<div><dt>${a}</dt><dd>${esc(b)}</dd></div>`).join("")}</dl>
      <p class="nota">Resultado calculado · bitácora C7.1, B15.1. El volumen por categoría de un cliente no está disponible.</p></div>`;
  }
  function fichaProducto(id, p) {
    const clase = p.XYZ_convencional === "sin_venta" ? `${p.clase_ABC_supuesto} · sin venta en CJ` : `${p.clase_ABC_supuesto}${p.XYZ_convencional}`;
    const fuente = p.fuente_clasificacion === "matriz_oficial" ? "matriz oficial (Gaseosas y Cervezas)" : "extensión complementaria (mismas reglas, C5.1)";
    const vu = [999, 9999].includes(p["Vida Util"]) ? `${nf(p["Vida Util"])} días (valor centinela: indefinida o no informada)` : nf(p["Vida Util"]) + " días";
    const it = [["Categoría", p.Categorias], ["Pallets 2023-2025", nf(p.CANTIDAD_PALLETS, 1)], ["Pallets 2023 / 2024 / 2025", `${nf(p.p2023, 1)} / ${nf(p.p2024, 1)} / ${nf(p.p2025, 1)}`],
      ["Clase ABC × XYZ", clase], ["Origen de la clase", fuente], ["CV mensual (36 meses)", nf(p.CV, 3)], ["Meses con venta", nf(p.n_meses_con_venta)],
      ["Vida útil (maestra)", vu], ["Vida útil ≤ 180 días (supuesto)", p.vu_corta ? "Sí" : "No"], ["Cajas por pallet (maestra)", nf(p.cajas_por_pallet)], ["Unidad de medida base", p.unidad_base]];
    return `<div class="f-card"><h3>Producto ${esc(id)}</h3><dl>${it.map(([a, b]) => `<div><dt>${a}</dt><dd>${esc(b)}</dd></div>`).join("")}</dl>
      <p class="nota">Resultado calculado · bitácora C4.1, C5.1, B19.</p></div>`;
  }

  R.demanda = function () {
    // mensual por año (filtro categoría)
    const S = D.serie, cats = state.cat === "Todas" ? S.categorias : [state.cat];
    const acc = {}; S.fechas.forEach((f, i) => { const y = f.slice(0, 4), m = +f.slice(5, 7) - 1; acc[y] = acc[y] || Array(12).fill(0);
      cats.forEach((k) => { acc[y][m] += S.pallets[k][i] || 0; }); });
    const anios = Object.keys(acc).sort();
    plot("mensual", anios.map((y) => ({ type: "scatter", mode: "lines+markers", name: y, x: MESES, y: acc[y], line: { color: ANIO_COLOR[y], width: 2 },
      marker: { size: 8, color: ANIO_COLOR[y], line: { color: "#fcfcfb", width: 2 } }, hovertemplate: "%{x} " + y + ": %{y:,.0f} pallets<extra></extra>" })),
    { hovermode: "x unified", yaxis: { title: { text: "pallets" }, rangemode: "tozero" } });
    setTabla("mensual", MESES.map((m, i) => Object.assign({ Mes: m }, ...anios.map((y) => ({ [y]: Math.round(acc[y][i]) })))));
    const tri = anios.map((y) => [0, 1, 2, 3].map((t) => acc[y].slice(t * 3, t * 3 + 3).reduce((a, b) => a + b, 0)));
    plot("trimestral", anios.map((y, j) => bar({ name: y, x: ["T1", "T2", "T3", "T4"], y: tri[j], marker: { color: ANIO_COLOR[y], line: { color: "#fcfcfb", width: 2 } },
      hovertemplate: "%{x} " + y + ": %{y:,.0f} pallets<extra></extra>" })), { barmode: "group", yaxis: { title: { text: "pallets" } } });
    setTabla("trimestral", ["T1", "T2", "T3", "T4"].map((t, i) => Object.assign({ Trimestre: t }, ...anios.map((y, j) => ({ [y]: Math.round(tri[j][i]) })))));
    // día de semana
    const s = serie(); const sum = Array(7).fill(0), n = Array(7).fill(0);
    s.f.forEach((f, i) => { const d = (new Date(f + "T12:00:00").getDay() + 6) % 7; sum[d] += s.p[i]; n[d] += 1; });
    const prom = sum.map((v, i) => n[i] ? v / n[i] : null);
    plot("dow", [bar({ x: DIAS, y: prom, marker: { color: S1, line: { color: "#fcfcfb", width: 2 } }, customdata: n,
      hovertemplate: "%{x}: %{y:,.1f} pallets/día<br>%{customdata} días con actividad<extra></extra>" })], { yaxis: { title: { text: "pallets por día activo" } }, title: { text: textoFiltro(), font: { size: 12, color: "#52514e" }, x: 0 } });
    setTabla("dow", DIAS.map((d, i) => ({ "Día": d, "Pallets promedio": prom[i], "Días con actividad": n[i] })));
    // serie diaria
    const p50 = q(s.p, 0.5), p90 = q(s.p, 0.9), p95 = q(s.p, 0.95);
    const linea = (v, t, dash) => ({ type: "line", xref: "paper", x0: 0, x1: 1, y0: v, y1: v, line: { color: "#75746f", width: 1, dash } });
    plot("diaria", [{ type: "scatter", mode: "lines", x: s.f, y: s.p, name: "Pallets por día", line: { color: S1, width: 1.5 },
      hovertemplate: "%{x|%d-%m-%Y}: %{y:,.1f} pallets<extra></extra>" }],
    { showlegend: false, shapes: [linea(p50, "P50", "dot"), linea(p90, "P90", "dash"), linea(p95, "P95", "solid")],
      annotations: [["P50", p50], ["P90", p90], ["P95", p95]].map(([t, v]) => ({ xref: "paper", x: 1, y: v, text: `${t} ${nf(v, 0)}`, showarrow: false, xanchor: "right", yanchor: "bottom", font: { size: 11, color: "#52514e" } })),
      yaxis: { title: { text: "pallets" }, rangemode: "tozero" }, xaxis: { type: "date" } });
    setTabla("diaria", [{ Filtro: textoFiltro(), "Días": s.p.length, Promedio: mean(s.p), P50: p50, P90: p90, P95: p95, "Máximo": Math.max(...s.p), "CV": (() => { const m = mean(s.p); return Math.sqrt(mean(s.p.map((x) => (x - m) ** 2))) / m; })() }]);
    // fin de mes
    const fm = filas(D.fin_mes);
    plot("finmes", [bar({ x: fm.map((r) => r.mes), y: fm.map((r) => r.ratio), marker: { color: fm.map((r) => r.ratio > 1 ? S1 : GRIS), line: { color: "#fcfcfb", width: 1 } },
      customdata: fm.map((r) => [r.ultimo_dia, r.promedio_mismo_dia_semana]), hovertemplate: "%{x}: razón %{y:.2f}<br>último día %{customdata[0]:,.1f} vs %{customdata[1]:,.1f} pallets<extra></extra>" })],
    { shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 1, y1: 1, line: { color: "#52514e", width: 1, dash: "dash" } }], yaxis: { title: { text: "razón" } }, xaxis: { tickangle: -60 } });
    const may = fm.filter((r) => r.ratio > 1).length;
    $("#x-finmes").innerHTML = `<p class="nota">Resultado calculado sobre la base corregida: en ${may} de ${fm.length} meses el último día supera al mismo día de la semana del resto del mes (${pct(100 * may / fm.length, 1)}); razón promedio ${nf(mean(fm.map((r) => r.ratio)), 2)}, mediana ${nf(q(fm.map((r) => r.ratio), 0.5), 2)}.</p>`;
    setTabla("finmes", fm);
    // índice estacional
    const ie = filas(D.ie); const anioSel = state.anio;
    const cats5 = D.meta.categorias.filter((c) => state.cat === "Todas" || c === state.cat);
    const z = cats5.map((c) => MESES.map((m, i) => { const v = ie.filter((r) => r.Categorias === c && r.MES === i + 1 && (anioSel === "Todos" || String(r.ANIO) === anioSel)).map((r) => r.indice_estacional); return mean(v); }));
    plot("ie", [{ type: "heatmap", x: MESES, y: cats5, z, colorscale: DIV, zmid: 1, xgap: 2, ygap: 2, text: z.map((r) => r.map((v) => nf(v, 2))), texttemplate: "%{text}",
      hovertemplate: "%{y} · %{x}: índice %{z:.2f}<extra></extra>", colorbar: { title: { text: "índice" }, thickness: 10 } }],
    { margin: { l: 120 }, title: { text: anioSel === "Todos" ? "Promedio 2023-2025" : anioSel, font: { size: 12, color: "#52514e" }, x: 0 } });
    setTabla("ie", cats5.map((c, j) => Object.assign({ "Categoría": c }, ...MESES.map((m, i) => ({ [m]: z[j][i] })))));
    // peaks septiembre / diciembre
    const pk = filas(D.peaks).filter((r) => (anioSel === "Todos" || String(r.ANIO) === anioSel) && cats5.includes(r.Categorias));
    const pm = (c, k) => mean(pk.filter((r) => r.Categorias === c).map((r) => r[k]));
    plot("peaks", [["ie_septiembre", "Septiembre", S1], ["ie_diciembre", "Diciembre", S2]].map(([k, n, col]) => bar({ name: n, x: cats5, y: cats5.map((c) => pm(c, k)),
      marker: { color: col, line: { color: "#fcfcfb", width: 2 } }, hovertemplate: "%{x} · " + n + ": %{y:.2f}<extra></extra>" })),
    { barmode: "group", yaxis: { title: { text: "índice estacional" } }, shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 1, y1: 1, line: { color: "#52514e", width: 1, dash: "dash" } }] });
    setTabla("peaks", pk);
    // mix
    const mx = filas(D.mix);
    plot("mix", D.meta.categorias.map((c) => bar({ name: c, x: D.meta.anios.map(String), y: D.meta.anios.map((a) => (mx.find((r) => r.ANIO === a && r.Categorias === c) || {}).pct_mix),
      marker: { color: CAT_COLOR[c], line: { color: "#fcfcfb", width: 2 } }, hovertemplate: "%{x} · " + c + ": %{y:.1f} %<extra></extra>" })),
    { barmode: "stack", xaxis: { type: "category" }, yaxis: { title: { text: "% de pallets" }, range: [0, 100] }, legend: { y: 1.2 } });
    setTabla("mix", mx);
    // alcance
    const am = filas(D.alcance_mensual);
    plot("alcance", [["actual_var_pct_2025_vs_2024", "Alcance anterior (comuna de facturación)", GRIS], ["corregido_var_pct_2025_vs_2024", "Alcance corregido (punto de entrega)", S1]].map(([k, n, col]) =>
      bar({ name: n, x: am.map((r) => MESES[r.MES - 1]), y: am.map((r) => r[k]), marker: { color: col, line: { color: "#fcfcfb", width: 2 } }, hovertemplate: "%{x}: %{y:.1f} %<extra>" + n + "</extra>" })),
    { barmode: "group", yaxis: { title: { text: "% variación 2025 vs 2024" }, zeroline: true, zerolinecolor: "#52514e" } });
    setTabla("alcance", am);
  };

  R.portafolio = function () {
    const ab = filas(D.abc_cat);
    plot("abc-cat", [bar({ type: "bar", orientation: "h", y: ab.map((r) => r.Categorias), x: ab.map((r) => r.pct), marker: { color: ab.map((r) => r.clase === "A" ? S1 : GRIS), line: { color: "#fcfcfb", width: 2 } },
      text: ab.map((r) => `Clase ${r.clase} · ${nf(r.pct, 1)} % (acum. ${nf(r.pct_acum, 1)} %)`), textposition: "auto", hovertemplate: "%{y}: %{x:.1f} %<extra></extra>" })],
    { yaxis: { autorange: "reversed" }, xaxis: { title: { text: "% del volumen (pallets)" } }, margin: { l: 120 } });
    setTabla("abc-cat", ab);
    const cv = filas(D.cv_cat);
    plot("cv-cat", [["CV_con_2025", "Con 2025 (36 meses)", S1], ["CV_sin_2025", "Sin 2025 (24 meses)", S2]].map(([k, n, col]) => bar({ name: n, x: cv.map((r) => r.Categorias), y: cv.map((r) => r[k]),
      marker: { color: col, line: { color: "#fcfcfb", width: 2 } }, hovertemplate: "%{x}: CV %{y:.3f}<extra>" + n + "</extra>" })), { barmode: "group", yaxis: { title: { text: "CV mensual" } } });
    setTabla("cv-cat", cv);
    const mz = filas(D.matriz).filter((r) => state.cat === "Todas" || r.Categorias === state.cat);
    const ABC = ["A", "B", "C"], XYZ = ["X", "Y", "Z", "sin_venta"];
    const fuera = state.cat !== "Todas" && !["Gaseosas", "Cervezas"].includes(state.cat);
    const tot = mz.reduce((a, r) => a + (r.CANTIDAD_PALLETS || 0), 0);
    const zn = ABC.map((a) => XYZ.map((x) => mz.filter((r) => r.clase_ABC_supuesto === a && r.XYZ_convencional === x).length));
    const zv = ABC.map((a) => XYZ.map((x) => 100 * mz.filter((r) => r.clase_ABC_supuesto === a && r.XYZ_convencional === x).reduce((s, r) => s + r.CANTIDAD_PALLETS, 0) / (tot || 1)));
    const hm = (z, fmt, unidad) => [{ type: "heatmap", x: XYZ.map((x) => x === "sin_venta" ? "sin venta" : x), y: ABC, z, colorscale: SEQ, xgap: 2, ygap: 2, showscale: false,
      text: z.map((r) => r.map(fmt)), texttemplate: "%{text}", hovertemplate: "%{y}%{x}: %{text} " + unidad + "<extra></extra>" }];
    ["mz-n", "mz-v"].forEach((id) => { const x = $("#x-" + id); x.innerHTML = fuera ? `<p class="no-disp">${esc(state.cat)} no está en la matriz oficial (solo Gaseosas y Cervezas). Ver la extensión complementaria en el buscador de productos.</p>` : ""; });
    plot("mz-n", fuera ? [] : hm(zn, (v) => nf(v), "SKU"), { yaxis: { autorange: "reversed" } });
    plot("mz-v", fuera ? [] : hm(zv, (v) => nf(v, 1) + " %", ""), { yaxis: { autorange: "reversed" } });
    setTabla("mz-n", ABC.map((a, i) => Object.assign({ ABC: a }, ...XYZ.map((x, j) => ({ [x]: zn[i][j] })))));
    setTabla("mz-v", ABC.map((a, i) => Object.assign({ ABC: a }, ...XYZ.map((x, j) => ({ [x]: zv[i][j] })))));
    const az = mz.filter((r) => r.clase_ABC_supuesto === "A" && r.XYZ_convencional === "Z").sort((a, b) => b.CANTIDAD_PALLETS - a.CANTIDAD_PALLETS);
    setTabla("az", az, null, $("#x-az")); setTabla("az", az);
    const cz = filas(D.cola_cz).filter((r) => r.alcance.startsWith("categoria_")).map((r) => Object.assign(r, { cat: r.alcance.replace("categoria_", "") }))
      .filter((r) => state.cat === "Todas" || r.cat === state.cat);
    plot("cola", [["sku_CZ", "SKU C-Z", GRIS], ["sku_CZ_vu_le_180", "de ellos con vida útil ≤ 180 días", S2]].map(([k, n, col]) => bar({ name: n, x: cz.map((r) => r.cat), y: cz.map((r) => r[k]),
      marker: { color: col, line: { color: "#fcfcfb", width: 2 } }, hovertemplate: "%{x}: %{y} SKU<extra>" + n + "</extra>" })), { barmode: "group", yaxis: { title: { text: "SKU" } } });
    setTabla("cola", filas(D.cola_cz));
    const rango = (cid, rows, unidad, dec) => {
      rows = rows.filter((r) => state.cat === "Todas" || r.Categorias === state.cat || r.Categorias === "TOTAL");
      plot(cid, [{ type: "scatter", mode: "markers", y: rows.map((r) => r.Categorias), x: rows.map((r) => r.p50), marker: { size: 10, color: rows.map((r) => CAT_COLOR[r.Categorias] || "#52514e"), line: { color: "#fcfcfb", width: 2 } },
        error_x: { type: "data", symmetric: false, array: rows.map((r) => r.p90 - r.p50), arrayminus: rows.map((r) => r.p50 - r.p10), color: "#75746f", thickness: 2, width: 6 },
        customdata: rows.map((r) => [r.p10, r.p90, r.razon_p90_p10]), hovertemplate: "%{y}: P50 %{x:." + dec + "f} " + unidad + "<br>P10 %{customdata[0]:." + dec + "f} · P90 %{customdata[1]:." + dec + "f} · razón %{customdata[2]:.2f}x<extra></extra>" }],
      { showlegend: false, yaxis: { autorange: "reversed" }, xaxis: { title: { text: unidad } }, margin: { l: 120 } });
      setTabla(cid, rows);
    };
    rango("espacio", filas(D.disp_espacio), "pallets por caja", 4);
    rango("peso", filas(D.disp_peso).filter((r) => r.metrica === "kg_por_pallet_equivalente"), "kg por pallet (supuesto kg)", 0);
    const cp = filas(D.cajas_pallet_cat).filter((r) => state.cat === "Todas" || r.Categorias === state.cat);
    plot("cpp", [bar({ x: cp.map((r) => r.Categorias), y: cp.map((r) => r.median), marker: { color: cp.map((r) => CAT_COLOR[r.Categorias]), line: { color: "#fcfcfb", width: 2 } },
      customdata: cp.map((r) => [r.min, r.max, r.count]), hovertemplate: "%{x}: mediana %{y} cajas/pallet<br>mín %{customdata[0]} · máx %{customdata[1]} · %{customdata[2]} SKU<extra></extra>" })],
    { showlegend: false, yaxis: { title: { text: "cajas por pallet (mediana)" } } });
    const vu = filas(D.vida_util_cat).filter((r) => state.cat === "Todas" || r.Categorias === state.cat);
    $("#x-cpp").innerHTML = "<p class='nota'>Vida útil por categoría (días, maestra):</p>"; setTabla("cpp", vu.map((r) => ({ "Categoría": r.Categorias, SKU: r.count, Mediana: r.median, "Mínimo": r.min, "Máximo": r.max })), null, $("#x-cpp").appendChild(document.createElement("div")));
    setTabla("cpp", cp);
  };

  // ---------- mapa ----------
  let MAPA = null;
  function capasMapa() {
    const el = document.getElementById("g-mapa"); if (!el) return;
    const C = D.clientes, col = C.columnas, k = (n) => col.indexOf(n);
    const campo = state.anio === "Todos" ? "pallets_totales" : "p" + state.anio;
    const pts = C.filas.filter((r) => r[k("lat")] !== null && r[k(campo)] > 0).map((r) => ({ id: r[0], lat: r[k("lat")], lon: r[k("lon")], v: r[k(campo)], canal: r[k("canal")], seg: r[k("segmento")], perd: r[k("perdido_2025")] }));
    const modo = ($("#m-color") || {}).value || "volumen";
    const TOPC = { "Supermercados y mayoristas": S1, "Almacenes y tradicional": S2, "Botillerias": S3 };
    const vs = pts.map((p) => p.v).sort((a, b) => a - b), cortes = [0.5, 0.75, 0.9, 0.97].map((p) => vs[Math.floor(p * (vs.length - 1))]);
    const SEQC = ["#b7d3f6", "#6da7ec", "#2a78d6", "#1c5cab", "#0d366b"];
    const colorDe = (p) => modo === "canal" ? (TOPC[p.canal] || GRIS) : SEQC[cortes.filter((c) => p.v > c).length];
    const radio = (p) => Math.max(3, Math.min(16, 2 + Math.sqrt(p.v) * 0.6));
    const ley = $("#x-mapa .leyenda");
    if (ley) ley.innerHTML = modo === "canal" ? Object.entries(TOPC).map(([n, c]) => `<span><i style="background:${c}"></i>${n}</span>`).join("") + `<span><i style="background:${GRIS}"></i>Otros canales</span>`
      : `<span>Pallets ${state.anio === "Todos" ? "2023-2025" : state.anio}:</span>` + SEQC.map((c, i) => `<span><i style="background:${c}"></i>${i === 0 ? "≤ " + nf(cortes[0], 1) : i === 4 ? "> " + nf(cortes[3], 1) : nf(cortes[i - 1], 1) + "–" + nf(cortes[i], 1)}</span>`).join("");
    if (ley) ley.innerHTML += `<span><i style="background:#fff;border:2px solid ${CRIT}"></i>Perdido 2025</span>`;
    $("#x-mapa .m-n").textContent = `${nf(pts.length)} clientes con coordenada y venta en ${state.anio === "Todos" ? "2023-2025" : state.anio}`;
    if (window.L) {
      if (!MAPA) {
        MAPA = { m: L.map(el, { preferCanvas: true }).setView([D.cg.lat, D.cg.lon], 11) };
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(MAPA.m);
        [5, 10, 20, 50].forEach((km) => L.circle([D.cg.lat, D.cg.lon], { radius: km * 1000, color: "#52514e", weight: 1, dashArray: "4 4", fill: false, interactive: false }).addTo(MAPA.m)
          .bindTooltip(km + " km", { permanent: false }));
        L.marker([D.cg.lat, D.cg.lon], { title: "Centro de gravedad" }).addTo(MAPA.m).bindPopup("Centro de gravedad ponderado por pallets (C8.1)");
      }
      ["puntos", "calor", "perdidos"].forEach((c) => { if (MAPA[c]) { MAPA.m.removeLayer(MAPA[c]); MAPA[c] = null; } });
      MAPA.puntos = L.layerGroup(pts.map((p) => L.circleMarker([p.lat, p.lon], { radius: radio(p), color: "#fcfcfb", weight: 1, fillColor: colorDe(p), fillOpacity: 0.85 })
        .bindTooltip(`Cliente ${esc(p.id)}<br>${esc(p.seg)}<br>${nf(p.v, 1)} pallets`))).addTo(MAPA.m);
      if ($("#m-calor").checked) {
        if (L.heatLayer) { const mx = vs[Math.floor(0.97 * (vs.length - 1))] || 1; MAPA.calor = L.heatLayer(pts.map((p) => [p.lat, p.lon, Math.min(1, p.v / mx)]), { radius: 18, blur: 16 }).addTo(MAPA.m); }
        else $("#x-mapa .m-n").textContent += " · Capa de calor no disponible (sin conexión)";
      }
      if ($("#m-perd").checked) MAPA.perdidos = L.layerGroup(pts.filter((p) => p.perd).map((p) => L.circleMarker([p.lat, p.lon], { radius: radio(p) + 2, color: CRIT, weight: 2, fill: false })
        .bindTooltip(`Cliente ${esc(p.id)} · perdido 2025`))).addTo(MAPA.m);
      setTimeout(() => MAPA.m.invalidateSize(), 50);
    } else {
      const trs = [{ type: "scattergl", mode: "markers", x: pts.map((p) => p.lon), y: pts.map((p) => p.lat), text: pts.map((p) => `Cliente ${p.id}<br>${p.seg}<br>${nf(p.v, 1)} pallets`),
        hovertemplate: "%{text}<extra></extra>", marker: { size: pts.map((p) => radio(p) * 1.4), color: pts.map(colorDe), line: { color: "#fcfcfb", width: 1 } } }];
      if ($("#m-perd").checked) { const pp = pts.filter((p) => p.perd); trs.push({ type: "scattergl", mode: "markers", x: pp.map((p) => p.lon), y: pp.map((p) => p.lat), hoverinfo: "skip",
        marker: { size: pp.map((p) => radio(p) * 1.4 + 4), color: "rgba(0,0,0,0)", line: { color: CRIT, width: 2 } } }); }
      trs.push({ type: "scatter", mode: "markers", x: [D.cg.lon], y: [D.cg.lat], marker: { symbol: "x", size: 14, color: "#0b0b0b" }, hovertemplate: "Centro de gravedad<extra></extra>" });
      plot("mapa", trs, { showlegend: false, xaxis: { title: { text: "longitud" } }, yaxis: { title: { text: "latitud" }, scaleanchor: "x", scaleratio: 1.15 } });
      $("#x-mapa .m-n").textContent += " · Mapa base no disponible sin conexión: vista de puntos (Plotly).";
    }
  }

  R.clientes = function () {
    const x = $("#x-mapa");
    if (!x.dataset.init) {
      x.dataset.init = "1";
      x.innerHTML = `<div class="mapa-ctrl"><label>Color <select id="m-color"><option value="volumen">Volumen (pallets)</option><option value="canal">Canal (agrupación supuesta)</option></select></label>
        <label><input type="checkbox" id="m-calor"> Mapa de calor</label><label><input type="checkbox" id="m-perd"> Clientes perdidos 2025</label></div><div class="leyenda"></div><p class="nota m-n"></p>
        ${D.anonimizado ? '<p class="nota">Versión publicada: IDs seudonimizados y coordenadas redondeadas a 3 decimales (~100 m).</p>' : ""}`;
      ["m-color", "m-calor", "m-perd"].forEach((id) => $("#" + id).addEventListener("change", capasMapa));
    }
    capasMapa();
    const rd = filas(D.radios).filter((r) => r.radio_km.startsWith("<="));
    plot("radios", [["pct_volumen_georref", "% del volumen", S1], ["pct_clientes_georref", "% de los clientes", S2]].map(([k, n, col]) => bar({ name: n, x: rd.map((r) => r.radio_km + " km"), y: rd.map((r) => r[k]),
      marker: { color: col, line: { color: "#fcfcfb", width: 2 } }, hovertemplate: "%{x}: %{y:.1f} %<extra>" + n + "</extra>" })), { barmode: "group", yaxis: { title: { text: "% acumulado (georreferenciados)" }, range: [0, 100] } });
    setTabla("radios", filas(D.radios));
    const cm = filas(D.comunas).filter((r) => r.pallets > 0.5);
    plot("comunas", [bar({ orientation: "h", y: cm.map((r) => r.COMUNA_LIMPIA), x: cm.map((r) => r.pct_volumen), marker: { color: cm.map((r) => r.COMUNA_LIMPIA.startsWith("FACTURADO") ? S2 : S1), line: { color: "#fcfcfb", width: 2 } },
      hovertemplate: "%{y}: %{x:.2f} %<extra></extra>" })], { yaxis: { autorange: "reversed" }, xaxis: { title: { text: "% de pallets" } }, margin: { l: 200 } });
    setTabla("comunas", filas(D.comunas));
    const cn = filas(D.canales).filter((r) => r.CANAL !== "TOTAL");
    plot("canales", [["pct_volumen", "% del volumen", S1], ["pct_clientes", "% de los clientes", S2]].map(([k, n, col]) => bar({ name: n, orientation: "h", y: cn.map((r) => r.CANAL), x: cn.map((r) => r[k]),
      marker: { color: col, line: { color: "#fcfcfb", width: 2 } }, hovertemplate: "%{y}: %{x:.1f} %<extra>" + n + "</extra>" })), { barmode: "group", yaxis: { autorange: "reversed" }, margin: { l: 230 }, xaxis: { title: { text: "%" } } });
    setTabla("canales", filas(D.canales));
    plot("ppp", [bar({ orientation: "h", y: cn.map((r) => r.CANAL), x: cn.map((r) => r.pallets_por_pedido), marker: { color: S1, line: { color: "#fcfcfb", width: 2 } },
      customdata: cn.map((r) => r.frecuencia_mediana_pedidos_semana), hovertemplate: "%{y}: %{x:.2f} pallets/pedido<br>%{customdata:.2f} pedidos/semana (mediana)<extra></extra>" })],
    { yaxis: { autorange: "reversed" }, margin: { l: 230 }, xaxis: { title: { text: "pallets por pedido" } } });
    setTabla("ppp", filas(D.segmentos));
    const dp = D.dist_pedidos;
    plot("frec", [{ type: "histogram", x: dp.n_pedidos, nbinsx: 60, marker: { color: S1, line: { color: "#fcfcfb", width: 1 } }, hovertemplate: "%{x} pedidos: %{y} clientes<extra></extra>" }],
      { xaxis: { title: { text: "pedidos (cliente-día) en 3 años" } }, yaxis: { title: { text: "clientes" } }, bargap: 0.02 });
    const lim = 3, sobre = dp.tamano_promedio.filter((v) => v > lim).length;
    plot("tam", [{ type: "histogram", x: dp.tamano_promedio.filter((v) => v <= lim), xbins: { start: 0, end: lim, size: 0.05 }, marker: { color: S1, line: { color: "#fcfcfb", width: 1 } }, hovertemplate: "%{x} pallets: %{y} clientes<extra></extra>" }],
      { xaxis: { title: { text: "pallets por pedido (promedio del cliente)" } }, yaxis: { title: { text: "clientes" } }, bargap: 0.02 });
    $("#x-tam").innerHTML = `<p class="nota">Se muestran los clientes con promedio ≤ ${lim} pallets; ${nf(sobre)} clientes tienen un promedio mayor (ver tabla del canal).</p>`;
    setTabla("frec", [{ Clientes: dp.n_pedidos.length, "Mediana de pedidos": q(dp.n_pedidos, 0.5), P90: q(dp.n_pedidos, 0.9), "Máximo": Math.max(...dp.n_pedidos) }]);
    setTabla("tam", [{ Clientes: dp.tamano_promedio.length, Mediana: q(dp.tamano_promedio, 0.5), P90: q(dp.tamano_promedio, 0.9), "Máximo": Math.max(...dp.tamano_promedio) }]);
    const vt = filas(D.ventanas).filter((r) => r.pedidos >= 500).sort((a, b) => b.tasa_352_o_360_por_100_pedidos - a.tasa_352_o_360_por_100_pedidos);
    const grupo = (s) => ["BOTILLERIA", "BAR", "DISCOTHEQUE"].includes(s);
    plot("ventanas", [[true, "Botillería / bar / discotheque", S2], [false, "Resto de segmentos", S1]].map(([g, n, col]) => { const r = vt.filter((x) => grupo(x.SEGMENTO) === g);
      return bar({ name: n, orientation: "h", y: r.map((x) => x.SEGMENTO), x: r.map((x) => x.tasa_352_o_360_por_100_pedidos), marker: { color: col, line: { color: "#fcfcfb", width: 2 } },
        customdata: r.map((x) => [x.tasa_352_por_100_pedidos, x.tasa_360_por_100_pedidos, x.pedidos]), hovertemplate: "%{y}: %{x:.2f} por 100 pedidos<br>local cerrado %{customdata[0]:.2f} · fuera de horario %{customdata[1]:.2f}<br>%{customdata[2]:,} pedidos<extra></extra>" }); }),
    { yaxis: { categoryorder: "array", categoryarray: vt.map((x) => x.SEGMENTO).reverse() }, margin: { l: 260 }, xaxis: { title: { text: "eventos 352 o 360 por cada 100 pedidos" } } });
    $("#x-ventanas").innerHTML = '<p class="nota">Segmentos con al menos 500 pedidos. Normativa (ley de alcoholes, ordenanzas de carga y descarga): pendiente de fuente secundaria.</p>';
    setTabla("ventanas", filas(D.ventanas));
    // variación por categoría
    const S = D.serie, va = D.meta.categorias.map((c) => { let a = 0, b = 0; S.fechas.forEach((f, i) => { if (f.startsWith("2024")) a += S.pallets[c][i]; if (f.startsWith("2025")) b += S.pallets[c][i]; }); return { c, a, b, v: 100 * (b / a - 1) }; });
    plot("var-cat", [bar({ x: va.map((r) => r.c), y: va.map((r) => r.v), marker: { color: va.map((r) => CAT_COLOR[r.c]), line: { color: "#fcfcfb", width: 2 } }, customdata: va.map((r) => [r.a, r.b]),
      hovertemplate: "%{x}: %{y:.1f} %<br>2024 %{customdata[0]:,.0f} → 2025 %{customdata[1]:,.0f} pallets<extra></extra>" })], { showlegend: false, yaxis: { title: { text: "% variación 2025 vs 2024" }, zeroline: true, zerolinecolor: "#52514e" } });
    setTabla("var-cat", va.map((r) => ({ "Categoría": r.c, "Pallets 2024": r.a, "Pallets 2025": r.b, "Variación %": r.v })));
    const dc = filas(D.perdidos_decil);
    plot("decil", [["tasa_perdida_pct_decil_volumen_actual", "Alcance anterior", GRIS], ["tasa_perdida_pct_decil_volumen_corregido", "Alcance corregido", S1]].map(([k, n, col]) => bar({ name: n, x: dc.map((r) => r.decil), y: dc.map((r) => r[k]),
      marker: { color: col, line: { color: "#fcfcfb", width: 2 } }, hovertemplate: "%{x}: %{y:.1f} %<extra>" + n + "</extra>" })), { barmode: "group", xaxis: { title: { text: "decil de volumen histórico (D1 = mayor volumen)" } }, yaxis: { title: { text: "% de clientes perdidos 2025" } } });
    $("#x-decil").innerHTML = ""; setTabla("decil", filas(D.perdidos_resumen), null, $("#x-decil")); setTabla("decil", dc);
  };

  R.flota = function () {
    const sel = (r) => state.anio === "Todos" || String(r.ANIO) === state.anio;
    const vd = filas(D.vueltas_dist).filter(sel), agg = {};
    vd.forEach((r) => { agg[r.vueltas] = (agg[r.vueltas] || 0) + r.dias_camion; });
    const xs = Object.keys(agg).map(Number).sort((a, b) => a - b), tot = xs.reduce((a, x) => a + agg[x], 0);
    plot("vueltas", [bar({ x: xs, y: xs.map((x) => 100 * agg[x] / tot), marker: { color: S1, line: { color: "#fcfcfb", width: 2 } }, customdata: xs.map((x) => agg[x]),
      hovertemplate: "%{x} vueltas: %{y:.1f} % de los camión-día (%{customdata:,})<extra></extra>" })], { xaxis: { title: { text: "vueltas en el día" }, dtick: 1 }, yaxis: { title: { text: "% de camión-día" } } });
    setTabla("vueltas", xs.map((x) => ({ Vueltas: x, "Camión-día": agg[x], "%": 100 * agg[x] / tot })));
    const vc = filas(D.vueltas_camion).filter(sel), pc = {};
    vc.forEach((r) => { pc[r.CAMION] = pc[r.CAMION] || { s: 0, n: 0, mx: 0 }; pc[r.CAMION].s += r.vueltas_promedio * r.dias_activo; pc[r.CAMION].n += r.dias_activo; pc[r.CAMION].mx = Math.max(pc[r.CAMION].mx, r.vueltas_max); });
    const top = Object.entries(pc).map(([c, o]) => ({ c, v: o.s / o.n, n: o.n, mx: o.mx })).sort((a, b) => b.v - a.v);
    const t15 = top.slice(0, 15);
    plot("vcamion", [bar({ orientation: "h", y: t15.map((r) => r.c), x: t15.map((r) => r.v), marker: { color: S1, line: { color: "#fcfcfb", width: 2 } }, customdata: t15.map((r) => [r.n, r.mx]),
      hovertemplate: "%{y}: %{x:.2f} vueltas/día<br>%{customdata[0]} días activo · máx %{customdata[1]}<extra></extra>" })], { yaxis: { autorange: "reversed" }, xaxis: { title: { text: "vueltas promedio por día activo" } }, margin: { l: 60 } });
    setTabla("vcamion", top.map((r) => ({ "Camión": r.c, "Vueltas promedio": r.v, "Días activo": r.n, "Máximo en un día": r.mx })));
    const ph = filas(D.pallets_viaje_hist).filter(sel), hb = {};
    ph.forEach((r) => { hb[r.bin] = (hb[r.bin] || 0) + r.viajes; });
    const bins = Object.keys(hb).sort((a, b) => +a - +b), K = D.kpis_fijos;
    plot("phist", [bar({ x: bins.map((b) => +b === 12 ? "≥ 12" : b + "–" + (+b + 0.5)), y: bins.map((b) => hb[b]), marker: { color: S1, line: { color: "#fcfcfb", width: 1 } },
      hovertemplate: "%{x} pallets: %{y:,} viajes<extra></extra>" })], { bargap: 0.05, xaxis: { title: { text: "pallets por viaje" }, tickangle: -45 }, yaxis: { title: { text: "viajes" } } });
    $("#x-phist").innerHTML = `<p class="nota">2023-2025: P50 ${nf(K.cap_p50, 2)} y P90 ${nf(K.cap_p90, 2)} pallets por viaje (C10.1).</p>`;
    setTabla("phist", bins.map((b) => ({ "Desde (pallets)": +b, Viajes: hb[b] })));
    const cap = filas(D.capacidad); setTabla("cap", cap, null, $("#x-cap")); setTabla("cap", cap);
    const tr = filas(D.tramos);
    plot("tramos", [{ type: "scatter", mode: "markers", x: tr.map((r) => r.tramo_pallets), y: tr.map((r) => r.kg_p50), marker: { size: 10, color: S1, line: { color: "#fcfcfb", width: 2 } },
      error_y: { type: "data", symmetric: false, array: tr.map((r) => r.kg_p90 - r.kg_p50), arrayminus: tr.map((r) => r.kg_p50 - r.kg_p10), color: "#75746f", thickness: 2, width: 6 },
      customdata: tr.map((r) => [r.kg_p10, r.kg_p90, r.n_viajes, r.paradas_p50]), hovertemplate: "%{x} pallets: P50 %{y:,.0f} kg<br>P10 %{customdata[0]:,.0f} · P90 %{customdata[1]:,.0f}<br>%{customdata[2]:,} viajes · %{customdata[3]} paradas (mediana)<extra></extra>" }],
    { showlegend: false, xaxis: { title: { text: "tramo de pallets por viaje" } }, yaxis: { title: { text: "kg por viaje (cota inferior, supuesto kg)" } } });
    setTabla("tramos", tr);
    const fl = filas(D.flota), g = (m) => fl.find((r) => r.metrica === m) || {};
    const met = [["camiones_necesarios_modelo_p50", "Modelo con P50"], ["camiones_necesarios_modelo_p90", "Modelo con P90"], ["camiones_activos_dia_real_promedio", "Reales activos por día"]];
    plot("camiones", [["actual", "Alcance anterior", GRIS], ["corregido", "Alcance corregido", S1]].map(([k, n, col]) => bar({ name: n, x: met.map((m) => m[1]), y: met.map((m) => g(m[0])[k]),
      marker: { color: col, line: { color: "#fcfcfb", width: 2 } }, hovertemplate: "%{x}: %{y:.1f} camiones<extra>" + n + "</extra>" })), { barmode: "group", yaxis: { title: { text: "camiones" } } });
    setTabla("camiones", fl);
    const tv = filas(D.top_viajes); setTabla("top", tv, null, $("#x-top")); setTabla("top", tv);
  };

  R.calidad = function () {
    const cal = filas(D.calidad); setTabla("calidad", cal, ["tema", "metrica", "valor", "tratamiento_actual"], $("#x-calidad")); setTabla("calidad", cal);
    const cs = filas(D.cascada).filter((r) => r.cantidad !== null);
    plot("cascada", [bar({ orientation: "h", y: cs.map((r) => r.paso), x: cs.map((r) => r.cantidad), marker: { color: cs.map((r) => r.paso.startsWith("3") ? S2 : S1), line: { color: "#fcfcfb", width: 2 } },
      customdata: cs.map((r) => [r.pct_cantidad_sobre_venta_efectiva, r.pallets]), hovertemplate: "%{y}<br>%{x:,} unidades (%{customdata[0]:.2f} % de la venta efectiva)<br>%{customdata[1]:,.1f} pallets<extra></extra>" })],
    { yaxis: { autorange: "reversed" }, margin: { l: 300 }, xaxis: { title: { text: "unidades (cantidad)" } } });
    setTabla("cascada", filas(D.cascada));
    const ex = filas(D.exclusiones_geo), sin = ex.filter((r) => r.motivo_exclusion.startsWith("a)")).reduce((a, r) => a + r.pct_volumen, 0);
    plot("geo", [bar({ x: ["Con coordenada válida", "Sin georreferencia"], y: [100 - sin, sin], marker: { color: [S1, GRIS], line: { color: "#fcfcfb", width: 2 } }, text: [pct(100 - sin, 2), pct(sin, 2)], textposition: "outside",
      hovertemplate: "%{x}: %{y:.2f} % del volumen<extra></extra>" })], { showlegend: false, yaxis: { title: { text: "% del volumen" }, range: [0, 110] } });
    setTabla("geo", ex);
    const hu = filas(D.huerfanos); setTabla("huerf", hu, null, $("#x-huerf")); setTabla("huerf", hu);
    const dd = $("#x-decisiones"); dd.innerHTML = "<p class='nota'>Código 451555 (Cerveza ZenMax):</p>"; setTabla("decisiones", filas(D.d451555), null, dd.appendChild(document.createElement("div")));
    dd.insertAdjacentHTML("beforeend", "<p class='nota'>Alcance geográfico: comparación de cifras clave (decisión del equipo, C2.1):</p>");
    setTabla("decisiones", filas(D.alcance_cifras), null, dd.appendChild(document.createElement("div"))); setTabla("decisiones", filas(D.alcance_cifras));
    const co = filas(D.codigos); setTabla("codigos", co, null, $("#x-codigos")); setTabla("codigos", co);
    const em = filas(D.envases_mes).filter((r) => state.anio === "Todos" || String(r.ANIO) === state.anio);
    plot("env-mes", [["CJ", "CJ (cajas de botellas)", S1], ["CU", "CU (casilleros, keg, sueltas)", S2]].map(([u, n, col]) => { const r = em.filter((x) => x.UNIDAD === u);
      return { type: "scatter", mode: "lines+markers", name: n, x: r.map((x) => `${x.ANIO}-${String(x.MES).padStart(2, "0")}`), y: r.map((x) => x.tasa_retorno_pct), line: { color: col, width: 2 },
        marker: { size: 8, color: col, line: { color: "#fcfcfb", width: 2 } }, hovertemplate: "%{x}: %{y:.1f} %<extra>" + n + "</extra>" }; }),
    { hovermode: "x unified", yaxis: { title: { text: "% retorno documentado (entrada / salida)" } }, xaxis: { type: "category", tickangle: -45 },
      shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 100, y1: 100, line: { color: "#52514e", width: 1, dash: "dash" } }] });
    setTabla("env-mes", em);
    const et = filas(D.envases_tipo).filter((r) => r.UNIDAD === "CJ" && r.SALIDA >= 100);
    plot("env-tipo", [bar({ orientation: "h", y: et.map((r) => `${r.CATEGORIA.replace("ENVASE ", "")} ${r.TAMANO}`), x: et.map((r) => r.tasa_retorno_pct), marker: { color: S1, line: { color: "#fcfcfb", width: 2 } },
      customdata: et.map((r) => [r.SALIDA, r.ENTRADA]), hovertemplate: "%{y}: %{x:.1f} %<br>salida %{customdata[0]:,} · entrada %{customdata[1]:,}<extra></extra>" })],
    { yaxis: { autorange: "reversed" }, margin: { l: 170 }, xaxis: { title: { text: "% retorno documentado" } } });
    setTabla("env-tipo", filas(D.envases_tipo));
    const dv = filas(D.devolucion);
    plot("dev", [["pct_cant_ANULACION_RECHAZO_PRODUCTO", "Anulaciones / rechazos", S1], ["pct_cant_SUBESTANDAR", "Subestándar (203, 204, 403)", S2]].map(([k, n, col]) => bar({ name: n, x: dv.map((r) => String(r.ANIO).replace("_", "-")), y: dv.map((r) => r[k]),
      marker: { color: col, line: { color: "#fcfcfb", width: 2 } }, text: dv.map((r) => nf(r[k], r[k] < 0.1 ? 3 : 2) + " %"), textposition: "outside", hovertemplate: "%{x}: %{y:.3f} %<extra>" + n + "</extra>" })),
    { barmode: "group", xaxis: { type: "category" }, yaxis: { title: { text: "% de la cantidad de venta efectiva" } } });
    setTabla("dev", dv);
    const ca = filas(D.inc_causa).sort((a, b) => b.pct_pedidos_afectados - a.pct_pedidos_afectados);
    plot("causas", [[true, "Incidencia de servicio", S1], [false, "Movimiento administrativo / comercial", GRIS]].map(([s, n, col]) => { const r = ca.filter((x) => x.incidencia_servicio === s);
      return bar({ name: n, orientation: "h", y: r.map((x) => x.causa_supuesta.replace(/_/g, " ").toLowerCase()), x: r.map((x) => x.pct_pedidos_afectados), marker: { color: col, line: { color: "#fcfcfb", width: 2 } },
        hovertemplate: "%{y}: %{x:.2f} % de los pedidos<extra></extra>" }); }),
    { yaxis: { categoryorder: "array", categoryarray: ca.map((x) => x.causa_supuesta.replace(/_/g, " ").toLowerCase()).reverse() }, margin: { l: 300 }, xaxis: { title: { text: "% de pedidos (cliente-día) afectados" } } });
    setTabla("causas", ca);
    const ia = filas(D.inc_anio).filter((r) => String(r.ANIO) !== "2023_2025");
    plot("srv", [bar({ x: ia.map((r) => String(r.ANIO)), y: ia.map((r) => r.pct_pedidos_con_incidencia_servicio), marker: { color: ia.map((r) => ANIO_COLOR[r.ANIO]), line: { color: "#fcfcfb", width: 2 } },
      text: ia.map((r) => pct(r.pct_pedidos_con_incidencia_servicio, 1)), textposition: "outside", hovertemplate: "%{x}: %{y:.1f} %<extra></extra>" })],
    { showlegend: false, xaxis: { type: "category" }, yaxis: { title: { text: "% de pedidos con incidencia" }, rangemode: "tozero" } });
    setTabla("srv", filas(D.inc_anio));
  };
  R.diseno = function () {};

  // ---------------- navegación, filtros y arranque ----------------
  const hechos = new Set();
  function render(p) {
    const main = document.getElementById("p-" + p); if (!main) return;
    if (!hechos.has(p)) { main.querySelectorAll(".card[data-ids]").forEach(hilo); hechos.add(p); }
    try { (R[p] || function () {})(); } catch (e) { console.error("Error al dibujar la página " + p, e); }
  }
  function actual() {
    if (MODO !== "uno") return document.body.dataset.page;
    const h = (location.hash || "#index").slice(1); return document.getElementById("p-" + h) ? h : "index";
  }
  function mostrar() {
    const p = actual();
    if (MODO === "uno") document.querySelectorAll("main.pagina").forEach((m) => { m.hidden = m.dataset.page !== p; });
    document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("activo", a.dataset.nav === p));
    render(p); window.scrollTo(0, 0);
  }
  document.addEventListener("DOMContentLoaded", function () {
    $("#generado").textContent = D.meta.generado;
    $("#alcance").textContent = D.meta.alcance + (D.anonimizado ? " · IDs de cliente seudonimizados" : "");
    const fa = $("#f-anio"), fc = $("#f-cat"); fa.value = state.anio; fc.value = state.cat;
    const cambio = () => { state.anio = fa.value; state.cat = fc.value; guardar(); render(actual()); };
    fa.addEventListener("change", cambio); fc.addEventListener("change", cambio);
    const btn = $(".menu-btn"); btn.addEventListener("click", () => { const n = $("#nav"); n.classList.toggle("abierto"); btn.setAttribute("aria-expanded", n.classList.contains("abierto")); });
    if (!window.Plotly) document.querySelectorAll(".plot").forEach((el) => { el.innerHTML = '<p class="no-disp">No se pudo cargar la librería de gráficos (Plotly). Revisa la conexión.</p>'; });
    window.addEventListener("hashchange", mostrar);
    mostrar();
  });
})();
