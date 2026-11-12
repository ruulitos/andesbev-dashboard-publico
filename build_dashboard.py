# -*- coding: utf-8 -*-
"""
BUILD DASHBOARD - AndesBev SpA, piloto Coquimbo-La Serena (Primera Entrega: diagnóstico)
========================================================================================

Lee los CSV del proyecto y genera:
  docs/                                  sitio estático listo para GitHub Pages (una página por sección)
  dist/AndesBev_dashboard_offline.html   versión "todo en uno" autocontenida (Plotly incrustado)

Uso:
  python build_dashboard.py                 # datos completos
  python build_dashboard.py --anonimizar    # IDs de cliente seudonimizados y coordenadas redondeadas
                                            # (recomendado si el repositorio/sitio es público)

Cada vez que cambie un CSV, basta con volver a correr este script.

Base de datos: ALCANCE CORREGIDO (decisión del equipo, registros C<N>.1 / B<N>.1 de la bitácora).
Reglas:
  - Ningún número se escribe a mano: todo sale de un CSV (directo o agregado aquí, y en ese
    caso se etiqueta "Resultado calculado").
  - Lo que no está en los datos se muestra como "Dato no disponible" (lista DATOS_NO_DISPONIBLES).
  - El hallazgo/implicancia de cada visual se toma de bitacora_hallazgos_hilo_conductor.csv.
"""

import argparse
import hashlib
import json
import re
import shutil
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

BASE = Path(__file__).resolve().parent
PROC = BASE / "datos_procesados"
H4 = PROC / "hallazgos_clase4"
H4C = H4 / "alcance_corregido"
AGG = PROC / "alcance_corregido" / "agregados"
INS = H4C / "insumos"
AUD = PROC / "auditoria"
SRC = BASE / "dashboard_src"
DOCS = BASE / "docs"
DIST = BASE / "dist"
PLOTLY_LOCAL = Path(__import__("plotly").__file__).parent / "package_data" / "plotly.min.js"

CDN = {
    "plotly": "https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js",
    "leaflet_js": "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js",
    "leaflet_css": "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css",
    "leaflet_heat": "https://cdn.jsdelivr.net/npm/leaflet.heat@0.2.0/dist/leaflet-heat.js",
}
CATEGORIAS = ["Gaseosas", "Cervezas", "Aguas", "Piscos y Licores", "Vinos"]
GRUPOS_CORREGIDO = {"R0_pipeline", "G1_comuna_region_otra_escritura", "G2_facturado_fuera_entrega_georref_region"}

DATOS_NO_DISPONIBLES = [
    ("Dimensiones y capacidad nominal de los camiones (pallets y kg)", "No están en los datos del caso; las capacidades mostradas son observadas (percentiles por viaje)."),
    ("Peso en la maestra de productos", "La maestra no tiene peso; se usa PESO-CAJA de las ventas con unidad supuesta kg."),
    ("Categoría de producto por cliente y por viaje", "Los agregados por cliente y por viaje no traen categoría: el filtro de categoría no aplica al mapa, a los clientes ni a la flota."),
    ("Segmento de 1.665 clientes", "No están en la base de georreferenciación."),
    ("Comuna de entrega de clientes facturados en la RM", "Solo se conoce su coordenada; la comuna de la venta es la de facturación."),
    ("Lead time Lampa - piloto, Ruta 5 Norte, jornada de conducción", "Pendiente de fuente secundaria (C9)."),
    ("Límites legales de peso (D.S. 158) y normativa de alcoholes/ordenanzas", "Pendiente de fuente secundaria (C10, C13)."),
    ("Diccionario oficial de motivos de anulación y de códigos CL/CU", "Pendiente de AndesBev (C12, A1)."),
]


def leer(ruta, **kw):
    return pd.read_csv(ruta, encoding="utf-8", **kw)


def limpio(obj):
    """Convierte tipos numpy/pandas y NaN a JSON."""
    if isinstance(obj, dict):
        return {str(k): limpio(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [limpio(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        return None if (obj is None or np.isnan(obj)) else round(float(obj), 4)
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if obj is pd.NA or obj is pd.NaT:
        return None
    return obj


def tabla(df):
    df = df.replace({np.nan: None})
    return {"columnas": [str(c) for c in df.columns], "filas": limpio(df.values.tolist())}


# =====================================================================
# DATOS
# =====================================================================
def preparar_datos(anonimizar: bool):
    D, control = {}, {}

    # ---------- Bitácora (versión con más filas: auditoria/) ----------
    bit = leer(AUD / "bitacora_hallazgos_hilo_conductor.csv", dtype=str).fillna("")
    D["bitacora"] = {r["id_hallazgo"]: {k: r[k] for k in bit.columns} for _, r in bit.iterrows()}
    control["bitacora_filas"] = len(bit)

    # ---------- Serie diaria por categoría (venta efectiva, alcance corregido) ----------
    dia = leer(AGG / "dia.csv", parse_dates=["FECHA"])
    dia = dia[dia["grupo"].isin(GRUPOS_CORREGIDO) & dia["ve"]]
    dia["Categorias"] = dia["Categorias"].replace("SIN_CATEGORIA", "Sin categoría")
    pal = dia.pivot_table(index="FECHA", columns="Categorias", values="pallets", aggfunc="sum", fill_value=0)
    caj = dia[dia["UNIDAD"] == "CJ"].pivot_table(index="FECHA", columns="Categorias", values="cantidad",
                                                aggfunc="sum", fill_value=0).reindex(pal.index, fill_value=0)
    cats_serie = CATEGORIAS + (["Sin categoría"] if "Sin categoría" in caj.columns else [])
    pal = pal.reindex(columns=cats_serie, fill_value=0)
    caj = caj.reindex(columns=cats_serie, fill_value=0)
    D["serie"] = {"fechas": [d.strftime("%Y-%m-%d") for d in pal.index], "categorias": cats_serie,
                  "pallets": {c: limpio(pal[c].round(3).tolist()) for c in cats_serie},
                  "cajas": {c: limpio(caj[c].tolist()) for c in cats_serie}}
    control["pallets_total"] = pal.values.sum()
    control["cajas_dia_promedio"] = caj.sum(axis=1).mean()
    control["dias"] = len(pal)

    # ---------- Fin de mes (misma lógica de investigar_pico_fin_de_mes.py, alcance corregido) ----------
    t = pal.sum(axis=1).rename("p").reset_index()
    t["dow"], t["ult"], t["mes"] = t["FECHA"].dt.dayofweek, t["FECHA"].dt.is_month_end, t["FECHA"].dt.to_period("M")
    fm = []
    for mes, g in t.groupby("mes"):
        u = g[g["ult"]]
        if u.empty:
            continue
        r = g[(g["dow"] == u.iloc[0]["dow"]) & ~g["ult"]]
        if r.empty:
            continue
        fm.append({"mes": str(mes), "ultimo_dia": u.iloc[0]["p"], "promedio_mismo_dia_semana": r["p"].mean(),
                   "ratio": u.iloc[0]["p"] / r["p"].mean()})
    D["fin_mes"] = tabla(pd.DataFrame(fm).round(3))

    # ---------- Estacionalidad, mix, comparación de alcance ----------
    D["ie"] = tabla(leer(H4C / "h03_indice_estacional_categoria_anio_mes.csv"))
    D["peaks"] = tabla(leer(H4C / "h03_mes_peak_por_categoria_anio.csv")[
        ["Categorias", "ANIO", "mes_peak", "ie_peak", "segundo_mes", "ie_segundo", "ie_septiembre", "ie_diciembre"]])
    D["mix"] = tabla(leer(H4C / "h03_mix_categorias_por_anio.csv"))
    D["alcance_mensual"] = tabla(leer(PROC / "alcance_corregido" / "comparacion_pallets_mensuales_2024_2025.csv"))
    cmp_ = leer(PROC / "alcance_corregido" / "comparacion_cifras_clave_actual_vs_corregido.csv")
    # valor_actual/valor_corregido mezclan números y texto (p. ej. categorías A): se convierte celda a celda
    a_num = lambda v: pd.to_numeric(v, errors="coerce") if pd.notna(pd.to_numeric(v, errors="coerce")) else v  # noqa: E731
    for c in ["valor_actual", "valor_corregido"]:
        cmp_[c] = cmp_[c].map(a_num).astype(object)
    cmp_["registro_bitacora"] = cmp_["registro_bitacora"].fillna("")
    D["alcance_cifras"] = tabla(cmp_[["metrica", "registro_bitacora", "valor_actual", "valor_corregido", "var_pct"]])
    D["variabilidad"] = tabla(leer(H4C / "h02_variabilidad_diaria_cajas.csv")[
        ["alcance", "n_dias", "media", "p50", "p90", "p95", "max", "CV"]])

    # ---------- Clientes ----------
    frec = leer(INS / "frecuencia_tamano_pedido_por_cliente.csv", dtype={"ID-CLIENTE": str})
    geo = leer(PROC / "georeferencia_clientes_limpio.csv", dtype={"ID_CLIENTE": str})
    geo["ID_CLIENTE"] = geo["ID_CLIENTE"].str.strip()
    canal = leer(H4C / "h07_mapeo_segmento_canal.csv").set_index("DESCR_SEGMENTO")["CANAL_supuesto"]
    perd = set(leer(INS / "clientes_perdidos_2025.csv", dtype={"ID-CLIENTE": str})["ID-CLIENTE"].str.strip())
    cd = leer(H4C / "base" / "cliente_dia.csv", dtype={"ID-CLIENTE": str})
    pa = cd.groupby(["ID-CLIENTE", "ANIO"])["pallets_venta_efectiva"].sum().unstack("ANIO").reindex(columns=[2023, 2024, 2025], fill_value=0).fillna(0)
    coords = leer(H4C / "h08_clientes_distancia_cg.csv", dtype={"ID-CLIENTE": str}).set_index("ID-CLIENTE")
    gi = geo.set_index("ID_CLIENTE")
    cli = frec.set_index("ID-CLIENTE")
    cli["segmento"] = gi["DESCR_SEGMENTO"].reindex(cli.index)
    cli["canal"] = cli["segmento"].map(canal)
    cli.loc[cli["segmento"].isna(), ["segmento", "canal"]] = "Sin segmento (no georreferenciado)"
    cli["perdido_2025"] = cli.index.isin(perd)
    cli = cli.join(coords[["lat", "lon", "dist_cg_km"]]).join(pa.rename(columns=lambda a: f"p{a}"))
    control["clientes"] = len(cli)
    control["pct_clientes_georref"] = 100 * cli.index.isin(gi.index).mean()
    control["pct_demanda_georref"] = 100 * cli.loc[cli.index.isin(gi.index), "pallets_totales"].sum() / cli["pallets_totales"].sum()

    ids = cli.index.tolist()
    if anonimizar:
        mapa = {i: "CL-" + hashlib.sha256(("andesbev|" + i).encode()).hexdigest()[:8].upper() for i in ids}
        cli.index = cli.index.map(mapa)
        cli["lat"], cli["lon"] = cli["lat"].round(3), cli["lon"].round(3)
        # Los textos de la bitácora citan clientes por ID: se reemplazan por el mismo seudónimo.
        # Un número que también es código de producto no se reemplaza (ambiguo) y se informa.
        productos = set(leer(PROC / "maestra_productos_limpio.csv")["Codigo Ventas"].dropna().astype(int).astype(str))
        ambiguos = set()

        def seudo(m):
            tok = m.group(0)
            if tok in mapa and tok not in productos:
                return mapa[tok]
            if tok in mapa:
                ambiguos.add(tok)
            return tok
        for r in D["bitacora"].values():
            for k in ("hallazgo", "implicancia", "condicionante", "analisis", "tema", "fuente"):
                r[k] = re.sub(r"\b\d{5,8}\b", seudo, r[k])
        control["ids_ambiguos_no_reemplazados_en_bitacora"] = sorted(ambiguos)
        for fila in D["alcance_cifras"]["filas"]:
            if fila[0] == "cliente_top1_id":
                fila[2:4] = [mapa.get(str(v), v) for v in fila[2:4]]
    else:
        cli["lat"], cli["lon"] = cli["lat"].round(5), cli["lon"].round(5)
    cols_cli = ["n_pedidos", "pallets_totales", "tamano_promedio_pedido", "tasa_frecuencia_pct", "primera_compra",
                "ultima_compra", "segmento", "canal", "perdido_2025", "lat", "lon", "dist_cg_km", "p2023", "p2024", "p2025"]
    c2 = cli[cols_cli].copy()
    c2[["pallets_totales", "tamano_promedio_pedido", "p2023", "p2024", "p2025", "dist_cg_km"]] = \
        c2[["pallets_totales", "tamano_promedio_pedido", "p2023", "p2024", "p2025", "dist_cg_km"]].round(3)
    D["clientes"] = {"columnas": ["id"] + cols_cli,
                     "filas": limpio([[i] + r for i, r in zip(c2.index.tolist(), c2.replace({np.nan: None}).values.tolist())])}
    D["anonimizado"] = anonimizar

    # Distribuciones de frecuencia y tamaño (bins calculados aquí)
    D["dist_pedidos"] = {"n_pedidos": limpio(frec["n_pedidos"].tolist()),
                         "tamano_promedio": limpio(frec["tamano_promedio_pedido"].round(4).tolist())}

    radios = leer(H4C / "h08_volumen_clientes_por_radio_cg.csv")
    D["radios"] = tabla(radios)
    D["cg"] = {"lat": float(radios["cg_lat"].iloc[0]), "lon": float(radios["cg_lon"].iloc[0])}
    D["comunas"] = tabla(leer(H4C / "h08_desglose_por_comuna.csv")[
        ["COMUNA_LIMPIA", "pallets", "pct_volumen", "n_clientes_comuna_principal", "dist_ponderada_cg_km"]])
    D["exclusiones_geo"] = tabla(leer(H4C / "auditoria_h08_exclusiones_geo.csv")[["motivo_exclusion", "n_clientes", "pct_volumen"]])
    seg = leer(H4C / "h07_economia_entrega_por_segmento.csv")
    D["segmentos"] = tabla(seg[["SEGMENTO", "CANAL", "n_clientes", "pct_clientes", "pct_volumen", "pallets_por_pedido",
                                "frecuencia_mediana_pedidos_semana"]])
    D["canales"] = tabla(leer(H4C / "h07_economia_entrega_por_canal.csv")[
        ["CANAL", "n_clientes", "pct_clientes", "pct_volumen", "pallets_por_pedido", "frecuencia_mediana_pedidos_semana"]])
    D["ventanas"] = tabla(leer(H4C / "h13_ventana_horaria_por_segmento.csv")[
        ["SEGMENTO", "clientes", "pedidos", "tasa_352_por_100_pedidos", "tasa_360_por_100_pedidos", "tasa_352_o_360_por_100_pedidos"]])
    D["perdidos_resumen"] = tabla(leer(H4C / "b16_clientes_perdidos_actual_vs_corregido.csv").rename(columns={"Unnamed: 0": "metrica"}))
    D["perdidos_decil"] = tabla(leer(H4C / "b15_tasa_perdida_por_decil_actual_vs_corregido.csv"))

    # ---------- Productos ----------
    sku = leer(H4C / "h05_sku_abc_xyz_vida_util.csv")
    base_m = leer(INS / "abc_xyz_base_mensual.csv")
    pa_s = base_m.groupby(["PRODUCTO", "ANIO"])["CANTIDAD_PALLETS"].sum().unstack("ANIO").reindex(columns=[2023, 2024, 2025]).fillna(0)
    mae = leer(PROC / "maestra_productos_limpio.csv").drop_duplicates("Codigo Ventas").set_index("Codigo Ventas")
    s = sku.set_index("PRODUCTO").join(pa_s.rename(columns=lambda a: f"p{a}"))
    s["cajas_por_pallet"] = mae["Cajas por Pallet"].reindex(s.index)
    s["unidad_base"] = mae["Unidad de medida base"].reindex(s.index)
    cols_s = ["Categorias", "CANTIDAD_PALLETS", "clase_ABC_supuesto", "XYZ_convencional", "fuente_clasificacion",
              "Vida Util", "vu_corta", "CV", "n_meses_con_venta", "cajas_por_pallet", "unidad_base", "p2023", "p2024", "p2025"]
    s2 = s[cols_s].round(3).replace({np.nan: None})
    D["productos"] = {"columnas": ["producto"] + cols_s,
                      "filas": limpio([[int(i)] + r for i, r in zip(s2.index.tolist(), s2.values.tolist())])}

    # ABC por categoría (consolidado, alcance corregido)
    bc = base_m.dropna(subset=["Categorias"])
    rc = bc.groupby("Categorias")["CANTIDAD_PALLETS"].sum().sort_values(ascending=False).reset_index()
    rc["pct"] = 100 * rc["CANTIDAD_PALLETS"] / rc["CANTIDAD_PALLETS"].sum()
    rc["pct_acum"] = rc["pct"].cumsum()
    rc["clase"] = np.where(rc["pct_acum"] <= 80, "A", np.where(rc["pct_acum"] <= 95, "B", "C"))
    D["abc_cat"] = tabla(rc.round(3))
    # CV mensual por categoría con y sin 2025 (misma función calcular_cv de ABC_parte_2.py)
    meses36 = pd.MultiIndex.from_product([[2023, 2024, 2025], range(1, 13)], names=["ANIO", "MES"])
    pv = bc.pivot_table(index="Categorias", columns=["ANIO", "MES"], values="CANTIDAD_PALLETS", aggfunc="sum", fill_value=0).reindex(columns=meses36, fill_value=0)
    p24 = pv.loc[:, pv.columns.get_level_values(0) < 2025]
    cv = pd.DataFrame({"CV_con_2025": pv.std(axis=1, ddof=1) / pv.mean(axis=1),
                       "CV_sin_2025": p24.std(axis=1, ddof=1) / p24.mean(axis=1)}).round(3).reset_index()
    D["cv_cat"] = tabla(cv)
    mz = leer(INS / "matriz_abc_xyz_sku_detalle.csv")
    D["matriz"] = tabla(mz[["Categorias", "PRODUCTO", "CANTIDAD_PALLETS", "clase_ABC_supuesto", "XYZ_convencional", "CV",
                            "n_meses_con_venta"]].round(3))
    D["cola_cz"] = tabla(leer(H4C / "h05_resumen_cola_cz_vida_util.csv")[
        ["alcance", "sku_alcance", "sku_CZ", "pct_vol_CZ_sobre_alcance", "sku_CZ_vu_le_120", "sku_CZ_vu_le_180",
         "sku_CZ_vu_le_365", "sku_CZ_vu_centinela"]])
    D["cajas_pallet_cat"] = tabla(leer(AUD / "auditoria_cajas_pallet_por_categoria_completa.csv"))
    D["vida_util_cat"] = tabla(leer(AUD / "auditoria_vida_util_por_categoria_completa.csv"))
    D["disp_espacio"] = tabla(leer(H4C / "h06_dispersion_pallet_eq_por_caja_categoria.csv")[
        ["Categorias", "n_sku", "p10", "p50", "p90", "razon_p90_p10", "cajas_por_pallet_p50"]])
    pes = leer(H4C / "h06_dispersion_peso_por_caja_y_pallet_categoria.csv")
    D["disp_peso"] = tabla(pes[["metrica", "Categorias", "p10", "p50", "p90", "razon_p90_p10"]])

    # ---------- Flota ----------
    vc = leer(H4C / "base" / "viaje_cliente.csv", dtype={"CAMION": str, "ID-CLIENTE": str}, parse_dates=["FECHA"])
    v = vc.groupby(["ANIO", "FECHA", "CAMION", "VIAJE"]).agg(pallets=("pallets", "sum"), kg=("peso_total", "sum"),
                                                          paradas=("ID-CLIENTE", "nunique")).reset_index()
    control["viajes"] = len(v)
    control["p50_viaje"] = v["pallets"].quantile(0.5)
    vu = v.groupby(["ANIO", "FECHA", "CAMION"])["VIAJE"].nunique().rename("vueltas").reset_index()
    D["vueltas_dist"] = tabla(vu.groupby(["ANIO", "vueltas"]).size().rename("dias_camion").reset_index())
    D["vueltas_camion"] = tabla(vu.groupby(["ANIO", "CAMION"])["vueltas"].agg(["mean", "max", "size"]).round(3)
                                .rename(columns={"mean": "vueltas_promedio", "max": "vueltas_max", "size": "dias_activo"}).reset_index())
    edges = list(np.arange(0, 12.5, 0.5)) + [1000]
    v["bin"] = pd.cut(v["pallets"], edges, right=False, labels=[f"{a:g}" for a in edges[:-1]])
    D["pallets_viaje_hist"] = tabla(v.groupby(["ANIO", "bin"], observed=False).size().rename("viajes").reset_index())
    top = v.sort_values("pallets", ascending=False).head(25).copy()
    top["FECHA"] = top["FECHA"].dt.strftime("%Y-%m-%d")
    D["top_viajes"] = tabla(top[["FECHA", "CAMION", "VIAJE", "pallets", "kg", "paradas"]].round(2))
    D["capacidad"] = tabla(leer(H4C / "h10_capacidad_observada_por_viaje.csv"))
    D["tramos"] = tabla(leer(H4C / "h10_peso_por_tramo_de_pallets_viaje.csv")[
        ["tramo_pallets", "n_viajes", "pct_viajes", "kg_p10", "kg_p50", "kg_p90", "paradas_p50"]])
    fl = leer(H4C / "b10_estimacion_flota_actual_vs_corregido.csv").rename(columns={"Unnamed: 0": "metrica"})
    D["flota"] = tabla(fl)

    # ---------- Calidad, logística inversa, servicio ----------
    D["calidad"] = tabla(leer(H4C / "h14_consolidado_calidad_informacion.csv"))
    D["cascada"] = tabla(leer(H4C / "h01_cascada_facturacion_demanda_flujo.csv"))
    D["codigos"] = tabla(leer(H4C / "h11_clasificacion_codigos_facturacion.csv")[
        ["TIPO FACTURA", "DESCRIPCION", "ACCION", "Clasificacion", "categoria_h11", "lineas", "nota"]])
    D["huerfanos"] = tabla(leer(H4 / "h01_huerfanos_por_clasificacion.csv"))
    D["d451555"] = tabla(pd.read_csv(AUD / "auditoria_decision_codigo_451555.csv", comment="#", encoding="utf-8")[
        ["PRODUCTO", "MARCA", "primera_fecha", "meses_con_actividad", "n_clientes_distintos", "decision", "pendiente"]])
    D["envases_mes"] = tabla(leer(H4C / "h11_balance_envases_por_mes.csv"))
    D["envases_tipo"] = tabla(leer(H4C / "h11_balance_envases_por_tipo.csv"))
    dev = leer(H4C / "h11_tasa_devolucion_total_por_anio.csv")
    D["devolucion"] = tabla(dev[["ANIO", "pct_cant_ANULACION_RECHAZO_PRODUCTO", "pct_cant_SUBESTANDAR",
                                 "pct_cant_DEVOLUCION_TOTAL", "pallets_ANULACION_RECHAZO_PRODUCTO"]])
    D["inc_causa"] = tabla(leer(H4C / "h12_incidencias_por_causa.csv")[
        ["causa_supuesta", "incidencia_servicio", "pct_pedidos_afectados", "pct_lineas_mot_anu_nz"]])
    D["inc_anio"] = tabla(leer(H4C / "h12_incidencias_resumen_por_anio.csv")[
        ["ANIO", "pct_lineas_mot_anu_nz", "pct_pedidos_con_incidencia_servicio", "nivel_servicio_proxy_pct"]])

    # ---------- KPIs fijos (2023-2025) ----------
    d_tot = dev[dev["ANIO"].astype(str) == "2023_2025"].iloc[0]
    flc = fl.set_index("metrica")["corregido"]
    D["kpis_fijos"] = {
        "pct_devolucion_total": d_tot["pct_cant_DEVOLUCION_TOTAL"],
        "pct_anulaciones": d_tot["pct_cant_ANULACION_RECHAZO_PRODUCTO"],
        "pct_subestandar": d_tot["pct_cant_SUBESTANDAR"],
        "pct_clientes_georref": control["pct_clientes_georref"],
        "n_clientes_georref": int(cli["lat"].notna().sum()), "n_clientes": control["clientes"],
        "pct_demanda_georref": control["pct_demanda_georref"],
        "factor_recargue": flc["factor_recargue_promedio"],
        "cap_p50": flc["capacidad_p50_pallets_viaje"], "cap_p90": flc["capacidad_p90_pallets_viaje"],
        "camiones_p50": flc["camiones_necesarios_modelo_p50"], "camiones_p90": flc["camiones_necesarios_modelo_p90"],
        "camiones_reales": flc["camiones_activos_dia_real_promedio"],
    }
    D["no_disponible"] = [{"dato": a, "detalle": b} for a, b in DATOS_NO_DISPONIBLES]
    D["meta"] = {"generado": datetime.now().strftime("%d-%m-%Y %H:%M"),
                 "alcance": "Alcance corregido: Región de Coquimbo por punto de entrega (incluye Vicuña/Paihuano y clientes facturados en la RM con entrega en la región)",
                 "categorias": CATEGORIAS, "anios": [2023, 2024, 2025]}
    return limpio(D), control


# =====================================================================
# PÁGINAS
# =====================================================================
PAGINAS = [
    ("index", "Inicio"), ("demanda", "Demanda"), ("portafolio", "Portafolio"),
    ("clientes", "Clientes y territorio"), ("flota", "Flota y transporte"),
    ("calidad", "Calidad de datos y logística inversa"), ("diseno", "Diseño"),
]

# card(id, título, etiqueta, fuentes, ids_bitácora, filtros, alto, nota)
def card(cid, titulo, etiqueta, fuentes, ids, filtros="", alto=340, nota="", ancho="", tabla_=True, sin_grafico=False):
    chips = "".join(f'<span class="chip chip-{f}">{ {"anio": "Filtro año", "cat": "Filtro categoría"}[f]}</span>'
                    for f in filtros.split() if f)
    cuerpo = "" if sin_grafico else f'<div class="plot" id="g-{cid}" style="height:{alto}px" role="img" aria-label="{titulo}"></div>'
    return f"""
<article class="card {ancho}" id="c-{cid}" data-ids="{ids}">
  <header class="card-head">
    <h3>{titulo}</h3>
    <div class="badges"><span class="badge badge-{etiqueta.split()[0].lower()}">{etiqueta}</span>{chips}</div>
  </header>
  {f'<p class="nota">{nota}</p>' if nota else ''}
  {cuerpo}
  <div class="extra" id="x-{cid}"></div>
  <details class="tabla-det" {'hidden' if not tabla_ else ''}><summary>Ver tabla de datos</summary><div class="tabla" id="t-{cid}"></div></details>
  <aside class="hilo" id="h-{cid}"></aside>
  <footer class="fuente">Fuente: {fuentes}</footer>
</article>"""


def seccion(titulo, html, intro=""):
    return f'<section class="bloque"><h2>{titulo}</h2>{f"<p class=intro>{intro}</p>" if intro else ""}<div class="grid">{html}</div></section>'


L = {"real": "Dato real", "calc": "Resultado calculado", "sup": "Supuesto", "prop": "Propuesta de diseño"}


def contenido(pagina):
    if pagina == "index":
        return f"""
<section class="bloque"><h2>Indicadores clave</h2>
<p class="intro">Promedios sobre días con actividad. Los indicadores de demanda responden a los filtros de año y categoría; el resto es 2023-2025.</p>
<div class="kpis" id="kpis"></div></section>
<section class="bloque"><h2>Buscar cliente o producto</h2>
<div class="buscador">
  <label for="q">ID de cliente o código de producto</label>
  <div class="buscador-fila"><input id="q" type="search" autocomplete="off" placeholder="ID de cliente o código de producto"><button id="q-btn" type="button">Buscar</button></div>
  <div id="q-sug" class="sugerencias"></div>
  <div id="ficha" class="ficha" aria-live="polite"></div>
</div></section>
{seccion("Hilo conductor", card("hilo-inicio", "Por qué la base es el alcance corregido", L["calc"], "comparacion_cifras_clave_actual_vs_corregido.csv; bitácora", "C2.1 B1.1 B16.1 C14.1", sin_grafico=True, nota="Comparación de cifras clave entre el alcance anterior (filtro por comuna de facturación) y el corregido (punto de entrega)."))}
{seccion("Datos no disponibles", '<article class="card ancho"><div id="no-disp"></div></article>')}"""
    if pagina == "demanda":
        return (seccion("Evolución 2023-2025",
                        card("mensual", "Pallets por mes y año", L["calc"], "agregados/dia.csv (venta efectiva)", "C2.1 B1.1", "cat", ancho="ancho")
                        + card("trimestral", "Pallets por trimestre y año", L["calc"], "agregados/dia.csv", "C2.1", "cat")
                        + card("dow", "Promedio de pallets por día de la semana", L["calc"], "agregados/dia.csv", "B4", "anio cat"))
                + seccion("Variabilidad diaria",
                          card("diaria", "Serie diaria con percentiles", L["calc"], "agregados/dia.csv", "C2.1 B4", "anio cat", alto=380, ancho="ancho",
                               nota="Líneas horizontales: P50, P90 y P95 de los días con actividad del filtro elegido.")
                          + card("finmes", "Último día del mes vs. mismo día de la semana del resto del mes", L["calc"], "agregados/dia.csv (lógica de investigar_pico_fin_de_mes.py)", "B18 B20", ancho="ancho",
                                 nota="Razón &gt; 1: el cierre de mes supera a un día comparable del mismo mes."))
                + seccion("Estacionalidad y mix",
                          card("ie", "Índice estacional por categoría (1 = mes promedio)", L["calc"], "h03_indice_estacional_categoria_anio_mes.csv", "C3.1 B2.1", "anio", alto=300, ancho="ancho")
                          + card("peaks", "Septiembre y diciembre por categoría", L["calc"], "h03_mes_peak_por_categoria_anio.csv", "C3.1 B2.1", "anio")
                          + card("mix", "Participación de cada categoría por año", L["calc"], "h03_mix_categorias_por_anio.csv", "C3.1"))
                + seccion("¿Hubo quiebre en 2025?",
                          card("alcance", "Variación 2025 vs 2024 por mes: alcance anterior vs corregido", L["calc"], "comparacion_pallets_mensuales_2024_2025.csv", "B1.1 C2.1", ancho="ancho",
                               nota="El alcance anterior filtraba por comuna de facturación y dejaba fuera a clientes que desde mayo-2025 se facturan en la RM.")))
    if pagina == "portafolio":
        return (seccion("Concentración",
                        card("abc-cat", "ABC por categoría (% del volumen)", L["calc"], "insumos/abc_xyz_base_mensual.csv", "C4.1")
                        + card("cv-cat", "Variabilidad mensual (CV) por categoría, con y sin 2025", L["calc"], "insumos/abc_xyz_base_mensual.csv", "C4.1 A2"))
                + seccion("Matriz ABC × XYZ (Gaseosas y Cervezas)",
                          card("mz-n", "Cantidad de SKU", L["calc"], "insumos/matriz_abc_xyz_sku_detalle.csv", "C4.1", "cat", alto=300)
                          + card("mz-v", "% del volumen de la matriz", L["calc"], "insumos/matriz_abc_xyz_sku_detalle.csv", "C4.1", "cat", alto=300)
                          + card("az", "SKU críticos A-Z (alto volumen, alta variabilidad)", L["calc"], "insumos/matriz_abc_xyz_sku_detalle.csv", "A2 C4.1", "cat", sin_grafico=True, ancho="ancho"),
                          "La matriz oficial cubre solo las categorías A (Gaseosas y Cervezas); Aguas, Piscos y Licores y Vinos quedan fuera (C4.1).")
                + seccion("Atributos físicos y vida útil",
                          card("cola", "Cola C-Z con vida útil corta (≤ 180 días)", L["sup"] + " (umbral)", "h05_resumen_cola_cz_vida_util.csv", "C5.1", "cat")
                          + card("espacio", "Pallets equivalentes por caja (P10-P50-P90)", L["calc"], "h06_dispersion_pallet_eq_por_caja_categoria.csv", "C6.1", "cat")
                          + card("peso", "kg por pallet equivalente (P10-P50-P90)", L["sup"] + " (unidad kg)", "h06_dispersion_peso_por_caja_y_pallet_categoria.csv", "C6.1", "cat")
                          + card("cpp", "Cajas por pallet y vida útil según maestra", L["real"], "auditoria_cajas_pallet_por_categoria_completa.csv; auditoria_vida_util_por_categoria_completa.csv", "B19", "cat",
                                 nota="Vida útil 999/9999 es un valor centinela (indefinida o no informada): se muestra la mediana.")))
    if pagina == "clientes":
        return (seccion("Mapa de demanda",
                        card("mapa", "Clientes georreferenciados", L["real"] + " (coordenadas)", "h08_clientes_distancia_cg.csv; georeferencia_clientes_limpio.csv; insumos/clientes_perdidos_2025.csv", "C8.1", "anio", alto=520, ancho="ancho",
                             nota="Círculos: 5, 10, 20 y 50 km desde el centro de gravedad ponderado por pallets. No representan rutas.")
                        + card("radios", "% de volumen y de clientes por distancia al centro de gravedad", L["calc"], "h08_volumen_clientes_por_radio_cg.csv", "C8.1")
                        + card("comunas", "Volumen por comuna de la venta", L["calc"], "h08_desglose_por_comuna.csv", "C8.1",
                               nota="'Facturado fuera (…)' = clientes facturados en la RM con entrega en la región."))
                + seccion("Economía de entrega por segmento",
                          card("canales", "% de volumen vs % de clientes por canal", L["calc"], "h07_economia_entrega_por_canal.csv", "C7.1 B13 B14")
                          + card("ppp", "Pallets por pedido por canal", L["calc"], "h07_economia_entrega_por_canal.csv", "C7.1")
                          + card("frec", "Distribución de pedidos por cliente (3 años)", L["calc"], "insumos/frecuencia_tamano_pedido_por_cliente.csv", "B13 B17")
                          + card("tam", "Distribución del tamaño promedio de pedido", L["calc"], "insumos/frecuencia_tamano_pedido_por_cliente.csv", "B13")
                          + card("ventanas", "Local cerrado / fuera de horario por segmento", L["calc"], "h13_ventana_horaria_por_segmento.csv", "C13.1", ancho="ancho"))
                + seccion("Variación 2024-2025",
                          card("var-cat", "Variación de pallets 2025 vs 2024 por categoría", L["calc"], "agregados/dia.csv", "B1.1 C3.1")
                          + card("decil", "Tasa de clientes perdidos 2025 por decil de volumen", L["calc"], "b15_tasa_perdida_por_decil_actual_vs_corregido.csv", "B15.1 B16.1")))
    if pagina == "flota":
        return (seccion("Uso de la flota observada",
                        card("vueltas", "Vueltas por camión por día", L["calc"], "base/viaje_cliente.csv", "B11 C10.1", "anio")
                        + card("vcamion", "Vueltas promedio por día, por camión (top 15)", L["calc"], "base/viaje_cliente.csv", "B20", "anio")
                        + card("phist", "Pallets por viaje", L["calc"], "base/viaje_cliente.csv", "C10.1 B10.1", "anio", ancho="ancho",
                               nota="Viaje = (fecha, camión, viaje). La capacidad nominal no está en los datos: P50 y P90 son capacidades observadas."))
                + seccion("Capacidad y camiones",
                          card("cap", "Capacidad observada por viaje", L["calc"], "h10_capacidad_observada_por_viaje.csv", "C10.1", sin_grafico=True)
                          + card("tramos", "Peso por viaje según tramo de pallets", L["sup"] + " (unidad kg)", "h10_peso_por_tramo_de_pallets_viaje.csv", "C10.1")
                          + card("camiones", "Camiones necesarios: modelo vs real", L["calc"] + " · " + L["sup"], "b10_estimacion_flota_actual_vs_corregido.csv", "B10.1 C10.1",
                                 nota="Supuesto: capacidad del camión = percentil observado de pallets por viaje. No es un dimensionamiento.")
                          + card("top", "Top 25 viajes por pallets", L["calc"], "base/viaje_cliente.csv", "B20", sin_grafico=True, ancho="ancho",
                                 nota="Agrupación por camión + viaje; el orden de las filas de venta no es la secuencia de visita, por eso no se dibujan rutas.")))
    if pagina == "calidad":
        return (seccion("Calidad de la información",
                        card("calidad", "Consolidado de auditorías", L["calc"], "h14_consolidado_calidad_informacion.csv", "C14.1 C14", sin_grafico=True, ancho="ancho")
                        + card("cascada", "Facturación → venta efectiva → venta neta", L["calc"], "h01_cascada_facturacion_demanda_flujo.csv", "C1.1")
                        + card("geo", "Cobertura de georreferenciación", L["calc"], "auditoria_h08_exclusiones_geo.csv", "C14.1 C8.1")
                        + card("huerf", "Productos huérfanos (sin maestra) por clasificación", L["real"], "h01_huerfanos_por_clasificacion.csv", "C1", sin_grafico=True)
                        + card("decisiones", "Decisiones documentadas", L["real"], "auditoria_decision_codigo_451555.csv; comparacion_cifras_clave_actual_vs_corregido.csv", "A4 C2.1", sin_grafico=True, ancho="ancho")
                        + card("codigos", "Clasificación de los 68 códigos de facturación", L["calc"], "h11_clasificacion_codigos_facturacion.csv", "C11.1", sin_grafico=True, ancho="ancho"))
                + seccion("Logística inversa",
                          card("env-mes", "Tasa de retorno documentada de envases por mes", L["calc"], "h11_balance_envases_por_mes.csv", "C11.1", "anio", ancho="ancho",
                               nota="CJ = cajas de botellas retornables; CU = casilleros, keg y botellas sueltas. No se suman entre sí.")
                          + card("env-tipo", "Retorno por tipo de envase (CJ)", L["calc"], "h11_balance_envases_por_tipo.csv", "C11.1")
                          + card("dev", "Devoluciones sobre la venta efectiva", L["calc"], "h11_tasa_devolucion_total_por_anio.csv", "C11.1 B7"))
                + seccion("Nivel de servicio",
                          card("causas", "% de pedidos afectados por causa (MOT ANU)", L["calc"] + " · " + L["sup"] + " (agrupación)", "h12_incidencias_por_causa.csv", "C12.1", ancho="ancho")
                          + card("srv", "Pedidos con incidencia de servicio por año", L["calc"], "h12_incidencias_resumen_por_anio.csv", "C12.1")))
    if pagina == "diseno":
        bloques = ["Flujo conceptual Lampa → CD → clientes → retorno", "Bosquejo CD", "Carga de pallets en camión", "Rutas propuestas"]
        html = "".join(f'<article class="card pendiente"><header class="card-head"><h3>{b}</h3><div class="badges"><span class="badge badge-propuesta">{L["prop"]}</span></div></header>'
                       f'<p class="pend">Pendiente – etapa de diseño</p></article>' for b in bloques)
        return seccion("Etapa de diseño (reservada)", html,
                       "Esta página no contiene propuestas: la Primera Entrega es de diagnóstico. "
                       "Supuesto para la etapa siguiente: pallet estándar 1,00 × 1,10 m, altura 1,60 m. Las dimensiones de camión no están en los datos.")
    raise ValueError(pagina)


def pagina_html(pagina, titulo, modo, datos_js, css, app_js, plotly_tag):
    nav = "".join(f'<a href="{"#" + p if modo == "uno" else p + ".html"}" data-nav="{p}">{t}</a>' for p, t in PAGINAS)
    filtros = """<div class="filtros" role="group" aria-label="Filtros globales">
  <label>Año <select id="f-anio"><option value="Todos">Todos</option><option>2023</option><option>2024</option><option>2025</option></select></label>
  <label>Categoría <select id="f-cat"><option value="Todas">Todas</option>""" + "".join(f"<option>{c}</option>" for c in CATEGORIAS) + "</select></label></div>"
    if modo == "uno":
        cuerpo = "".join(f'<main class="pagina" data-page="{p}" id="p-{p}" hidden><h1>{t}</h1>{contenido(p)}</main>' for p, t in PAGINAS)
        cabeza_css, cabeza_js = f"<style>{css}</style>", f"<script>{datos_js}</script>{plotly_tag}"
        pie_js = f"<script>{app_js}</script>"
    else:
        cuerpo = f'<main class="pagina" data-page="{pagina}" id="p-{pagina}"><h1>{titulo}</h1>{contenido(pagina)}</main>'
        cabeza_css = '<link rel="stylesheet" href="assets/app.css">'
        cabeza_js = f'<script src="data/datos.js"></script>{plotly_tag}'
        pie_js = '<script src="assets/app.js"></script>'
    leaflet = "" if pagina not in ("clientes", "todo") else (
        f'<link rel="stylesheet" href="{CDN["leaflet_css"]}"><script src="{CDN["leaflet_js"]}"></script>'
        f'<script src="{CDN["leaflet_heat"]}"></script>')
    return f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AndesBev · {titulo}</title>
<meta name="description" content="Dashboard de diagnóstico de la cadena de suministro AndesBev SpA, piloto Coquimbo-La Serena.">
{cabeza_css}{leaflet}{cabeza_js}</head>
<body data-modo="{modo}" data-page="{pagina}">
<header class="top"><div class="marca"><strong>AndesBev SpA</strong><span>Diagnóstico · Piloto Coquimbo–La Serena</span></div>
<button class="menu-btn" type="button" aria-expanded="false" aria-controls="nav">Menú</button>
<nav id="nav">{nav}</nav></header>
<div class="barra">{filtros}<p class="alcance" id="alcance"></p></div>
{cuerpo}
<footer class="pie">Generado el <span id="generado"></span> con build_dashboard.py · Datos: CSV del proyecto (Grupo 6, DataRoute Lab) · Etiquetas: Dato real / Resultado calculado / Supuesto / Propuesta de diseño</footer>
{pie_js}</body></html>"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--anonimizar", action="store_true", help="seudonimiza IDs de cliente y redondea coordenadas")
    args = ap.parse_args()

    datos, control = preparar_datos(args.anonimizar)
    # Controles contra cifras validadas del alcance corregido (C2.1, C10.1, C14.1)
    assert abs(control["pallets_total"] - 251994.0) < 1, control["pallets_total"]
    assert abs(control["cajas_dia_promedio"] - 22923.7) < 0.1, control["cajas_dia_promedio"]
    assert control["dias"] == 892 and control["clientes"] == 5219 and control["viajes"] == 42500
    assert round(control["p50_viaje"], 2) == 6.54
    assert round(control["pct_clientes_georref"], 1) == 68.1 and round(control["pct_demanda_georref"], 1) == 95.7
    print("Controles OK:", {k: round(v, 2) if isinstance(v, float) else v for k, v in control.items()})

    datos_js = "window.DASH = " + json.dumps(datos, ensure_ascii=False, separators=(",", ":")) + ";"
    css = (SRC / "app.css").read_text(encoding="utf-8")
    app_js = (SRC / "app.js").read_text(encoding="utf-8")

    # --- docs/ (GitHub Pages) ---
    # Se borran solo los archivos (no las carpetas): OneDrive o un servidor local pueden bloquear un directorio
    if DOCS.exists():
        for f in sorted(DOCS.rglob("*"), reverse=True):
            if f.is_file():
                f.unlink()
    (DOCS / "assets").mkdir(parents=True, exist_ok=True)
    (DOCS / "data").mkdir(exist_ok=True)
    (DOCS / "data" / "datos.js").write_text(datos_js, encoding="utf-8")
    (DOCS / "assets" / "app.css").write_text(css, encoding="utf-8")
    (DOCS / "assets" / "app.js").write_text(app_js, encoding="utf-8")
    (DOCS / ".nojekyll").write_text("", encoding="utf-8")
    tag_cdn = f'<script src="{CDN["plotly"]}"></script>'
    for p, t in PAGINAS:
        (DOCS / f"{p}.html").write_text(pagina_html(p, t, "sitio", datos_js, css, app_js, tag_cdn), encoding="utf-8")

    # --- dist/ (todo en uno) ---
    DIST.mkdir(exist_ok=True)
    plotly_inline = "<script>" + PLOTLY_LOCAL.read_text(encoding="utf-8").replace("</script>", "<\\/script>") + "</script>"
    uno = pagina_html("todo", "Dashboard de diagnóstico", "uno", datos_js, css, app_js, plotly_inline)
    (DIST / "AndesBev_dashboard_offline.html").write_text(uno, encoding="utf-8")

    tam = lambda p: f"{p.stat().st_size / 1e6:.1f} MB"  # noqa: E731
    print(f"docs/: {len(PAGINAS)} páginas, datos {tam(DOCS / 'data' / 'datos.js')}")
    print(f"dist/AndesBev_dashboard_offline.html: {tam(DIST / 'AndesBev_dashboard_offline.html')}")
    print("Anonimizado:", args.anonimizar)


if __name__ == "__main__":
    main()
