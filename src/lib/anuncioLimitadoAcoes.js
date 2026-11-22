// Anúncio limitado pela plataforma — gravações SÓ aqui (preferencias_loja
// `anuncios:limitados`, sem SQL). Conta e textos em lib/anuncioLimitado.js.
import { gravarPreferencia, lerPreferencia } from "../hooks/usePreferencia.js";
import { hojeSP } from "./datas.js";

const CHAVE = "anuncios:limitados";
const ler = () => ({ ...(lerPreferencia(CHAVE) || {}) });

/** Marca (ou edita) o anúncio como limitado desde `desde`. */
export function marcarLimitado(chave, { desde, motivo = "outro", obs = "" }) {
  const c = ler();
  const nao = { ...(c._nao || {}) };
  delete nao[chave];
  c._nao = nao;
  c[chave] = { desde: desde || hojeSP(), motivo, obs: String(obs || "").trim(), em: hojeSP(), conferido: null, fim: null };
  return gravarPreferencia(CHAVE, c);
}

/** "Ainda está limitado" — volta a perguntar daqui a 7 dias. */
export function confirmarAindaLimitado(chave) {
  const c = ler();
  if (!c[chave]) return Promise.resolve({ ok: false, msg: "marcação não encontrada" });
  c[chave] = { ...c[chave], conferido: hojeSP() };
  return gravarPreferencia(CHAVE, c);
}

/** Voltou ao normal: guarda o fim (fica no histórico) e as decisões voltam. */
export function desmarcarLimitado(chave) {
  const c = ler();
  if (!c[chave]) return Promise.resolve({ ok: true });
  c[chave] = { ...c[chave], fim: hojeSP() };
  return gravarPreferencia(CHAVE, c);
}

/** "Não, é outra coisa" — não pergunta de novo por 14 dias. */
export function naoEhLimitado(chave, desde) {
  const c = ler();
  c._nao = { ...(c._nao || {}), [chave]: { em: hojeSP(), desde: desde || null } };
  return gravarPreferencia(CHAVE, c);
}
