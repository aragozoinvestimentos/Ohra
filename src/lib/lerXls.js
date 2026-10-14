// Leitor de planilha .xls ANTIGA (BIFF8 dentro de um "Compound File") — o
// formato que a Olist exporta em "Pedidos de venda". Sem biblioteca: lê o
// contêiner (FAT/miniFAT/diretório), acha o stream "Workbook" e as células da
// 1ª aba (texto compartilhado, número, RK, MULRK, rótulo e fórmula).
// → array de linhas, cada linha = array de valores (string | number | null).

const u16 = (d, o) => d[o] | (d[o + 1] << 8);
const u32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
const FIM = 0xfffffffe;

function lerCfb(buf) {
  const d = new Uint8Array(buf);
  const assinatura = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (!assinatura.every((b, i) => d[i] === b)) throw new Error("não é uma planilha .xls (formato antigo do Excel)");
  const secTam = 1 << u16(d, 0x1e);
  const miniTam = 1 << u16(d, 0x20);
  const nFat = u32(d, 0x2c);
  const dirIni = u32(d, 0x30);
  const corte = u32(d, 0x38);
  const miniFatIni = u32(d, 0x3c);
  let difatIni = u32(d, 0x44);
  const setor = (n) => d.subarray((n + 1) * secTam, (n + 2) * secTam);
  // Setores da FAT (109 no cabeçalho + DIFAT encadeada)
  const fatSetores = [];
  for (let i = 0; i < 109 && fatSetores.length < nFat; i++) fatSetores.push(u32(d, 0x4c + i * 4));
  let guarda = 0;
  while (fatSetores.length < nFat && difatIni < FIM && guarda++ < 10000) {
    const s = setor(difatIni);
    for (let i = 0; i < secTam / 4 - 1 && fatSetores.length < nFat; i++) fatSetores.push(u32(s, i * 4));
    difatIni = u32(s, secTam - 4);
  }
  const fat = [];
  for (const fs of fatSetores) {
    const s = setor(fs);
    for (let i = 0; i < secTam / 4; i++) fat.push(u32(s, i * 4));
  }
  const cadeia = (ini, tabela) => {
    const out = [];
    const vistos = new Set();
    for (let n = ini; n < FIM && !vistos.has(n) && n < tabela.length; n = tabela[n]) {
      vistos.add(n);
      out.push(n);
    }
    return out;
  };
  const juntar = (setores, tam, ler) => {
    const out = new Uint8Array(setores.length * tam);
    setores.forEach((n, i) => out.set(ler(n), i * tam));
    return out;
  };
  const dir = juntar(cadeia(dirIni, fat), secTam, setor);
  const entradas = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nl = u16(dir, o + 0x40);
    let nome = "";
    for (let i = 0; i < nl / 2 - 1; i++) nome += String.fromCharCode(u16(dir, o + i * 2));
    entradas.push({ nome, tipo: dir[o + 0x42], ini: u32(dir, o + 0x74), tam: u32(dir, o + 0x78) });
  }
  const raiz = entradas.find((e) => e.tipo === 5);
  const miniStream = raiz ? juntar(cadeia(raiz.ini, fat), secTam, setor) : new Uint8Array(0);
  const miniFat = [];
  if (miniFatIni < FIM)
    for (const n of cadeia(miniFatIni, fat)) {
      const s = setor(n);
      for (let i = 0; i < secTam / 4; i++) miniFat.push(u32(s, i * 4));
    }
  const stream = (nome) => {
    const e = entradas.find((x) => x.tipo === 2 && x.nome.toLowerCase() === nome.toLowerCase());
    if (!e) return null;
    if (e.tam < corte) {
      const dados = juntar(cadeia(e.ini, miniFat), miniTam, (n) => miniStream.subarray(n * miniTam, (n + 1) * miniTam));
      return dados.subarray(0, e.tam);
    }
    return juntar(cadeia(e.ini, fat), secTam, setor).subarray(0, e.tam);
  };
  return { stream };
}

const decod = typeof TextDecoder !== "undefined" ? new TextDecoder("windows-1252") : null;
const latin = (bytes) => (decod ? decod.decode(bytes) : String.fromCharCode(...bytes));
const utf16 = (d, o, n) => {
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(u16(d, o + i * 2));
  return s;
};

function rk(v) {
  let x;
  if (v & 2) x = (v >> 2) | 0;
  else {
    const b = new DataView(new ArrayBuffer(8));
    b.setUint32(0, 0, true);
    b.setUint32(4, v & 0xfffffffc, true);
    x = b.getFloat64(0, true);
  }
  return v & 1 ? x / 100 : x;
}

// SST: strings podem atravessar registros CONTINUE (cada pedaço novo de
// caracteres começa com um byte de flag).
function lerSst(pedacos) {
  const out = [];
  let p = 0;
  let o = 8;
  let d = pedacos[0];
  const total = u32(d, 4);
  const garantir = () => {
    if (o >= d.length && p < pedacos.length - 1) {
      p++;
      d = pedacos[p];
      o = 0;
    }
  };
  const pular = (n) => {
    while (n > 0) {
      garantir();
      const k = Math.min(n, d.length - o);
      o += k;
      n -= k;
    }
  };
  for (let s = 0; s < total; s++) {
    garantir();
    if (!d || o + 3 > d.length) break;
    const cch = u16(d, o);
    let flags = d[o + 2];
    o += 3;
    let runs = 0;
    let ext = 0;
    if (flags & 8) {
      runs = u16(d, o);
      o += 2;
    }
    if (flags & 4) {
      ext = u32(d, o);
      o += 4;
    }
    let str = "";
    let falta = cch;
    while (falta > 0) {
      if (o >= d.length) {
        p++;
        d = pedacos[p];
        if (!d) break;
        o = 0;
        flags = d[o];
        o += 1;
      }
      const alto = flags & 1;
      const cabem = Math.min(falta, Math.floor((d.length - o) / (alto ? 2 : 1)));
      str += alto ? utf16(d, o, cabem) : latin(d.subarray(o, o + cabem));
      o += cabem * (alto ? 2 : 1);
      falta -= cabem;
    }
    pular(runs * 4 + ext);
    out.push(str);
  }
  return out;
}

function lerString(d, o) {
  const cch = u16(d, o);
  const alto = d[o + 2] & 1;
  return alto ? utf16(d, o + 3, cch) : latin(d.subarray(o + 3, o + 3 + cch));
}

/** Lê o .xls e devolve as linhas da 1ª aba. */
export function lerXls(buf) {
  const cfb = lerCfb(buf);
  const wb = cfb.stream("Workbook") || cfb.stream("Book");
  if (!wb) throw new Error("planilha sem o conteúdo esperado");
  const linhas = [];
  const pos = (r, c, v) => {
    if (!linhas[r]) linhas[r] = [];
    linhas[r][c] = v;
  };
  let sst = [];
  let sstPedacos = null;
  let bofs = 0;
  let pendenteString = null; // fórmula com resultado texto: vem no próximo STRING
  for (let o = 0; o + 4 <= wb.length; ) {
    const tipo = u16(wb, o);
    const tam = u16(wb, o + 2);
    const r = wb.subarray(o + 4, o + 4 + tam);
    o += 4 + tam;
    if (tipo === 0x003c && sstPedacos) {
      sstPedacos.push(r);
      continue;
    }
    if (sstPedacos) {
      sst = lerSst(sstPedacos);
      sstPedacos = null;
    }
    if (tipo === 0x0809) {
      bofs++;
      if (bofs > 2) break; // só a 1ª aba
      continue;
    }
    if (tipo === 0x00fc) sstPedacos = [r];
    else if (bofs < 2) continue;
    else if (tipo === 0x00fd) pos(u16(r, 0), u16(r, 2), sst[u32(r, 6)] ?? "");
    else if (tipo === 0x0203) pos(u16(r, 0), u16(r, 2), new DataView(r.buffer, r.byteOffset + 6, 8).getFloat64(0, true));
    else if (tipo === 0x027e) pos(u16(r, 0), u16(r, 2), rk(u32(r, 6)));
    else if (tipo === 0x00bd) {
      const row = u16(r, 0);
      const c0 = u16(r, 2);
      const n = (tam - 6) / 6;
      for (let i = 0; i < n; i++) pos(row, c0 + i, rk(u32(r, 4 + i * 6 + 2)));
    } else if (tipo === 0x0204) pos(u16(r, 0), u16(r, 2), lerString(r, 6));
    else if (tipo === 0x0006) {
      if (u16(r, 12) === 0xffff) {
        if (r[6] === 0) pendenteString = [u16(r, 0), u16(r, 2)];
      } else pos(u16(r, 0), u16(r, 2), new DataView(r.buffer, r.byteOffset + 6, 8).getFloat64(0, true));
    } else if (tipo === 0x0207 && pendenteString) {
      pos(pendenteString[0], pendenteString[1], lerString(r, 0));
      pendenteString = null;
    }
  }
  const out = [];
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i] || [];
    out.push(Array.from({ length: l.length }, (_, k) => (l[k] === undefined ? null : l[k])));
  }
  return out;
}
