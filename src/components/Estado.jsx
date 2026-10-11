import { DESC_ESTADO, ESTADOS, ICONE_ESTADO, ROTULO_ESTADO } from "../lib/estados.js";

// Etiqueta de estado (regra única de cores — lib/estados.js). Sempre com
// ícone ou palavra: se o texto já começa com um símbolo (✓ ↻ ↑ ⚠ ! …), não
// repete o ícone padrão.
const COMECA_COM_SIMBOLO = /^[^\wÀ-ú(]/;

export default function Estado({ tipo = "info", icone, children, title, className = "", discreto = false }) {
  const txt = typeof children === "string" ? children : null;
  const ic = icone === undefined ? (txt && COMECA_COM_SIMBOLO.test(txt) ? null : ICONE_ESTADO[tipo]) : icone;
  return (
    <span className={`st st-${tipo}${discreto ? " st-discreto" : ""}${className ? ` ${className}` : ""}`} title={title}>
      {ic && <span className="st-ic" aria-hidden="true">{ic}</span>}
      {children}
    </span>
  );
}

// Bolinha de saúde à esquerda da linha (vermelha/âmbar/terracota; nada se ok).
export function PontoSaude({ estado }) {
  if (!estado) return <i className="ponto-saude vazio" aria-hidden="true" />;
  return <i className={`ponto-saude st-${estado.tipo}`} title={`${ROTULO_ESTADO[estado.tipo]}: ${estado.motivo}`} aria-label={`${ROTULO_ESTADO[estado.tipo]}: ${estado.motivo}`} role="img" />;
}

// Legenda única (mesmo texto em todas as telas — "?" do topo).
export function LegendaEstados() {
  return (
    <div className="legenda-estados">
      <b>Cores do app</b>
      {ESTADOS.map((t) => (
        <div key={t}>
          <Estado tipo={t}>{ROTULO_ESTADO[t]}</Estado> <span>{DESC_ESTADO[t]}</span>
        </div>
      ))}
      <div className="legenda-estados-ok">Sem cor = está ok. A bolinha à esquerda da linha mostra o estado mais grave dela.</div>
    </div>
  );
}
