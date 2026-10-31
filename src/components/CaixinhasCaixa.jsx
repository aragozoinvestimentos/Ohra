import { useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { BRL } from "../lib/format.js";
import { recarregarReserva } from "../hooks/useReservaProducao.js";
import { useCaixinhas } from "../hooks/useCaixinhas.js";
import { CAIXINHAS, NOME_CAIXINHA, jaDistribuiu } from "../lib/caixinhas.js";
import EditarDialog from "./EditarDialog.jsx";
import Ajuda from "./Ajuda.jsx";

// Caixinhas do Dinheiro (01/11/2026, schema v72) — conta em lib/caixinhas.js.
// Separações virtuais do caixa da loja: o saldo não muda, só ganha destino.
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const nomeMes = (m) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
const num = (v) => (Number.isFinite(Number(String(v).replace(",", "."))) ? Number(String(v).replace(",", ".")) : 0);
const SQL = "Falta rodar o supabase/schema_v72.sql no Supabase pra usar as caixinhas.";

export default function CaixinhasCaixa({ registros = [], disponivel, caixa, lancamentos = [], hoje, onToast }) {
  const { lojaId } = useLoja();
  const { mes, sug, divisao, pref, setPref, saldos, total } = useCaixinhas({ registros, lancamentos, caixa, hoje });
  const [dist, setDist] = useState(null); // { mes, linhas editáveis }
  const [usar, setUsar] = useState(null); // { caixinha, valor, descricao }
  const [verPct, setVerPct] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const feito = jaDistribuiu(registros, mes);

  const livre = Math.round((caixa - total) * 100) / 100;

  async function gravar(linhas, extra) {
    if (!supabase) return false;
    setSalvando(true);
    const r = await supabase.from("reserva_producao").insert(linhas.map((l) => ({ loja_id: lojaId || null, data: hoje, ...extra, ...l })));
    setSalvando(false);
    if (r.error) {
      onToast?.(/caixinha|origem/.test(r.error.message) ? SQL : `Não foi possível salvar: ${r.error.message}`);
      return false;
    }
    recarregarReserva();
    return true;
  }

  async function confirmarDist() {
    const linhas = dist.linhas
      .filter((l) => num(l.valor) > 0)
      .map((l) => ({ caixinha: l.caixinha, tipo: l.liberar ? "usar" : "separar", valor: Math.round(num(l.valor) * 100) / 100, mes: dist.mes, origem: "distribuir", descricao: `Distribuição de ${nomeMes(dist.mes)}${l.liberar ? " (giro acima do alvo — liberado)" : ""}` }));
    if (!linhas.length) return setDist(null);
    if (await gravar(linhas, {})) {
      onToast?.(`Distribuição de ${nomeMes(dist.mes)} feita`);
      setDist(null);
    }
  }

  async function confirmarUsar() {
    const v = num(usar.valor);
    if (!(v > 0)) return onToast?.("Digite o valor");
    if (await gravar([{ caixinha: usar.caixinha, tipo: usar.tipo, valor: Math.round(v * 100) / 100, mes: hoje.slice(0, 7), descricao: usar.descricao.trim() || (usar.tipo === "usar" ? "usado" : "separado à mão") }], {})) {
      onToast?.(usar.tipo === "usar" ? `Tirado de ${NOME_CAIXINHA[usar.caixinha]}` : `Separado em ${NOME_CAIXINHA[usar.caixinha]}`);
      setUsar(null);
    }
  }

  if (!disponivel) return null;

  return (
    <div className="panel caixinhas">
      <h3>
        Caixinhas <Ajuda texto="Separações virtuais do dinheiro da loja: o saldo não muda, só ganha destino. Giro, Impostos e Equipamentos são calculados (saem do dinheiro que não é lucro: custo das peças e imposto). Só o “Sobrou pra você” do mês é dividido em Pró-labore, Reserva e Reinvestimento." />
      </h3>
      <div className="caixinhas-topo">
        <span>
          Caixa da loja <b>{BRL(caixa)}</b> · nas caixinhas <b>{BRL(total)}</b> · <span className={livre < 0 ? "neg" : ""}>livre <b>{BRL(livre)}</b></span>
        </span>
        {livre < -0.009 && <span className="st st-atencao">⚠ as caixinhas passaram do dinheiro que existe — tire de alguma</span>}
        <span className="caixinhas-acoes">
          {!feito ? (
            <button className="btn primary btn-mini" onClick={() => setDist({ mes, linhas: sug.linhas.map((l) => ({ ...l, valor: String(l.valor.toFixed(2)) })) })}>
              Distribuir {nomeMes(mes)}
            </button>
          ) : (
            <span className="hint">✓ {nomeMes(mes)} distribuído</span>
          )}
          <button className="link-btn" onClick={() => setVerPct((v) => !v)}>
            {verPct ? "fechar divisão" : "mudar a divisão"}
          </button>
        </span>
      </div>
      {verPct && (
        <div className="caixinhas-pct">
          {[
            ["prolabore", "Pró-labore"],
            ["reserva", "Reserva de emergência"],
            ["reinvestimento", "Reinvestimento"],
          ].map(([k, rot]) => (
            <label key={k}>
              {rot}{" "}
              <input type="number" min="0" max="100" step="1" style={{ width: 64 }} value={Math.round(divisao[k] * 100)} onChange={(e) => setPref({ ...(pref || {}), [k]: Math.max(0, Number(e.target.value) || 0) / 100 })} />%
            </label>
          ))}
          <label>
            Meta da reserva{" "}
            <input type="number" min="1" max="12" step="1" style={{ width: 56 }} value={divisao.reservaMeses} onChange={(e) => setPref({ ...(pref || {}), reservaMeses: Math.max(1, Number(e.target.value) || 3) })} /> meses de contas fixas
          </label>
          {!divisao.somaOk && <span className="st st-atencao">⚠ a soma está em {Math.round(divisao.soma * 100)}% (o certo é 100%)</span>}
        </div>
      )}
      <div className="caixinhas-grade">
        {CAIXINHAS.map((c) => (
          <div key={c.chave} className="caixinha">
            <div className="caixinha-nome">
              {c.nome} <Ajuda texto={c.ajuda} />
              {!c.calc && <span className="hint"> {Math.round(divisao[c.chave] * 100)}%</span>}
            </div>
            <div className={`caixinha-valor${saldos[c.chave] < 0 ? " neg" : ""}`}>{BRL(saldos[c.chave])}</div>
            <div className="caixinha-botoes">
              <button className="link-btn" onClick={() => setUsar({ caixinha: c.chave, tipo: "usar", valor: "", descricao: "" })}>
                usar
              </button>
              <button className="link-btn" onClick={() => setUsar({ caixinha: c.chave, tipo: "separar", valor: "", descricao: "" })}>
                + separar
              </button>
            </div>
          </div>
        ))}
      </div>

      {dist && (
        <EditarDialog titulo={`Distribuir ${nomeMes(dist.mes)}`} salvando={salvando} onSalvar={confirmarDist} onCancelar={() => setDist(null)} salvarLabel="Confirmar a distribuição" classe="modal-box-md">
          <p className="hint">
            Livre no caixa agora: <b>{BRL(sug.livreAntes)}</b>.{" "}
            {sug.sobrou > 0 ? (
              <>
                Sobrou pra você em {nomeMes(dist.mes)}: <b>{BRL(sug.sobrou)}</b>.
              </>
            ) : sug.faltou > 0 ? (
              <>
                {nomeMes(dist.mes)} fechou faltando <b>{BRL(sug.faltou)}</b> — não há o que dividir em Pró-labore/Reserva/Reinvestimento.
              </>
            ) : null}{" "}
            Os valores são editáveis. Nada sai do caixa.
          </p>
          {sug.limitado && <p className="st st-atencao">⚠ O dinheiro livre não cobre tudo: as primeiras caixinhas (Impostos, Giro, Equipamentos) vêm antes.</p>}
          {dist.linhas.length === 0 ? (
            <p className="hint">Nada pra separar neste mês.</p>
          ) : (
            <table className="tabela-mini">
              <tbody>
                {dist.linhas.map((l, i) => (
                  <tr key={l.caixinha + i}>
                    <td>
                      <b>{NOME_CAIXINHA[l.caixinha]}</b>
                      {l.liberar && <span className="hint"> · liberar</span>}
                      <div className="hint">{l.conta}</div>
                    </td>
                    <td style={{ width: 120 }}>
                      <input type="text" inputMode="decimal" value={l.valor} onChange={(e) => setDist((d) => ({ ...d, linhas: d.linhas.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)) }))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </EditarDialog>
      )}

      {usar && (
        <EditarDialog titulo={`${usar.tipo === "usar" ? "Usar de" : "Separar em"} ${NOME_CAIXINHA[usar.caixinha]}`} salvando={salvando} onSalvar={confirmarUsar} onCancelar={() => setUsar(null)} salvarLabel={usar.tipo === "usar" ? "Tirar da caixinha" : "Separar"}>
          <p className="hint">
            Saldo: {BRL(saldos[usar.caixinha])}. {usar.tipo === "usar" ? "Se o dinheiro saiu de verdade, lance também a saída no Caixa (ou use “Sai de uma caixinha?” na própria saída)." : `Livre no caixa: ${BRL(livre)}.`}
          </p>
          <div className="grid-auto">
            <label>
              Valor (R$)
              <input type="text" inputMode="decimal" value={usar.valor} onChange={(e) => setUsar((u) => ({ ...u, valor: e.target.value }))} autoFocus />
            </label>
            <label>
              Pra quê
              <input type="text" value={usar.descricao} onChange={(e) => setUsar((u) => ({ ...u, descricao: e.target.value }))} placeholder="ex.: filamento, Ads, salário" />
            </label>
          </div>
        </EditarDialog>
      )}
    </div>
  );
}
