// Extrai o texto (com a posição) de um PDF de DANFE usando o pdf.js — carregado só
// quando você escolhe um PDF (não pesa no resto do app). A leitura da nota em si
// é pura, em danfe.js (interpretarDanfe).
import { interpretarDanfe } from "./danfe.js";

export async function paginasDoPdf(dados) {
  const pdfjs = await import("pdfjs-dist/build/pdf.min.mjs");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: dados }).promise;
  const paginas = [];
  for (let n = 1; n <= Math.min(doc.numPages, 20); n++) {
    const pg = await doc.getPage(n);
    const vp = pg.getViewport({ scale: 1 });
    const tc = await pg.getTextContent();
    const itens = [];
    for (const it of tc.items) {
      const t = String(it.str || "");
      if (!t.trim()) continue;
      const h = Math.abs(it.height || it.transform[3] || 6);
      itens.push({ t, x: it.transform[4], y: vp.height - it.transform[5] - h, w: it.width || t.length * h * 0.5, h });
    }
    paginas.push({ itens });
  }
  return paginas;
}

/** File (PDF) → nota no formato do lerNfe (+ origem "pdf" e avisos) ou { erro }. */
export async function lerDanfePdf(arquivo) {
  try {
    return interpretarDanfe(await paginasDoPdf(new Uint8Array(await arquivo.arrayBuffer())));
  } catch (e) {
    return { erro: `Não consegui abrir este PDF (${e.message}). Tente o XML da nota.` };
  }
}
