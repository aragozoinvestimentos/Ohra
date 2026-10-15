import { useState } from "react";

// Cartão "O que fazer agora" + "O que o app está olhando" (Rampa de preço,
// produto e anúncio com vários itens). Os dados vêm de lib/rampaAgora.js;
// `onAcao(chave)` é decidido pela tela (subir, voltar, abrir uma aba…).
const SINAL_IC = { ok: "✓", ruim: "!", atencao: "!", espera: "…" };

export function AgoraRampa({ acao, proxima, onAcao, extra }) {
  const [feitos, setFeitos] = useState({});
  if (!acao) return null;
  return (
    <div className={`agora-rampa agora-${acao.tipo}`}>
      <div className="agora-rot">{acao.rotulo}</div>
      <div className="agora-titulo">{acao.titulo}</div>
      {acao.porque && <div className="agora-porque">{acao.porque}</div>}
      {acao.passos?.length > 0 && (
        <ol className="agora-passos">
          {acao.passos.map((p, i) => (
            <li key={i} className={feitos[i] ? "feito" : ""}>
              <input type="checkbox" checked={!!feitos[i]} onChange={(e) => setFeitos((f) => ({ ...f, [i]: e.target.checked }))} aria-label={p.texto} />
              <div>
                <b>
                  {i + 1}. {p.texto}
                </b>
                {p.dica && <small>{p.dica}</small>}
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="agora-acoes">
        {acao.acao && acao.botao && (
          <button type="button" className={`btn btn-mini ${acao.tipo === "oportunidade" ? "btn-verde" : "primary"}`} onClick={() => onAcao?.(acao.acao)}>
            {acao.botao}
          </button>
        )}
        {extra}
        {proxima && <span className={`agora-prox${proxima.atrasada ? " atrasada" : ""}`}>Próxima conferência: {proxima.texto}</span>}
      </div>
      {acao.depois && <div className="agora-depois">{acao.depois}</div>}
    </div>
  );
}

export function OlhandoRampa({ sinais }) {
  if (!sinais?.length) return null;
  return (
    <div className="olhando-rampa">
      <div className="olhando-tit">O que o app está olhando</div>
      <div className="olhando-grade">
        {sinais.map((s) => (
          <div key={s.chave} className={`sinal-rampa sinal-${s.estado}`}>
            <div className="sinal-t">
              <span className="sinal-ic">{SINAL_IC[s.estado]}</span>
              {s.titulo}
            </div>
            <div className="sinal-d">{s.texto}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Marca de notificação pequena (mesmas cores do menu): r = resolver, a = atenção, o = oportunidade.
export function MarcaAba({ tipo, children = "!" }) {
  if (!tipo) return null;
  const c = { resolver: "r", atencao: "a", oportunidade: "o" }[tipo];
  return c ? <span className={`marca marca-${c} marca-aba`}>{c === "o" && children === "!" ? "↑" : children}</span> : null;
}
