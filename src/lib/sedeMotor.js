// Motor da "Sede da <loja>" — versão nova em perspectiva (27/10/2026, aprovada pela
// prévia vista B). Desenha a cena de sedeCena.js num <canvas> (Path2D), anima as
// pessoas (rotinas, caminho desviando dos móveis e das paredes), dia/noite pelo
// relógio, zoom ao clicar numa sala e reações aos eventos do app.
// SÓ MOSTRA: nada aqui grava dado. Placas, nomes e falas são HTML por cima do canvas.
//
// Desempenho (pedido do Gustavo, vale PC e celular): o cenário de cada sala é
// desenhado UMA vez numa camada guardada; a cada quadro só as pessoas se mexem
// (e o pedaço de móvel que fica na frente delas é redesenhado por cima).
// Quem usa: components/Sede.jsx (dados, eventos e painel).
import { SALAS_SEDE } from "./sede.js";
import { CENA, ORDEM_GRUPOS, P, desenharPessoa, desenharPug, montarCena, noChao, tom, visuais } from "./sedeCena.js";

export const TAMANHO_SEDE = { largura: CENA.largura, altura: CENA.altura };
const VEL = 2.3; // unidades do chão por segundo
const POSE_SENTADO = new Set(["sentado"]);

export function criarSede({ canvas, camada, personagens, salas = {}, partes = {}, reduzir = false, onSala, onConversa, onZoom }) {
  const ctx = canvas.getContext("2d");
  const FECHADAS = salas.fechadas || {};
  const nomeSala = (k) => salas.nomes?.[k] || SALAS_SEDE.find((s) => s.k === k)?.nome || k;
  const impressoras = partes.impressoras ?? 1;
  const revenda = !!partes.revenda;
  const LOOK = visuais(personagens.estilo);
  const LETRA = String(personagens.letra || "").slice(0, 1).toUpperCase();

  // ================= cena (refeita quando a luz dos monitores muda) =================
  let telas = {};
  let epoca = personagens.epoca || null;
  let cena = null;
  let grupos = {};
  const compilar = (paths) => paths.map((p) => ({ ...p, p2: new Path2D(p.d), dash: p.dash ? p.dash.split(" ").map(Number) : null }));
  function refazerCena() {
    cena = montarCena({ fechadas: FECHADAS, impressoras, revenda, telas, epoca });
    grupos = Object.fromEntries(ORDEM_GRUPOS.map((g) => [g, []]));
    for (const it of cena.itens) {
      it.c = compilar(it.paths);
      (grupos[it.g] ||= []).push(it);
    }
    for (const g of Object.keys(grupos)) grupos[g].sort((a, b) => a.z - b.z);
    sujo = true;
  }
  function pintar(c, lista) {
    for (const p of lista) {
      if (p.fill && p.fill !== "none") {
        c.fillStyle = p.fill;
        c.fill(p.p2);
      }
      if (p.stroke && p.stroke !== "none" && p.sw) {
        c.strokeStyle = p.stroke;
        c.lineWidth = p.sw;
        c.lineCap = "round";
        c.lineJoin = "round";
        if (p.dash) c.setLineDash(p.dash);
        c.stroke(p.p2);
        if (p.dash) c.setLineDash([]);
      }
    }
  }

  // ================= câmera e tamanho =================
  let dpr = Math.min(2, window.devicePixelRatio || 1);
  let cssW = canvas.clientWidth || 1000, cssH = (cssW * CENA.altura) / CENA.largura;
  const CHEIA = { x: 0, y: 0, w: CENA.largura, h: CENA.altura };
  let cam = { ...CHEIA }, alvoCam = null, deCam = null, tCam = 0;
  let zoomSala = null;
  let sujo = true;
  const camadas = {};
  function caixaDaSala(k) {
    const s = SALAS_SEDE.find((x) => x.k === k);
    const c = [P(s.x, s.y, CENA.H + 4), P(s.x + s.w, s.y, CENA.H + 4), P(s.x, s.y + s.h), P(s.x + s.w, s.y + s.h)];
    const xs = c.map((q) => q[0]), ys = c.map((q) => q[1]);
    let x = Math.min(...xs) - 16, y = Math.min(...ys) - 44, w = Math.max(...xs) - x + 16, h = Math.max(...ys) - y + 14;
    const asp = CENA.largura / CENA.altura;
    if (w / h > asp) { const nh = w / asp; y -= (nh - h) / 2; h = nh; } else { const nw = h * asp; x -= (nw - w) / 2; w = nw; }
    return { x, y, w, h };
  }
  function medir() {
    const W = canvas.clientWidth || cssW;
    if (!W) return;
    cssW = W;
    cssH = (W * CENA.altura) / CENA.largura;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
      sujo = true;
    }
    posicionarFixos();
  }
  const kCss = () => cssW / cam.w;
  const naTela = (sx, sy) => [(sx - cam.x) * kCss(), (sy - cam.y) * kCss()];
  function transformar(c) {
    const k = (canvas.width / cam.w);
    c.setTransform(k, 0, 0, k, -cam.x * k, -cam.y * k);
  }
  function refazerCamadas() {
    for (const g of ORDEM_GRUPOS) {
      let cv = camadas[g];
      if (!cv) cv = camadas[g] = document.createElement("canvas");
      cv.width = canvas.width;
      cv.height = canvas.height;
      const c = cv.getContext("2d");
      c.clearRect(0, 0, cv.width, cv.height);
      transformar(c);
      for (const it of grupos[g] || []) pintar(c, it.c);
      if (g !== "base" && FECHADAS[g]) escurecerSala(c, g);
    }
    sujo = false;
  }
  function escurecerSala(c, k) {
    const s = SALAS_SEDE.find((x) => x.k === k);
    const pts = [P(s.x, s.y, CENA.H), P(s.x + s.w, s.y, CENA.H), P(s.x + s.w, s.y), P(s.x + s.w, s.y + s.h), P(s.x, s.y + s.h), P(s.x, s.y)];
    c.fillStyle = "rgba(20,22,30,.6)";
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fill();
  }

  // ================= pessoas =================
  const sprites = new Map();
  function sprite(p, pose) {
    const chave = `${p.id}|${pose.sentado ? "s" : "e"}|${pose.passo || 0}|${pose.costas ? 1 : 0}|${pose.est}|${pose.carrega || ""}|${pose.xicara ? 1 : 0}|${pose.piscando ? 1 : 0}|${pose.apagado ? 1 : 0}`;
    let s = sprites.get(chave);
    if (!s) {
      const d = desenharPessoa(p.look, { ...pose, letra: !p.dono && LETRA });
      s = { c: compilar(d.paths), topo: d.topo, peito: d.peito };
      sprites.set(chave, s);
      if (sprites.size > 600) sprites.delete(sprites.keys().next().value);
    }
    return s;
  }
  const PESSOAS = [];
  const ids = ["ceo1", "ceo2", "consultor", "bia", "lia", "kai", "celia", "rafa", "nina", "leo", "teo", "ivo", "duda", "rui", "ze"];
  let lugares = {};
  refazerCena();
  lugares = cena.lugares;
  for (const id of ids) {
    const casa = lugares[id];
    if (!casa) continue;
    const p = {
      id, nome: personagens.nomes?.[id] || id, look: LOOK[id], casa, x: casa.x, y: casa.y,
      sala: { ceo1: "diretoria", ceo2: "diretoria", consultor: "gg", bia: "financeiro", lia: "financeiro", kai: "financeiro", celia: "comercial", rafa: "comercial", nina: "comercial", leo: "comercial", teo: "operacao", ivo: "operacao", duda: "operacao", rui: "operacao", ze: "recepcao" }[id],
      est: casa.s ? "sentado" : "trabalhando", cam: [], alvo: null, t: 2 + Math.random() * 8, passo: 0, fase: 0, costas: false,
      fala: null, falaT: 0, aviso: null, carrega: null, xicara: false, pisca: 2 + Math.random() * 4, piscando: 0,
      dono: id === "ceo1" || id === "ceo2",
    };
    if (personagens.ocultos?.has(id) || (id === "ivo" && !impressoras) || (FECHADAS[p.sala])) p.oculto = true;
    if (id === "rui" && !revenda) p.apagado = true;
    PESSOAS.push(p);
  }
  const porId = (id) => PESSOAS.find((p) => p.id === id);
  const CEO1 = porId("ceo1"), CEO2 = porId("ceo2"), CONS = porId("consultor"), ZE = porId("ze"), DUDA = porId("duda"), IVO = porId("ivo"), LEO = porId("leo"), BIA = porId("bia");
  const DONOS = [CEO1, CEO2].filter((d) => d && !d.oculto);

  const BICHOS = [];
  for (const [id, cor, pos] of [["bento", "#2b2726", [3.0, 8.9]], ["nick", "#e3c79c", [8.6, 9.6]], ["miau", "#f0a050", [12, 10]]]) {
    const nome = personagens.nomes?.[id];
    if (!nome || personagens.ocultos?.has(id)) continue;
    BICHOS.push({ id, nome, cor, funcao: { miau: "gato do escritório", bento: "pug preto", nick: "pug bege" }[id], x: pos[0], y: pos[1], cam: [], alvo: null, t: 2 + Math.random() * 5, passo: 0, fase: 0, fala: null, falaT: 0, bicho: true });
  }

  // ---------- caminho (BFS nas células, respeitando paredes e portas) ----------
  function caminho(ax, ay, bx, by) {
    const LX = CENA.LX;
    const k = (x, y) => y * LX + x;
    const ini = [Math.floor(ax), Math.floor(ay)], fim = [Math.floor(bx), Math.floor(by)];
    const veio = new Map([[k(...ini), null]]);
    const fila = [ini];
    const pode = (x0, y0, x1, y1) => (x1 === fim[0] && y1 === fim[1]) || cena.passa(x0, y0, x1, y1);
    while (fila.length) {
      const [x, y] = fila.shift();
      if (x === fim[0] && y === fim[1]) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (veio.has(k(nx, ny)) || nx < 0 || ny < 0 || nx >= LX || ny >= CENA.LY) continue;
        if (!pode(x, y, nx, ny)) continue;
        veio.set(k(nx, ny), [x, y]);
        fila.push([nx, ny]);
      }
    }
    if (!veio.has(k(...fim))) return null;
    const out = [];
    let c = fim;
    while (c && !(c[0] === ini[0] && c[1] === ini[1])) {
      out.unshift([c[0] + 0.5, c[1] + 0.5]);
      c = veio.get(k(c[0], c[1]));
    }
    return out;
  }
  function ir(p, alvo, depois) {
    if (p.oculto || !alvo) return;
    const c = caminho(p.x, p.y, alvo[0], alvo[1]);
    if (!c) { if (depois) depois(); return; }
    if (c.length) c[c.length - 1] = [alvo[0], alvo[1]];
    else c.push([alvo[0], alvo[1]]);
    p.cam = c;
    p.est = "andando";
    p.depois = depois;
  }
  const sorteio = (l) => l[Math.floor(Math.random() * l.length)];
  function pontoNaSala(k) {
    const s = SALAS_SEDE.find((x) => x.k === k);
    for (let i = 0; i < 60; i++) {
      const x = s.x + 0.5 + Math.floor(Math.random() * s.w), y = s.y + 1.5 + Math.floor(Math.random() * (s.h - 1));
      if (cena.livre(x, y)) return [x, y];
    }
    return null;
  }
  const naFrenteDe = (p) => {
    const m = cena.mesaDe[p.id];
    if (m) return [m.x + (p.casa.x - m.x), m.y + m.d + 0.7];
    return [p.casa.x + 0.8, p.casa.y + 0.8];
  };
  const falando = () => [...PESSOAS, ...BICHOS].filter((q) => q.fala).length;
  function falar(p, txt, s = 3, forcar = false) {
    if (!p || p.oculto || (!forcar && !p.fala && falando() >= 3)) return;
    p.fala = txt;
    p.falaT = s;
  }
  const voltar = (p) => ir(p, [p.casa.x, p.casa.y], () => { p.est = p.casa.s ? "sentado" : "trabalhando"; p.t = 8 + Math.random() * 14; p.xicara = false; p.carrega = null; });

  // ---------- rotinas (só visual; a agenda fixa do dia vem na etapa B) ----------
  let pilha = 3, liveLigada = false;
  function proximaTarefa(p) {
    const dado = Math.random();
    // quem ainda não começou (Rui sem revenda) fica na mesa dele
    if (p.apagado) { p.est = p.casa.s ? "sentado" : "trabalhando"; p.t = 30; return; }
    const copa = () => ir(p, sorteio(cena.pontos.copa), () => { p.est = "parado"; p.t = 5 + Math.random() * 4; p.xicara = true; if (Math.random() < 0.4) falar(p, "☕", 2); p.depois2 = () => voltar(p); });
    if (p.dono) {
      if (p === CEO2 && liveLigada && !FECHADAS.live) { ir(p, cena.pontos.live, () => { p.est = "live"; p.t = 30; falar(p, "Oi, gente! 💕", 4, true); }); return; }
      if (dado < 0.18) { const s = sorteio(["comercial", "operacao", "financeiro", "recepcao"].filter((k) => !FECHADAS[k])); ir(p, pontoNaSala(s), () => { p.est = "parado"; p.t = 4; falar(p, sorteio(["Como estão as coisas?", "Bora!", "Ficou ótimo", "Me mostra isso?"]), 3); p.depois2 = () => voltar(p); }); return; }
      if (dado < 0.28) { copa(); return; }
      p.est = "sentado";
      p.t = 10 + Math.random() * 14;
      return;
    }
    if (p === CONS) {
      p.carrega = "papel";
      if (pendentes > 0 && dado < 0.35) { ir(p, naFrenteDe(sorteio(DONOS) || CEO1), () => { p.est = "parado"; p.t = 5; falar(p, pendentes === 1 ? "Tenho uma proposta 📋" : `Tenho ${pendentes} propostas 📋`, 3.5, true); p.depois2 = () => voltar(p); }); return; }
      if (dado < 0.6) {
        const alvos = SALAS_SEDE.filter((s) => !FECHADAS[s.k] && (cheias[s.k] || luz[s.k] === "r" || luz[s.k] === "a")).map((s) => s.k);
        const sala = sorteio(alvos.length ? alvos : ["comercial", "operacao", "financeiro"]);
        ir(p, pontoNaSala(sala), () => { p.est = "parado"; p.t = 4 + Math.random() * 4; if (Math.random() < 0.35) falar(p, cheias[sala] ? "Esse setor tá lotado… 📝" : "Hmm, anotando 📝", 2.5); p.depois2 = () => voltar(p); });
        return;
      }
      p.carrega = null;
      p.est = "sentado";
      p.t = 10 + Math.random() * 10;
      return;
    }
    if (p === IVO) { ir(p, sorteio(cena.pontos.impressoras), () => { p.est = "trabalhando"; p.t = 5 + Math.random() * 6; if (p.aviso && Math.random() < 0.4) falar(p, "🔧 manutenção!", 2.5); }); return; }
    if (p === DUDA) {
      if (dado < 0.5) { ir(p, cena.pontos.estoque, () => { p.carrega = "#c8955c"; p.est = "parado"; p.t = 1; p.depois2 = () => ir(p, cena.pontos.expedicao, () => { p.carrega = null; p.est = "trabalhando"; p.t = 5; }); }); return; }
      // leva caixa pro pallet da coleta (vai empilhando; o carteiro esvazia)
      ir(p, cena.pontos.expedicao, () => { p.carrega = "#c8955c"; p.est = "parado"; p.t = 1; p.depois2 = () => ir(p, cena.pontos.pallet, () => { p.carrega = null; pilha = pilha >= 8 ? 2 : pilha + 1; p.est = "parado"; p.t = 2; p.depois2 = () => voltar(p); }); });
      return;
    }
    if (p === ZE) {
      if (dado < 0.25) { ir(p, cena.pontos.correio, () => { p.est = "parado"; p.t = 3; if (p.aviso) falar(p, "📬 tem arquivo novo!", 2.5); p.depois2 = () => voltar(p); }); return; }
      p.est = "sentado";
      p.t = 8 + Math.random() * 10;
      return;
    }
    if (p.aviso && dado < 0.28 && DONOS.length) {
      const dono = sorteio(DONOS);
      p.carrega = "papel";
      ir(p, naFrenteDe(dono), () => { p.est = "parado"; p.t = 3.5; falar(p, p.aviso === "o" ? "Oportunidade!" : p.aviso === "r" ? "Urgente!" : "Precisa decidir", 3); setTimeout(() => falar(dono, "Deixa comigo", 2.5), 1400); p.depois2 = () => voltar(p); });
      return;
    }
    if (dado < 0.3) { copa(); return; }
    p.est = p.casa.s ? "sentado" : "trabalhando";
    p.t = 8 + Math.random() * 14;
  }
  function mover(p, dt, vel = VEL) {
    if (!p.cam.length) return false;
    const [tx, ty] = p.cam[0];
    const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy), passo = vel * dt;
    p.costas = dx + dy < -0.01;
    if (d <= passo) { p.x = tx; p.y = ty; p.cam.shift(); } else { p.x += (dx / d) * passo; p.y += (dy / d) * passo; }
    p.fase += dt * 7;
    p.passo = 1 + (Math.floor(p.fase) % 2);
    return true;
  }
  function atualizar(p, dt) {
    if (p.oculto) return;
    if (p.falaT > 0) { p.falaT -= dt; if (p.falaT <= 0) p.fala = null; }
    p.pisca -= dt;
    if (p.pisca <= 0) { p.piscando = 0.14; p.pisca = 2.5 + Math.random() * 4; }
    if (p.piscando > 0) p.piscando -= dt;
    if (p.est === "andando") {
      if (!mover(p, dt)) { p.passo = 0; p.costas = false; p.est = "parado"; const f = p.depois; p.depois = null; if (f) f(); }
      return;
    }
    p.t -= dt;
    if (p.t <= 0) { if (p.depois2) { const f = p.depois2; p.depois2 = null; f(); } else proximaTarefa(p); }
  }
  function atualizarBicho(g, dt) {
    if (g.falaT > 0) { g.falaT -= dt; if (g.falaT <= 0) g.fala = null; }
    g.t -= dt;
    if (!g.cam.length && g.t <= 0) {
      const d = Math.random();
      let alvo;
      if (d < 0.45 && DONOS.length) { const dono = sorteio(DONOS); alvo = [dono.x + (Math.random() < 0.5 ? 1.2 : -1.2), dono.y + 2.6]; if (!cena.livre(...alvo)) alvo = pontoNaSala("diretoria"); }
      else if (d < 0.75) alvo = cena.pontos.caminhaPug;
      else alvo = pontoNaSala(sorteio(["diretoria", "diretoria", "comercial"]));
      const c = alvo && caminho(g.x, g.y, alvo[0], alvo[1]);
      g.cam = c || [];
      g.t = 4 + Math.random() * 7;
      if (Math.random() < 0.1) falar(g, g.id === "miau" ? "Miau" : "Au!", 1.5);
    }
    if (mover(g, dt, 1.9)) g.fase += dt * 3;
    else g.passo = 0;
  }
  // conversa entre setores: quem cuida do assunto vai até quem precisa saber
  let conversas = [], tempoConversa = 25;
  function iniciarConversa() {
    const ok = conversas.filter((c) => { const a = porId(c.de), b = porId(c.para); return a && b && a !== b && !a.oculto && !b.oculto && a.est !== "andando" && a.est !== "live" && b.est !== "live"; });
    if (!ok.length) return;
    const c = sorteio(ok);
    const Aq = porId(c.de), B = porId(c.para);
    Aq.depois2 = null;
    Aq.carrega = "papel";
    ir(Aq, naFrenteDe(B), () => {
      Aq.est = "parado";
      Aq.t = 7;
      falar(Aq, c.fala, 3.5, true);
      setTimeout(() => falar(B, c.resposta, 3.5, true), 1900);
      onConversa?.(c);
      Aq.depois2 = () => voltar(Aq);
    });
  }

  // ================= HTML por cima (placas, nomes, falas, quadros) =================
  const el = (cls, html = "", tag = "div") => { const e = document.createElement(tag); e.className = cls; if (html) e.innerHTML = html; camada.appendChild(e); return e; };
  const fixos = [];
  const placaEl = {};
  for (const pl of cena.placas) {
    const fechada = !!FECHADAS[pl.k];
    const b = el(`sede-placa2${fechada ? " fechada" : ""}`, "", "button");
    b.type = "button";
    const nome = nomeSala(pl.k);
    b.innerHTML = fechada ? `🔒 ${nome} <b>· em breve</b>` : `<i></i>${pl.curto ? SALAS_SEDE.find((s) => s.k === pl.k)?.curto || nome : nome}`;
    b.addEventListener("click", (e) => { e.stopPropagation(); zoom(pl.k); onSala?.(pl.k); });
    fixos.push({ e: b, pt: pl.pt, skew: pl.eixo === "y" ? 26.57 : -26.57, max: 1.25, min: 0.85 });
    placaEl[pl.k] = b;
  }
  // recorde de faturamento: na própria placa da Diretoria, numa linha embaixo do nome
  const recordeEl = document.createElement("small");
  recordeEl.className = "sede-recorde";
  placaEl.diretoria?.appendChild(recordeEl);
  const logoEl = el("sede-logo", `<span>${LETRA || "•"}</span><b></b>`);
  logoEl.querySelector("b").textContent = personagens.nomeLoja || "";
  if (personagens.logoUrl) { const img = document.createElement("img"); img.src = personagens.logoUrl; img.alt = ""; logoEl.querySelector("span").replaceWith(img); }
  fixos.push({ e: logoEl, pt: cena.decor.logo.pt, skew: -26.57, max: 9 });
  const tvEl = el("sede-quadro-txt sede-tv");
  fixos.push({ e: tvEl, pt: cena.decor.tv.pt, skew: 26.57, max: 9 });
  const destaqueEl = el("sede-quadro-txt sede-destaque", "DESTAQUE DA SEMANA");
  fixos.push({ e: destaqueEl, pt: cena.decor.destaque.pt, skew: -26.57, max: 9 });
  const aoVivoEl = el("sede-aovivo", "● AO VIVO");
  fixos.push({ e: aoVivoEl, pt: cena.decor.aoVivo.pt, skew: 26.57, max: 9 });
  for (const v of cena.decor.vagas) fixos.push({ e: el("sede-vaga", "vaga"), pt: v, skew: 0, max: 9 });
  const entradaEl = el("sede-entrada", "ENTRADA ▲");
  fixos.push({ e: entradaEl, pt: P(57, 34.2), skew: 0, max: 1.2 });
  function posicionarFixos() {
    const k = kCss();
    for (const f of fixos) {
      const [x, y] = naTela(f.pt[0], f.pt[1]);
      const fora = x < -200 || y < -100 || x > cssW + 200 || y > cssH + 100;
      f.e.style.display = fora ? "none" : "";
      if (fora) continue;
      f.e.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%) scale(${Math.max(f.min || 0, Math.min(k, f.max)).toFixed(3)})${f.skew ? ` skewY(${f.skew}deg)` : ""}`;
    }
  }
  // nomes (crachás), plaquinhas de mesa e falas
  const nomesEl = new Map(), mesasEl = new Map(), falasEl = new Map(), letrasEl = new Map();
  let hover = null;
  function crachas() {
    const k = kCss();
    const ks = Math.max(0.85, Math.min(k * 1.15, 1.35));
    for (const p of [...PESSOAS, ...BICHOS]) {
      const zoomAqui = zoomSala && (p.bicho ? zoomSala === "diretoria" : p.sala === zoomSala || cena.salaEm(p.x, p.y) === zoomSala);
      const mostra = !p.oculto && !p.bicho && (zoomAqui || (p.aviso && !zoomSala) || hover === p);
      let e = nomesEl.get(p.id);
      if (!mostra) { if (e) e.style.display = "none"; } else {
        if (!e) { e = el("sede-cracha"); nomesEl.set(p.id, e); }
        const estr = p.estrelas != null ? ` ★${p.estrelas}` : "";
        const txt = `${p.nome}${estr}`;
        if (e.textContent !== txt) e.textContent = txt;
        e.className = `sede-cracha ${p.aviso || "n"}${p.apagado ? " apagado" : ""}`;
        const [X, Y0] = P(p.x, p.y);
        const top = Y0 + (p.est === "sentado" ? -10 : 0) - 48;
        const [x, y] = naTela(X, top);
        e.style.display = "";
        e.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%) scale(${ks.toFixed(3)})`;
      }
      // plaquinha da mesa e a letra da loja na camisa: só com o zoom na sala
      const m = !p.bicho && cena.mesaDe[p.id];
      let pm = mesasEl.get(p.id);
      if (zoomAqui && m && !p.oculto) {
        if (!pm) { pm = el("sede-plaquinha"); mesasEl.set(p.id, pm); }
        const txt = `${p.nome} · ${FUNCAO[p.id] || ""}`;
        if (pm.textContent !== txt) pm.textContent = txt;
        const [x, y] = naTela(...P(Math.max(m.x + 0.6, p.casa.x - 0.9), m.y + m.d - 0.05, 20));
        pm.style.display = "";
        pm.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%) scale(${Math.min(k * 0.75, 1.2).toFixed(3)})`;
      } else if (pm) pm.style.display = "none";
      let le = letrasEl.get(p.id);
      if (zoomAqui && LETRA && !p.bicho && !p.dono && !p.oculto && !p.apagado && !p.costas) {
        if (!le) { le = el("sede-letra", LETRA); letrasEl.set(p.id, le); }
        const [X, Y0] = P(p.x, p.y);
        const [x, y] = naTela(X - 3.6, Y0 + (p.est === "sentado" ? -10 : 0) - 22.5);
        le.style.display = "";
        le.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%) scale(${k.toFixed(3)})`;
      } else if (le) le.style.display = "none";
    }
  }
  const larguras = new Map();
  function falas() {
    const vivas = new Set();
    const postos = [];
    const bolhas = [...PESSOAS, ...BICHOS].filter((q) => q.fala && !q.oculto).map((q) => {
      const [X, Y0] = P(q.x, q.y);
      const top = q.bicho ? Y0 - 16 : Y0 + (q.est === "sentado" ? -10 : 0) - 54;
      return { id: q.id, txt: q.fala, x: X, y: top };
    });
    for (const b of bolhas.sort((a, c) => c.y - a.y)) {
      vivas.add(b.id);
      let e = falasEl.get(b.id);
      if (!e) { e = el("sede-fala"); falasEl.set(b.id, e); }
      if (e.textContent !== b.txt) { e.textContent = b.txt; larguras.delete(b.id); }
      let w = larguras.get(b.id);
      if (!w) { w = [e.offsetWidth, e.offsetHeight]; larguras.set(b.id, w); }
      const [lw, lh] = w;
      const [sx, sy] = naTela(b.x, b.y);
      let X = Math.max(4, Math.min(cssW - lw - 4, sx - lw / 2));
      let Y = sy - lh - 4;
      for (let n = 0; n < 6; n++) {
        const bate = postos.find((u) => X < u.X + u.w + 4 && u.X < X + lw + 4 && Y < u.Y + u.h + 3 && u.Y < Y + lh + 3);
        if (!bate) break;
        Y = bate.Y - lh - 4;
      }
      Y = Math.max(2, Y);
      postos.push({ X, Y, w: lw, h: lh });
      e.style.transform = `translate(${Math.round(X)}px, ${Math.round(Y)}px)`;
    }
    for (const [id, e] of falasEl) if (!vivas.has(id)) { e.remove(); falasEl.delete(id); larguras.delete(id); }
  }

  // ================= desenho =================
  let perf = 0, noite = false;
  const confete = [];
  const presentes = [];
  const caixaPessoa = (p) => {
    const [X, Y0] = P(p.x, p.y);
    return [X - 13, Y0 - 62, X + 13, Y0 + 8];
  };
  function desenharPessoaEm(c, p) {
    const sentado = POSE_SENTADO.has(p.est) && p.casa.s && Math.hypot(p.x - p.casa.x, p.y - p.casa.y) < 0.05;
    const pose = { sentado, passo: p.est === "andando" ? p.passo : 0, costas: p.est === "andando" && p.costas, est: p.dono ? "ok" : p.aviso || "ok", carrega: p.carrega, xicara: p.xicara, piscando: p.piscando > 0, apagado: p.apagado };
    const s = sprite(p, pose);
    const [X, Y0] = P(p.x, p.y);
    c.save();
    c.translate(X, Y0);
    pintar(c, s.c);
    c.restore();
  }
  const zPessoa = (p) => p.x + p.y + (POSE_SENTADO.has(p.est) ? 0.9 : 0.6);
  function desenharGrupo(c, g, comCamada) {
    if (comCamada) {
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.drawImage(camadas[g], 0, 0);
      c.restore();
    } else {
      for (const it of grupos[g] || []) pintar(c, it.c);
      if (g !== "base" && FECHADAS[g]) escurecerSala(c, g);
    }
    if (g === "recepcao") desenharPallet(c);
    const vivos = [...PESSOAS.filter((p) => !p.oculto), ...BICHOS].filter((p) => grupoDe(p) === g).sort((a, b) => zPessoa(a) - zPessoa(b));
    for (const p of vivos) {
      if (p.bicho) {
        const [X, Y0] = P(p.x, p.y);
        c.save();
        c.translate(X, Y0);
        if (p.cam.length && p.cam[0][0] - p.x + (p.cam[0][1] - p.y) < 0) c.scale(-1, 1);
        pintar(c, compilarPug(p.cor, p.cam.length ? Math.floor(p.fase) % 2 : 0));
        c.restore();
      } else desenharPessoaEm(c, p);
      // o que fica na frente (mesa, mureta) é redesenhado por cima
      const zb = zPessoa(p), bx = caixaPessoa(p);
      for (const it of grupos[g] || []) {
        if (it.z < -100 || !(it.bx[0] < bx[2] && it.bx[2] > bx[0] && it.bx[1] < bx[3] && it.bx[3] > bx[1])) continue;
        // na frente = a pegada do móvel começa mais pra frente (x ou y maior) que a pessoa
        const frente = it.pe ? it.pe[0] >= p.x - 0.05 || it.pe[1] >= p.y - 0.05 : it.z > zb;
        if (frente) pintar(c, it.c);
      }
    }
  }
  const pugs = new Map();
  const compilarPug = (cor, passo) => {
    const k = `${cor}|${passo}`;
    if (!pugs.has(k)) pugs.set(k, compilar(desenharPug(cor, passo).paths));
    return pugs.get(k);
  };
  const grupoDe = (p) => {
    const s = cena.salaEm(p.x, p.y);
    return s && s !== "corredor" ? s : p.y < 11.95 ? (SALAS_SEDE.find((r) => p.x >= r.x && p.x <= r.x + r.w && r.y < 12)?.k || "corredor") : "corredor";
  };
  function desenharPallet(c) {
    const { x, y } = cena.decor.pallet;
    const pos = [[0.1, 0.1, 1.6], [0.95, 0.1, 1.6], [0.1, 0.8, 1.6], [0.95, 0.8, 1.6], [0.15, 0.15, 8.6], [0.95, 0.15, 8.6], [0.15, 0.85, 8.6], [0.5, 0.45, 15.6]];
    for (let i = 0; i < Math.min(pilha, pos.length); i++) {
      const [dx, dy, e] = pos[i];
      const key = `cx|${i}`;
      if (!pugs.has(key)) {
        const bx = x + dx, by = y + dy;
        const it = { paths: [] };
        const pts = (l) => "M " + l.map((q) => q.join(" ")).join(" L ") + " Z";
        it.paths.push({ d: pts([P(bx, by + 0.6, e), P(bx + 0.8, by + 0.6, e), P(bx + 0.8, by + 0.6, e + 7), P(bx, by + 0.6, e + 7)]), fill: tom("#c8955c", 0.84), stroke: "rgba(0,0,0,.22)", sw: 1 });
        it.paths.push({ d: pts([P(bx + 0.8, by, e), P(bx + 0.8, by + 0.6, e), P(bx + 0.8, by + 0.6, e + 7), P(bx + 0.8, by, e + 7)]), fill: tom("#c8955c", 0.68), stroke: "rgba(0,0,0,.22)", sw: 1 });
        it.paths.push({ d: pts([P(bx, by, e + 7), P(bx + 0.8, by, e + 7), P(bx + 0.8, by + 0.6, e + 7), P(bx, by + 0.6, e + 7)]), fill: "#c8955c", stroke: "rgba(0,0,0,.22)", sw: 1 });
        pugs.set(key, compilar(it.paths));
      }
      pintar(c, pugs.get(key));
    }
  }
  function desenhar() {
    if (!cena) return;
    const animando = !!alvoCam;
    if (!animando && sujo) refazerCamadas();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#1d2433";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    transformar(ctx);
    for (const g of ORDEM_GRUPOS) desenharGrupo(ctx, g, !animando && !sujo);
    for (const g of presentes) desenharPresente(g);
    for (const cf of confete) { ctx.fillStyle = cf.c; ctx.fillRect(cf.x, cf.y, 3, 3); }
    if (noite) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "rgba(12,18,40,.32)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    posicionarFixos();
    crachas();
    falas();
  }
  function desenharPresente(g) {
    const [X, Y] = P(g.x, g.y);
    const b = Math.floor(perf / 300) % 2;
    ctx.fillStyle = "#e05a7a";
    ctx.fillRect(X - 7, Y - 14 - b, 14, 11);
    ctx.fillStyle = "#ffd25a";
    ctx.fillRect(X - 1.5, Y - 14 - b, 3, 11);
    ctx.fillRect(X - 7, Y - 10 - b, 14, 2.5);
  }
  let ultimo = 0, raf = 0, rodando = false, relogio = 0;
  function conferirHora() {
    const h = Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }).format(new Date())) % 24;
    noite = h >= 20 || h < 6;
  }
  function frame(t) {
    const dt = Math.min(0.05, ultimo ? (t - ultimo) / 1000 : 0);
    ultimo = t;
    perf = t;
    relogio -= dt;
    if (relogio <= 0) { conferirHora(); relogio = 30; }
    if (alvoCam) {
      tCam = Math.min(1, tCam + dt / 0.45);
      const e = tCam < 0.5 ? 2 * tCam * tCam : 1 - Math.pow(-2 * tCam + 2, 2) / 2;
      for (const k of ["x", "y", "w", "h"]) cam[k] = deCam[k] + (alvoCam[k] - deCam[k]) * e;
      if (tCam >= 1) { cam = { ...alvoCam }; alvoCam = null; sujo = true; }
    }
    for (const p of PESSOAS) atualizar(p, dt);
    for (const g of BICHOS) atualizarBicho(g, dt);
    tempoConversa -= dt;
    if (tempoConversa <= 0) { tempoConversa = 35 + Math.random() * 30; iniciarConversa(); }
    for (let i = confete.length - 1; i >= 0; i--) { const c = confete[i]; c.x += c.vx * dt; c.y += c.vy * dt; c.vy += 40 * dt; c.v -= dt; if (c.v <= 0) confete.splice(i, 1); }
    desenhar();
    if (rodando) raf = requestAnimationFrame(frame);
  }
  function soltarConfete([cx, cy], n = 70) {
    for (let i = 0; i < n; i++) confete.push({ x: cx, y: cy, vx: (Math.random() - 0.5) * 160, vy: -60 - Math.random() * 110, v: 1.6 + Math.random(), c: ["#e0453a", "#ffd25a", "#41d27a", "#4fb0e8", "#f29ab8"][i % 5] });
  }
  const chamar = (d, alvo, txt) => { if (!d || d.oculto) return; d.depois2 = null; ir(d, alvo, () => { d.est = "parado"; d.t = 4; falar(d, txt, 3, true); d.depois2 = () => voltar(d); }); };
  const pugsPraDiretoria = () => BICHOS.filter((g) => g.id !== "miau").forEach((g, i) => { g.cam = caminho(g.x, g.y, 5 + i * 2, 9.8) || []; g.t = 6; falar(g, "Au! Au!", 2, true); });

  // reações aos eventos do app (no app: realtime das tabelas)
  const EVENTOS = {
    salaAberta(info) {
      const s = SALAS_SEDE.find((x) => x.k === info?.k);
      if (!s) return;
      chamar(CEO1, [s.x + s.w / 2 - 1, 14], `${nomeSala(s.k)} inaugurada! 🎉`);
      chamar(CEO2, [s.x + s.w / 2 + 1, 14], "Que orgulho!");
      pugsPraDiretoria();
      setTimeout(() => soltarConfete(P(s.x + s.w / 2, 14, 30)), 2500);
    },
    produto(info) {
      const g = { x: 6.6, y: 9.4 };
      presentes.push(g);
      chamar(CEO1, [5.6, 9.6], `${info?.nome ? String(info.nome).slice(0, 22) : "Produto novo"}! 🎉`);
      chamar(CEO2, [7.6, 9.6], "Que lindo!");
      pugsPraDiretoria();
      setTimeout(() => { soltarConfete(P(6.6, 9.4, 20)); presentes.splice(presentes.indexOf(g), 1); }, 4500);
    },
    pedidos(info) {
      if (!ZE || ZE.oculto) return;
      ZE.depois2 = null;
      ZE.carrega = "papel";
      falar(ZE, info?.n ? `${info.n} pedidos chegaram!` : "Chegaram pedidos!", 3, true);
      // Zé entrega só no setor que usa o arquivo (pedidos: Comercial, Financeiro e Operação)
      ir(ZE, cena.pontos.correio, () => ir(ZE, naFrenteDe(porId("celia") || ZE), () => { falar(ZE, "📨 Comercial", 2.5, true); ir(ZE, naFrenteDe(BIA || ZE), () => { falar(ZE, "📨 Financeiro", 2.5, true); ir(ZE, cena.pontos.expedicao, () => { falar(ZE, `📨 pra você, ${DUDA?.nome || "Duda"}`, 2.5, true); ZE.carrega = null; voltar(ZE); }); }); }));
    },
    meta() { soltarConfete(P(5, 6, 30), 90); soltarConfete(P(9, 6, 30), 90); falar(CEO1, "BATEMOS! 🎉", 4, true); falar(CEO2, "Uhuuu! 💕", 4, true); pugsPraDiretoria(); },
    ads(info) { falar(LEO, info?.nome ? `Ads no ar: ${String(info.nome).slice(0, 20)} 📣` : "Ads no ar! 📣", 3, true); },
    live() { liveLigada = true; aoVivoEl.classList.add("on"); if (CEO2 && !FECHADAS.live) { CEO2.depois2 = null; ir(CEO2, cena.pontos.live, () => { CEO2.est = "live"; CEO2.t = 40; falar(CEO2, "Oi, gente! 💕", 4, true); }); } },
    liveFim() { liveLigada = false; aoVivoEl.classList.remove("on"); if (CEO2?.est === "live") { CEO2.t = 0; falar(CEO2, "Obrigada, gente! 💕", 3, true); } },
    pago() { falar(BIA, "Pago! ✅", 2.5, true); },
  };
  const FUNCAO = { ceo1: "CEO", ceo2: "CEO", consultor: "Gerente Geral", bia: "Gerente financeira", lia: "Analista Shopee", kai: "Analista TikTok", celia: "Gerente comercial", rafa: "Preços", nina: "Anúncios e Rampa", leo: "Ads", teo: "Gerente de operação", ivo: "Técnico de impressão", duda: "Expedição e estoque", rui: "Analista de revenda", ze: "Estagiário" };

  // ================= zoom =================
  function zoom(k) {
    const alvo = k ? caixaDaSala(k) : { ...CHEIA };
    zoomSala = k || null;
    deCam = { ...cam };
    alvoCam = alvo;
    tCam = 0;
    camada.classList.toggle("com-zoom", !!k);
    onZoom?.(zoomSala);
    if (!rodando) { cam = { ...alvo }; alvoCam = null; sujo = true; desenhar(); }
  }
  // hover: mostra o nome de quem está embaixo do mouse
  function emCima(fx, fy) {
    const sx = cam.x + fx * cam.w, sy = cam.y + fy * cam.h;
    for (const g of BICHOS) { const [X, Y0] = P(g.x, g.y); if (Math.abs(sx - X) < 9 && sy > Y0 - 14 && sy < Y0 + 3) return g; }
    const lista = PESSOAS.filter((p) => !p.oculto).sort((a, b) => zPessoa(b) - zPessoa(a));
    for (const p of lista) { const b = caixaPessoa(p); if (sx > b[0] + 3 && sx < b[2] - 3 && sy > b[1] + 6 && sy < b[3] - 4) return p; }
    return null;
  }
  const onMove = (e) => {
    const r = canvas.getBoundingClientRect();
    const q = emCima((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    hover = q && !q.bicho ? q : null;
    canvas.style.cursor = q ? "pointer" : "";
  };
  canvas.addEventListener("mousemove", onMove);
  // celular: pinça fechando = voltar pra Sede inteira
  let pinca = 0;
  const onTouch = (e) => {
    if (e.touches.length !== 2) { pinca = 0; return; }
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    if (!pinca) pinca = d;
    else if (zoomSala && d < pinca * 0.7) { pinca = 0; zoom(null); }
  };
  canvas.addEventListener("touchmove", onTouch, { passive: true });
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { medir(); if (!rodando) desenhar(); }) : null;
  ro?.observe(canvas);

  // ================= controle =================
  let luz = {}, cheias = {}, pendentes = 0;
  function iniciar() { if (rodando || reduzir) return; rodando = true; ultimo = 0; raf = requestAnimationFrame(frame); }
  function parar() { rodando = false; cancelAnimationFrame(raf); }
  conferirHora();
  medir();
  desenhar();
  iniciar();
  return {
    ativo(sim) { if (sim) iniciar(); else parar(); },
    dados({ luz: l = {}, porPessoa = {}, live = false, pendentes: pend = 0, cheiasNovas = {}, conversasNovas = [], recorde = null, epoca: ep = null }) {
      luz = l;
      cheias = cheiasNovas;
      conversas = conversasNovas;
      pendentes = pend;
      for (const [k, b] of Object.entries(placaEl)) {
        if (FECHADAS[k]) continue;
        b.className = `sede-placa2 ${luz[k] || "n"}${cheias[k] ? " cheia" : ""}`;
      }
      const novasTelas = {};
      for (const p of PESSOAS) {
        p.aviso = p.dono || p === CONS ? null : porPessoa[p.id] || null;
        novasTelas[p.id] = p.aviso || "ok";
      }
      if (JSON.stringify(novasTelas) !== JSON.stringify(telas) || ep !== epoca) { telas = novasTelas; epoca = ep; refazerCena(); }
      recordeEl.innerHTML = recorde?.valor ? `Recorde ${recorde.valor} · ${recorde.mes}<br>este mês: ${recorde.pct}` : "Recorde: no 1º mês fechado";
      tvEl.innerHTML = "Reunião do Bom dia às 9h<br><small>agenda da equipe — em breve</small>";
      if (live !== liveLigada) (live ? EVENTOS.live : EVENTOS.liveFim)();
      if (!rodando) desenhar();
    },
    evento(tipo, info) { EVENTOS[tipo]?.(info); if (!rodando) desenhar(); },
    zoom,
    sala: () => zoomSala,
    /** (fx, fy) = posição do clique em fração do canvas (0–1). */
    quemEsta(fx, fy) {
      const q = emCima(fx, fy);
      if (q?.bicho) return { id: q.id, nome: q.nome, funcao: q.funcao, bicho: true };
      if (q) return { id: q.id, nome: q.nome, funcao: FUNCAO[q.id], sala: q.sala, est: q.est, aviso: q.aviso, dono: q.dono, consultor: q === CONS, apagado: q.apagado };
      const sx = cam.x + fx * cam.w, sy = cam.y + fy * cam.h;
      const [x, y] = noChao(sx, sy);
      const s = cena.salaEm(x, y);
      return s && s !== "corredor" ? { sala: s } : null;
    },
    destruir() {
      parar();
      ro?.disconnect();
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("touchmove", onTouch);
      camada.innerHTML = "";
    },
  };
}
