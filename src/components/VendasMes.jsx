import { Fragment, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useEscada } from "../hooks/useEscada.js";
import { useRampas } from "../hooks/useRampas.js";
import { useAfiliados } from "../hooks/useAfiliados.js";
import { recarregarReserva, useReservaProducao } from "../hooks/useReservaProducao.js";
import { recarregarVendasOrganicas, useVendasOrganicas } from "../hooks/useVendasOrganicas.js";
import { gruposDoSeletor, itemTipoDoId } from "../lib/variacoes.js";
import BuscaItem from "./BuscaItem.jsx";
import { EmbalagemOrganicoVenda } from "./EmbalagemOrganico.jsx";
import { saldoReserva, vendasDoMes } from "../lib/vendasMes.js";
import { trocarSubAba } from "../lib/subAbas.js";
import { useVendasReais } from "../hooks/useVendasReais.js";
import { gastoAdsNaJanela, regrasAds, tetoDaLoja } from "../lib/ads.js";
import { useAdsPeriodos } from "../hooks/useAdsPeriodos.js";
import { hojeISO, mesDe, rotuloMes } from "../lib/fluxoCaixa.js";
import { BRL, PCT } from "../lib/format.js";
import { irParaAba } from "../lib/navegar.js";
import Kpis from "./Kpis.jsx";
import Ajuda from "./Ajuda.jsx";
import CanalTag from "./CanalTag.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import EditarDialog from "./EditarDialog.jsx";

const dm = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : "");
const PREFIXO = { produto: "p", variacao: "v", kit: "k" };
// Último dia do mês 'YYYY-MM'.
const fimDoMes = (mes) => {
  const [a, m] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`;
};

// Fluxo de Caixa → Vendas do mês (Fase A, estimada — lib/vendasMes.js):
// vendas registradas no Crescimento × preço da semana → recebe, repor e lucro,
// por produto; e a Reserva de produção (schema v51): separar o "repor" do mês
// num envelope (não é saída — o dinheiro fica na conta, só deixa de estar livre).
export default function VendasMes({ mes, onToast }) {
  const { lojaId } = useLoja();
  const { itens, canais, precos, cfgDoProduto, cfgLoja, itemNoCanal, produtos: produtosEsc, kits: kitsEsc, embalagens: embalagensEsc = [] } = useEscada();
  const { rampas, rampasGrupo, registros } = useRampas({ comRegistros: true });
  const af = useAfiliados();
  const reserva = useReservaProducao();
  const org = useVendasOrganicas();
  const reais = useVendasReais({ itens, canais, cfgDoProduto });
  const [vendaOrg, setVendaOrg] = useState(null); // formulário da venda orgânica (novo ou edição)
  const [excluirOrg, setExcluirOrg] = useState(null);
  const [verItem, setVerItem] = useState(null);
  const [verHistorico, setVerHistorico] = useState(false);
  const [separar, setSeparar] = useState(null); // valor sugerido
  const [usar, setUsar] = useState(null); // { valor, descricao }
  const [excluir, setExcluir] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const hoje = hojeISO();

  const v = useMemo(
    () => vendasDoMes({ mes, rampas, rampasGrupo, rampaRegistros: registros, afRegistros: af.registros, organicas: org.registros, itens, canais, cfgDoProduto, pedidos: reais.linhas, cobertura: reais.cobertura, itemNoCanal }),
    [itemNoCanal, mes, rampas, rampasGrupo, registros, af.registros, org.registros, itens, canais, cfgDoProduto, reais.linhas, reais.cobertura]
  );
  const res = useMemo(() => saldoReserva(reserva.registros), [reserva.registros]);
  const jaSeparado = res.porMes.get(mes) || 0;
  const falta = Math.max(0, Math.round((v.total.repor - jaSeparado) * 100) / 100);
  const t = v.total;
  // Ads do mês AO VIVO (16/10/2026, mesma conta do teto da aba Ads): por
  // período, o maior entre as semanas registradas e o andamento (CSV) —
  // inclui a campanha da loja (GMV Max da Loja).
  const adsH = useAdsPeriodos();
  const adsMes = useMemo(() => {
    const de = `${mes}-01`;
    const ate = fimDoMes(mes) < hoje ? fimDoMes(mes) : hoje;
    const porItem = new Map();
    for (const p of adsH.periodos || []) {
      const k = `${p.item_tipo}|${p.item_id}|${p.canal_id}`;
      if (!porItem.has(k)) porItem.set(k, []);
      porItem.get(k).push(p);
    }
    let total = 0;
    for (const [k, pers] of porItem) {
      const [tipo, id, canalId] = k.split("|");
      const rampa = tipo === "produto" ? (rampas || []).find((r) => r.produto_id === id && r.canal_id === canalId) : null;
      const semanas = rampa
        ? (registros || []).filter((g) => g.rampa_id === rampa.id && g.tipo === "semana")
        : (af.registros || []).filter((g) => g.item_tipo === tipo && g.item_id === id && g.canal_id === canalId && g.vendas_total != null);
      total += gastoAdsNaJanela(pers, semanas, de, ate);
    }
    return Math.round(Math.max(total, t.ads) * 100) / 100;
  }, [adsH.periodos, mes, hoje, rampas, registros, af.registros, t.ads]);

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

  // --- Venda orgânica registrada à mão (schema v52) — só financeiro ---
  const organicasMes = org.registros.filter((o) => o.data && mesDe(String(o.data).slice(0, 10)) === mes);
  const gruposBusca = useMemo(() => gruposDoSeletor(itens), [itens]);
  const ultimoDia = mes === mesDe(hoje) ? hoje : fimDoMes(mes);
  const precoSalvo = (itemId, canalId) => {
    const tipo = itemTipoDoId(itemId);
    const l = precos.find((p) => p.item_tipo === tipo && p.item_id === itemId.slice(2) && p.canal_id === canalId);
    return l && Number(l.preco) > 0 ? Number(l.preco) : null;
  };
  const canaisComPreco = (itemId) => (itemId ? canais.filter((c) => precoSalvo(itemId, c.id) != null) : []);
  // Produto em rampa (ou variação dele) no canal: as vendas já entram pelo Registrar semana.
  const emRampaNoCanal = (itemId, canalId) => {
    if (!itemId || !canalId || itemId.startsWith("k:")) return false;
    const pid = itemId.startsWith("p:") ? itemId.slice(2) : itens.find((i) => i.id === itemId)?.produtoId;
    return rampas.some((r) => r.produto_id === pid && r.canal_id === canalId);
  };
  const jaNoRegistrarSemana = (itemId, canalId) =>
    !!itemId && !!canalId && (af.registros || []).some((g) => g.vendas_total != null && g.item_tipo === itemTipoDoId(itemId) && g.item_id === itemId.slice(2) && g.canal_id === canalId && g.data && mesDe(String(g.data).slice(0, 10)) === mes);

  function novaVendaOrg() {
    setVendaOrg({ id: null, itemId: "", canalId: "", de: `${mes}-01`, ate: ultimoDia, unidades: "", preco: "", conhecidos: "", observacao: "" });
  }
  function editarVendaOrg(o) {
    setVendaOrg({ id: o.id, itemId: `${PREFIXO[o.item_tipo] || "p"}:${o.item_id}`, canalId: o.canal_id || "", de: o.periodo_inicio || "", ate: String(o.data).slice(0, 10), unidades: String(o.unidades), preco: String(o.preco), conhecidos: o.conhecidos != null ? String(o.conhecidos) : "", observacao: o.observacao || "" });
  }
  function escolherItemOrg(itemId) {
    const cs = canaisComPreco(itemId);
    const canalId = cs.some((c) => c.id === vendaOrg.canalId) ? vendaOrg.canalId : cs[0]?.id || "";
    setVendaOrg((p) => ({ ...p, itemId, canalId, preco: canalId ? String(precoSalvo(itemId, canalId)) : "" }));
  }
  function escolherCanalOrg(canalId) {
    setVendaOrg((p) => ({ ...p, canalId, preco: canalId && p.itemId ? String(precoSalvo(p.itemId, canalId) ?? p.preco) : p.preco }));
  }
  async function salvarVendaOrg() {
    const f = vendaOrg;
    const unidades = Math.round(Number(f.unidades));
    const preco = Number(String(f.preco).replace(",", "."));
    if (!f.itemId) return onToast?.("Escolha o produto, variação ou kit");
    if (!f.canalId) return onToast?.("Escolha o canal");
    if (emRampaNoCanal(f.itemId, f.canalId)) return onToast?.("Esse produto está em rampa nesse canal — as vendas dele entram pelo Registrar semana do Crescimento");
    if (!(unidades > 0)) return onToast?.("Informe quantas unidades vendeu");
    if (!(preco > 0)) return onToast?.("Informe o preço de venda");
    if (!f.ate) return onToast?.("Informe a data (Até)");
    if (f.de && f.de > f.ate) return onToast?.("A data De precisa ser antes do Até");
    const conhecidos = f.conhecidos === "" ? null : Math.round(Number(f.conhecidos));
    if (conhecidos != null && (conhecidos < 0 || conhecidos > unidades)) return onToast?.("Conhecidos precisa ficar entre 0 e as unidades vendidas");
    const registro = {
      loja_id: lojaId || null,
      item_tipo: itemTipoDoId(f.itemId),
      item_id: f.itemId.slice(2),
      canal_id: f.canalId,
      periodo_inicio: f.de || null,
      data: f.ate,
      unidades,
      preco,
      conhecidos,
      observacao: f.observacao.trim() || null,
    };
    setSalvando(true);
    const { error } = f.id ? await supabase.from("vendas_organicas").update(registro).eq("id", f.id) : await supabase.from("vendas_organicas").insert(registro);
    setSalvando(false);
    if (error) return onToast?.(/vendas_organicas/i.test(error.message) ? "Rode o supabase/schema_v52.sql no Supabase pra registrar venda orgânica" : `Não foi possível salvar: ${error.message}`);
    recarregarVendasOrganicas();
    setVendaOrg(null);
    onToast?.(f.id ? "Venda orgânica atualizada" : `${unidades} un. registradas${mesDe(f.ate) !== mes ? ` em ${rotuloMes(mesDe(f.ate))}` : ""}`);
  }
  async function confirmarExcluirOrg() {
    const { error } = await supabase.from("vendas_organicas").delete().eq("id", excluirOrg.id);
    setExcluirOrg(null);
    if (error) return onToast?.(`Não foi possível excluir: ${error.message}`);
    recarregarVendasOrganicas();
    onToast?.("Venda orgânica excluída");
  }
  const nomeItem = (itemId) => {
    const it = itens.find((i) => i.id === itemId);
    return it ? it.nome : "item excluído";
  };

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
      {t.unidades > 0 && (() => {
        // Teto de Ads da loja (mesma conta da aba Ads) com os números deste mês.
        const tt = tetoDaLoja({ faturamento: t.faturamento, lucro: t.lucro, gasto: adsMes, regras: regrasAds(cfgLoja) });
        return (
          <div className={`linha-info${tt.acimaTeto ? " atencao-txt" : ""}`}>
            Ads do mês: <b>{BRL(adsMes)}</b> de {BRL(tt.teto)} (teto da fase {tt.fase}
            {tt.limitadoPelaTrava ? ", limitado pela metade do lucro" : ""}){tt.acimaTeto ? " — acima do teto" : ""}
          </div>
        );
      })()}

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
        <h3 className="section-title h3-split">
          <span>
          Vendas por produto
          <span className="badge info" style={{ marginLeft: 8 }}>{t.real > 0 ? (t.real >= t.unidades ? "real" : "real + estimado") : "estimado"}</span>
          <Ajuda texto="REAL: pedidos importados na aba Análise (Olist) e vendas físicas — o valor pago de verdade, com o custo e as taxas de hoje; nas semanas com pedidos importados a estimativa daquela plataforma sai. ESTIMADO (onde ainda não há pedidos): das semanas registradas no Crescimento (Registrar semana): produtos em rampa e itens com afiliado ou Ads. Cada venda vale o preço daquela semana (o de agora na época), com o custo e as taxas de hoje. Unidades vendidas em kit contam como unidades no preço da semana. A semana entra no mês do último dia dela. Produto fora de rampa sem Ads e sem afiliado: use “+ Registrar venda orgânica” (só financeiro — no preço que você digitar, no mês da data Até)." />
          </span>
          <button type="button" className="btn btn-mini primary" onClick={novaVendaOrg} disabled={!org.disponivel} title={org.disponivel ? "Venda de produto fora de rampa — só pro fechamento do mês" : "Rode o supabase/schema_v52.sql no Supabase"}>
            + Registrar venda orgânica
          </button>
        </h3>
        {!org.disponivel && (
          <div className="alerta alerta-warn">
            <b>Falta rodar o SQL</b> Rode o <b>supabase/schema_v52.sql</b> no SQL Editor do Supabase pra registrar venda orgânica.
          </div>
        )}
        {!v.linhas.length ? (
          <div className="empty">
            Nenhuma venda registrada em {rotuloMes(mes)}. Use “+ Registrar venda orgânica” ou{" "}
            <button type="button" className="link-btn" onClick={() => irParaAba("crescimento", { registrar: true })}>
              registre a semana no Crescimento →
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
                        {l.item.nome} <CanalTag canal={l.canal} />
                        {l.aMao > 0 && <span className="muted-cel"> · {l.aMao} orgânica{l.aMao > 1 ? "s" : ""} à mão</span>}
                        {l.real > 0 && l.real < l.unidades && <span className="muted-cel"> · {l.real} dos pedidos</span>}
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
                    {verItem === l.chave && l.unidades > 0 && (
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
                                <small>De onde vem</small>
                                <b>{l.unidades} un.</b>
                                <span>
                                  {[l.real > 0 && `${l.real} un. dos pedidos importados (real)`, l.semanas > 0 && `${l.semanas} semana${l.semanas > 1 ? "s" : ""} do Crescimento (estimado)`, l.aMao > 0 && `${l.aMao} un. orgânica${l.aMao > 1 ? "s" : ""} à mão`].filter(Boolean).join(" · ")}
                                </span>
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

      {organicasMes.length > 0 && (
        <div className="panel">
          <h3 className="section-title">
            Vendas orgânicas registradas à mão — {rotuloMes(mes)}
            <Ajuda texto="Vendas que você lançou aqui (produto fora de rampa). Entram só no financeiro do mês: vendas, recebe, repor, lucro e reserva. Ads, Afiliados e a Rampa não usam esses números." />
          </h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Período</th>
                  <th>Item</th>
                  <th className="num">Unidades</th>
                  <th className="num">Preço</th>
                  <th className="num">Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {organicasMes.map((o) => {
                  const itemId = `${PREFIXO[o.item_tipo] || "p"}:${o.item_id}`;
                  const canal = canais.find((c) => c.id === o.canal_id);
                  return (
                    <tr key={o.id}>
                      <td>{o.periodo_inicio && o.periodo_inicio !== String(o.data).slice(0, 10) ? `${dm(o.periodo_inicio)} a ${dm(o.data)}` : dm(o.data)}</td>
                      <td>
                        {nomeItem(itemId)} {canal && <CanalTag canal={canal} />}
                        {canal && reais.cobertura.cobre(canal, String(o.data).slice(0, 10)) && (
                          <div className="muted-cel" title="Esses dias já têm pedidos importados da Olist — as vendas entram por eles">não conta: já está nos pedidos importados</div>
                        )}
                        {(o.conhecidos > 0 || o.observacao) && (
                          <div className="muted-cel">{[o.conhecidos > 0 && `${o.conhecidos} de conhecidos`, o.observacao].filter(Boolean).join(" · ")}</div>
                        )}
                      </td>
                      <td className="num">{o.unidades} un.</td>
                      <td className="num">{BRL(o.preco)}</td>
                      <td className="num" style={{ fontWeight: 600 }}>{BRL(o.unidades * Number(o.preco))}</td>
                      <td className="num" style={{ whiteSpace: "nowrap" }}>
                        <span className="acoes-linha">
                          <button className="del" title="Editar" onClick={() => editarVendaOrg(o)}>✎</button>
                          <button className="del" title="Excluir" onClick={() => setExcluirOrg(o)}>×</button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {vendaOrg && (
        <EditarDialog
          titulo={vendaOrg.id ? "Editar venda orgânica" : "Registrar venda orgânica"}
          salvando={salvando}
          onSalvar={salvarVendaOrg}
          onCancelar={() => setVendaOrg(null)}
          salvarLabel={vendaOrg.id ? "Salvar alterações" : "Registrar"}
        >
          <p className="hint" style={{ marginTop: 0 }}>
            Só pro fechamento do mês: entra em vendas, recebe, repor, lucro e reserva. Não mexe em Ads, Afiliados nem na Rampa.
          </p>
          <div className="field">
            <label>Produto, variação ou kit</label>
            <BuscaItem grupos={gruposBusca} value={vendaOrg.itemId} onChange={escolherItemOrg} vazio="— escolha o item —" />
          </div>
          {vendaOrg.itemId && (
            <div className="field">
              <label>Canal</label>
              {canaisComPreco(vendaOrg.itemId).length ? (
                <select value={vendaOrg.canalId} onChange={(e) => escolherCanalOrg(e.target.value)}>
                  {canaisComPreco(vendaOrg.itemId).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome} · salvo {BRL(precoSalvo(vendaOrg.itemId, c.id))}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="alerta alerta-warn">Esse item não tem preço salvo em nenhum canal — salve o preço em Precificação antes.</div>
              )}
            </div>
          )}
          {vendaOrg.itemId && vendaOrg.canalId && (
            <EmbalagemOrganicoVenda
              item={itens.find((i) => i.id === vendaOrg.itemId)}
              canal={canais.find((c) => c.id === vendaOrg.canalId) || null}
              itemNoCanal={itemNoCanal}
              produtos={produtosEsc}
              kits={kitsEsc}
              embalagens={embalagensEsc}
              onToast={onToast}
            />
          )}
          {emRampaNoCanal(vendaOrg.itemId, vendaOrg.canalId) && (
            <div className="alerta alerta-warn">
              <b>Produto em rampa nesse canal</b> As vendas dele já entram pelo Registrar semana do Crescimento — registrar aqui contaria duas vezes.{" "}
              <button type="button" className="link-btn" onClick={() => { setVendaOrg(null); irParaAba("crescimento", { registrar: true }); }}>
                ir pro Registrar semana →
              </button>
            </div>
          )}
          {!emRampaNoCanal(vendaOrg.itemId, vendaOrg.canalId) && jaNoRegistrarSemana(vendaOrg.itemId, vendaOrg.canalId) && (
            <div className="alerta alerta-warn">Esse item já tem vendas deste mês registradas pelo Registrar semana (Ads/afiliado) — confira pra não contar duas vezes.</div>
          )}
          {(() => {
            const canal = canais.find((c) => c.id === vendaOrg.canalId);
            const ate = vendaOrg.ate || hoje;
            const de = vendaOrg.de || ate;
            if (!canal || !(reais.cobertura.cobre(canal, de) || reais.cobertura.cobre(canal, ate))) return null;
            return (
              <div className="alerta alerta-warn">
                <b>Este canal já tem pedidos importados nesse período</b> As vendas da {canal.nome} nesses dias já entram pelos pedidos (aba Análise) — e esta venda à mão não seria contada. O registro à mão é pra venda fora da Olist: use “+ Registrar venda física” em Análise → Importar dados.{" "}
                <button type="button" className="link-btn" onClick={() => { setVendaOrg(null); trocarSubAba("ohra:analise-sub", "importar"); irParaAba("analise"); }}>
                  ir pra Análise →
                </button>
              </div>
            );
          })()}
          <div className="row2">
            <div className="field">
              <label>De (opcional)</label>
              <input type="date" value={vendaOrg.de} onChange={(e) => setVendaOrg((p) => ({ ...p, de: e.target.value }))} />
            </div>
            <div className="field">
              <label>Até (o mês da venda)</label>
              <input type="date" value={vendaOrg.ate} onChange={(e) => setVendaOrg((p) => ({ ...p, ate: e.target.value }))} />
            </div>
          </div>
          <div className="row2">
            <div className="field">
              <label>Unidades vendidas</label>
              <input type="number" min="1" step="1" value={vendaOrg.unidades} onChange={(e) => setVendaOrg((p) => ({ ...p, unidades: e.target.value }))} />
            </div>
            <div className="field">
              <label>Preço de venda (R$ cada)</label>
              <input type="number" min="0" step="0.01" value={vendaOrg.preco} onChange={(e) => setVendaOrg((p) => ({ ...p, preco: e.target.value }))} />
              <span className="campo-nota">vem o preço salvo — mude se vendeu por outro valor</span>
            </div>
          </div>
          <div className="row2">
            <div className="field">
              <label>Conhecidos (opcional)</label>
              <input type="number" min="0" step="1" placeholder="amigos/família" value={vendaOrg.conhecidos} onChange={(e) => setVendaOrg((p) => ({ ...p, conhecidos: e.target.value }))} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Observação (opcional)</label>
              <input type="text" value={vendaOrg.observacao} onChange={(e) => setVendaOrg((p) => ({ ...p, observacao: e.target.value }))} />
            </div>
          </div>
          {Number(vendaOrg.unidades) > 0 && Number(String(vendaOrg.preco).replace(",", ".")) > 0 && (
            <div className="hint" style={{ margin: "8px 0 0" }}>
              Total: <b>{BRL(Math.round(Number(vendaOrg.unidades)) * Number(String(vendaOrg.preco).replace(",", ".")))}</b>
              {vendaOrg.ate && mesDe(vendaOrg.ate) !== mes ? ` · entra em ${rotuloMes(mesDe(vendaOrg.ate))}` : ""}
            </div>
          )}
        </EditarDialog>
      )}
      {excluirOrg && (
        <ConfirmDialog
          titulo="Excluir venda orgânica"
          mensagem={`Excluir ${excluirOrg.unidades} un. de "${nomeItem(`${PREFIXO[excluirOrg.item_tipo] || "p"}:${excluirOrg.item_id}`)}" (${BRL(excluirOrg.unidades * Number(excluirOrg.preco))})? Sai do fechamento do mês.`}
          confirmarLabel="Excluir"
          perigo
          onConfirm={confirmarExcluirOrg}
          onCancel={() => setExcluirOrg(null)}
        />
      )}

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
