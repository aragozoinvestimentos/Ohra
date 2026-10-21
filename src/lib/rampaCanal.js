// Rampa POR CANAL (19/10/2026, decisão do Gustavo): o TikTok passou a ser o
// canal da live — produto cadastrado no preço pela margem, desconto só por
// cupom (na live e fora dela). A rampa nesse canal fica DESLIGADA por padrão,
// mas nada é apagado: a opção fica em Configuração → Canais (coluna "Rampa")
// e religar volta tudo como era. Guardado em lojas.config_escada.rampaCanais
// = { canal_id: true|false } (sem SQL); sem escolha = padrão pelo tipo.
export const RAMPA_DESLIGADA_PADRAO = new Set(["tiktok"]);

export function rampaNoCanal(canal, cfgLoja) {
  if (!canal) return true;
  const m = cfgLoja?.rampaCanais || {};
  if (Object.prototype.hasOwnProperty.call(m, canal.id)) return m[canal.id] !== false;
  return !RAMPA_DESLIGADA_PADRAO.has(canal.tipo);
}

// Ids dos canais com a rampa desligada (pra filtrar rampas).
export function canaisSemRampa(canais, cfgLoja) {
  return new Set((canais || []).filter((c) => !rampaNoCanal(c, cfgLoja)).map((c) => c.id));
}
