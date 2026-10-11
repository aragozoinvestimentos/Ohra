import { useSemanaPendente } from "../hooks/useSemanaPendente.js";
import CanalTag from "./CanalTag.jsx";

const diaMes = (iso) => String(iso || "").slice(0, 10).split("-").reverse().slice(0, 2).join("/");

// Faixa "Semana pendente" no topo do Crescimento — o mesmo estado do Início e
// da bolinha do menu (lib/semanaPendente.js + tabela lembretes).
export default function SemanaPendenteFaixa({ onRegistrar }) {
  const { pendentes, adiados, adiar } = useSemanaPendente();
  if (!pendentes.length && !adiados.length) return null;
  if (!pendentes.length)
    return (
      <div className="semana-pend semana-pend-quieta">
        {adiados.length} {adiados.length === 1 ? "item adiado" : "itens adiados"} no registro da semana — volta{adiados.length === 1 ? "" : "m"} em{" "}
        {[...new Set(adiados.map((x) => diaMes(x.lembrete.adiado_ate)))].join(", ")}.
      </div>
    );
  return (
    <div className="alerta alerta-warn semana-pend">
      <div className="semana-pend-cab">
        <b>Semana pendente · {pendentes.length} {pendentes.length === 1 ? "item" : "itens"} sem registro há mais de 7 dias</b>
        <button type="button" className="btn btn-mini primary" onClick={onRegistrar}>
          Registrar agora
        </button>
      </div>
      <ul className="semana-pend-lista">
        {pendentes.map((x) => (
          <li key={x.chave}>
            <span>
              <b>{x.nome}</b> <CanalTag canal={x.canal} /> <span className="muted-cel">{x.tipo === "rampa" ? "em rampa" : "afiliado"} · sem registro desde {diaMes(x.ultimo)} ({x.dias} dias)</span>
            </span>
            <span className="semana-pend-acoes">
              <button type="button" className="link-btn" onClick={() => adiar(x.chave, "pular")} title="Some até a semana que vem. Nada é gravado: o período fica em aberto e entra no próximo registro.">
                não registrar esta semana
              </button>
              <button type="button" className="link-btn" onClick={() => adiar(x.chave, "amanha")}>
                lembrar amanhã
              </button>
            </span>
          </li>
        ))}
      </ul>
      {adiados.length > 0 && <div className="muted-cel">+ {adiados.length} adiado{adiados.length === 1 ? "" : "s"}</div>}
    </div>
  );
}
