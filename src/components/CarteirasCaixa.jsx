import { useState } from "react";
import { BRL } from "../lib/format.js";
import { registrarTransferencia } from "../lib/carteirasAcoes.js";
import Ajuda from "./Ajuda.jsx";
import CanalTag from "./CanalTag.jsx";
import EditarDialog from "./EditarDialog.jsx";
import { irParaAba } from "../lib/navegar.js";

const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

// Dinheiro → 1 · Caixa: carteiras (schema v67, aprovado pela prévia de
// 26/10/2026). Abas Geral + uma por carteira (o que vem embaixo — KPIs,
// projeção, lançamentos — segue a aba), 4 números da loja e um cartão por
// carteira. Contas em lib/carteiras.js; só mostra.
export default function CarteirasCaixa({ resumo, sel, onSel, extratoDisponivel, onTransferir }) {
  if (!resumo || resumo.carteiras.length < 2) return null;
  const k = [
    { label: "Total da loja", valor: resumo.total, sub: "todas as carteiras", forte: true },
    { label: "Liberado", valor: resumo.liberado, sub: "na conta da loja + liberado nas plataformas — dá pra usar/sacar" },
    { label: "A liberar", valor: resumo.aLiberar, sub: "entregue; a plataforma ainda segura alguns dias" },
    { label: "A caminho", valor: resumo.aCaminho, sub: "pago, ainda não entregue — fora do saldo" },
  ];
  return (
    <div className="carteiras-caixa">
      <div className="subabas subabas-compacta carteiras-abas">
        <button type="button" className={`btn${sel === "geral" ? " primary" : ""}`} onClick={() => onSel("geral")}>
          Geral
        </button>
        {resumo.carteiras.map((c) => (
          <button key={c.id} type="button" className={`btn${sel === c.id ? " primary" : ""}`} onClick={() => onSel(c.id)}>
            {c.nome}
          </button>
        ))}
      </div>
      <div className="carteiras-kpis">
        {k.map((x) => (
          <div key={x.label} className={`carteira-kpi${x.forte ? " forte" : ""}`}>
            <span>{x.label}</span>
            <b>{BRL(x.valor)}</b>
            <small>{x.sub}</small>
          </div>
        ))}
      </div>
      <div className="carteiras-cartoes">
        {resumo.carteiras.map((c) => (
          <div key={c.id} className={`carteira-cartao${sel === c.id ? " ativo" : ""}`}>
            <div className="carteira-cab">
              {c.plataforma ? <CanalTag tipo={c.tipo} nome={c.nome} /> : <b>Conta da loja</b>}
              <b className="carteira-saldo">{BRL(c.saldo)}</b>
            </div>
            {!c.plataforma ? (
              <div className="carteira-linha faint">banco da loja · vendas físicas e orgânicas, contas, saques que chegaram</div>
            ) : c.extrato ? (
              <>
                <div className="carteira-linha">
                  <span>Liberado</span> <b>{BRL(c.liberado)}</b>
                </div>
                <div className="carteira-linha">
                  <span>A liberar</span> <b>{BRL(c.aLiberar)}</b>
                </div>
                <div className="carteira-linha">
                  <span>A caminho</span> <b>{BRL(c.aCaminho)}</b>
                </div>
                <div className="carteira-linha faint">
                  extrato até {dm(c.extrato.ate)}
                  {c.adiantado > 0.004 ? ` · ${BRL(c.adiantado)} liberado de pedido que a Olist ainda não marcou entregue` : ""}
                </div>
              </>
            ) : (
              <>
                <div className="carteira-linha">
                  <span>Entregue</span> <b>{BRL(c.saldo)}</b>
                </div>
                <div className="carteira-linha">
                  <span>A caminho</span> <b>{BRL(c.aCaminho)}</b>
                </div>
                <div className="carteira-linha faint">
                  {c.id === "shopee" ? (
                    <>
                      sem extrato: não dá pra separar liberado de a liberar ·{" "}
                      <button
                        type="button"
                        className="link-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          irParaAba("importar");
                        }}
                      >
                        enviar o Extrato do Meu Saldo
                      </button>
                    </>
                  ) : (
                    "estimado pelos pedidos (o extrato desta plataforma ainda não é lido)"
                  )}
                </div>
              </>
            )}
            {c.plataforma && c.saldo > 0.004 && (
              <div className="carteira-linha">
                <button
                  type="button"
                  className="link-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTransferir(c.id);
                  }}
                >
                  ⇄ registrar saque
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {!extratoDisponivel && <div className="hint">Pra separar liberado × a liberar e registrar saques, falta rodar o supabase/schema_v67.sql no Supabase.</div>}
    </div>
  );
}

/** "⇄ Transferir (saque)": carteira da plataforma → Conta da loja. */
export function TransferirDialog({ lojaId, carteiras, inicial, hoje, onToast, onFechar }) {
  const plats = carteiras.filter((c) => c.plataforma);
  const [de, setDe] = useState(inicial?.de || plats[0]?.id || "");
  const cart = plats.find((c) => c.id === de);
  const [valor, setValor] = useState(() => {
    const c = plats.find((x) => x.id === (inicial?.de || plats[0]?.id));
    const v = c ? (c.liberado ?? c.saldo) : 0;
    return v > 0 ? String(v.toFixed(2)).replace(".", ",") : "";
  });
  const [data, setData] = useState(hoje);
  const [salvando, setSalvando] = useState(false);
  async function salvar() {
    setSalvando(true);
    const r = await registrarTransferencia({ lojaId, de, valor: Number(String(valor).replace(/\./g, "").replace(",", ".")), data });
    setSalvando(false);
    if (!r.ok) return onToast?.(r.msg);
    onToast?.("Saque registrado — saiu da plataforma e entrou na Conta da loja");
    onFechar(true);
  }
  return (
    <EditarDialog titulo="Transferir (saque)" salvando={salvando} onSalvar={salvar} onCancelar={() => onFechar(false)} salvarLabel="Registrar saque">
      <p className="hint" style={{ marginTop: 0 }}>
        O dinheiro sai da carteira da plataforma e entra na <b>Conta da loja</b>. O total da loja não muda e não conta como venda nem como gasto.
        <Ajuda texto="Na Shopee, o saque que aparecer no Extrato do Meu Saldo entra sozinho quando você envia o extrato em Atualizar dados — não precisa registrar aqui também." />
      </p>
      <div className="row2">
        <div className="field">
          <label>De</label>
          <select value={de} onChange={(e) => setDe(e.target.value)}>
            {plats.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Para</label>
          <input value="Conta da loja" disabled />
        </div>
      </div>
      <div className="row2">
        <div className="field">
          <label>Valor (R$)</label>
          <input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
          {cart && <small className="faint">{cart.liberado != null ? `liberado: ${BRL(cart.liberado)}` : `saldo no app: ${BRL(cart.saldo)}`}</small>}
        </div>
        <div className="field">
          <label>Data</label>
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </div>
      </div>
    </EditarDialog>
  );
}
