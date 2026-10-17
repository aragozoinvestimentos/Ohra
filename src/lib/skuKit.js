// SKU sugerido do kit (17/10/2026, combinado com o Gustavo): "KIT-" + o SKU
// de cada peça na ordem do kit, quantidade na frente quando > 1
// (Leão LEAO + Letreiro ELEVIVE → KIT-LEAO-ELEVIVE; 2 Tigelas → KIT-2TIGELA-…).
// Só letras, números e traço (marketplaces e Olist trocam/recusam o resto) e
// no máximo SKU_KIT_MAX caracteres — passou, cada parte é encurtada por igual.
// "KIT-" na frente evita a venda do kit cair numa peça pela regra de prefixo da
// importação (ligarSku: o SKU cadastrado mais longo + "-").
export const SKU_KIT_MAX = 20;

export const limparSku = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");

// partes: [{ sku, nome, quantidade }] na ordem do kit; existentes: SKUs já usados (pra não repetir).
export function skuDoKit(partes, existentes = []) {
  const ps = (partes || [])
    .map((p) => ({ cod: limparSku(p.sku) || limparSku(String(p.nome || "").split(/\s+/)[0]), q: Math.max(1, Math.round(Number(p.quantidade) || 1)) }))
    .filter((p) => p.cod);
  if (!ps.length) return "";
  const montar = (corte) => `KIT-${ps.map((p) => `${p.q > 1 ? p.q : ""}${corte ? p.cod.slice(0, corte) : p.cod}`).join("-")}`;
  let sku = montar(0);
  if (sku.length > SKU_KIT_MAX) {
    const espaco = SKU_KIT_MAX - 4 - (ps.length - 1) - ps.reduce((t, p) => t + (p.q > 1 ? String(p.q).length : 0), 0);
    sku = montar(Math.max(2, Math.floor(espaco / ps.length))).slice(0, SKU_KIT_MAX).replace(/-+$/, "");
  }
  const usados = new Set((existentes || []).map((s) => String(s || "").trim().toUpperCase()).filter(Boolean));
  if (!usados.has(sku)) return sku;
  for (let n = 2; n < 100; n++) {
    const sufixo = `-${n}`;
    const c = sku.slice(0, SKU_KIT_MAX - sufixo.length).replace(/-+$/, "") + sufixo;
    if (!usados.has(c)) return c;
  }
  return sku;
}

// Aviso pro SKU digitado: longo demais ou com caractere fora de letra/número/traço.
export function avisoSkuKit(sku) {
  const s = String(sku || "").trim();
  if (!s) return null;
  if (/[^A-Za-z0-9-]/.test(s)) return "use só letras, números e traço — espaço, acento e símbolos (+ / _ .) dão problema em alguns marketplaces";
  if (s.length > SKU_KIT_MAX) return `${s.length} caracteres — prefira até ${SKU_KIT_MAX} (cabe em todas as plataformas)`;
  return null;
}
