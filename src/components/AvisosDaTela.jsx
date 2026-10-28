import { useSyncExternalStore } from "react";
import { useLoja } from "../lib/LojaContext.jsx";
import { assinarSede, lerSede } from "../lib/sedeDados.js";
import { chaveDoDestino } from "../lib/marcas.js";
import { adiarAviso } from "../lib/avisosAcoes.js";
import { hojeSP } from "../lib/datas.js";
import Estado from "./Estado.jsx";

// "Avisos desta tela" (28/10/2026, pedido do Gustavo: a bolinha do menu marcava 3 e,
// entrando na tela, não dava pra saber o quê). São os MESMOS avisos do Início que
// geram a bolinha (sedeDados = o que o Início publica); cada um com "ver" (o que a
// tela faz com o pedido do aviso) e "lembrar em 30 dias" (urgente não some).
const ESTADO = { resolver: "resolver", rotina: "atencao", oportunidade: "oportunidade" };

export default function AvisosDaTela({ chaves, onVer, onToast }) {
  const { lojaId } = useLoja();
  const sede = useSyncExternalStore(assinarSede, lerSede, lerSede);
  const lista = (sede.pendencias || []).filter((p) => chaves.includes(chaveDoDestino(p.ir)));
  if (!lista.length) return null;
  async function adiar(p) {
    const { error } = await adiarAviso(lojaId, p.id, hojeSP());
    onToast?.(error ? `Não foi possível adiar: ${error.message}` : `Ok — “${p.titulo}” volta em 30 dias (se ainda valer)`);
  }
  return (
    <div className="panel avisos-tela">
      <h3>
        Avisos desta tela <span className="h3-contagem">{lista.length} — os mesmos da bolinha do menu e do Início</span>
      </h3>
      <ul>
        {lista.map((p) => (
          <li key={p.id}>
            <Estado tipo={ESTADO[p.grupo] || "atencao"}>{p.grupo === "resolver" ? "resolver" : p.grupo === "oportunidade" ? "oportunidade" : "atenção"}</Estado>
            <b>{p.titulo}</b>
            {p.texto && <span className="avisos-tela-txt"> {p.texto}</span>}
            {onVer && (
              <button type="button" className="link-btn" onClick={() => onVer(p)}>
                ver
              </button>
            )}
            {p.grupo !== "resolver" && (
              <button type="button" className="link-btn" onClick={() => adiar(p)} title="Some daqui, do Início e da bolinha do menu por 30 dias e volta sozinho se ainda valer.">
                lembrar em 30 dias
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
