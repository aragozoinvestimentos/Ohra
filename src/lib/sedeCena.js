// Cena da Sede nova (27/10/2026, vista B em perspectiva — aprovada pela prévia
// https://claude.ai/artifact/EX2Ceo8SxZqJaJ6uU8b3cJ): o prédio, as salas, os móveis
// e o desenho das pessoas, tudo como "caminhos" SVG (Path2D no canvas). PURO: não
// mexe em tela nem em dado — o motor (sedeMotor.js) desenha e anima.
//
// Coordenadas: chão em unidades (x pra direita-baixo, y pra esquerda-baixo), z em px
// pra cima. P(x, y, z) → ponto na cena (1392 × 780). Cada item tem um GRUPO (a sala)
// e um z (soma do canto mais à frente): desenha-se grupo por grupo, de trás pra
// frente (as paredes da sala da frente escondem os móveis da sala de trás).
import { SALAS_SEDE } from "./sede.js";

export const CENA = { largura: 1392, altura: 780, S: 14, H: 40, OX: 486, OY: 66, LX: 63, LY: 33 };
const { S, H, OX, OY } = CENA;
const r1 = (v) => Math.round(v * 10) / 10;
export const P = (x, y, z = 0) => [r1(OX + (x - y) * S), r1(OY + ((x + y) * S) / 2 - z)];
/** Ponto da cena → chão (z = 0). */
export const noChao = (sx, sy) => {
  const a = (sx - OX) / S, b = ((sy - OY) * 2) / S;
  return [(a + b) / 2, (b - a) / 2];
};
export const ORDEM_GRUPOS = ["base", "diretoria", "gg", "reuniao", "live", "financeiro", "corredor", "comercial", "operacao", "recepcao"];
export const tom = (hex, f) => {
  if (!hex || !hex.startsWith("#")) return hex;
  const n = parseInt(hex.slice(1, 7), 16);
  return "#" + [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, "0")).join("");
};
const rnd = (i) => {
  const v = Math.sin(i * 12.9898 + 4.1) * 43758.5453;
  return v - Math.floor(v);
};
const LN = "rgba(0,0,0,.22)";
export const COR_TELA = { ok: "#8fc3e6", a: "#f2b84b", o: "#5fd08a", r: "#ef6a5a" };

// ---------- caminhos ----------
function novoItem(g, z) {
  return { g, z, paths: [], bx: [Infinity, Infinity, -Infinity, -Infinity] };
}
const cresce = (it, x, y) => {
  const b = it.bx;
  if (x < b[0]) b[0] = x;
  if (y < b[1]) b[1] = y;
  if (x > b[2]) b[2] = x;
  if (y > b[3]) b[3] = y;
};
export function caneta(it) {
  const path = (d, fill, stroke = "none", sw = 0, dash = "") => it.paths.push({ d, fill, stroke, sw: stroke === "none" ? 0 : sw || 1, dash });
  const poly = (l, fill, stroke = LN, dash = "") => {
    l.forEach((q) => cresce(it, q[0], q[1]));
    path("M " + l.map((q) => q.join(" ")).join(" L ") + (l.length > 2 ? " Z" : ""), fill, stroke, 1, dash);
  };
  const circ = (c, r, fill, stroke = "none", sw = 0) => {
    cresce(it, c[0] - r, c[1] - r);
    cresce(it, c[0] + r, c[1] + r);
    path(`M ${r1(c[0] - r)} ${c[1]} a ${r} ${r} 0 1 0 ${r1(2 * r)} 0 a ${r} ${r} 0 1 0 ${r1(-2 * r)} 0 Z`, fill, stroke, sw);
  };
  const rect = (x, y, w, h, fill, rx = 1, stroke = "none") => {
    const q = Math.min(rx, w / 2, h / 2);
    x = r1(x);
    y = r1(y);
    cresce(it, x, y);
    cresce(it, x + w, y + h);
    path(`M ${r1(x + q)} ${y} H ${r1(x + w - q)} Q ${r1(x + w)} ${y} ${r1(x + w)} ${r1(y + q)} V ${r1(y + h - q)} Q ${r1(x + w)} ${r1(y + h)} ${r1(x + w - q)} ${r1(y + h)} H ${r1(x + q)} Q ${x} ${r1(y + h)} ${x} ${r1(y + h - q)} V ${r1(y + q)} Q ${x} ${y} ${r1(x + q)} ${y} Z`, fill, stroke, 1);
  };
  const box = (x, y, w, d, h, e, cor, f = {}) => {
    const x1 = x + w, y1 = y + d;
    // pegada no chão (pra saber se o móvel fica na frente de quem passa)
    const pe = (it.pe ||= [Infinity, Infinity, -Infinity, -Infinity]);
    pe[0] = Math.min(pe[0], x); pe[1] = Math.min(pe[1], y); pe[2] = Math.max(pe[2], x1); pe[3] = Math.max(pe[3], y1);
    poly([P(x, y1, e), P(x1, y1, e), P(x1, y1, e + h), P(x, y1, e + h)], f.front || tom(cor, 0.84), f.stroke || LN);
    poly([P(x1, y, e), P(x1, y1, e), P(x1, y1, e + h), P(x1, y, e + h)], f.side || tom(cor, 0.68), f.stroke || LN);
    poly([P(x, y, e + h), P(x1, y, e + h), P(x1, y1, e + h), P(x, y1, e + h)], f.top || cor, f.stroke || LN);
  };
  const paredeY = (y, a, b, z0, z1, fill, stroke = LN) => poly([P(a, y, z0), P(b, y, z0), P(b, y, z1), P(a, y, z1)], fill, stroke);
  const paredeX = (x, a, b, z0, z1, fill, stroke = LN) => poly([P(x, a, z0), P(x, b, z0), P(x, b, z1), P(x, a, z1)], fill, stroke);
  const chao = (x, y, w, d, fill, stroke = "none", e = 0) => poly([P(x, y, e), P(x + w, y, e), P(x + w, y + d, e), P(x, y + d, e)], fill, stroke);
  return { path, poly, circ, rect, box, paredeY, paredeX, chao };
}

const LIVROS = ["#b4501f", "#2f5d8a", "#3f8f6a", "#c98a12", "#7b5fb3", "#8a3c16", "#e8e1d4", "#5e6b78"];
const FIL = ["#d2622b", "#2f5d8a", "#f2c14e", "#3f8f6a", "#ffffff", "#1f1d1b", "#c0392b", "#9b59b6", "#25a3b5"];
const A = 17;

/**
 * Monta a cena estática. opts: { fechadas: {k: motivo}, impressoras: 0–3, revenda: bool,
 * telas: {idPessoa: ok|a|o|r} (luz do monitor de cada mesa), epoca: "natal"|null, momento: "9h"|null }.
 * Devolve { itens, livre(x,y) → andável, passa(x0,y0,x1,y1), lugares, pontos, placas, decor }.
 */
export function montarCena({ fechadas = {}, impressoras = 1, revenda = false, telas = {}, epoca = null, momento = null } = {}) {
  const itens = [];
  let GRUPO = "base";
  const item = (z) => {
    const it = novoItem(GRUPO, z);
    itens.push(it);
    return { it, ...caneta(it) };
  };
  // ---------- grade de andar (células 1 × 1) ----------
  const LX = CENA.LX, LY = CENA.LY;
  const andavel = [...Array(LY)].map(() => Array(LX).fill(false));
  const salaDaCelula = [...Array(LY)].map(() => Array(LX).fill(null));
  for (const r of SALAS_SEDE) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { andavel[y][x] = true; salaDaCelula[y][x] = r.k; }
  for (let y = 12; y < 17; y++) for (let x = 1; x < 62; x++) { andavel[y][x] = true; salaDaCelula[y][x] = "corredor"; }
  // célula bloqueada só se o móvel ocupa um bom pedaço dela (cadeira encostada na mesa continua livre)
  const bloquear = (x, y, w, d) => {
    let n = 0;
    for (let j = Math.floor(y + 0.3); j < Math.ceil(y + d - 0.3); j++) for (let i = Math.floor(x + 0.3); i < Math.ceil(x + w - 0.3); i++) if (andavel[j]?.[i] !== undefined) { andavel[j][i] = false; n++; }
    // móvel pequeno (planta, lixeira): bloqueia a célula do centro
    if (!n) { const cy = Math.floor(y + d / 2), cx = Math.floor(x + w / 2); if (andavel[cy]?.[cx] !== undefined) andavel[cy][cx] = false; }
  };
  // passagens: entre o corredor (linha 16) e as salas de baixo (linha 17) só pela porta;
  // a Diretoria só pela porta da mureta; Live fechada não deixa entrar.
  const portas = new Set(["20,16", "34,16", "53,16", "52,16", "7,11", "8,11"]);
  const passa = (x0, y0, x1, y1) => {
    if (!andavel[y1]?.[x1]) return false;
    if (y0 === 16 && y1 === 17) return portas.has(`${x0},16`) && x0 === x1;
    if (y0 === 17 && y1 === 16) return portas.has(`${x1},16`) && x0 === x1;
    if ((y0 === 11 && y1 === 12) || (y0 === 12 && y1 === 11)) {
      const x = x0;
      if (x >= 1 && x < 14) return portas.has(`${x},11`);
      if (fechadas.live && x >= 37 && x < 47) return false;
      return true;
    }
    return true;
  };

  const planta = (x, y, t = 1, e = 0) => {
    const { box, circ } = item(x + y + 0.7 + (e ? 3 : 0));
    box(x, y, 0.55 * t, 0.55 * t, 8 * t, e, "#b8693f");
    const c = P(x + 0.27 * t, y + 0.27 * t, e + 8 * t);
    for (const [dx, dy, r, c2] of [[0, -6, 6.5, "#3f7d4a"], [-5, -11, 5.5, "#4f9a5a"], [5, -12, 5.5, "#468c52"], [0, -17, 5.5, "#5aa865"], [-2, -21, 4, "#66b672"]]) circ([c[0] + dx * t, c[1] + dy * t], r * t, c2);
    if (!e) bloquear(x, y, 0.55 * t, 0.55 * t);
  };
  const mesas = {};
  const mesa = (x, y, w, d, cor = "#8a6446", it = {}) => {
    const o = item(x + w + y + d);
    const L = 0.14;
    for (const [lx, ly] of [[x + 0.08, y + d - 0.08 - L], [x + w - 0.08 - L, y + d - 0.08 - L], [x + w - 0.08 - L, y + 0.08]]) o.box(lx, ly, L, L, A, 0, "#3b3430");
    if (it.gaveta) o.box(x + w - 1, y + 0.15, 0.85, d - 0.3, A, 0, tom(cor, 0.9));
    o.box(x, y, w, d, 3, A, cor);
    const t = item(x + w + y + d + 0.01), e = A + 3;
    if (it.papel) { t.chao(x + 0.25, y + 0.25, 0.7, 0.5, "#fbfaf6", LN, e); t.chao(x + 0.35, y + 0.3, 0.7, 0.5, "#ffffff", LN, e + 0.5); }
    const mons = it.monitor === false ? [] : it.monitores || [w / 2];
    for (let i = 0; i < mons.length; i++) {
      const mx = x + mons[i];
      const dono = (it.donos || [])[i] || it.dono;
      const st = dono ? telas[dono] || "ok" : null;
      t.chao(mx - 0.55, y + d * 0.3, 1.1, 0.32, "#e3e5ea", LN, e);
      t.box(mx - 0.1, y + d - 0.45, 0.2, 0.2, 4, e, "#3b3f47");
      t.box(mx - 0.8, y + d - 0.36, 1.6, 0.12, 11, e + 4, "#2b2f38", { top: "#4a4f59" });
      if (st) {
        t.paredeY(y + d - 0.24, mx - 0.72, mx + 0.72, e + 13.2, e + 14.6, COR_TELA[st], "none");
        t.poly([P(mx - 0.9, y + d - 0.36, e + 15), P(mx + 0.9, y + d - 0.36, e + 15), P(mx + 0.7, y + d - 0.36, e + 19), P(mx - 0.7, y + d - 0.36, e + 19)], COR_TELA[st] + "55", "none");
      }
      if (it.duplo && i === 0) t.box(mx + 0.85, y + d - 0.36, 1.2, 0.12, 10, e + 4, "#2b2f38", { top: "#4a4f59" });
    }
    if (it.caneca) { const c = P(x + 0.45, y + d - 0.4, e); t.rect(c[0] - 2.5, c[1] - 6, 5, 6, it.caneca, 1, "rgba(0,0,0,.3)"); }
    if (it.luminaria) { const b = P(x + w - 0.35, y + 0.35, e); t.rect(b[0] - 1, b[1] - 16, 2, 16, "#3b3f47"); t.circ([b[0] - 3, b[1] - 17], 4, "#f2c14e", "rgba(0,0,0,.3)", 1); }
    if (it.vaso) planta(x + w - 0.55, y + 0.15, 0.5, e);
    bloquear(x, y, w, d);
    const m = { x, y, w, d };
    if (it.dono) mesas[it.dono] = m;
    (it.donos || []).forEach((id) => { mesas[id] = m; });
    return m;
  };
  const cadeira = (x, y, cor = "#2f3238", virada = false, couro = false) => {
    const o = item(x + y + 0.8 + (virada ? 0.3 : 0));
    const b = P(x + 0.4, y + 0.4);
    for (const [dx, dy] of [[-5, 1], [5, 1], [0, 3]]) o.circ([b[0] + dx, b[1] + dy], 1.6, "#1d1f24");
    o.box(x + 0.34, y + 0.34, 0.12, 0.12, 8, 0, "#6b6f78");
    const alto = couro ? 18 : 13;
    if (virada) { o.box(x, y, 0.8, 0.8, 3, 8, cor); o.box(x, y + 0.66, 0.8, 0.14, alto, 11, cor); }
    else { o.box(x, y - 0.02, 0.8, 0.14, alto, 11, cor); o.box(x, y, 0.8, 0.8, 3, 8, cor); }
  };
  const estante = (x, y, w, h, cor = "#7a5a3c", tipo = "livros") => {
    const o = item(x + w + y + 0.6);
    o.box(x, y, w, 0.6, h, 0, cor);
    const yf = y + 0.6, niv = Math.floor((h - 4) / 12);
    for (let i = 0; i < niv; i++) {
      const z0 = 3 + i * 12;
      o.paredeY(yf, x + 0.1, x + w - 0.1, z0, z0 + 10, tom(cor, 0.5), "none");
      if (tipo === "livros" || tipo === "pastas") {
        let bx = x + 0.15, k = 0;
        while (bx < x + w - 0.35) {
          const bw = tipo === "pastas" ? 0.3 : 0.14 + rnd(i * 31 + k + x) * 0.14;
          const bh = tipo === "pastas" ? 9 : 6 + rnd(i * 7 + k + x) * 3.5;
          o.paredeY(yf, bx, bx + bw, z0, z0 + bh, tipo === "pastas" ? ["#2f5d8a", "#3f8f6a", "#e8e1d4", "#c98a12"][k % 4] : LIVROS[(i * 3 + k) % LIVROS.length], "rgba(0,0,0,.25)");
          bx += bw + 0.03;
          k++;
          if (tipo === "livros" && rnd(i * 13 + k) > 0.8) bx += 0.4;
        }
      } else if (tipo === "carretel") {
        for (let j = 0; j < Math.floor((w - 0.2) / 0.72); j++) { const c = P(x + 0.48 + j * 0.72, yf, z0 + 5); o.circ(c, 4.4, FIL[(i * 4 + j) % FIL.length], "rgba(0,0,0,.4)", 1); o.circ(c, 1.5, "#2b2f38"); }
      } else if (tipo === "produtos") {
        for (let j = 0; j < Math.floor((w - 0.2) / 0.55); j++) { const a = x + 0.2 + j * 0.55; o.paredeY(yf, a, a + 0.38, z0, z0 + 5 + rnd(j + i * 5) * 3, FIL[(j + i * 2) % FIL.length], "rgba(0,0,0,.3)"); }
      }
    }
    bloquear(x, y, w, 0.6);
  };
  const caixa = (o, x, y, w, d, h, e) => {
    o.box(x, y, w, d, h, e, "#c8955c");
    o.poly([P(x + w / 2 - 0.05, y, e + h), P(x + w / 2 + 0.05, y, e + h), P(x + w / 2 + 0.05, y + d, e + h), P(x + w / 2 - 0.05, y + d, e + h)], "#e9d7b5", "none");
  };
  const prateleiraAberta = (x, y, w, d, niv) => {
    const o = item(x + w + y + d);
    for (const [px, py] of [[x, y + d - 0.12], [x + w - 0.12, y + d - 0.12], [x + w - 0.12, y], [x, y]]) o.box(px, py, 0.12, 0.12, niv * 13 + 2, 0, "#7f858e");
    for (let i = 0; i < niv; i++) {
      o.box(x, y, w, d, 1.2, 1 + i * 13, "#a7adb5");
      let bx = x + 0.15, k = 0;
      while (bx < x + w - 0.7) { const bw = 0.55 + rnd(k + i * 9) * 0.35; caixa(o, bx, y + 0.15, bw, d - 0.3, 6 + rnd(k * 3 + i) * 4, 2.2 + i * 13); bx += bw + 0.12; k++; }
    }
    bloquear(x, y, w, d);
  };
  const impressora = (x, y, fil, peca, ligada = true) => {
    mesa(x, y, 2.5, 1.6, "#9aa0a8", { monitor: false });
    if (!ligada) return;
    const e = A + 3, o = item(x + 2.5 + y + 1.6 + 0.05);
    o.box(x + 0.3, y + 0.25, 1.9, 1.2, 3, e, "#2b2f38");
    o.box(x + 0.25, y + 0.62, 0.14, 0.14, 30, e + 3, "#c9ccd2");
    o.box(x + 0.45, y + 0.35, 1.6, 1.0, 1.2, e + 5, "#3d424b", { top: "#1d2026" });
    o.box(x + 1.0, y + 0.55, 0.45, 0.45, 5, e + 6.2, peca);
    o.box(x + 2.1, y + 0.62, 0.14, 0.14, 30, e + 3, "#c9ccd2");
    o.box(x + 0.25, y + 0.6, 2.0, 0.18, 2.5, e + 32, "#c9ccd2");
    o.box(x + 1.05, y + 0.55, 0.4, 0.3, 4, e + 17, "#d2622b");
    const c = P(x + 2.35, y + 1.0, e + 24);
    o.circ(c, 6.5, fil, "rgba(0,0,0,.4)", 1);
    o.circ(c, 2.2, "#2b2f38");
    o.circ(P(x + 0.5, y + 1.45, e + 1.5), 1.4, "#3fd17a");
  };
  const sofaX = (x, y, len, cor) => {
    const o = item(x + 1.2 + y + len);
    o.box(x, y, 0.35, len, 15, 0, tom(cor, 0.9));
    o.box(x, y, 1.2, 0.3, 11, 0, tom(cor, 0.85));
    o.box(x + 0.3, y + 0.3, 0.9, len - 0.6, 7, 0, cor);
    o.box(x, y + len - 0.3, 1.2, 0.3, 11, 0, tom(cor, 0.85));
    o.circ(P(x + 0.6, y + 0.9, 9), 4, "#f2c14e");
    o.circ(P(x + 0.6, y + len - 0.9, 9), 4, "#e8e1d4");
    bloquear(x, y, 1.2, len);
  };
  const ocupado = Object.fromEntries(SALAS_SEDE.map((r) => [r.k, { y: [], x: [] }]));
  const salaNaParede = (x, y) => SALAS_SEDE.find((r) => x >= r.x && x <= r.x + r.w && Math.abs(y - r.y) < 0.4);
  const marcaY = (y, a, b) => { const r = salaNaParede((a + b) / 2, y); if (r) ocupado[r.k].y.push([a, b]); };
  const marcaX = (x, a, b) => { const r = SALAS_SEDE.find((q) => Math.abs(q.x - x) < 0.01 && (a + b) / 2 > q.y && (a + b) / 2 < q.y + q.h); if (r) ocupado[r.k].x.push([a, b]); };
  const janelaY = (o, y, a, b) => {
    marcaY(y, a - 0.15, b + 0.15);
    o.paredeY(y, a, b, 12, 34, "#fbf7f0");
    o.paredeY(y, a + 0.15, b - 0.15, 14, 32, "#a9cde3", "none");
    o.paredeY(y, (a + b) / 2 - 0.05, (a + b) / 2 + 0.05, 14, 32, "#fbf7f0", "none");
    o.paredeY(y, a + 0.35, a + 0.6, 18, 29, "rgba(255,255,255,.55)", "none");
    o.paredeY(y, a - 0.15, b + 0.15, 11, 12.5, "#e2d9cb");
  };
  const portaY = (o, y, a) => {
    marcaY(y, a - 0.1, a + 1.6);
    o.paredeY(y, a, a + 1.5, 0, 29, "#8a6446");
    o.paredeY(y, a + 0.12, a + 1.38, 0, 27.5, "#a77b55", "none");
    o.circ(P(a + 1.15, y, 13), 1.4, "#e3c79c");
  };
  const quadroBranco = (o, eixo, pos, a, b, linhas = 4) => {
    const fn = eixo === "y" ? o.paredeY : o.paredeX;
    if (eixo === "y") marcaY(pos, a, b); else marcaX(pos, a, b);
    fn(pos, a, b, 12, 32, "#fdfdfb");
    fn(pos, a, b, 11, 12.5, "#a7adb5");
    for (let i = 0; i < linhas; i++) fn(pos, a + 0.4, a + 0.4 + (b - a - 0.8) * (0.5 + rnd(i + a) * 0.5), 27 - i * 4, 28 - i * 4, ["#2f5d8a", "#d2622b", "#3f8f6a", "#7b5fb3"][i % 4], "none");
  };

  // ---------- prédio e paredes ----------
  const base = item(-2000);
  base.poly([P(0, 0), P(63, 0), P(63, 33), P(0, 33)], "#3a3f4b", "none");
  base.poly([P(0, 33), P(63, 33), P(63, 33, -10), P(0, 33, -10)], "#232731", "none");
  base.poly([P(63, 0), P(63, 33), P(63, 33, -10), P(63, 0, -10)], "#2b303b", "none");
  base.chao(1, 12, 61, 5, "#d8cfc1");
  for (let x = 2; x < 62; x += 2) base.poly([P(x, 12), P(x, 17)], "none", "rgba(0,0,0,.06)");
  base.chao(6, 13.9, 42, 1.2, "#9e4f3b");
  base.chao(6.2, 14.05, 41.6, 0.9, "none", "rgba(255,255,255,.35)");
  const PISO = { diretoria: ["#c69a72", "madeira"], gg: ["#c9d0d8", "carpete"], reuniao: ["#ddd5c9"], live: ["#ecd3dc"], financeiro: ["#d6ddd2"], comercial: ["#e2d9ca"], operacao: ["#c9c6bf", "cimento"], recepcao: ["#e8dfcf"] };
  const paredes = {};
  for (const r of SALAS_SEDE) {
    const x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
    const [piso, tipo] = PISO[r.k] || ["#ddd5c9"];
    base.chao(x0, y0, r.w, r.h, piso, "rgba(0,0,0,.25)");
    if (tipo === "madeira") for (let y = y0 + 0.7; y < y1; y += 0.7) base.poly([P(x0, y), P(x1, y)], "none", "rgba(70,40,20,.13)");
    else if (tipo === "cimento") for (let i = 0; i < 40; i++) base.circ(P(x0 + rnd(i) * r.w, y0 + rnd(i + 50) * r.h), 1 + rnd(i + 9) * 1.5, "rgba(0,0,0,.05)");
    else if (tipo === "carpete") for (let i = 0; i < 70; i++) base.circ(P(x0 + rnd(i * 3) * r.w, y0 + rnd(i + 70) * r.h), 0.8, "rgba(255,255,255,.18)");
    else for (let x = x0 + 1.5; x < x1; x += 1.5) base.poly([P(x, y0), P(x, y1)], "none", "rgba(0,0,0,.05)");
    GRUPO = r.k;
    const o = item(-500);
    paredes[r.k] = o;
    o.paredeY(y0, x0, x1, 0, H, "#efe8dc", "rgba(0,0,0,.2)");
    o.paredeX(x0, y0, y1, 0, H, "#ddd4c6", "rgba(0,0,0,.2)");
    o.paredeY(y0, x0, x1, 0, 4, "#cfc4b4", "none");
    o.paredeX(x0, y0, y1, 0, 4, "#c4b9a8", "none");
    o.poly([P(x0, y0, H), P(x1, y0, H), P(x1, y0 + 0.25, H), P(x0 + 0.25, y0 + 0.25, H), P(x0 + 0.25, y1, H), P(x0, y1, H)], "#b9ae9f", "rgba(0,0,0,.25)");
    if (r.porta) portaY(o, y0, r.porta);
  }
  const ctx = (k) => {
    GRUPO = k;
    return paredes[k];
  };
  const pontos = {};
  const decor = {};

  // ---------- Diretoria (só os dois CEOs) ----------
  {
    const o = ctx("diretoria");
    janelaY(o, 1, 1.75, 3.35);
    marcaY(1, 9.0, 10.9);
    o.paredeY(1, 9.0, 10.9, 13, 34, "#b08d3a");
    o.paredeY(1, 9.15, 10.75, 14.5, 32.5, "#2b2620", "none");
    for (let i = 0; i < 5; i++) o.paredeY(1, 9.35 + i * 0.28, 9.52 + i * 0.28, 16, 18 + [4, 6, 5, 8, 12][i], i === 4 ? "#f2c14e" : "#7fa88a", "none");
    marcaX(1, 2.2, 5.0);
    o.paredeX(1, 2.2, 5.0, 14, 32, "#b08d3a");
    o.paredeX(1, 2.4, 4.8, 15.5, 30.5, "#fbf3e3", "none");
    decor.destaque = { pt: P(1, 3.6, 22), eixo: "x" };
    marcaX(1, 6.4, 10.6);
    decor.logo = { pt: P(1, 8.5, 24), eixo: "x" };
    o.chao(2.4, 3.6, 9.4, 6.0, "#7d3f31");
    o.chao(2.7, 3.8, 8.8, 5.6, "none", "rgba(255,230,200,.45)");
  }
  estante(11.2, 1.05, 2.6, 34, "#5a3d2a", "livros");
  mesa(3.4, 5.2, 7.4, 1.8, "#5a3d2a", { papel: true, caneca: "#ffffff", luminaria: true, monitores: [1.9, 5.5], donos: ["ceo1", "ceo2"] });
  cadeira(4.9, 4.0, "#3a2a22", false, true);
  cadeira(8.5, 4.0, "#3a2a22", false, true);
  {
    const o = item(2.2 + 2.2 + 8.2 + 1.5);
    o.chao(2.2, 8.2, 2.2, 1.5, "#b9a28a", "rgba(0,0,0,.25)");
    o.chao(2.45, 8.4, 1.7, 1.1, "#d9c6ae");
    o.box(2.2, 8.2, 2.2, 0.25, 4, 0, "#a58a6c");
    pontos.caminhaPug = [3.3, 9.0];
  }
  planta(13.1, 10.8, 1.1);
  {
    // mureta baixa na frente com a porta (a Diretoria é a única com porta à vista)
    const o = item(999);
    const pd = 6.6;
    o.box(1, 11.9, pd - 1, 0.18, 9, 0, "#d9d0c2", { top: "#b9ae9f" });
    o.box(pd + 1.7, 11.9, 14 - pd - 1.7, 0.18, 9, 0, "#d9d0c2", { top: "#b9ae9f" });
    o.box(pd, 11.9, 0.18, 0.18, 32, 0, "#8a6446");
    o.box(pd + 1.52, 11.9, 0.18, 0.18, 32, 0, "#8a6446");
    o.box(pd, 11.9, 1.7, 0.18, 3, 32, "#8a6446");
    o.poly([P(pd + 0.18, 11.9, 0), P(pd + 0.18, 10.6, 0), P(pd + 0.18, 10.6, 30), P(pd + 0.18, 11.9, 30)], "#a77b55", "rgba(0,0,0,.3)");
    o.circ(P(pd + 0.18, 10.85, 14), 1.3, "#e3c79c");
  }

  // ---------- Gerente Geral ----------
  { const o = ctx("gg"); quadroBranco(o, "y", 1, 15.8, 19.4, 5); janelaY(o, 1, 20.3, 22.2); }
  mesa(16.4, 5.2, 4.2, 1.7, "#4a3426", { gaveta: true, duplo: true, caneca: "#2f5d8a", dono: "consultor" });
  { const o = item(20.6 + 5.2 + 3.2); o.box(20.6, 3.6, 1.2, 3.3, 20, 0, "#4a3426"); bloquear(20.6, 3.6, 1.2, 3.3); }
  cadeira(17.9, 4.0, "#2f5d8a", false, true);
  planta(22.3, 10.8, 1.1);
  planta(15.4, 10.8, 1.0);

  // ---------- Reunião ----------
  {
    const o = ctx("reuniao");
    marcaY(1, 26.8, 32.6);
    o.paredeY(1, 26.8, 32.6, 13, 34, "#1d2026");
    o.paredeY(1, 27.1, 32.3, 14.5, 32.5, momento === "9h" ? "#2c4a63" : "#202833", "none");
    if (momento === "9h") for (let i = 0; i < 6; i++) o.paredeY(1, 29.6 + i * 0.4, 29.85 + i * 0.4, 16, 18 + [4, 6, 5, 8, 9, 11][i], ["#3f8f6a", "#3f8f6a", "#c98a12", "#3f8f6a", "#3f8f6a", "#d2622b"][i], "none");
    decor.tv = { pt: P(29.7, 1, 26.5), eixo: "y" };
    janelaY(o, 1, 33.4, 35.2);
    quadroBranco(o, "x", 24, 3, 7, 4);
  }
  const cadReu = [26.8, 28.7, 30.6, 32.5];
  for (const x of cadReu) cadeira(x, 3.5, "#5e6b78");
  mesa(26.2, 4.6, 7.4, 3.0, "#8a6a4a", { monitor: false });
  for (const x of cadReu) cadeira(x, 7.9, "#5e6b78", true);
  pontos.reuniao = cadReu.map((x) => [x + 0.4, 3.95]);
  pontos.tv = [25.7, 3.0];
  planta(24.5, 10.9);
  planta(35.2, 10.9);

  // ---------- Live ----------
  {
    const o = ctx("live");
    marcaY(1, 38, 46);
    o.paredeY(1, 38, 46, 4, 36, "#f2c6d4");
    o.paredeY(1, 38.3, 45.7, 6, 34, "#f7dbe4", "none");
  }
  estante(38.4, 1.05, 2.4, 30, "#f7f3ec", "produtos");
  estante(43.2, 1.05, 2.4, 30, "#f7f3ec", "produtos");
  mesa(39.6, 4.3, 4.4, 1.3, "#ffffff", { monitor: false });
  { const o = item(39.6 + 4.4 + 4.3 + 1.31); for (let j = 0; j < 4; j++) o.box(40 + j * 1, 4.6, 0.5, 0.5, 4 + j, A + 3, FIL[j]); }
  {
    const o = item(41.6 + 7.4);
    o.box(41.55, 7.0, 0.12, 0.12, 30, 0, "#3b3f47");
    const c = P(41.6, 7.05, 34);
    o.circ(c, 9, "none", "#fff6d6", 3);
    o.circ(c, 9, "none", "rgba(0,0,0,.25)", 0.6);
    o.box(41.45, 7.0, 0.3, 0.06, 6, 30, "#1d1f24");
    decor.aoVivo = { pt: P(42, 1, 37), eixo: "y" };
  }
  pontos.live = [41.8, 8.2];
  planta(46, 10.8);

  // ---------- Financeiro ----------
  { const o = ctx("financeiro"); janelaY(o, 1, 51.2, 53.2); janelaY(o, 1, 53.8, 55.8); }
  estante(60.6, 1.05, 1.3, 30, "#7f858e", "pastas");
  mesa(55.4, 3.6, 4.4, 1.8, "#4a3426", { papel: true, caneca: "#ffffff", duplo: true, dono: "bia" });
  cadeira(56.9, 2.5, "#3f8f6a", false, true);
  { const o = item(60.6 + 6.4 + 1.6); o.box(60.6, 6.4, 1.1, 1.3, 20, 0, "#6b7078"); o.circ(P(61.15, 7.7, 10), 3, "#c9ccd2", "rgba(0,0,0,.4)", 1); bloquear(60.6, 6.4, 1.1, 1.3); }
  mesa(49.4, 8.4, 2.7, 1.4, "#8f7253", { caneca: "#e0874f", dono: "lia" });
  cadeira(50.3, 7.3, "#e0874f");
  mesa(52.6, 8.4, 2.7, 1.4, "#8f7253", { papel: true, dono: "kai" });
  cadeira(53.5, 7.3, "#25a3b5");
  decor.vagas = [];
  for (const x of [55.8, 59]) { const o = item(x + 9.8); o.chao(x, 8.4, 2.7, 1.4, "rgba(255,255,255,.3)", "#8a7d70", "4 3"); decor.vagas.push(P(x + 1.35, 9.1)); }
  planta(48.4, 1.6);
  planta(61.3, 10.9);

  // ---------- Comercial ----------
  { const o = ctx("comercial"); janelaY(o, 17, 2.5, 4.8); janelaY(o, 17, 5.6, 7.9); janelaY(o, 17, 8.7, 11); quadroBranco(o, "x", 1, 21.5, 27, 4); }
  estante(12.2, 17.05, 2.8, 34, "#7a5a3c", "livros");
  mesa(15.6, 19.6, 4.4, 1.8, "#4a3426", { papel: true, caneca: "#7c7a80", duplo: true, dono: "celia" });
  cadeira(17.1, 18.5, "#7c7a80", false, true);
  mesa(2.6, 22.6, 2.7, 1.4, "#9a6a43", { caneca: "#e0874f", dono: "rafa" });
  cadeira(3.5, 21.5, "#e0874f");
  mesa(5.8, 22.6, 2.7, 1.4, "#9a6a43", { vaso: true, dono: "nina" });
  cadeira(6.7, 21.5, "#7b5fb3");
  mesa(9, 22.6, 2.7, 1.4, "#9a6a43", { papel: true, dono: "leo" });
  cadeira(9.9, 21.5, "#3b7bb8");
  for (const x of [2.6, 5.8, 9]) { const o = item(x + 30); o.chao(x, 27.4, 2.7, 1.4, "rgba(255,255,255,.3)", "#8a7d70", "4 3"); decor.vagas.push(P(x + 1.35, 28.1)); }
  planta(1.4, 30.8, 1.2);
  planta(21.6, 30.8, 1.1);
  planta(16.2, 30.9, 1.0);

  // ---------- Operação (produção, expedição, estoque, revenda) ----------
  {
    const o = ctx("operacao");
    janelaY(o, 17, 40.9, 42.7);
    janelaY(o, 17, 44.6, 47.6);
    marcaX(24, 20, 22.5);
    o.paredeX(24, 20, 22.5, 14, 30, "#f5c542");
    o.paredeX(24, 20.2, 22.3, 15.5, 28.5, "#fff8dc", "none");
  }
  const cores3 = [["#d2622b", "#d2622b"], ["#2f5d8a", "#2f5d8a"], ["#f2c14e", "#3f8f6a"]];
  [25.2, 28.2, 31.2].forEach((x, i) => impressora(x, 18.2, cores3[i][0], cores3[i][1], i < impressoras));
  pontos.impressoras = [25.2, 28.2, 31.2].slice(0, Math.max(1, impressoras)).map((x) => [x + 1.3, 20.4]);
  estante(36.2, 17.05, 4, 40, "#8a8f98", "carretel");
  mesa(43.4, 19.8, 4.3, 1.8, "#4a3426", { papel: true, caneca: "#5e6b78", luminaria: true, dono: "teo" });
  cadeira(44.9, 18.7, "#5e6b78", false, true);
  mesa(31.4, 26.4, 6.6, 1.5, "#c9a37a", { monitor: false });
  {
    const o = item(31.4 + 6.6 + 26.4 + 1.52);
    caixa(o, 31.8, 26.6, 1.0, 0.9, 6, A + 3);
    caixa(o, 33.1, 26.6, 0.8, 0.8, 5, A + 3);
    o.chao(34.3, 26.6, 1.1, 0.8, "#e8e1d4", LN, A + 3);
    const t = P(36.1, 27.0, A + 3);
    o.circ([t[0], t[1] - 3], 3.4, "#c9a37a", "rgba(0,0,0,.4)", 1);
    o.circ([t[0], t[1] - 3], 1.4, "#e8e1d4");
    o.box(36.8, 26.6, 0.9, 0.8, 1.5, A + 3, "#3b3f47");
  }
  pontos.expedicao = [34.4, 25.9];
  prateleiraAberta(25.1, 28.8, 5.6, 1.3, 3);
  pontos.estoque = [27.8, 28.2];
  { const o = item(38.4 + 30.2 + 1.6); o.box(38.4, 29.6, 1.6, 1.4, 1.5, 0, "#a77b55"); caixa(o, 38.5, 29.7, 0.7, 0.6, 7, 1.5); caixa(o, 39.25, 29.7, 0.7, 0.6, 6, 1.5); caixa(o, 38.6, 29.75, 0.65, 0.55, 6, 8.5); bloquear(38.4, 29.6, 1.6, 1.4); }
  estante(41, 28.3, 2.6, 24, "#b08a5a", "produtos");
  mesa(44.2, 26.4, 2.7, 1.4, "#b08a5a", { dono: revenda ? "rui" : null });
  cadeira(45.1, 25.3, "#9aa39b");
  planta(48.9, 31, 1.1);
  planta(24.6, 26.5, 1);

  // ---------- Recepção: copa, balcão do Zé, sofá, pallet da coleta ----------
  { ctx("recepcao"); marcaY(17, 55.9, 62); }
  {
    const o = item(56.2 + 3.4 + 17.1 + 1.1);
    o.box(56.2, 17.1, 3.4, 1.1, 18, 0, "#d8d2c8", { top: "#f2efe9" });
    o.box(56.5, 17.2, 0.8, 0.65, 14, 18, "#2b2f38");
    o.circ(P(56.9, 17.85, 26), 1.4, "#e04848");
    for (const x of [57.7, 58.2]) { const c = P(x, 17.5, 18); o.rect(c[0] - 2, c[1] - 5, 4, 5, "#fff", 1, "rgba(0,0,0,.3)"); }
    o.box(58.7, 17.25, 0.6, 0.5, 6, 18, "#c98a12");
    bloquear(56.2, 17.1, 3.4, 1.1);
  }
  {
    const o = item(59.8 + 1.4 + 17.05 + 1.2);
    o.box(59.8, 17.05, 1.4, 1.2, 46, 0, "#e9ecef");
    o.paredeY(18.25, 59.9, 61.1, 4, 43, "#bfe1ef", "rgba(0,0,0,.3)");
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) o.paredeY(18.25, 60 + j * 0.28, 60.15 + j * 0.28, 6 + i * 9.5, 12 + i * 9.5, ["#c0392b", "#3f8f6a", "#f2c14e", "#2f5d8a"][(i + j) % 4], "none");
    o.box(59.8, 17.05, 1.4, 1.2, 4, 46, "#d2622b");
    bloquear(59.8, 17.05, 2.1, 1.2);
  }
  { const o = item(61.3 + 0.6 + 17.2 + 0.6); o.box(61.3, 17.2, 0.6, 0.6, 20, 0, "#f2efe9"); o.circ(P(61.6, 17.5, 27), 5, "#7fc4e6", "rgba(0,0,0,.25)", 1); }
  { const o = item(60.3 + 0.9 + 20.6 + 0.9); o.box(60.65, 20.95, 0.15, 0.15, 20, 0, "#3b3f47"); o.circ(P(60.75, 21.05, 21), 7, "#f2efe9", "rgba(0,0,0,.3)", 1); bloquear(60.4, 20.7, 0.7, 0.7); }
  pontos.copa = [[57.4, 19.6], [58.9, 19.9], [59.6, 21.6], [56.4, 20.4]];
  mesa(52.4, 22.4, 4.2, 1.3, "#9a6a43", { vaso: true, monitores: [1.6], dono: "ze" });
  cadeira(53.6, 21.3, "#d2622b");
  sofaX(51.05, 25.4, 3.8, "#c98a12");
  { const o = item(52.9 + 0.9 + 26.4 + 1.6); o.box(52.9, 26.4, 0.9, 1.6, 6, 0, "#9a6a43"); bloquear(52.9, 26.4, 0.9, 1.6); }
  // pallet da coleta: as caixas são desenhadas pelo motor (empilham conforme os pedidos)
  { const o = item(57.6 + 1.8 + 27.4 + 1.5 - 0.01); o.box(57.6, 27.4, 1.8, 1.5, 1.6, 0, "#a77b55"); bloquear(57.6, 27.4, 1.8, 1.5); }
  decor.pallet = { x: 57.6, y: 27.4 };
  pontos.pallet = [58.5, 26.8];
  { const o = item(61.6 + 26.6); o.box(61.45, 25.9, 0.12, 0.12, 14, 0, "#3b3f47"); o.box(61.1, 25.7, 0.8, 0.6, 7, 14, "#d2622b"); bloquear(61.1, 25.7, 0.8, 0.6); }
  pontos.correio = [60.6, 27.2];
  pontos.entrada = [57, 31.5];
  if (epoca === "natal") {
    const o = item(61.1 + 23.6);
    const b = P(61.1, 23.6);
    o.box(60.85, 23.35, 0.5, 0.5, 5, 0, "#8a3c16");
    for (const [w, z, c] of [[16, 5, "#2f6b3c"], [12, 15, "#3a8048"], [8, 24, "#468c52"]]) o.path(`M ${b[0] - w} ${b[1] - z} L ${b[0]} ${b[1] - z - 16} L ${b[0] + w} ${b[1] - z} Z`, c, "rgba(0,0,0,.2)", 0.6);
    o.circ([b[0], b[1] - 41], 2.6, "#f2c14e");
    for (const [dx, dy, c] of [[-8, -9, "#c0392b"], [6, -12, "#f2c14e"], [-3, -19, "#2f5d8a"], [4, -27, "#c0392b"], [-6, -16, "#fff"]]) o.circ([b[0] + dx, b[1] + dy], 1.6, c);
    cresce(o.it, b[0] - 17, b[1] - 45);
    bloquear(60.85, 23.35, 0.5, 0.5);
  }
  planta(51.5, 31, 1.1);
  planta(61.3, 30.8, 1.1);

  // ---------- placas: no maior trecho livre da parede, sem passar da sala ----------
  const placas = [];
  const livre = (lista, ini, fim) => {
    const occ = [...lista].sort((a, b) => a[0] - b[0]);
    const out = [];
    let c = ini;
    for (const [a, b] of occ) { if (a > c) out.push([c, Math.min(a, fim)]); c = Math.max(c, b); }
    if (c < fim) out.push([c, fim]);
    return out.filter((q) => q[1] > q[0]).sort((a, b) => b[1] - b[0] - (a[1] - a[0]));
  };
  const larg = (t) => (t.length * 5 + 10) / (S * 1.118);
  for (const r of SALAS_SEDE) {
    let feito = null;
    for (const nome of [r.nome, r.curto].filter(Boolean)) {
      const fy = livre(ocupado[r.k].y, r.x + 0.3, r.x + r.w - 0.3)[0];
      if (fy && fy[1] - fy[0] >= larg(nome) + 0.3) { feito = { k: r.k, curto: nome !== r.nome, pt: P((fy[0] + fy[1]) / 2, r.y, 35), eixo: "y" }; break; }
      const fx = livre(ocupado[r.k].x, r.y + 0.3, r.y + r.h - 0.3)[0];
      if (fx && fx[1] - fx[0] >= larg(nome) + 0.3) { feito = { k: r.k, curto: nome !== r.nome, pt: P(r.x, (fx[0] + fx[1]) / 2, 35), eixo: "x" }; break; }
    }
    placas.push(feito || { k: r.k, curto: !!r.curto, pt: P(r.x + r.w / 2, r.y, 37), eixo: "y" });
  }

  // lugares (onde cada um senta/fica) — sentado = atrás da mesa, de frente pra quem olha
  const sent = (m, dx) => (m ? { x: m.x + dx, y: m.y - 0.75, s: true } : null);
  const M = mesas;
  const lugares = {
    ceo1: sent(M.ceo1, 1.9),
    ceo2: sent(M.ceo2, 5.5),
    consultor: sent(M.consultor, 2.1),
    bia: sent(M.bia, 2.2),
    lia: sent(M.lia, 1.35),
    kai: sent(M.kai, 1.35),
    celia: sent(M.celia, 2.2),
    rafa: sent(M.rafa, 1.35),
    nina: sent(M.nina, 1.35),
    leo: sent(M.leo, 1.35),
    teo: sent(M.teo, 2.15),
    ivo: { x: 29.6, y: 21.2, s: false },
    duda: { x: 34.4, y: 25.9, s: false },
    rui: { x: 45.55, y: 25.75, s: true },
    ze: sent(M.ze, 1.6),
  };
  const mesaDe = Object.fromEntries(Object.keys(lugares).map((id) => [id, M[id] || null]));
  const livreXY = (x, y) => !!andavel[Math.floor(y)]?.[Math.floor(x)];
  const salaEm = (x, y) => salaDaCelula[Math.floor(y)]?.[Math.floor(x)] || null;
  return { itens, andavel, passa, livre: livreXY, salaEm, lugares, mesaDe, pontos, placas, decor };
}

/**
 * Pessoa desenhada a partir do ponto dos pés (0, 0). look = { pele, cabelo, estilo, barba,
 * roupa, cor, camisa, calca, gravata, oculos, fone, lapis, brincos, colar, protecao, luvas,
 * bone, bolsa }. pose = { sentado, passo (0|1|2), costas, est ok|a|o|r, carrega (cor|papel),
 * xicara, apagado, letra (só funcionários) }. Devolve { paths, topo } (topo = y da cabeça).
 */
export function desenharPessoa(look, pose = {}) {
  const it = novoItem("p", 0);
  const { path, poly, circ, rect } = caneta(it);
  const p = look;
  const s = !!pose.sentado;
  const X = 0, Y0 = 0, Y = Y0 - (s ? 10 : 0);
  const ap = !!pose.apagado;
  const pele = p.pele, cab = p.cabelo;
  const roupa = ap ? "#b9b4ad" : p.cor;
  const calca = ap ? "#a9a49d" : p.calca || (p.roupa === "terno" ? p.cor : p.roupa === "blazer" ? tom(p.cor, 0.75) : "#3d5a80");
  if (s) {
    for (const dx of [-3.2, 3.2]) {
      const kx = 0.55 * S - 0.55 * S, ky = (1.1 * S) / 2 - 11;
      const qx = kx + dx;
      poly([[X + dx - 2.2, Y - 1], [X + dx + 2.2, Y - 1], [qx + 2.2, ky], [qx - 2.2, ky]], calca, "rgba(0,0,0,.25)");
      rect(qx - 2.2, ky - 1, 4.4, 11, calca, 1.5);
      rect(qx - 2.6, ky + 9, 5.6, 2.6, "#1d1f24", 1.2);
    }
  } else {
    circ([X, Y0], 7, "rgba(0,0,0,.22)");
    const pa = pose.passo === 1 ? -1.5 : 0, pb = pose.passo === 2 ? -1.5 : 0;
    rect(X - 5, Y - 10 + pa, 4.3, 10, calca, 1.5);
    rect(X + 0.7, Y - 10 + pb, 4.3, 10, calca, 1.5);
    rect(X - 5.5, Y - 1.5 + pa, 5, 2.4, "#1d1f24", 1);
    rect(X + 0.5, Y - 1.5 + pb, 5, 2.4, "#1d1f24", 1);
  }
  const hx = X, hy = Y - 33;
  const costas = !!pose.costas;
  if (p.estilo === "longo") path(`M ${hx - 7} ${hy - 2} Q ${hx - 10.5} ${hy + 10} ${hx - 10} ${hy + 19} L ${hx + 10} ${hy + 19} Q ${hx + 10.5} ${hy + 10} ${hx + 7} ${hy - 2} Z`, cab);
  if (p.estilo === "chanel") path(`M ${hx - 7.2} ${hy - 1} Q ${hx - 8} ${hy + 5} ${hx - 6.5} ${hy + 7} L ${hx + 6.5} ${hy + 7} Q ${hx + 8} ${hy + 5} ${hx + 7.2} ${hy - 1} Z`, cab);
  if (p.estilo === "cacheado") for (const [dx, dy, r] of [[-6, -3, 4], [6, -3, 4], [-7, 2, 3.6], [7, 2, 3.6], [-4, -7, 4], [4, -7, 4], [0, -8.5, 4], [-6.5, 6, 3], [6.5, 6, 3]]) circ([hx + dx, hy + dy], r, cab);
  if (p.roupa === "moletom") circ([hx, hy + 5], 8, tom(roupa, 0.8));
  rect(X - 7.5, Y - 28, 15, 20, roupa, 5, "rgba(0,0,0,.25)");
  if (!costas) {
    if (p.roupa === "terno" || p.roupa === "blazer") {
      path(`M ${X - 3.4} ${Y - 28} L ${X} ${Y - 20} L ${X + 3.4} ${Y - 28} Z`, p.camisa);
      path(`M ${X - 3.4} ${Y - 28} L ${X - 1.2} ${Y - 21} L ${X - 4.5} ${Y - 24} Z M ${X + 3.4} ${Y - 28} L ${X + 1.2} ${Y - 21} L ${X + 4.5} ${Y - 24} Z`, tom(roupa, 0.82));
      if (p.gravata) path(`M ${X - 1} ${Y - 27.5} L ${X + 1} ${Y - 27.5} L ${X + 1.5} ${Y - 20} L ${X} ${Y - 18.5} L ${X - 1.5} ${Y - 20} Z`, p.gravata);
    } else if (p.roupa === "xadrez") {
      for (let i = 0; i < 3; i++) { rect(X - 7.5, Y - 25 + i * 5.5, 15, 1.1, "rgba(0,0,0,.18)", 0); rect(X - 5 + i * 5, Y - 28, 1.1, 20, "rgba(0,0,0,.15)", 0); }
      path(`M ${X - 2.6} ${Y - 28} L ${X} ${Y - 25} L ${X + 2.6} ${Y - 28} Z`, "#f4efe8");
    } else if (p.roupa === "avental") {
      rect(X - 5.5, Y - 24, 11, 16, tom(roupa, 1.25), 2, "rgba(0,0,0,.2)");
      path(`M ${X - 3.4} ${Y - 28} L ${X - 3.4} ${Y - 24} M ${X + 3.4} ${Y - 28} L ${X + 3.4} ${Y - 24}`, "none", tom(roupa, 1.25), 1.4);
    } else if (p.roupa === "camisa") path(`M ${X - 2.6} ${Y - 28} L ${X} ${Y - 25} L ${X + 2.6} ${Y - 28} Z`, tom(roupa, 1.2));
  }
  const carregaCaixa = pose.carrega && pose.carrega !== "papel";
  if (carregaCaixa) {
    rect(X - 9.5, Y - 22, 19, 4, tom(roupa, 0.86), 2);
    rect(X - 7, Y - 27, 14, 11, pose.carrega, 1.5, "rgba(0,0,0,.3)");
    rect(X - 0.6, Y - 27, 1.2, 11, "rgba(255,255,255,.4)", 0);
  } else {
    rect(X - 10, Y - 26, 3.6, 13, tom(roupa, 0.86), 1.8);
    rect(X + 6.4, Y - 26, 3.6, 13, tom(roupa, 0.86), 1.8);
    circ([X - 8.2, Y - 12], 1.9, p.luvas ? "#e0b43a" : pele);
    circ([X + 8.2, Y - 12], 1.9, p.luvas ? "#e0b43a" : pele);
  }
  if (!costas) {
    if (p.colar) path(`M ${X - 3.5} ${Y - 27.5} Q ${X} ${Y - 23} ${X + 3.5} ${Y - 27.5}`, "none", "#d9b44a", 0.9);
    if (pose.letra && !ap) circ([X - 3.6, Y - 22.5], 1.9, "#ffffff", "rgba(0,0,0,.25)", 0.5);
    if (p.bolsa) { path(`M ${X - 6} ${Y - 27} L ${X + 6} ${Y - 13}`, "none", "#6b4a2e", 1.6); rect(X + 4, Y - 15, 7, 6, "#8a5a34", 1.5, "rgba(0,0,0,.3)"); }
    if (pose.xicara) rect(X + 7.2, Y - 15, 3.4, 3.6, "#ffffff", 0.8, "rgba(0,0,0,.35)");
    if (pose.carrega === "papel") { rect(X + 6, Y - 19, 7, 9, "#ffffff", 0.8, "rgba(0,0,0,.3)"); path(`M ${X + 7.5} ${Y - 16} H ${X + 11.5} M ${X + 7.5} ${Y - 13.5} H ${X + 11}`, "none", "#9aa0a8", 0.7); }
  }
  if (p.estilo === "rabo") { circ([hx + 6.8, hy + 1], 2.8, cab); circ([hx + 7.6, hy + 4.8], 2.3, cab); }
  circ([hx, hy], 6.4, costas ? cab : pele);
  if (!costas && !["longo", "chanel", "cacheado"].includes(p.estilo)) { circ([hx - 6.3, hy + 0.6], 1.5, pele); circ([hx + 6.3, hy + 0.6], 1.5, pele); }
  if (!costas) {
    if (p.barba === "aparada") {
      path(`M ${hx - 6.2} ${hy - 0.4} Q ${hx - 6.1} ${hy + 6.6} ${hx} ${hy + 7.4} Q ${hx + 6.1} ${hy + 6.6} ${hx + 6.2} ${hy - 0.4} L ${hx + 5.2} ${hy + 0.6} Q ${hx + 4.4} ${hy + 5.2} ${hx} ${hy + 5.6} Q ${hx - 4.4} ${hy + 5.2} ${hx - 5.2} ${hy + 0.6} Z`, tom(cab, 1.25));
      path(`M ${hx - 2.8} ${hy + 2.5} Q ${hx} ${hy + 1.2} ${hx + 2.8} ${hy + 2.5} Q ${hx} ${hy + 2.2} ${hx - 2.8} ${hy + 2.5} Z`, tom(cab, 1.25), tom(cab, 1.25), 0.8);
    } else if (p.barba) path(`M ${hx - 6.1} ${hy + 0.2} Q ${hx - 6} ${hy + (p.barba === "cheia" ? 7.6 : 6.6)} ${hx} ${hy + (p.barba === "cheia" ? 8.2 : 7)} Q ${hx + 6} ${hy + (p.barba === "cheia" ? 7.6 : 6.6)} ${hx + 6.1} ${hy + 0.2} Q ${hx + 4} ${hy + 4.2} ${hx} ${hy + 4.6} Q ${hx - 4} ${hy + 4.2} ${hx - 6.1} ${hy + 0.2} Z`, cab);
  }
  const capa = (lado = 0) => path(`M ${hx - 6.7} ${hy + 0.8 + lado} C ${hx - 7.4} ${hy - 9}, ${hx + 7.4} ${hy - 9}, ${hx + 6.7} ${hy + 0.8 + lado} C ${hx + 5.4} ${hy - 3.6}, ${hx - 5.4} ${hy - 3.6}, ${hx - 6.7} ${hy + 0.8 + lado} Z`, cab);
  if (p.estilo === "degrade") path(`M ${hx - 6.4} ${hy - 1} C ${hx - 6.8} ${hy - 9}, ${hx + 6.8} ${hy - 9}, ${hx + 6.4} ${hy - 1} C ${hx + 5} ${hy - 4.2}, ${hx - 5} ${hy - 4.2}, ${hx - 6.4} ${hy - 1} Z`, cab);
  else if (p.estilo === "longo") {
    capa(2);
    if (!costas) path(`M ${hx - 6.6} ${hy + 1} Q ${hx - 4} ${hy - 6} ${hx + 2} ${hy - 5.2} Q ${hx - 3} ${hy - 3} ${hx - 5} ${hy + 4} Z`, cab);
    for (const sg of [-1, 1]) path(`M ${hx + sg * 7} ${hy - 3} Q ${hx + sg * 7.8} ${hy + 6} ${hx + sg * 7.6} ${hy + 15} L ${hx + sg * 5.2} ${hy + 15} Q ${hx + sg * 5.8} ${hy + 6} ${hx + sg * 5.4} ${hy - 1} Z`, cab);
  } else if (p.estilo === "coque") { capa(); circ([hx, hy - 8.4], 3.3, cab); }
  else if (p.estilo === "cacheado") capa();
  else if (p.estilo === "chanel") { capa(1.5); path(`M ${hx - 6} ${hy - 2} Q ${hx + 1} ${hy - 6.5} ${hx + 6} ${hy - 1} Q ${hx + 1} ${hy - 4} ${hx - 6} ${hy - 2} Z`, tom(cab, 0.85)); }
  else if (p.estilo === "trancas") { capa(); for (const sg of [-1, 1]) { rect(hx + sg * 6.2 - 1.4, hy, 2.8, 15, cab, 1.4); for (let i = 0; i < 4; i++) rect(hx + sg * 6.2 - 1.4, hy + 2 + i * 3.4, 2.8, 0.7, "rgba(255,255,255,.15)", 0); } }
  else if (p.estilo === "baguncado") { capa(); path(`M ${hx - 6} ${hy - 4} L ${hx - 4} ${hy - 9} L ${hx - 2} ${hy - 6} L ${hx} ${hy - 10} L ${hx + 2} ${hy - 6.5} L ${hx + 4.5} ${hy - 9.5} L ${hx + 6} ${hy - 4} Z`, cab); }
  else if (p.estilo === "bone" || p.estilo === "bonetras") {
    capa(-0.5);
    path(`M ${hx - 6.8} ${hy - 1.5} C ${hx - 7} ${hy - 9.5}, ${hx + 7} ${hy - 9.5}, ${hx + 6.8} ${hy - 1.5} Z`, p.bone);
    if (p.estilo === "bone") path(`M ${hx - 6.8} ${hy - 1.5} Q ${hx - 2} ${hy - 0.2} ${hx + 9.5} ${hy - 1.2} L ${hx + 6.8} ${hy - 2.6} Z`, tom(p.bone, 0.8));
    else path(`M ${hx - 6.4} ${hy - 4} Q ${hx - 10} ${hy - 4.5} ${hx - 10.4} ${hy - 2} L ${hx - 6.6} ${hy - 1.6} Z`, tom(p.bone, 0.8));
    circ([hx, hy - 8], 0.9, tom(p.bone, 0.7));
  } else if (p.estilo === "partido") { capa(); path(`M ${hx - 2.2} ${hy - 7.2} L ${hx - 1.4} ${hy - 3.6}`, "none", "rgba(255,255,255,.35)", 0.8); }
  else capa();
  if (p.protecao) { rect(hx - 7, hy - 6.4, 14, 2, "#2b2f38", 1); circ([hx - 2.8, hy - 5.4], 2.2, "#9fd3ea", "#2b2f38", 0.8); circ([hx + 2.8, hy - 5.4], 2.2, "#9fd3ea", "#2b2f38", 0.8); }
  if (p.fone) { path(`M ${hx - 7} ${hy + 1} C ${hx - 8} ${hy - 11}, ${hx + 8} ${hy - 11}, ${hx + 7} ${hy + 1}`, "none", "#1d1f24", 1.6); circ([hx - 7, hy + 1], 2.4, "#1d1f24"); circ([hx + 7, hy + 1], 2.4, "#1d1f24"); }
  if (!costas) {
    if (p.lapis) path(`M ${hx + 5.5} ${hy - 2} L ${hx + 10} ${hy - 5.5}`, "none", "#f2c14e", 1.3);
    if (p.brincos) { circ([hx - 6.3, hy + 3], 1.1, "#d9b44a"); circ([hx + 6.3, hy + 3], 1.1, "#d9b44a"); }
    const st = pose.est || "ok";
    const bro = st === "a" || st === "r";
    path(bro ? `M ${hx - 3.6} ${hy - 2.4} L ${hx - 1.3} ${hy - 3.1} M ${hx + 1.3} ${hy - 3.1} L ${hx + 3.6} ${hy - 2.4}` : `M ${hx - 3.5} ${hy - 2.9} Q ${hx - 2.4} ${hy - 3.6} ${hx - 1.3} ${hy - 2.9} M ${hx + 1.3} ${hy - 2.9} Q ${hx + 2.4} ${hy - 3.6} ${hx + 3.5} ${hy - 2.9}`, "none", tom(cab === "#b8b8b8" ? "#8a8a8a" : cab, 0.9), 0.9);
    if (pose.piscando) { path(`M ${hx - 3.2} ${hy - 0.6} H ${hx - 1.4} M ${hx + 1.4} ${hy - 0.6} H ${hx + 3.2}`, "none", "#2b2018", 0.8); }
    else {
      circ([hx - 2.3, hy - 0.6], 0.95, "#2b2018");
      circ([hx + 2.3, hy - 0.6], 0.95, "#2b2018");
      circ([hx - 2.0, hy - 0.9], 0.3, "#ffffff");
      circ([hx + 2.6, hy - 0.9], 0.3, "#ffffff");
    }
    if (p.oculos === "redondo") { circ([hx - 2.4, hy - 0.6], 2.1, "rgba(255,255,255,.15)", "#2b2f38", 0.7); circ([hx + 2.4, hy - 0.6], 2.1, "rgba(255,255,255,.15)", "#2b2f38", 0.7); path(`M ${hx - 0.4} ${hy - 0.8} L ${hx + 0.4} ${hy - 0.8}`, "none", "#2b2f38", 0.7); }
    if (p.oculos === "leitura") { rect(hx - 4.4, hy - 0.4, 3.6, 2.2, "rgba(255,255,255,.2)", 0.8, "#7b3f2a"); rect(hx + 0.8, hy - 0.4, 3.6, 2.2, "rgba(255,255,255,.2)", 0.8, "#7b3f2a"); }
    path(`M ${hx} ${hy} Q ${hx + 0.9} ${hy + 1.6} ${hx - 0.2} ${hy + 1.8}`, "none", tom(pele, 0.75), 0.7);
    if (!p.barba) { circ([hx - 3.8, hy + 2], 1.2, "rgba(230,120,110,.25)"); circ([hx + 3.8, hy + 2], 1.2, "rgba(230,120,110,.25)"); }
    const boca = p.barba ? "#f1e1d6" : "#7a2e1f";
    if (st === "o") path(`M ${hx - 2.4} ${hy + 2.6} Q ${hx} ${hy + 6.4} ${hx + 2.4} ${hy + 2.6} Z`, "#7a2e1f", "#7a2e1f", 0.5);
    else if (st === "a") path(`M ${hx - 1.9} ${hy + 3.6} Q ${hx} ${hy + 3.0} ${hx + 1.9} ${hy + 3.6}`, "none", boca, 0.9);
    else if (st === "r") path(`M ${hx - 2} ${hy + 4.2} Q ${hx} ${hy + 2.6} ${hx + 2} ${hy + 4.2}`, "none", boca, 0.9);
    else path(`M ${hx - 2.3} ${hy + 2.8} Q ${hx} ${hy + 4.8} ${hx + 2.3} ${hy + 2.8}`, "none", boca, 0.95);
  }
  if (ap) poly([[X - 11, Y - 44], [X + 11, Y - 44], [X + 11, Y - 7], [X - 11, Y - 7]], "rgba(239,232,220,.45)", "none");
  return { paths: it.paths, topo: Y - (p.estilo === "coque" || p.estilo === "cacheado" ? 52 : 48), peito: [X - 3.6, Y - 22.5] };
}

/** Pug (de lado) a partir do chão (0, 0). */
export function desenharPug(cor, passo = 0) {
  const it = novoItem("p", 0);
  const { circ } = caneta(it);
  const X = 0, Y = -1;
  circ([X, Y + 2], 5.5, "rgba(0,0,0,.18)");
  circ([X, Y - 4 - (passo ? 0.6 : 0)], 5.5, cor);
  circ([X + 5, Y - 7 - (passo ? 0.6 : 0)], 3.6, cor);
  circ([X + 7, Y - 6.5 - (passo ? 0.6 : 0)], 1.6, "#1d1f24");
  circ([X + 3.6, Y - 8.5 - (passo ? 0.6 : 0)], 0.7, "#fff");
  return { paths: it.paths };
}

// Visual de cada pessoa (tabela combinada com o Gustavo em 27/10/2026).
// CEOs da Ohra pela foto de 24/10: social esportivo, combinando (ele blazer marinho e
// camisa creme; ela blazer creme e blusa marinho) — sem a letra da loja na roupa.
export function visuais(estiloLoja) {
  const ohra = estiloLoja === "ohra";
  return {
    ceo1: ohra
      ? { pele: "#c08a62", cabelo: "#241a14", estilo: "degrade", barba: "aparada", roupa: "blazer", cor: "#2c3e5c", camisa: "#f4f1ea", calca: "#b59a74" }
      : { pele: "#e3b48f", cabelo: "#5a3a22", estilo: "curto", roupa: "blazer", cor: "#4a5560", camisa: "#f4f1ea", calca: "#2f3540" },
    ceo2: ohra
      ? { pele: "#f1d1bc", cabelo: "#15110e", estilo: "longo", roupa: "blazer", cor: "#ece2d0", camisa: "#2c3e5c", calca: "#2c3e5c" }
      : { pele: "#e9c3a3", cabelo: "#6b3f22", estilo: "longo", roupa: "blazer", cor: "#7a4a3a", camisa: "#f4efe8", calca: "#2f3540" },
    consultor: { pele: "#e6bf9c", cabelo: "#b8b8b8", estilo: "partido", roupa: "terno", cor: "#2f5d8a", camisa: "#ffffff", gravata: "#1f3d5c", oculos: "redondo" },
    bia: { pele: "#f2d3bd", cabelo: "#2b2018", estilo: "coque", roupa: "camisa", cor: "#3f8f6a", oculos: "leitura" },
    lia: { pele: "#e8c4a8", cabelo: "#a4622b", estilo: "rabo", roupa: "camisa", cor: "#e0874f" },
    kai: { pele: "#b07a58", cabelo: "#1d1f24", estilo: "bonetras", bone: "#1d6f7a", roupa: "moletom", cor: "#25a3b5" },
    celia: { pele: "#e8c4a8", cabelo: "#5a3520", estilo: "chanel", roupa: "blazer", cor: "#6f6d74", camisa: "#f4efe8", colar: true },
    rafa: { pele: "#f3d6c2", cabelo: "#2b2018", estilo: "curto", roupa: "camisa", cor: "#e2725b", lapis: true },
    nina: { pele: "#7a4a32", cabelo: "#1d1f24", estilo: "cacheado", roupa: "camisa", cor: "#7b5fb3", brincos: true },
    leo: { pele: "#b07a58", cabelo: "#2b2018", estilo: "curto", barba: "curta", roupa: "camisa", cor: "#3b7bb8", fone: true },
    teo: { pele: "#d9a37f", cabelo: "#3b2a1e", estilo: "curto", barba: "cheia", roupa: "xadrez", cor: "#5e6b78" },
    ivo: { pele: "#e8b896", cabelo: "#6b3b1f", estilo: "baguncado", roupa: "avental", cor: "#4a7fb5", protecao: true },
    duda: { pele: "#a86b48", cabelo: "#1d1f24", estilo: "trancas", roupa: "camisa", cor: "#c58a3a", luvas: true },
    rui: { pele: "#d9b39a", cabelo: "#5b4a3a", estilo: "partido", roupa: "camisa", cor: "#9aa39b" },
    ze: { pele: "#e8b896", cabelo: "#2b2018", estilo: "bone", bone: "#d2622b", roupa: "camisa", cor: "#f08a52", bolsa: true },
  };
}
