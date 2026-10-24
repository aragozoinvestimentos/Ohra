// Motor da "Sede da <loja>" (24/10/2026): escritório em pixel art num <canvas>,
// com pessoas autônomas (rotinas, caminho desviando dos móveis), dia/noite pelo
// relógio e reações aos eventos do app. SÓ MOSTRA: nada aqui grava dado.
// Falas e placas são HTML por cima do canvas (nítidas em qualquer tamanho).
// Quem usa: components/Sede.jsx (dados, eventos e painel).
import { SALAS_SEDE } from "./sede.js";

const T = 16, MW = 40, MH = 26, LARG = MW * T, ALT = MH * T;
export const TAMANHO_SEDE = { largura: LARG, altura: ALT };

export function criarSede({ canvas, camada, personagens, impressoras = 1, reduzir = false, onSala }) {
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const r = (x, y, w, h, c) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  };
  const SALAS = SALAS_SEDE.map((s) => ({ ...s, luz: "o" }));
  const ENTRADA = [35, 24];

  // grade: 0 parede, 1 piso
  const grid = [...Array(MH)].map(() => Array(MW).fill(0));
  const salaDe = [...Array(MH)].map(() => Array(MW).fill(null));
  for (const s of SALAS) for (let y = s.y0; y <= s.y1; y++) for (let x = s.x0; x <= s.x1; x++) { grid[y][x] = 1; salaDe[y][x] = s.k; }
  for (let y = 11; y <= 13; y++) for (let x = 1; x <= 38; x++) { grid[y][x] = 1; salaDe[y][x] = "corredor"; }
  for (const s of SALAS) { const [px, py] = s.porta; grid[py][px] = 1; salaDe[py][px] = "porta"; }
  grid[ENTRADA[1]][ENTRADA[0]] = 1;
  salaDe[ENTRADA[1]][ENTRADA[0]] = "porta";
  const andavel = grid.map((l) => l.slice());

  // ================= móveis =================
  const moveis = [];
  function movel(x, y, w, h, desenha, bloqueia = true) { moveis.push({ x, y, w, h, desenha, base: (y + h) * T }); if (bloqueia) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) andavel[y + j][x + i] = 0; }
  const tom = (hex, f) => { const n = parseInt(hex.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * f)))); return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join(""); };
  function mesa(x, y, madeira = "#9a6a43", monitor = true, placa = null) {
    movel(x, y, 2, 1, (X, Y) => {
      r(X, Y + 2, 32, 9, madeira); r(X, Y + 2, 32, 1, tom(madeira, 1.2)); r(X, Y + 11, 32, 4, tom(madeira, .75)); r(X + 1, Y + 15, 2, 1, "#3a2a1c"); r(X + 29, Y + 15, 2, 1, "#3a2a1c");
      if (monitor) { r(X + 3, Y - 6, 12, 9, "#23262c"); r(X + 4, Y - 5, 10, 6, "#4fb0e8"); r(X + 4, Y - 5, 10, 2, "#7fd0f5"); r(X + 8, Y + 3, 2, 1, "#23262c"); r(X + 15, Y + 6, 9, 2, "#555a63"); r(X + 26, Y + 6, 3, 2, "#ddd"); r(X + 19, Y + 3, 5, 3, "#f3efe6"); }
      if (placa) { r(X + 9, Y + 11, 14, 3, "#c9a24a"); r(X + 10, Y + 12, 12, 1, "#8a6a22"); }
    });
  }
  function cadeira(x, y, cor = "#2f3238") { movel(x, y, 1, 1, (X, Y) => { r(X + 3, Y + 1, 10, 5, cor); r(X + 3, Y + 6, 10, 5, tom(cor, 1.25)); r(X + 7, Y + 11, 2, 3, "#222"); r(X + 4, Y + 14, 8, 1, "#222"); }, false); }
  function planta(x, y) { movel(x, y, 1, 1, (X, Y) => { r(X + 4, Y + 9, 8, 6, "#c98d5c"); r(X + 4, Y + 9, 8, 1, "#e0a774"); r(X + 2, Y - 3, 12, 8, "#4f8a3a"); r(X + 5, Y - 7, 6, 6, "#6aab4f"); r(X + 1, Y + 1, 5, 6, "#447a32"); r(X + 10, Y + 1, 5, 6, "#5d9a44"); }); }
  function estante(x, y, w, cores) { movel(x, y, w, 1, (X, Y) => { r(X, Y - 14, w * T, 30, "#7a5a3c"); for (let n = 0; n < 3; n++) { r(X + 1, Y - 13 + n * 9, w * T - 2, 8, "#5c4229"); let px = X + 2; for (const c of cores[n] || []) { r(px, Y - 12 + n * 9, 4, 7, c); r(px, Y - 12 + n * 9, 4, 1, tom(c, 1.25)); px += 5; } } r(X, Y + 14, w * T, 2, "#4a3420"); }); }
  function sofa(x, y, w, cor) { movel(x, y, w, 1, (X, Y) => { r(X, Y, w * T, 6, tom(cor, .85)); r(X, Y + 5, w * T, 8, cor); r(X, Y + 5, w * T, 1, tom(cor, 1.2)); r(X - 2, Y + 2, 4, 12, tom(cor, .75)); r(X + w * T - 2, Y + 2, 4, 12, tom(cor, .75)); r(X + 2, Y + 13, w * T - 4, 2, "#2a1d15"); }); }
  // Impressoras da Minha farm (uma por impressora ativa, até 3); a 1ª pisca com aviso de manutenção.
  const VAGAS_IMPRESSORA = [[18, 17], [21, 17], [23, 19]];
  let alertaProducao = null;
  VAGAS_IMPRESSORA.slice(0, Math.max(1, Math.min(3, impressoras))).forEach(([x, y], i) =>
    movel(x, y, 2, 1, (X, Y) => {
      r(X, Y + 2, 32, 12, "#8f7253"); r(X, Y + 2, 32, 1, "#a98a68"); r(X + 6, Y - 14, 2, 18, "#3a3d44"); r(X + 24, Y - 14, 2, 18, "#3a3d44"); r(X + 6, Y - 15, 20, 3, "#3a3d44");
      const bico = Math.round(Math.sin(perf / 350 + i) * 7);
      r(X + 13 + bico, Y - 11, 6, 4, "#2b2b30"); r(X + 15 + bico, Y - 7, 2, 2, "#ff9a5c");
      r(X + 8, Y, 16, 3, ["#ff9a5c", "#4a7fb5", "#f29ab8"][i % 3]); r(X + 12, Y - 3, 8, 3, tom(["#ff9a5c", "#4a7fb5", "#f29ab8"][i % 3], .85));
      if (i === 0 && alertaProducao && Math.floor(perf / 400) % 2) { r(X + 26, Y - 22, 7, 7, alertaProducao === "r" ? "#e0453a" : "#e8a317"); r(X + 29, Y - 21, 1, 3, "#fff"); r(X + 29, Y - 17, 1, 1, "#fff"); }
    }),
  );
  estante(1, 2, 3, [["#8b3a2b", "#2f4a6b", "#d9b26f", "#4c6b3c", "#e0874f", "#6b5a8a", "#c9c2b3", "#3b5e7a", "#b8432f"], ["#2f4a6b", "#d9b26f", "#e0874f", "#4c6b3c", "#8b3a2b"], ["#c9c2b3", "#6b5a8a", "#3b5e7a"]]);
  mesa(3, 5, "#6e4a33", true, "G"); cadeira(4, 4);
  mesa(7, 5, "#6e4a33", true, "J"); cadeira(8, 4);
  sofa(3, 8, 4, "#4a5a6e"); planta(10, 2); planta(1, 8);
  // Live
  movel(14, 2, 6, 1, (X, Y) => { r(X, Y - 10, 96, 24, "#f2a7bf"); r(X + 4, Y - 7, 88, 18, "#f7c3d3"); for (let i = 0; i < 6; i++) r(X + 10 + i * 14, Y - 2, 6, 6, i % 2 ? "#fff" : "#e05a7a"); });
  mesa(15, 4, "#f4f1ec", false); movel(15, 4, 2, 1, () => {}, true);
  movel(18, 6, 1, 1, (X, Y) => { r(X + 7, Y - 6, 2, 20, "#333"); r(X + 2, Y - 14, 12, 12, "#fff"); r(X + 4, Y - 12, 8, 8, "#f6eef0"); r(X + 6, Y - 11, 4, 6, "#1b1b1f"); r(X + 3, Y + 13, 10, 2, "#333"); });
  planta(20, 8);
  // Financeiro
  mesa(24, 5, "#8f7253"); cadeira(25, 4);
  movel(27, 2, 2, 1, (X, Y) => { r(X, Y - 10, 30, 26, "#8d969f"); for (let n = 0; n < 3; n++) { r(X + 2, Y - 8 + n * 8, 26, 6, "#a6aeb6"); r(X + 13, Y - 6 + n * 8, 4, 1, "#555"); } });
  planta(22, 8);
  // Beleza (vazia, pra crescer)
  estante(31, 2, 2, [["#f29ab8", "#e05a7a"], ["#fff2f6"], []]);
  movel(36, 2, 2, 1, (X, Y) => { r(X + 2, Y + 2, 28, 10, "#f4eef0"); r(X + 2, Y + 12, 28, 3, "#d9c9cf"); r(X + 8, Y - 12, 16, 14, "#c9e4f0"); r(X + 7, Y - 13, 18, 1, "#e8c5d0"); r(X + 7, Y + 1, 18, 1, "#e8c5d0"); });
  // Corredor: mural, café, relógio, plantas, bebedouro
  movel(9, 11, 1, 1, () => {}, false);
  movel(30, 11, 2, 1, (X, Y) => { r(X + 2, Y + 3, 28, 11, "#8a6a4a"); r(X + 2, Y + 3, 28, 1, "#a8855f"); r(X + 4, Y - 4, 8, 9, "#2b2b30"); r(X + 6, Y - 2, 4, 2, "#ff6b4a"); r(X + 15, Y, 5, 4, "#fff"); r(X + 22, Y, 5, 4, "#f2e3cf"); });
  movel(3, 11, 1, 1, (X, Y) => { r(X + 4, Y - 6, 8, 14, "#cfe8f5"); r(X + 4, Y - 6, 8, 5, "#7fc2e8"); r(X + 3, Y + 8, 10, 7, "#d9d9d9"); });
  planta(37, 11); planta(13, 13); planta(26, 13);
  // Comercial: 4 mesas
  mesa(3, 18); cadeira(4, 17, "#8a3a2a"); mesa(9, 18); cadeira(10, 17, "#4b3d6b");
  mesa(3, 22); cadeira(4, 21, "#2b4a6b"); mesa(9, 22); cadeira(10, 21, "#555");
  movel(13, 15, 2, 1, (X, Y) => { r(X, Y - 10, 30, 18, "#f7f7f5"); r(X - 1, Y - 11, 32, 1, "#9aa"); r(X + 3, Y - 2, 6, 1, "#d2622b"); r(X + 9, Y - 4, 6, 1, "#d2622b"); r(X + 15, Y - 5, 6, 1, "#d2622b"); r(X + 21, Y - 8, 6, 1, "#d2622b"); r(X + 3, Y + 8, 2, 8, "#888"); r(X + 25, Y + 8, 2, 8, "#888"); });
  planta(15, 22);
  // Produção
  movel(23, 15, 2, 1, (X, Y) => { r(X, Y - 12, 32, 28, "#6f5a46"); const cs = ["#e0874f", "#f4f1ec", "#2b2b30", "#c9a24a", "#4a7fb5", "#e05a7a"]; cs.forEach((c, i) => { const cx = X + 4 + (i % 3) * 9, cy = Y - 8 + Math.floor(i / 3) * 12; r(cx, cy, 8, 8, c); r(cx + 3, cy + 3, 2, 2, "#4a3626"); }); });
  movel(18, 21, 3, 1, (X, Y) => { r(X, Y + 2, 48, 11, "#9a7a58"); r(X, Y + 2, 48, 1, "#b8956d"); r(X + 6, Y - 1, 8, 4, "#d9d9d9"); r(X + 30, Y - 2, 4, 5, "#c9a24a"); });
  // Estoque & Expedição
  estante(28, 15, 2, [["#e0874f", "#e0874f", "#d26a3a", "#e0874f", "#c9a24a"], ["#e0874f", "#f4f1ec", "#e0874f", "#e0874f"], ["#d26a3a", "#e0874f", "#c9a24a"]]);
  estante(31, 15, 2, [["#f29ab8", "#e05a7a", "#fff2f6"], ["#f29ab8"], []]);
  movel(29, 19, 2, 1, (X, Y) => { r(X, Y + 2, 32, 12, "#b08a5a"); r(X, Y + 2, 32, 1, "#c9a37a"); r(X + 4, Y - 2, 9, 6, "#d8b68c"); r(X + 18, Y - 1, 8, 5, "#c9a37a"); r(X + 26, Y + 1, 4, 2, "#ddd"); });
  movel(33, 21, 3, 1, (X, Y) => { r(X, Y + 1, 48, 13, "#c9a37a"); r(X, Y + 1, 48, 2, "#e8d3b5"); r(X, Y + 11, 48, 3, "#d2622b"); r(X + 36, Y - 4, 6, 5, "#c9a24a"); r(X + 38, Y - 6, 2, 2, "#c9a24a"); });
  movel(37, 19, 1, 1, (X, Y) => { r(X + 3, Y - 6, 10, 20, "#d2622b"); r(X + 3, Y - 6, 10, 2, "#e88552"); r(X + 4, Y - 9, 8, 4, "#fff"); r(X + 6, Y - 11, 8, 4, "#fdf6e8"); });
  const pilha = { n: 3 };
  movel(36, 23, 2, 1, (X, Y) => { for (let i = 0; i < pilha.n; i++) { const bx = X + (i % 4) * 7, by = Y + 4 - Math.floor(i / 4) * 6; r(bx, by, 7, 6, "#c9a37a"); r(bx, by, 7, 1, "#e0c49c"); r(bx + 3, by, 1, 6, "#a8835e"); } }, false);

  // ================= estado =================
  let perf = 0, noite = false, liveLigada = false, adsOn = false, carimbo = 0, sino = 0;
  const meta = { pct: 0 };
  const confete = [];
  const presentes = [];

  // ================= pessoas =================
  const ohra = personagens.estilo === "ohra";
  const LOOKS = {
    ceo1: ohra
      ? { pele: "#c98e66", cab: "#17110d", estilo: "curto", barba: true, roupa: "#f7f7f5", blazer: "#2f3238", calca: "#262a33" }
      : { pele: "#e3b48f", cab: "#5a3a22", estilo: "curto", roupa: "#f7f7f5", blazer: "#2b3a55", calca: "#262a33" },
    ceo2: ohra
      ? { pele: "#f0cdb2", cab: "#0d0d10", estilo: "longo", roupa: "#f7f7f5", blazer: "#5b3a52", calca: "#1f1f24", batom: true }
      : { pele: "#e9c3a3", cab: "#6b3f22", estilo: "longo", roupa: "#f7f7f5", blazer: "#7a4a3a", calca: "#1f1f24", batom: true },
    bia: { pele: "#f2d3bd", cab: "#e2c27a", estilo: "coque", roupa: "#3f8f6a", calca: "#3b3b44" },
    rafa: { pele: "#f3d6c2", cab: "#b5502a", estilo: "cacheado", roupa: "#e0874f", calca: "#4a4f5a" },
    nina: { pele: "#7a4a32", cab: "#1a1210", estilo: "black", roupa: "#7b5fb3", calca: "#2e3440" },
    leo: { pele: "#b07a58", cab: "#b07a58", estilo: "careca", roupa: "#3b7bb8", calca: "#2e3440", fone: true },
    celia: { pele: "#e8c4a8", cab: "#b9b6b0", estilo: "chanel", roupa: "#7c7a80", calca: "#3b3b44", oculos: true },
    teo: { pele: "#d9a37f", cab: "#c9a24a", estilo: "bone", corBone: "#e0874f", roupa: "#5e6b78", calca: "#5e6b78" },
    duda: { pele: "#a86b48", cab: "#4a2e1c", estilo: "rabo", roupa: "#e8e1d4", colete: "#c58a3a", calca: "#2e3440" },
    ze: { pele: "#e8b896", cab: "#3a2a1c", estilo: "bone", corBone: "#d2622b", roupa: "#d2622b", calca: "#2e3440" },
  };
  const CASA = { ceo1: [4, 4], ceo2: [8, 4], bia: [25, 4], rafa: [4, 17], nina: [10, 17], leo: [4, 21], celia: [10, 21], teo: [19, 19], duda: [30, 18], ze: [34, 20] };
  const SALA = { bia: "financeiro", rafa: "comercial", nina: "comercial", leo: "comercial", celia: "comercial", teo: "producao", duda: "estoque", ze: "estoque", ceo1: "diretoria", ceo2: "diretoria" };
  const FUNCAO = { ceo1: "CEO", ceo2: "CEO", bia: "Financeiro", rafa: "Preços", nina: "Anúncios e Rampa", leo: "Ads", celia: "Análise", teo: "Produção", duda: "Estoque", ze: "Recepção / carteiro" };
  const PESSOAS = [];
  function pessoa(id) {
    const casa = CASA[id];
    const p = { id, nome: personagens.nomes[id] || id, funcao: FUNCAO[id], sala: SALA[id], casa, look: LOOKS[id], x: casa[0], y: casa[1], px: casa[0] * T, py: casa[1] * T, cam: [], est: "sentado", t: 2 + Math.random() * 6, quadro: 0, dir: "f", carrega: null, fala: null, falaT: 0, aviso: null, dono: id === "ceo1" || id === "ceo2", empe: ["teo", "duda", "ze"].includes(id) };
    PESSOAS.push(p);
    return p;
  }
  const CEO1 = pessoa("ceo1"), CEO2 = pessoa("ceo2");
  ["bia", "rafa", "nina", "leo", "celia"].forEach(pessoa);
  const TEO = pessoa("teo"), DUDA = pessoa("duda"), ZE = pessoa("ze");
  const DONOS = [CEO1, CEO2];
  const LEO = PESSOAS.find((p) => p.id === "leo"), BIA = PESSOAS.find((p) => p.id === "bia");

  // bichos (só os que têm nome)
  const BICHOS = [];
  function bicho(id, tipo, pos, cores) {
    const nome = personagens.nomes[id];
    if (!nome) return;
    BICHOS.push({ id, nome, funcao: { miau: "gato do escritório", bento: "pug preto", nick: "pug bege" }[id], tipo, cores, x: pos[0], y: pos[1], px: pos[0] * T, py: pos[1] * T, cam: [], t: 2 + Math.random() * 4, quadro: 0, dir: "d", fala: null, falaT: 0, bicho: true });
  }
  bicho("miau", "gato", [20, 12], { corpo: "#f0a050", sombra: "#d08840" });
  bicho("bento", "pug", [6, 7], { corpo: "#2b2726", sombra: "#1a1716", cara: "#0f0d0c", orelha: "#121010", olho: "#e9e2da" });
  bicho("nick", "pug", [9, 8], { corpo: "#e3c79c", sombra: "#c9a979", cara: "#2a2220", orelha: "#2a2220", olho: "#f6efe5" });

  // ---------- caminho (BFS) ----------
  function caminho(a, b) {
    const [ax, ay] = a, [bx, by] = b;
    const k = (x, y) => y * MW + x;
    const veio = new Map([[k(ax, ay), null]]);
    const fila = [[ax, ay]];
    const livre = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH && (andavel[y][x] || (x === bx && y === by));
    while (fila.length) {
      const [x, y] = fila.shift();
      if (x === bx && y === by) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (livre(nx, ny) && !veio.has(k(nx, ny))) { veio.set(k(nx, ny), [x, y]); fila.push([nx, ny]); } }
    }
    if (!veio.has(k(bx, by))) return [];
    const out = [];
    let c = [bx, by];
    while (c && !(c[0] === ax && c[1] === ay)) { out.unshift(c); c = veio.get(k(c[0], c[1])); }
    return out;
  }
  const tile = (p) => [Math.round(p.px / T), Math.round(p.py / T)];
  const sorteio = (l) => l[Math.floor(Math.random() * l.length)];
  const pontoLivre = (sala) => { const s = SALAS.find((x) => x.k === sala); for (let i = 0; i < 60; i++) { const x = s.x0 + Math.floor(Math.random() * (s.x1 - s.x0 + 1)), y = s.y0 + 1 + Math.floor(Math.random() * (s.y1 - s.y0)); if (andavel[y][x]) return [x, y]; } return s.porta; };
  const corredorLivre = () => { for (let i = 0; i < 60; i++) { const x = 2 + Math.floor(Math.random() * 36), y = 11 + Math.floor(Math.random() * 3); if (andavel[y][x]) return [x, y]; } return [20, 12]; };
  function ir(p, alvo, depois) { p.cam = caminho(tile(p), alvo); p.est = "andando"; p.depois = depois; }
  // Fala: no máximo 3 balões ao mesmo tempo (as dos eventos passam na frente).
  const falando = () => [...PESSOAS, ...BICHOS].filter((q) => q.fala).length;
  function falar(p, txt, s = 3, forcar = false) { if (!p || (!forcar && !p.fala && falando() >= 3)) return; p.fala = txt; p.falaT = s; }

  // ---------- rotinas (só visual) ----------
  const sentar = (p) => () => { p.est = p.empe ? "trabalhando" : "sentado"; p.t = 8 + Math.random() * 14; };
  function proximaTarefa(p) {
    if (noite && p !== TEO) { ir(p, ENTRADA, () => { p.est = "fora"; p.t = 9999; }); return; }
    const casa = p.casa, volta = () => ir(p, casa, sentar(p));
    const dado = Math.random();
    if (p.dono) {
      if (p === CEO2 && liveLigada) { ir(p, [16, 6], () => { p.est = "live"; p.t = 30; falar(p, "Oi, gente! 💕", 4, true); }); return; }
      if (dado < 0.35) { const s = sorteio(["comercial", "producao", "estoque", "financeiro", "live", "beleza"]); ir(p, pontoLivre(s), () => { p.est = "parado"; p.t = 4; falar(p, sorteio(["Como estão as coisas?", "Bora!", "Ficou ótimo", "Me mostra isso?"]), 3); p.depois2 = volta; }); return; }
      if (dado < 0.5) { ir(p, [31, 12], () => { p.est = "parado"; p.t = 4; falar(p, "☕", 3); p.depois2 = volta; }); return; }
      sentar(p)();
      return;
    }
    if (p === TEO) { ir(p, sorteio([[19, 19], [22, 16], [20, 20], [19, 16]]), () => { p.est = "trabalhando"; p.t = 5 + Math.random() * 6; if (p.aviso && Math.random() < 0.4) falar(p, "🔧 manutenção!", 2.5); }); return; }
    if (p === DUDA) { if (dado < 0.5) ir(p, [29, 16], () => { p.carrega = "#e0874f"; ir(p, [30, 18], () => { p.carrega = null; p.est = "trabalhando"; p.t = 4; }); }); else ir(p, [30, 18], () => { p.carrega = "#c9a37a"; ir(p, [35, 22], () => { p.carrega = null; p.est = "trabalhando"; p.t = 4; p.depois2 = () => ir(p, DUDA.casa, sentar(p)); }); }); return; }
    if (p === ZE) { if (dado < 0.3 && p.aviso) ir(p, [37, 20], () => { p.est = "parado"; p.t = 3; falar(p, "📬 caixa cheia!", 2.5); p.depois2 = () => ir(p, ZE.casa, sentar(p)); }); else sentar(p)(); return; }
    // funcionários de mesa: com aviso, levam papel pra Diretoria
    if (p.aviso && dado < 0.3) {
      const dono = DONOS.find((d) => d.est === "sentado") || CEO1;
      p.carrega = "papel";
      ir(p, [dono.casa[0] + 1, dono.casa[1] + 2], () => { p.est = "parado"; p.t = 3.5; falar(p, p.aviso === "o" ? "Oportunidade!" : p.aviso === "r" ? "Urgente!" : "Precisa decidir", 3); setTimeout(() => falar(dono, "Deixa comigo", 2.5), 1400); p.depois2 = () => { p.carrega = null; volta(); }; });
      return;
    }
    if (dado < 0.45) { ir(p, [31, 12], () => { p.est = "parado"; p.t = 3 + Math.random() * 3; if (Math.random() < 0.5) falar(p, "☕", 2); p.depois2 = volta; }); return; }
    sentar(p)();
  }
  function atualizarBicho(g, dt) {
    if (g.falaT > 0) { g.falaT -= dt; if (g.falaT <= 0) g.fala = null; }
    g.t -= dt;
    if (!g.cam.length && g.t <= 0) {
      const d = Math.random();
      let alvo;
      if (g.tipo === "pug" && d < 0.35) { const dono = sorteio(DONOS.filter((x) => x.est !== "fora")) || CEO1; const [tx, ty] = tile(dono); alvo = [tx + (Math.random() < 0.5 ? 1 : -1), ty + 1]; if (!andavel[alvo[1]]?.[alvo[0]]) alvo = pontoLivre("diretoria"); }
      else if (d < 0.75) alvo = corredorLivre();
      else alvo = pontoLivre(sorteio(g.tipo === "pug" ? ["diretoria", "comercial", "live"] : ["diretoria", "comercial"]));
      g.cam = caminho(tile(g), alvo);
      g.t = 4 + Math.random() * 7;
      if (g.tipo === "pug" && Math.random() < 0.12) falar(g, "Au!", 1.5);
      if (g.tipo === "gato" && Math.random() < 0.08) falar(g, "Miau", 1.5);
    }
    if (mover(g, dt, g.tipo === "pug" ? 2.1 : 1.6)) g.quadro += dt * 4;
  }
  function mover(p, dt, vel = 2.6) {
    if (!p.cam.length) return false;
    const [tx, ty] = p.cam[0];
    const gx = tx * T, gy = ty * T;
    const dx = gx - p.px, dy = gy - p.py, d = Math.hypot(dx, dy), passo = vel * T * dt;
    p.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "d" : "e") : dy > 0 ? "f" : "c";
    if (d <= passo) { p.px = gx; p.py = gy; p.cam.shift(); } else { p.px += (dx / d) * passo; p.py += (dy / d) * passo; }
    p.quadro += dt * 8;
    return true;
  }
  function atualizar(p, dt) {
    if (p.falaT > 0) { p.falaT -= dt; if (p.falaT <= 0) p.fala = null; }
    if (p.est === "andando") { if (!mover(p, dt)) { p.est = "parado"; const f = p.depois; p.depois = null; if (f) f(); } return; }
    if (p.est === "fora") { if (!noite) { p.px = ENTRADA[0] * T; p.py = ENTRADA[1] * T; ir(p, p.casa, sentar(p)); } return; }
    p.t -= dt;
    p.quadro += dt * (p.est === "sentado" || p.est === "trabalhando" ? 6 : 2);
    if (p.t <= 0) { if (p.depois2) { const f = p.depois2; p.depois2 = null; f(); } else proximaTarefa(p); }
  }

  // ---------- desenho ----------
  const bolhas = [];
  function bolha(x, y, txt, id) { bolhas.push({ x, y, txt, id }); }
  function desenhaPessoa(p) {
    const L = p.look, X = Math.round(p.px) + 2, Y = Math.round(p.py) - 8;
    const sent = p.est === "sentado";
    const anda = p.est === "andando", f = Math.floor(p.quadro) % 2;
    r(X + 1, Y + 22, 10, 2, "rgba(0,0,0,.22)");
    if (!sent) {
      r(X + 3, Y + 16 - (anda && f ? 1 : 0), 3, 5, L.calca); r(X + 7, Y + 16 - (anda && !f ? 1 : 0), 3, 5, L.calca);
      r(X + 2, Y + 21 - (anda && f ? 1 : 0), 4, 1, "#1e1e22"); r(X + 7, Y + 21 - (anda && !f ? 1 : 0), 4, 1, "#1e1e22");
    }
    const dy = sent ? 3 : 0, tecla = sent && Math.floor(p.quadro) % 2 ? 1 : 0;
    // tronco
    r(X + 2, Y + 9 + dy, 9, 8, L.roupa);
    if (L.blazer) { r(X + 2, Y + 9 + dy, 3, 8, L.blazer); r(X + 8, Y + 9 + dy, 3, 8, L.blazer); r(X + 5, Y + 9 + dy, 3, 1, L.blazer); }
    if (L.colete) { r(X + 3, Y + 10 + dy, 7, 6, L.colete); r(X + 6, Y + 10 + dy, 1, 6, L.roupa); }
    // braços
    const braco = L.blazer || L.roupa;
    if (p.carrega && p.carrega !== "papel") { r(X + 1, Y + 11 + dy, 11, 2, braco); r(X + 2, Y + 7, 9, 6, p.carrega); r(X + 2, Y + 7, 9, 1, tom(p.carrega, 1.2)); }
    else { r(X + 1, Y + 10 + dy - tecla, 2, 6, braco); r(X + 10, Y + 10 + dy + tecla - 1, 2, 6, braco); r(X + 1, Y + 16 + dy - tecla, 2, 1, L.pele); r(X + 10, Y + 15 + dy + tecla, 2, 1, L.pele); }
    if (p.carrega === "papel") { r(X + 9, Y + 12 + dy, 5, 6, "#fff"); r(X + 10, Y + 14 + dy, 3, 1, "#999"); }
    // cabeça
    const H = Y + dy;
    if (L.estilo === "longo") r(X + 1, H + 1, 11, 13, L.cab);
    if (L.estilo === "black") r(X, H - 3, 13, 11, L.cab);
    r(X + 5, H + 8, 3, 1, tom(L.pele, .9));
    r(X + 2, H + 1, 9, 8, L.pele); r(X + 3, H, 7, 1, L.pele);
    const costas = p.dir === "c";
    // cabelo
    if (L.estilo === "curto") { r(X + 2, H - 1, 9, 3, L.cab); r(X + 2, H + 2, 1, 2, L.cab); r(X + 10, H + 2, 1, 2, L.cab); }
    if (L.estilo === "longo") { r(X + 2, H - 1, 9, 3, L.cab); r(X + 2, H + 2, 2, 5, L.cab); r(X + 9, H + 2, 2, 5, L.cab); }
    if (L.estilo === "coque") { r(X + 2, H - 1, 9, 3, L.cab); r(X + 5, H - 4, 3, 3, L.cab); }
    if (L.estilo === "cacheado") { r(X + 1, H - 2, 11, 4, L.cab); r(X + 1, H + 2, 2, 3, L.cab); r(X + 10, H + 2, 2, 3, L.cab); r(X + 3, H - 3, 2, 1, L.cab); r(X + 8, H - 3, 2, 1, L.cab); }
    if (L.estilo === "black") r(X + 2, H, 9, 1, L.cab);
    if (L.estilo === "careca") r(X + 4, H + 1, 2, 1, tom(L.pele, 1.2));
    if (L.estilo === "chanel") { r(X + 1, H - 1, 11, 3, L.cab); r(X + 1, H + 2, 2, 5, L.cab); r(X + 10, H + 2, 2, 5, L.cab); }
    if (L.estilo === "rabo") { r(X + 2, H - 1, 9, 3, L.cab); r(X + 11, H + 1, 2, 7, L.cab); }
    if (L.estilo === "bone") { r(X + 2, H - 1, 9, 3, L.corBone); r(X + (p.dir === "e" ? -1 : 7), H + 1, 5, 1, tom(L.corBone, .8)); }
    if (costas) { r(X + 2, H + 1, 9, 6, L.estilo === "careca" ? L.pele : L.cab); }
    else {
      const ox = p.dir === "e" ? -1 : p.dir === "d" ? 1 : 0;
      r(X + 4 + ox, H + 4, 1, 2, "#1d1a19"); r(X + 8 + ox, H + 4, 1, 2, "#1d1a19");
      if (L.oculos) { r(X + 3 + ox, H + 3, 3, 1, "#222"); r(X + 7 + ox, H + 3, 3, 1, "#222"); }
      if (L.barba) { r(X + 2, H + 6, 9, 3, L.cab); r(X + 5 + ox, H + 7, 3, 1, "#e9e2da"); }
      else r(X + 5 + ox, H + 7, 3, 1, L.batom ? "#c2475e" : "#9a4a3c");
      if (!L.barba) { r(X + 3, H + 6, 1, 1, "rgba(235,120,120,.5)"); r(X + 9, H + 6, 1, 1, "rgba(235,120,120,.5)"); }
    }
    if (L.fone) { r(X + 1, H - 1, 11, 1, "#222"); r(X, H + 3, 2, 3, "#222"); r(X + 11, H + 3, 2, 3, "#222"); }
    // aviso / fala
    if (p.fala) bolha(X + 6, H - 6, p.fala, p.id);
    else if (p.aviso && (p.est === "sentado" || p.est === "trabalhando")) { const c = { r: "#e0453a", a: "#e8a317", o: "#22a35a" }[p.aviso]; const b = Math.floor(perf / 400) % 2; r(X + 9, H - 9 - b, 7, 7, c); r(X + 12, H - 8 - b, 1, 3, "#fff"); r(X + 12, H - 4 - b, 1, 1, "#fff"); }
  }
  function desenhaCenario() {
    r(0, 0, 640, 416, "#1d2430");
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const X = x * T, Y = y * T, sd = salaDe[y][x];
      if (grid[y][x]) {
        const s = SALAS.find((a) => a.k === sd);
        if (s) { const [a, b] = s.piso; r(X, Y, T, T, (x + y) % 2 ? a : b); if (s.k === "diretoria" || s.k === "estoque") { r(X, Y + 7, T, 1, tom(a, .9)); r(X + ((y % 2) ? 4 : 11), Y, 1, 7, tom(a, .9)); r(X + ((y % 2) ? 11 : 4), Y + 8, 1, 8, tom(a, .9)); } }
        else { r(X, Y, T, T, (x + y) % 2 ? "#cfc6b8" : "#c8bfb0"); }
      } else {
        const frenteLivre = y + 1 < MH && grid[y + 1][x];
        if (frenteLivre) { r(X, Y, T, T, "#e9e1d4"); r(X, Y + T - 3, T, 3, "#8c7a66"); r(X, Y, T, 2, "#5b4c3e"); }
        else r(X, Y, T, T, "#4a3f36");
      }
    }
    // portas (batente)
    for (const s of SALAS) { const [px, py] = s.porta; r(px * T - 1, py * T, 1, T, "#3a2f27"); r(px * T + T, py * T, 1, T, "#3a2f27"); }
    r(ENTRADA[0] * T, ENTRADA[1] * T + 10, T, 6, "#7a5a3c");
    // janelas na parede de trás
    for (const x of [2, 7, 15, 24, 33, 37]) { const X = x * T, Y = 1 * T; const dia = !noite; r(X, Y + 2, 26, 11, "#f7f4ee"); r(X + 2, Y + 3, 22, 9, dia ? "#a9d3ec" : "#22304a"); r(X + 2, Y + 3, 22, 3, dia ? "#c8e4f3" : "#2c3c5a"); r(X + 12, Y + 3, 1, 9, "#f7f4ee"); if (!dia) r(X + 18, Y + 4, 2, 2, "#f6f0c8"); }
    // termômetro da meta (parede da Diretoria)
    { const X = 10 * T + 6, Y = T + 1; r(X, Y, 6, 14, "#fff"); r(X + 1, Y + 1, 4, 12, "#eee"); const h = Math.round(12 * Math.min(1, meta.pct)); r(X + 1, Y + 13 - h, 4, h, meta.pct >= 1 ? "#22a35a" : "#e0453a"); }
    // relógio no corredor
    { const X = 20 * T, Y = 10 * T + 2; r(X + 3, Y, 10, 10, "#fff"); r(X + 3, Y, 10, 1, "#555"); r(X + 3, Y + 9, 10, 1, "#555"); const ag = new Date(), hh = (ag.getHours() % 12) / 12, mm = ag.getMinutes() / 60; r(X + 7 + Math.round(Math.sin(hh * 6.283) * 2), Y + 4 - Math.round(Math.cos(hh * 6.283) * 2), 2, 2, "#222"); r(X + 7 + Math.round(Math.sin(mm * 6.283) * 3), Y + 4 - Math.round(Math.cos(mm * 6.283) * 3), 1, 1, "#c33"); }
    // mural no corredor
    { const X = 9 * T, Y = 10 * T + 1; r(X - 6, Y, 30, 13, "#b98a5e"); r(X - 5, Y + 1, 28, 11, "#e9d8bf"); r(X - 3, Y + 2, 7, 5, "#fff6a8"); r(X + 6, Y + 3, 7, 5, "#ffd3e0"); r(X + 15, Y + 2, 6, 5, "#cfe8ff"); }
    // LIVE na parede do estúdio
    { const X = 17 * T + 4, Y = 1 * T + 2; r(X, Y, 22, 8, "#2b2b30"); r(X + 2, Y + 2, 3, 3, liveLigada ? (Math.floor(perf / 300) % 2 ? "#ff3b3b" : "#a11") : "#552"); r(X + 7, Y + 3, 12, 2, liveLigada ? "#ff6b6b" : "#666"); }
    // "espaço pra crescer" na Beleza
    ctx.setLineDash([3, 3]); ctx.strokeStyle = "#d4a9b8"; ctx.lineWidth = 1; ctx.strokeRect(31 * T + .5, 5 * T + .5, 7 * T, 4 * T); ctx.setLineDash([]);
  }
  
  function desenhaBicho(g) {
    const c = g.cores, f = Math.floor(g.quadro) % 2, esq = g.dir === "e";
    if (g.tipo === "gato") {
      const X = Math.round(g.px) + 3, Y = Math.round(g.py) + 6;
      r(X, Y + 7, 10, 1, "rgba(0,0,0,.2)"); r(X + 1, Y + 2, 8, 4, c.corpo); r(X + 7, Y - 1, 4, 4, c.corpo); r(X + 7, Y - 2, 1, 1, c.corpo); r(X + 10, Y - 2, 1, 1, c.corpo); r(X + 8, Y, 1, 1, "#222"); r(X - 1, Y + 1 + f, 2, 1, c.corpo); r(X + 2, Y + 6, 1, 1 + f, c.sombra); r(X + 7, Y + 6, 1, 2 - f, c.sombra);
      if (g.fala) bolha(X + 5, Y - 4, g.fala, g.id);
      return;
    }
    // pug: corpo gordinho, cara achatada escura, orelhinhas, rabo enrolado
    const X = Math.round(g.px) + 2, Y = Math.round(g.py) + 5;
    const cab = esq ? X - 1 : X + 7, rabo = esq ? X + 11 : X - 1;
    r(X, Y + 9, 13, 1, "rgba(0,0,0,.22)");
    r(X + 1, Y + 2, 10, 6, c.corpo); r(X + 1, Y + 7, 10, 1, c.sombra);
    r(X + 2, Y + 8, 2, 1 + f, c.sombra); r(X + 8, Y + 8, 2, 2 - f, c.sombra);
    r(rabo, Y + 1, 2, 2, c.corpo); r(rabo + (esq ? 1 : 0), Y, 1, 1, c.sombra);
    r(cab, Y - 2, 7, 6, c.corpo);
    r(cab + (esq ? 0 : 2), Y + 1, 5, 3, c.cara);
    r(cab, Y - 3, 2, 2, c.orelha); r(cab + 5, Y - 3, 2, 2, c.orelha);
    r(cab + (esq ? 1 : 2), Y - 1, 1, 1, c.olho); r(cab + (esq ? 4 : 5), Y - 1, 1, 1, c.olho);
    r(cab + (esq ? 1 : 2), Y - 1, 1, 1, "#111"); r(cab + (esq ? 4 : 5), Y - 1, 1, 1, "#111");
    r(cab + 3, Y + 4, 1, 1, "#e07a8a");
    if (g.fala) bolha(cab + 3, Y - 4, g.fala, g.id);
  }
  function desenhaPresente(g) { const X = g.x * T + 2, Y = g.y * T + 2 - (Math.floor(perf / 300) % 2); r(X, Y + 4, 12, 9, "#e05a7a"); r(X, Y + 4, 12, 2, "#f29ab8"); r(X + 5, Y + 4, 2, 9, "#ffd25a"); r(X + 3, Y + 1, 3, 3, "#ffd25a"); r(X + 6, Y + 1, 3, 3, "#ffd25a"); }

  // ================= placas e falas (HTML, nítidas) =================
  const placas = new Map();
  for (const s of SALAS) {
    const d = document.createElement("button");
    d.type = "button";
    d.className = "sede-placa n";
    d.innerHTML = `<i></i>${s.nome}`;
    const [px, py] = s.porta;
    d.style.left = `${((px * T + 8) / LARG) * 100}%`;
    d.style.top = `${((s.y0 > 12 ? (py - 0.2) * T : (py + 0.5) * T) / ALT) * 100}%`;
    d.addEventListener("click", () => onSala?.(s.k));
    camada.appendChild(d);
    placas.set(s.k, d);
  }
  const falas = new Map();
  const larguras = new Map();
  function desenhaFalas() {
    const W = camada.clientWidth || LARG, s = W / LARG;
    const vivas = new Set();
    const postos = [];
    // de baixo pra cima: quem está mais embaixo fica no lugar, quem encosta sobe
    for (const b of [...bolhas].sort((a, c) => c.y - a.y)) {
      vivas.add(b.id);
      let el = falas.get(b.id);
      if (!el) { el = document.createElement("div"); el.className = "sede-fala"; camada.appendChild(el); falas.set(b.id, el); }
      if (el.textContent !== b.txt) { el.textContent = b.txt; larguras.delete(b.id); }
      let w = larguras.get(b.id);
      if (!w) { w = [el.offsetWidth, el.offsetHeight]; larguras.set(b.id, w); }
      const [lw, lh] = w;
      let X = Math.max(4, Math.min(W - lw - 4, b.x * s - lw / 2));
      let Y = b.y * s - lh - 6;
      for (let n = 0; n < 6; n++) {
        const bate = postos.find((u) => X < u.X + u.w + 4 && u.X < X + lw + 4 && Y < u.Y + u.h + 3 && u.Y < Y + lh + 3);
        if (!bate) break;
        Y = bate.Y - lh - 4;
      }
      Y = Math.max(2, Y);
      postos.push({ X, Y, w: lw, h: lh });
      el.style.transform = `translate(${Math.round(X)}px, ${Math.round(Y)}px)`;
    }
    for (const [id, el] of falas) if (!vivas.has(id)) { el.remove(); falas.delete(id); larguras.delete(id); }
  }

  // ================= laço principal =================
  function desenhar() {
    bolhas.length = 0;
    desenhaCenario();
    const vivos = PESSOAS.filter((p) => p.est !== "fora");
    const fila = [
      ...moveis.map((m) => ({ y: m.base, fn: () => m.desenha(m.x * T, m.y * T) })),
      ...vivos.map((p) => ({ y: p.py + (p.est === "sentado" ? 12 : 15), fn: () => desenhaPessoa(p) })),
      ...BICHOS.map((g) => ({ y: g.py + 14, fn: () => desenhaBicho(g) })),
      ...presentes.map((g) => ({ y: g.y * T + 15, fn: () => desenhaPresente(g) })),
    ];
    fila.sort((a, b) => a.y - b.y).forEach((f) => f.fn());
    if (adsOn) { const X = 3 * T + 26, Y = 22 * T - 4; r(X, Y, 5, 5, Math.floor(perf / 250) % 2 ? "#41d27a" : "#1a7a40"); }
    if (carimbo > 0) { const X = 24 * T + 6, Y = 5 * T - 10; r(X, Y, 22, 9, "#22a35a"); r(X + 3, Y + 3, 16, 3, "#bff0cf"); }
    if (sino > 0) { const X = 36 * T, Y = 20 * T - 18 - (Math.floor(perf / 120) % 2); r(X, Y, 6, 5, "#e8b923"); r(X + 2, Y + 5, 2, 1, "#a87a10"); }
    for (const c of confete) r(c.x, c.y, 2, 2, c.c);
    if (noite) { ctx.fillStyle = "rgba(12,18,40,.48)"; ctx.fillRect(0, 0, LARG, ALT); for (const [x, y] of [[6, 6], [24, 6], [8, 19], [21, 19], [32, 19], [20, 12]]) { const g = ctx.createRadialGradient(x * T, y * T, 2, x * T, y * T, 46); g.addColorStop(0, "rgba(255,220,150,.22)"); g.addColorStop(1, "rgba(255,220,150,0)"); ctx.fillStyle = g; ctx.fillRect(x * T - 46, y * T - 46, 92, 92); } }
    desenhaFalas();
  }
  let ultimo = 0, raf = 0, rodando = false, relogio = 0;
  function conferirHora() {
    const h = Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }).format(new Date())) % 24;
    const era = noite;
    noite = h >= 20 || h < 7;
    if (era !== noite) for (const p of PESSOAS) if (p !== TEO) p.t = Math.random() * 2;
  }
  function frame(t) {
    const dt = Math.min(0.05, ultimo ? (t - ultimo) / 1000 : 0);
    ultimo = t;
    perf = t;
    relogio -= dt;
    if (relogio <= 0) { conferirHora(); relogio = 30; }
    for (const p of PESSOAS) atualizar(p, dt);
    for (const g of BICHOS) atualizarBicho(g, dt);
    if (carimbo > 0) carimbo -= dt;
    if (sino > 0) sino -= dt;
    for (let i = confete.length - 1; i >= 0; i--) { const c = confete[i]; c.x += c.vx * dt; c.y += c.vy * dt; c.vy += 30 * dt; c.v -= dt; if (c.v <= 0) confete.splice(i, 1); }
    desenhar();
    if (rodando) raf = requestAnimationFrame(frame);
  }
  function soltarConfete(cx, cy, n = 60) { for (let i = 0; i < n; i++) confete.push({ x: cx, y: cy, vx: (Math.random() - 0.5) * 120, vy: -40 - Math.random() * 80, v: 1.5 + Math.random(), c: ["#e0453a", "#ffd25a", "#41d27a", "#4fb0e8", "#f29ab8"][i % 5] }); }
  const chamar = (d, alvo, txt) => { d.depois2 = null; ir(d, alvo, () => { d.est = "parado"; d.t = 4; falar(d, txt, 3, true); d.depois2 = () => ir(d, d.casa, () => { d.est = "sentado"; d.t = 10; }); }); };
  const pugsPraDiretoria = () => BICHOS.filter((g) => g.tipo === "pug").forEach((g, i) => { g.cam = caminho(tile(g), [5 + i * 2, 8]); g.t = 6; falar(g, "Au! Au!", 2, true); });

  // reações aos eventos do app (no app: realtime das tabelas)
  const EVENTOS = {
    produto(info) {
      const g = { x: 6, y: 7 };
      presentes.push(g);
      chamar(CEO1, [5, 7], `${info?.nome ? `${String(info.nome).slice(0, 22)}` : "Produto novo"}! 🎉`);
      chamar(CEO2, [7, 7], "Que lindo!");
      pugsPraDiretoria();
      setTimeout(() => { soltarConfete(6 * T + 8, 7 * T); presentes.splice(presentes.indexOf(g), 1); }, 4500);
    },
    pedidos(info) {
      sino = 3;
      ZE.depois2 = null; ZE.px = ENTRADA[0] * T; ZE.py = ENTRADA[1] * T; ZE.carrega = "#c9a37a";
      falar(ZE, info?.n ? `${info.n} pedidos chegaram!` : "Chegaram pedidos!", 3, true);
      ir(ZE, [30, 17], () => { falar(ZE, `📨 pra você, ${DUDA.nome}`, 2.5, true); ir(ZE, [8, 15], () => { falar(ZE, "📨 Comercial", 2.5, true); ZE.carrega = null; ir(ZE, ZE.casa, () => { ZE.est = "trabalhando"; ZE.t = 10; }); }); });
      pilha.n = Math.min(12, pilha.n + 4);
    },
    meta() { meta.pct = Math.max(1, meta.pct); soltarConfete(5 * T, 5 * T, 90); soltarConfete(9 * T, 5 * T, 90); falar(CEO1, "BATEMOS! 🎉", 4, true); falar(CEO2, "Uhuuu! 💕", 4, true); pugsPraDiretoria(); },
    ads(info) { adsOn = true; falar(LEO, info?.nome ? `Ads no ar: ${String(info.nome).slice(0, 20)} 📣` : "Ads no ar! 📣", 3, true); },
    live() { liveLigada = true; CEO2.depois2 = null; ir(CEO2, [16, 6], () => { CEO2.est = "live"; CEO2.t = 40; falar(CEO2, "Oi, gente! 💕", 4, true); }); },
    liveFim() { liveLigada = false; if (CEO2.est === "live") { CEO2.t = 0; falar(CEO2, "Obrigada, gente! 💕", 3, true); } },
    pago() { carimbo = 3; falar(BIA, "Pago! ✅", 2.5, true); },
  };

  // ================= controle =================
  function iniciar() { if (rodando || reduzir) return; rodando = true; ultimo = 0; raf = requestAnimationFrame(frame); }
  function parar() { rodando = false; cancelAnimationFrame(raf); }
  conferirHora();
  desenhar();
  iniciar();
  return {
    ativo(sim) { if (sim) iniciar(); else parar(); },
    dados({ luz = {}, porPessoa = {}, metaPct = 0, live = false, ads = false, producao = null }) {
      for (const [k, el] of placas) el.className = `sede-placa ${luz[k] || "n"}`;
      for (const p of PESSOAS) p.aviso = p.dono ? null : porPessoa[p.id] || null;
      meta.pct = metaPct || 0;
      if (live !== liveLigada) (live ? EVENTOS.live : EVENTOS.liveFim)();
      adsOn = !!ads;
      alertaProducao = producao;
      if (!rodando) desenhar();
    },
    evento(tipo, info) { EVENTOS[tipo]?.(info); if (!rodando) desenhar(); },
    quemEsta(x, y) {
      const g = BICHOS.find((q) => x > q.px && x < q.px + 16 && y > q.py && y < q.py + 16);
      if (g) return { id: g.id, nome: g.nome, funcao: g.funcao, bicho: true };
      const p = PESSOAS.find((q) => q.est !== "fora" && x > q.px && x < q.px + 16 && y > q.py - 12 && y < q.py + 16);
      if (p) return { id: p.id, nome: p.nome, funcao: p.funcao, sala: p.sala, est: p.est, aviso: p.aviso, dono: p.dono };
      const sd = salaDe[Math.floor(y / T)]?.[Math.floor(x / T)];
      return sd && SALAS.some((s) => s.k === sd) ? { sala: sd } : null;
    },
    destruir() { parar(); for (const el of placas.values()) el.remove(); for (const el of falas.values()) el.remove(); },
  };
}
