import { Fragment, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useEscada } from "../hooks/useEscada.js";
import { useRampas } from "../hooks/useRampas.js";
import { useAfiliados } from "../hooks/useAfiliados.js";
import { recarregarReserva, useReservaProducao } from "../hooks/useReservaProducao.js";
import { saldoReserva, vendasDoMes } from "../lib/vendasMes.js";
import { hojeISO, rotuloMes } from "../lib/fluxoCaixa.js";
import { BRL, PCT } from "../lib/format.js";
import { irParaAba } from "../lib/navegar.js";
import Kpis from "./Kpis.jsx";
import Ajuda from "./Ajuda.jsx";
import CanalTag from "./CanalTag.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import EditarDialog from "./EditarDialog.jsx";

const dm = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : "");

// Fluxo de Caixa → Vendas do mês (Fase A, estimada — lib/vendasMes.js):
// vendas registradas no Crescimento × preço da semana → recebe, repor e lucro,
// por produto; e a Reserva de produção (schema v51): separar o "repor" do mês
// num envelope (não é saída — o dinheiro fica na conta, só deixa de estar livre).
export default function VendasMes({ mes, onToast }) {
  const { lojaId } = useLoja();
  const { itens, canais, cfgDoProduto } = useEscada();
  const { rampas, registros } = useRampas({ comRegistros: true });
  const af = useAfiliados();
  const reserva = useReservaProducao();
  const [verItem, setVerItem] = useState(null);
  const [verHistorico, setVerHistorico] = useState(false);
  const [separar, setSeparar] = useState(null); // valor sugerido
  const [usar, setUsar] = useState(null); // { valor, descricao }
  const [excluir, setExcluir] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const hoje = hojeISO();

  const v = useMemo(
    () => vendasDoMes({ mes, rampas, rampaRegistros: registros, afRegistros: af.registros, itens, canais, cfgDoProduto }),
    [mes, rampas, registros, af.registros, itens, canais, cfgDoProduto]
  );
  const res = useMemo(() => saldoReserva(reserva.registros), [reserva.registros]);
  const jaSeparado = res.porMes.get(mes) || 0;
  const falta = Math.max(0, Math.round((v.total.repor - jaSeparado) * 100) / 100);
  const t = v.total;

  async function gravar(registro, msg) {
    setSalvando(true);
    const { error } = await supabase.from("reserva_producao").insert({ loja_id: lojaId || null, ...registro });
    setSalvando(false);
    if (error) return onToast?.(/reserva_producao/i.test(error.message) ? "Rode o supabase/schema_v51.sql no Supabase pra usar a reserva" : `Não foi possível salvar: ${error.message}`);
    recarregarReserva();
    onToast?.(msg);
    return true;
  }
  async function confirmarSeparar() {
    const valor = Number(String(separar).replace(",", "."));
    if (!(valor > 0)) return onToast?.("Informe um valor maior que zero");
    if (await gravar({ tipo: "separar", valor, mes, data: hoje, descricao: `Repor produção — ${rotuloMes(mes)}` }, `${BRL(valor)} separados na reserva`)) setSeparar(null);
  }
  async function confirmarUsar() {
    const valor = Number(String(usar.valor).replace(",", "."));
    if (!(valor > 0)) return onToast?.("Informe um valor maior que zero");
    if (await gravar({ tipo: "usar", valor, data: hoje, descricao: usar.descricao.trim() || "Usado da reserva" }, `${BRL(valor)} usados da reserva`)) setUsar(null);
  }
  async function confirmarExcluir() {
    const { error } = await supabase.from("reserva_producao").delete().eq("id", excluir.id);
    setExcluir(null);
    if (error) return onToast?.(`Não foi possível excluir: ${error.message}`);
    recarregarReserva();
    onToast?.("Movimento da reserva excluído");
  }

  return (
    <>
      <Kpis
        itens={[
          { label: `Vendas de ${rotuloMes(mes)}`, valor: t.unidades ? `${t.unidades} un.` : "—", sub: t.unidades ? `faturamento ${BRL(t.faturamento)}` : "nenhuma semana registrada no mês" },
          { label: "Você recebe", valor: t.unidades ? BRL(t.recebe) : "—", sub: "o que os canais repassam, depois das taxas" },
          { label: "Repor a produção", valor: t.unidades ? BRL(t.repor) : "—", sub: "custo das peças vendidas → reserva" },
          {
            label: "Seu lucro",
            valor: t.unidades ? BRL(t.lucro) : "—",
            tom: t.unidades ? (t.lucro >= 0 ? "destaque" : "bad") : undefined,
            sub: t.unidades ? (t.ads || t.comissao ? `depois de Ads e afiliado: ${BRL(t.sobra)}` : t.faturamento > 0 ? `margem ${PCT(t.lucro / t.faturamento)}` : null) : null,
          },
        ]}
      />

      <div className="panel">
        <h3 className="section-title">
          Reserva de produção
          <Ajuda texto="O dinheiro das vendas que volta pra produção: material, embalagem, energia, máquina, manutenção, falhas e acabamento (tudo que está no custo do produto). Não é uma saída — o dinheiro continua na conta; o caixa só mostra quanto dele está separado e quanto está livre. Separe o “repor” de cada mês e use a reserva quando comprar filamento, peças ou embalagem." />
        </h3>
        {!reserva.disponivel ? (
          <div className="alerta alerta-warn">
            <b>Falta rodar o SQL</b> Rode o <b>supabase/schema_v51.sql</b> no SQL Editor do Supabase pra guardar a reserva.
          </div>
        ) : (
          <div className="reserva-faixa">
            <div className="reserva-saldo">
              <small>Saldo da reserva</small>
              <b>{BRL(res.saldo)}</b>
            </div>
            <div className="reserva-mes">
              <small>{rotuloMes(mes)}</small>
              <span>
                repor {BRL(t.repor)} · separado {BRL(jaSeparado)}
                {falta > 0 ? (
                  <>
                    {" "}· <b>falta {BRL(falta)}</b>
                  </>
                ) : t.repor > 0 ? (
                  " · ✓ separado"
                ) : null}
              </span>
            </div>
            <div className="reserva-acoes">
              <button type="button" className="btn btn-mini primary" disabled={!(falta > 0)} onClick={() => setSeparar(falta.toFixed(2))}>
                Separar {falta > 0 ? BRL(falta) : ""} na reserva
              </button>
              <button type="button" className="btn btn-mini" onClick={() => setUsar({ valor: "", descricao: "" })}>
                Usei da reserva
              </button>
              {reserva.registros.length > 0 && (
                <button type="button" className="link-btn" onClick={() => setVerHistorico((x) => !x)}>
                  {verHistorico ? "esconder movimentos" : `movimentos (${reserva.registros.length})`}
                </button>
              )}
            </div>
          </div>
        )}
        {verHistorico && reserva.registros.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Movimento</th>
                  <th className="num">Valor</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {reserva.registros.map((r) => (
                  <tr key={r.id}>
                    <td>{dm(r.data)}</td>
                    <td>
                      {r.descricao || (r.tipo === "usar" ? "Usado" : "Separado")}
                      <span className="muted-cel"> · {r.tipo === "usar" ? "usou" : "separou"}</span>
                    </td>
                    <td className="num" style={{ fontWeight: 600 }}>
                      {r.tipo === "usar" ? "−" : "+"}
                      {BRL(r.valor)}
                    </td>
                    <td className="num">
                      <span className="acoes-linha">
                        <button className="del" title="Excluir este movimento" onClick={() => setExcluir(r)}>×</button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h3 className="section-title">
          Vendas por produto
          <span className="badge info" style={{ marginLeft: 8 }}>estimado</span>
          <Ajuda texto="Das semanas registradas no Crescimento (Registrar semana): produtos em rampa e itens com afiliado ou Ads. Cada venda vale o preço daquela semana (o de agora na época), com o custo e as taxas de hoje. Unidades vendidas em kit contam como unidades no preço da semana. A semana entra no mês do último dia dela. Produto fora de rampa sem Ads e sem afiliado ainda não tem onde registrar venda (fica pra próxima fase, com o relatório da Shopee/Olist)." />
        </h3>
        {!v.linhas.length ? (
          <div className="empty">
            Nenhuma venda registrada em {rotuloMes(mes)}.{" "}
            <button type="button" className="link-btn" onClick={() => irParaAba("crescimento", { registrar: true })}>
              Registrar a semana no Crescimento →
            </button>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Vendas</th>
                  <th className="num">Faturamento</th>
                  <th className="num" title="O que o canal repassa depois das taxas">Recebe</th>
                  <th className="num" title="Custo das peças vendidas — vai pra reserva de produção">Repor</th>
                  <th className="num" title="Recebe − repor">Lucro</th>
                  <th className="num" title="Gasto de Ads e comissão de afiliado registrados nas semanas">Ads / afiliado</th>
                </tr>
              </thead>
              <tbody>
                {v.linhas.map((l) => (
                  <Fragment key={l.chave}>
                    <tr className="linha-clicavel" onClick={() => setVerItem((x) => (x === l.chave ? null : l.chave))}>
                      <td>
                        {l.item.nomeVariacao ? `${l.item.nome} — ${l.item.nomeVariacao}` : l.item.nome} <CanalTag canal={l.canal} />
                      </td>
                      <td className="num">{l.unidades} un.</td>
                      <td className="num">{BRL(l.faturamento)}</td>
                      <td className="num">{BRL(l.recebe)}</td>
                      <td className="num muted-cel">{BRL(l.repor)}</td>
                      <td className="num" style={{ fontWeight: 600, color: l.lucro < 0 ? "var(--bad)" : undefined }}>
                        {BRL(l.lucro)}
                      </td>
                      <td className="num muted-cel">{l.ads || l.comissao ? BRL(l.ads + l.comissao) : "—"}</td>
                    </tr>
                    {verItem === l.chave && (
                      <tr className="linha-detalhe">
                        <td colSpan={7}>
                          <div className="detalhe-cel">
                            <div className="detalhe-cel-grade">
                              <div className="kv-cel">
                                <small>Por venda (média)</small>
                                <b>{BRL(l.faturamento / l.unidades)}</b>
                                <span>
                                  recebe {BRL(l.recebe / l.unidades)} − repor {BRL(l.repor / l.unidades)} = lucro {BRL(l.lucro / l.unidades)}
                                </span>
                              </div>
                              <div className="kv-cel">
                                <small>Semanas no mês</small>
                                <b>{l.semanas}</b>
                                <span>registros do Crescimento</span>
                              </div>
                              {(l.ads > 0 || l.comissao > 0) && (
                                <div className="kv-cel">
                                  <small>Depois de Ads e afiliado</small>
                                  <b>{BRL(l.lucro - l.ads - l.comissao)}</b>
                                  <span>
                                    Ads {BRL(l.ads)} · afiliado {BRL(l.comissao)}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                <tr className="linha-total">
                  <td>Total</td>
                  <td className="num">{t.unidades} un.</td>
                  <td className="num">{BRL(t.faturamento)}</td>
                  <td className="num">{BRL(t.recebe)}</td>
                  <td className="num">{BRL(t.repor)}</td>
                  <td className="num">{BRL(t.lucro)}</td>
                  <td className="num">{t.ads || t.comissao ? BRL(t.ads + t.comissao) : "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {separar != null && (
        <EditarDialog titulo={`Separar na reserva — ${rotuloMes(mes)}`} salvando={salvando} onSalvar={confirmarSeparar} onCancelar={() => setSeparar(null)} salvarLabel="Separar">
          <p className="hint" style={{ marginTop: 0 }}>
            Repor a produção de {rotuloMes(mes)}: {BRL(t.repor)} (estimado){jaSeparado > 0 ? ` · já separado ${BRL(jaSeparado)}` : ""}. Não é uma saída: o dinheiro continua na conta, só deixa de aparecer como livre no Caixa.
          </p>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Valor (R$)</label>
            <input type="number" step="0.01" min="0" autoFocus value={separar} onChange={(e) => setSeparar(e.target.value)} />
          </div>
        </EditarDialog>
      )}
      {usar && (
        <EditarDialog titulo="Usei da reserva de produção" salvando={salvando} onSalvar={confirmarUsar} onCancelar={() => setUsar(null)} salvarLabel="Registrar">
          <p className="hint" style={{ marginTop: 0 }}>
            Saldo da reserva: {BRL(res.saldo)}. Lance a compra em si no Caixa (− Saída); aqui só sai da reserva. Dica: no “− Saída” dá pra marcar “pago com a reserva de produção” e fazer os dois de uma vez.
          </p>
          <div className="row2">
            <div className="field">
              <label>Valor (R$)</label>
              <input type="number" step="0.01" min="0" autoFocus value={usar.valor} onChange={(e) => setUsar((p) => ({ ...p, valor: e.target.value }))} />
            </div>
            <div className="field">
              <label>Pra quê</label>
              <input type="text" placeholder="ex: 2 rolos PLA" value={usar.descricao} onChange={(e) => setUsar((p) => ({ ...p, descricao: e.target.value }))} />
            </div>
          </div>
        </EditarDialog>
      )}
      {excluir && (
        <ConfirmDialog
          titulo="Excluir movimento da reserva"
          mensagem={`Excluir "${excluir.descricao || (excluir.tipo === "usar" ? "Usado" : "Separado")}" (${excluir.tipo === "usar" ? "−" : "+"}${BRL(excluir.valor)})? O saldo da reserva muda; o caixa não muda.`}
          confirmarLabel="Excluir"
          perigo
          onConfirm={confirmarExcluir}
          onCancel={() => setExcluir(null)}
        />
      )}
    </>
  );
}
