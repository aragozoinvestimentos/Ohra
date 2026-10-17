import { irParaAba } from "../lib/navegar.js";
import { trocarSubAba } from "../lib/subAbas.js";
import { Fragment, useMemo, useState } from "react";
import { useLoja } from "../lib/LojaContext.jsx";
import { BRL } from "../lib/format.js";
import { andamentoValido, capacidadeDoItem, faseDaLoja, periodoLigado, resumoPeriodo, retornoAds, textoRetorno, tetoPorFaixas, valoresAtuais, REGRAS_ADS } from "../lib/ads.js";
import { porSemana } from "../lib/rampa.js";
import { useCatalogo } from "../hooks/useCatalogo.js";
import { adsPorItemApp, cruzarGrupos, lerRelatorio } from "../lib/relatorioShopee.js";
import { useEscada } from "../hooks/useEscada.js";
import { fichaDoGrupo } from "../lib/anunciosGrupo.js";
import { hojeSP } from "../lib/datas.js";
import Kpis from "./Kpis.jsx";
import Ajuda from "./Ajuda.jsx";
import CanalTag from "./CanalTag.jsx";
import Estado from "./Estado.jsx";
import EditarDialog from "./EditarDialog.jsx";
import { EncerrarAdsDialog, NAO_RECOMENDA, PeriodoAdsDialog } from "./AdsPeriodoDialogs.jsx";
import { ajustarPeriodoAds, despausarPeriodoAds, encerrarPeriodoAds, estenderPeriodoAds, excluirPeriodoAds, iniciarPeriodoAds, pausarPeriodoAds, reviseiSemVendaAds, salvarAndamentoAds } from "../lib/adsAcoes.js";
import { supabase } from "../lib/supabaseClient.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import { AgoraRampa } from "./RampaAgora.jsx";

// Crescimento → Ads (schema v44): avaliação semanal de Ads por produto/kit ×
// canal — a decisão vem SÓ de lib/ads.js (avaliarAds); aqui só mostra e grava
// os períodos (início, ajustes, fim) quando o Gustavo clica.
const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const um = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const virg = (v) => (v == null || v === "" ? "" : String(v).replace(".", ","));
const ORDEM = { resolver: 0, atencao: 1, oportunidade: 2, decisao: 3, info: 4, ok: 5 };

// Lista em seções (out/2026, mesmo padrão da Rampa): o que fazer vem SÓ do
// avaliarAds — aqui só escolhe a seção, o botão da linha e a próxima decisão.
const SECOES_ADS = [
  ["fazer", "Pra fazer agora"],
  ["oport", "Oportunidade"],
  ["acomp", "Acompanhando"],
  ["sem", "Sem Ads"],
];
function secaoAds(av, l) {
  if (l?.semAds && !av.ativo) return "sem"; // "não usar Ads por enquanto"
  if (["resolver", "atencao"].includes(av.estado) || av.avisoMeta) return "fazer";
  if (av.estado === "oportunidade") return "oport";
  return av.ativo ? "acomp" : "sem";
}
const PAUSAR = new Set(["pausar", "pausar-revisar", "pausar-corte", "inviavel-ativo"]);
/** Ação da linha: { k: novo|ajuste|encerrar|abrir, botao, ajuste?, depois } */
function acaoDoAds(av) {
  const vals = av.ativo ? valoresAtuais(av.ativo) : null;
  const n = av.numeros || {};
  const DEPOIS_AJ = "Depois de mudar na Shopee: registre aqui — o app espera uns dias pra decidir de novo.";
  if (av.ativo) {
    if (av.chave === "sem-venda-dia3" || av.chave === "ads-prejuizo" || av.chave === "parou-ads") return { k: "abrir", botao: "Ver o que fazer", depois: "Pause na Shopee e arrume o anúncio; depois marque aqui." };
    if (av.chave === "pausado" || av.chave === "despausar" || av.chave === "pausa-longa") return { k: "despausar", botao: "Despausei", depois: "Depois de religar na Shopee: marque aqui — a conferência recomeça 3 dias depois." };
    if (av.chave === "conferir-dia3") return { k: "andamento", botao: "Atualizar andamento", depois: "Envie o CSV do Shopee Ads (ou o número à mão) pra saber se já vendeu." };
    if (av.chave === "virar-meta" && av.novaMeta) return { k: "ajuste", botao: `Já troquei — meta ${um(av.novaMeta)}`, ajuste: { orcamento: vals.orcamento, meta: av.novaMeta, motivo: "fim do lance automático: virou meta de ROAS" }, depois: "Na Shopee: editar a campanha → GMV Max – Meta de ROAS. Depois registre aqui." };
    if (av.chave === "loja-abaixo" && av.novaMeta) return { k: "ajuste", botao: `Subi a meta pra ${um(av.novaMeta)}`, ajuste: { orcamento: vals.orcamento, meta: av.novaMeta, motivo: "campanha da loja abaixo do equilíbrio" }, depois: DEPOIS_AJ };
    if (av.chave === "loja-nao-gasta" && av.novaMeta) return { k: "ajuste", botao: `Baixei a meta pra ${um(av.novaMeta)}`, ajuste: { orcamento: vals.orcamento, meta: av.novaMeta, motivo: "campanha da loja quase não gasta" }, depois: DEPOIS_AJ };
    if (av.chave === "aguardando" && av.loja) return { k: "andamento", botao: "Atualizar andamento", depois: null };
    if (av.chave === "queda-ads" && av.novoOrcamento)
      return { k: "ajuste", botao: `Reduzi pra ${BRL(av.novoOrcamento)}/dia`, ajuste: { orcamento: av.novoOrcamento, meta: vals.meta, motivo: "reduzi: vendas pelo Ads caíram há 7 dias" }, depois: DEPOIS_AJ };
    if (av.chave === "queda-ads-sinal") return { k: "abrir", botao: "Ver o que conferir", depois: "Só avalie a causa — o app pede pra agir se seguir assim por 7 dias." };
    if ((av.chave === "aumentar" || av.chave === "reduzir") && av.novoOrcamento)
      return {
        k: "ajuste",
        botao: `${av.chave === "aumentar" ? "Aumentei" : "Reduzi"} pra ${BRL(av.novoOrcamento)}/dia`,
        ajuste: { orcamento: av.novoOrcamento, meta: vals.meta, motivo: av.chave === "aumentar" ? `${av.titulo.split(" →")[0].toLowerCase()} (retorno ${um(n.retorno)}×)` : "reduzi: ROAS abaixo do equilíbrio" },
        depois: DEPOIS_AJ,
      };
    if (av.chave === "subir-meta") return { k: "ajuste", botao: `Subi a meta pra ${um(av.novaMeta)}`, ajuste: { orcamento: vals.orcamento, meta: av.novaMeta, motivo: "subi a meta: ROAS abaixo do equilíbrio no mínimo diário" }, depois: DEPOIS_AJ };
    if (av.chave === "meta-alta") return { k: "ajuste", botao: `Baixei a meta pra ${um(av.novaMeta)}`, ajuste: { orcamento: vals.orcamento, meta: av.novaMeta, motivo: "baixei a meta: a Shopee gastou pouco" }, depois: DEPOIS_AJ };
    if (av.avisoMeta) return { k: "ajuste", botao: `Registrar ajuste: meta ${um(av.avisoMeta.sugerida)}`, ajuste: { orcamento: vals.orcamento, meta: av.avisoMeta.sugerida, motivo: "meta alta pra começar (equilíbrio × 1,3)" }, depois: DEPOIS_AJ };
    if (PAUSAR.has(av.chave)) return { k: "encerrar", botao: "Pausei — encerrar período", depois: "Depois de pausar na Shopee: encerre o período aqui (o histórico fica guardado)." };
    return { k: "abrir", botao: null };
  }
  if (av.chave === "loja-desligada") return { k: "novo", botao: "+ Ligar campanha da loja", depois: "Depois de ligar na Shopee (GMV Max da Loja, meta alta, orçamento ilimitado): registre aqui." };
  if (["pode", "ligar-sazonal"].includes(av.chave)) return { k: "novo", botao: "+ Novo período", depois: "Depois de ligar na Shopee: registre o período aqui com o orçamento e a meta que usou." };
  if (av.chave === "arrumar") return { k: "abrir", botao: null };
  return { k: "abrir", botao: null };
}
function proximaAds(av, hoje) {
  if (!av.ativo) return null;
  if (av.decideEm) return { texto: `Decidir em ${dm(av.decideEm)}` };
  if (av.ativo.tipo === "teste") return { texto: av.ativo.fim ? `Teste até ${dm(av.ativo.fim)}` : "Teste em andamento" };
  const ult = av.ativo.parcial?.em ? String(av.ativo.parcial.em).slice(0, 10) : null;
  if (!ult || diasEntre(ult, hoje) > 3) return { texto: ult ? `Atualizar o andamento (último ${dm(ult)})` : "Atualizar o andamento", atrasada: true };
  return { texto: `Atualizar o andamento em ${dm(somarDias(ult, 3))}` };
}

// "ver por produto" do teto (16/10/2026): onde foi o gasto dos 30 dias,
// curto — até 5 linhas + "outros". Retorno = lucro que cada R$ 1 trouxe;
// etiqueta cinza quando a Shopee não gasta nem metade do orçamento/dia.
function GastoPorItem({ T, onAbrir }) {
  const lista = T.porItem;
  const top = lista.slice(0, 5);
  const resto = lista.slice(5);
  const somaResto = resto.reduce((t, x) => t + x.gasto, 0);
  return (
    <div className="panel gasto-por-item">
      <h3>
        Onde foi o gasto · 30 dias <span className="dir">{T.ate ? `pelo CSV até ${dm(T.ate)}` : ""}</span>
      </h3>
      <table className="tabela-mini">
        <tbody>
          {top.map((x) => (
            <tr key={x.chave} className={x.loja ? undefined : "clicavel"} onClick={x.loja ? undefined : () => onAbrir(x.chave)}>
              <td>
                <b>{x.nome}</b>
                {x.orcamentoUso != null && x.orcamentoUso < 0.5 && <span className="chip-cel" title="A Shopee não está gastando o orçamento por dia programado — só informativo.">gastou {Math.round(x.orcamentoUso * 100)}% do orçamento/dia</span>}
                <div className="muted-cel">{x.fonte === "csv" ? `CSV até ${dm(x.ate)}` : "semanas registradas"}</div>
              </td>
              <td className="num">{BRL(x.gasto)}</td>
              <td className="num">
                {x.retorno == null ? <span className="muted-cel">—</span> : x.retorno >= 1 ? <span title="lucro que cada R$ 1 investido trouxe">retorno {um(x.retorno)}×</span> : <Estado tipo="atencao">retorno {um(x.retorno)}×</Estado>}
              </td>
            </tr>
          ))}
          {resto.length > 0 && (
            <tr>
              <td className="muted-cel">+ {resto.length} outro{resto.length > 1 ? "s" : ""}</td>
              <td className="num">{BRL(somaResto)}</td>
              <td />
            </tr>
          )}
          <tr className="total">
            <td>Total</td>
            <td className="num">{BRL(T.gasto)}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Situacao({ av, compacto }) {
  if (av.estado === "ok") return <span className={compacto ? "muted-cel" : undefined}>✓ {av.titulo}</span>;
  return <Estado tipo={av.estado}>{av.titulo}</Estado>;
}

export default function AdsCrescimento({ linhasAds, adsH, regrasA, regras, hoje, canais, onToast, abrirChave = null }) {
  const { lojaId, lojas, atualizar } = useLoja();
  const loja = lojas?.find((l) => l.id === lojaId) || null;
  const canaisComLinha = useMemo(() => canais.filter((c) => linhasAds.linhas.some((l) => l.canal.id === c.id)), [canais, linhasAds]);
  const [canalId, setCanalId] = useState(null);
  const canal = canaisComLinha.find((c) => c.id === canalId) || canaisComLinha.find((c) => c.tipo === "shopee") || canaisComLinha[0] || null;
  const [soLigados, setSoLigados] = useState(false);
  const [filtro, setFiltro] = useState("todos");
  const [aberta, setAberta] = useState(abrirChave);
  // Pedido do Início (ohra:ir-para → Crescimento): abre o detalhe da linha.
  const [pedidoVisto, setPedidoVisto] = useState(abrirChave);
  if (abrirChave && abrirChave !== pedidoVisto) {
    setPedidoVisto(abrirChave);
    setAberta(abrirChave);
  }
  const [periodoDlg, setPeriodoDlg] = useState(null); // { linha }
  const [ajusteDlg, setAjusteDlg] = useState(null); // { linha, orcamento, meta }
  const [encerrarDlg, setEncerrarDlg] = useState(null); // { linha }
  const [excluirDlg, setExcluirDlg] = useState(null); // { periodo }
  const [verRegras, setVerRegras] = useState(false);
  const [andamentoDlg, setAndamentoDlg] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const linhas = useMemo(
    () =>
      linhasAds.linhas
        .filter((l) => l.canal.id === canal?.id && (!soLigados || l.av.ativo) && (filtro === "todos" || secaoAds(l.av, l) === filtro))
        .sort((a, b) => (b.av.ativo ? 1 : 0) - (a.av.ativo ? 1 : 0) || ORDEM[a.av.estado] - ORDEM[b.av.estado] || a.item.nome.localeCompare(b.item.nome)),
    [linhasAds, canal, soLigados, filtro]
  );
  const ligados = linhasAds.linhas.filter((l) => l.av.ativo).length;
  const doCanal = linhasAds.linhas.filter((l) => l.canal.id === canal?.id);
  const fazerLinha = (l) => {
    const a = acaoDoAds(l.av);
    if (a.k === "despausar") rodar(() => despausarPeriodoAds(l.av.ativo, hoje), "Despausado — a conferência recomeça em 3 dias");
    else if (a.k === "andamento") setAndamentoDlg(true);
    else if (a.k === "ajuste") setAjusteDlg({ linha: l, ...a.ajuste });
    else if (a.k === "encerrar") setEncerrarDlg({ linha: l });
    else if (a.k === "novo") setPeriodoDlg({ linha: l });
    else setAberta(l.chave);
  };
  const L = linhasAds.loja;
  const T = linhasAds.teto; // teto de Ads da loja (30 dias, tabela progressiva + metade do lucro)
  const [verTabela, setVerTabela] = useState(false);
  const [verPorItem, setVerPorItem] = useState(false);

  if (!adsH.disponivel)
    return (
      <div className="panel">
        <h3>Ads</h3>
        <div className="empty">
          Falta rodar o <b>supabase/schema_v44.sql</b> no SQL Editor do Supabase (tabela dos períodos de Ads). Depois recarregue a página.
        </div>
      </div>
    );

  // Teste de lançamento possível: produto em rampa com o teste ainda não feito.
  const testeDe = (l) => {
    const t = l.rampa?.est.teste;
    if (!t || !["observando", "recomendado"].includes(t.status)) return null;
    return { padrao: t.status === "recomendado", dias: regras.testeDias, orcamentoDia: t.porDia, meta: regras.testeMeta };
  };
  async function rodar(fn, ok) {
    setSalvando(true);
    const r = await fn();
    setSalvando(false);
    if (!r.ok) return onToast?.(r.msg), false;
    window.dispatchEvent(new Event("focus"));
    onToast?.(r.semTipo ? `${ok} — rode o supabase/schema_v45.sql pra separar teste de período normal` : ok);
    return true;
  }

  async function salvarPeriodo(f) {
    const l = periodoDlg.linha;
    const ok = await rodar(
      () =>
        iniciarPeriodoAds({
          lojaId,
          tipo: l.tipo,
          id: l.id,
          canalId: l.canal.id,
          inicio: f.inicio,
          fim: f.fim || null,
          orcamento: f.orcamento === "" ? null : num(f.orcamento),
          meta: f.meta === "" ? null : num(f.meta),
          nota: f.nota || null,
          teste: f.comoTeste,
          auto: !f.comoTeste && f.modo === "auto",
          rampa: l.rampa?.r || null,
          regras,
        }),
      f.comoTeste ? `Teste de lançamento iniciado: ${l.item.nome}` : f.modo === "auto" && !f.comoTeste ? `Lance automático iniciado: ${l.item.nome} — o app confere no dia 3` : `Período de Ads iniciado: ${l.item.nome}`
    );
    if (ok) setPeriodoDlg(null);
  }

  async function salvarAjuste(f) {
    const p = ajusteDlg.linha.av.ativo;
    const ok = await rodar(
      () => ajustarPeriodoAds(p, { data: f.data, orcamento: f.orcamento === "" ? null : num(f.orcamento), meta: f.meta === "" ? null : num(f.meta), motivo: f.motivo || null }),
      "Ajuste registrado — a Shopee reaprende uns dias"
    );
    if (ok) setAjusteDlg(null);
  }

  async function encerrar(f) {
    const l = encerrarDlg.linha;
    const ok = await rodar(() => encerrarPeriodoAds(l.av.ativo, { fim: f.fim, motivo: f.motivo || null, rampa: l.rampa?.r || null }), "Período encerrado — lembre de pausar na plataforma");
    if (ok) setEncerrarDlg(null);
  }

  async function excluir() {
    const ok = await rodar(() => excluirPeriodoAds(excluirDlg.periodo, { rampa: excluirDlg.rampa || null, hoje }), "Período excluído");
    if (ok) setExcluirDlg(null);
  }

  async function salvarAndamento(lista) {
    setSalvando(true);
    let n = 0;
    for (const x of lista) {
      const r = await salvarAndamentoAds(x.periodo, x.valores);
      if (!r.ok) {
        setSalvando(false);
        onToast(r.msg);
        return;
      }
      n++;
    }
    window.dispatchEvent(new Event("focus")); // recarrega os períodos sem esperar o realtime
    setSalvando(false);
    setAndamentoDlg(false);
    onToast(n ? `Andamento atualizado em ${n} produto${n > 1 ? "s" : ""}` : "Nada pra atualizar");
  }

  // CSV do Ads com gasto num item sem período: cria o período (só no "Sim") e já guarda o andamento.
  async function criarPeloCsv(l, inicio, ate, valores) {
    setSalvando(true);
    const r = await iniciarPeriodoAds({ lojaId, tipo: l.tipo, id: l.id, canalId: l.canal.id, inicio, nota: "criado pelo CSV do Shopee Ads" });
    if (r.ok && r.periodo) await salvarAndamentoAds(r.periodo, { ate, ...valores });
    setSalvando(false);
    if (!r.ok) return onToast?.(r.msg), false;
    window.dispatchEvent(new Event("focus"));
    onToast?.(`${l.item.nome}: período de Ads criado desde ${dm(inicio)} — confira orçamento e meta em “Registrar ajuste”`);
    return true;
  }

  // "Não usar Ads por enquanto" (lembretes, sem SQL): tira de Oportunidade/Início.
  async function semAdsPorEscolha(l, marcar) {
    if (!supabase) return;
    const chave = `ads-nao|${l.chave}`;
    setSalvando(true);
    let r;
    if (marcar) r = await supabase.from("lembretes").upsert({ loja_id: lojaId || null, chave, adiado_ate: hoje, tipo: "sem-ads" }, { onConflict: "loja_id,chave" });
    else {
      let q = supabase.from("lembretes").delete().eq("chave", chave);
      if (lojaId) q = q.eq("loja_id", lojaId);
      r = await q;
    }
    setSalvando(false);
    if (r.error) return onToast?.(/lembretes|does not exist/.test(r.error.message) ? "Falta rodar o supabase/schema_v40.sql no Supabase" : `Não foi possível salvar: ${r.error.message}`);
    window.dispatchEvent(new Event("ohra:lembretes"));
    onToast?.(marcar ? `${l.item.nome}: sem Ads por enquanto — saiu das sugestões` : `${l.item.nome}: volta a aparecer nas sugestões`);
  }

  async function salvarRegras(f) {
    if (!loja) return;
    const novo = { ...(loja.config_escada?.ads || {}), ...(f.aumento != null ? { aumento: num(f.aumento) / 100 } : {}), ...(f.faixasTeto ? { faixasTeto: f.faixasTeto } : {}) };
    setSalvando(true);
    const r = await atualizar(loja.id, { configEscada: { ...(loja.config_escada || {}), ads: novo } });
    setSalvando(false);
    onToast?.(r.ok ? "Regras do Ads salvas pra loja" : `Não foi possível salvar: ${r.error}`);
    if (r.ok) setVerRegras(false);
  }

  return (
    <>
      <Kpis
        itens={[
          {
            label: "Ads na semana (loja)",
            valor: BRL(L.gasto),
            sub: L.fonte === "csv" ? `últimos 7 dias · pelo CSV até ${dm(L.ate)}` : L.fonte === "semanas" ? "últimos 7 dias · semanas registradas" : "últimos 7 dias",
          },
          {
            label: "Teto de Ads (30 dias)",
            valor: (
              <span className="kpi-v-com-acao">
                <span>
                  {T ? BRL(T.gasto) : "—"}
                  {T && <span className="kpi-v-de"> de {BRL(T.teto)}</span>}
                </span>
                {T && (
                  <button type="button" className="btn btn-mini" onClick={() => setVerTabela((v) => !v)}>
                    {verTabela ? "esconder tabela" : "ver tabela"}
                  </button>
                )}
              </span>
            ),
            tom: T?.acimaTeto ? "bad" : undefined,
            sub: T ? `fase ${T.fase} · faturamento ${BRL(T.faturamento)}${T.limitadoPelaTrava ? " · limitado pela metade do lucro" : ""}` : "",
            extra: T?.porItem?.length ? (
              <button type="button" className="btn btn-mini kpi-acao" onClick={() => setVerPorItem((v) => !v)}>
                {verPorItem ? "esconder por produto" : "ver por produto"}
              </button>
            ) : null,
          },
          {
            label: "Vendas via Ads",
            valor: pct(L.pctVendasAds),
            tom: L.dependente ? "bad" : undefined,
            sub: L.dependente ? "mais da metade das vendas — dependência" : L.vendas > 0 ? `${virg(Math.round(L.vendasAds * 10) / 10)} de ${L.vendas} vendas · 7 dias` : "das vendas dos últimos 7 dias",
          },
          { label: "Com Ads ligado", valor: String(ligados), sub: `de ${linhasAds.linhas.length} produto${linhasAds.linhas.length === 1 ? "" : "s"} × canal` },
        ]}
      />
      {T?.acimaTeto && (
        <div className="alerta alerta-warn">
          <b>Ads acima do teto da loja</b>Nos últimos 30 dias o Ads gastou {BRL(T.gasto)}; o teto é {BRL(T.teto)} (fase {T.fase}). Antes de aumentar algum produto, reduza os que estão abaixo do mínimo.
        </div>
      )}
      {verPorItem && T?.porItem?.length > 0 && (
        <GastoPorItem
          T={T}
          onAbrir={(chave) => {
            const l = linhasAds.linhas.find((x) => x.chave === chave);
            if (l && l.canal.id !== canal?.id) setCanalId(l.canal.id);
            setFiltro("todos");
            setSoLigados(false);
            setAberta(chave);
          }}
        />
      )}
      {verTabela && T && <TabelaTeto regrasA={regrasA} T={T} salvando={salvando} onSalvar={(faixasTeto) => salvarRegras({ faixasTeto })} />}

      <div className="panel">
        <h3 className="section-title">
          Ads por produto
          <Ajuda
            texto={
              <>
                Decisão ao vivo pelo andamento (CSV do Shopee Ads) ou pela semana registrada. Ads é investimento: não entra no preço.
                <br />• <b>ROAS de equilíbrio</b> = preço de agora ÷ lucro por venda (antes do Ads): abaixo dele, o Ads tira lucro. <b>Meta sugerida</b> = equilíbrio × 1,3.
                <br />• <b>Retorno</b> = ROAS ÷ equilíbrio = quanto de lucro cada R$ 1 investido trouxe.
                <br />• <b>7 dias de aprendizado</b> no começo do período; depois de cada ajuste, nova decisão em <b>{regrasA.decisaoDias || 3} dias</b>.
                <br />• Com a Shopee gastando ≥ 80% do orçamento: retorno 1–1,2× → manter; 1,2–2× → <b>+{Math.round(regrasA.aumento * 100)}%</b>; ≥ 2× → <b>+{Math.round((regrasA.aumentoMax || 0.3) * 100)}%</b> (máximo — sem estouro de uma vez) (sempre dentro do teto da loja e perguntando se a produção dá conta). Vendas via Ads caíram mais de 30% em 3 dias com retorno bom → também sugere aumentar.
                <br />• Abaixo do equilíbrio: muitos cliques e poucas vendas → arrumar o anúncio; já no mínimo de {BRL(regrasA.minDiario)}/dia → subir a meta (mais seletivo) ou pausar; senão → reduzir o orçamento. A Shopee não gasta o orçamento → baixar a meta (mais alcance).
                <br />• <b>Produto novo — lance automático</b> (método do Luan): sem meta, orçamento baixo. <b>Dia 3 sem venda</b> (vale pra todo período) → pare e arrume o anúncio: “Pausei pra revisar” mantém o período e as métricas. <b>Dia 7</b> → troque pra meta de ROAS = o ROAS que bateu (nunca abaixo do equilíbrio).
                <br />• <b>Loja inteira · GMV Max da Loja</b> (linha fixa no topo): produtos sem Ads próprio, meta alta e orçamento ilimitado — o app compara o ROAS com o equilíbrio da loja.
                <br />• <b>Anúncio com vários itens</b> = uma linha só: equilíbrio pelo mix de vendas das opções (sem vendas, pela opção mais exigente).
                <br />• Sem Ads: o app diz se vale impulsionar, se o anúncio precisa ser arrumado antes ou se o Ads não se paga neste preço.
                <br />• <b>Produto “só na época de…”</b>: Aquecer (45 dias antes da data-limite, R$ 10/dia) → Ajustar (21 dias antes) → Alavancar (da data-limite em diante: a cada 3 dias pelo andamento, aumento até 30%, só com lucro) → Corte (7 dias antes da data: pausar). Na temporada o Ads tem que deixar pelo menos metade do lucro de cada venda (mínimo = 2× o equilíbrio).
                <br />• <b>Teto da loja</b>: tabela progressiva pelo faturamento dos últimos 30 dias (cada % vale só pro pedaço da faixa) e nunca mais que metade do lucro do período.
              </>
            }
          />
        </h3>
        <div className="toolbar">
          {canaisComLinha.length > 1 && (
            <select value={canal?.id || ""} onChange={(e) => setCanalId(e.target.value)} aria-label="Canal" style={{ width: "auto" }}>
              {canaisComLinha.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          )}
          <div className="filtros-lista" role="group" aria-label="Filtrar a lista">
            {[["todos", "Todos"], ...SECOES_ADS.map(([k, t]) => [k, k === "fazer" ? "Pra fazer" : t])]
              .map(([k, rot]) => [k, rot, k === "todos" ? doCanal.length : doCanal.filter((l) => secaoAds(l.av, l) === k).length])
              .filter(([k, , n]) => k === "todos" || n > 0)
              .map(([k, rot, n]) => (
                <button key={k} type="button" className={`filtro-btn${filtro === k ? " ativo" : ""}${k === "oport" ? " filtro-subir" : ""}`} onClick={() => setFiltro(k)}>
                  {rot} <span className="filtro-n">{n}</span>
                </button>
              ))}
          </div>
          <label className="check-inline">
            <input type="checkbox" checked={soLigados} onChange={(e) => setSoLigados(e.target.checked)} /> só com Ads ligado
          </label>
          <button type="button" className="btn btn-mini" onClick={() => setVerRegras((v) => !v)}>Regras do Ads</button>
          {(linhasAds.linhas.length > 0 || linhasAds.lojaLinha?.av.ativo) && (
            <button type="button" className="btn btn-mini" onClick={() => setAndamentoDlg(true)} title="Ver como está o Ads no meio do período, sem encerrar nada">
              Atualizar andamento
            </button>
          )}
        </div>
        {verRegras && <RegrasAds regrasA={regrasA} salvando={salvando} onSalvar={salvarRegras} />}
        {!linhas.length && !(linhasAds.lojaLinha && canal?.id === linhasAds.lojaLinha.canal.id) ? (
          <div className="empty">{soLigados ? "Nenhum produto com Ads ligado neste canal." : "Nenhum produto com preço salvo neste canal."}</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>O que fazer</th>
                  <th className="num">ROAS agora</th>
                  <th className="num">Equilíbrio</th>
                  <th className="num">Meta</th>
                  <th className="num">Orçamento/dia</th>
                  <th>Próxima decisão</th>
                </tr>
              </thead>
              <tbody>
                {linhasAds.lojaLinha && canal?.id === linhasAds.lojaLinha.canal.id && (() => {
                  const l = linhasAds.lojaLinha;
                  const av = l.av;
                  const ac = acaoDoAds(av);
                  const vals = av.ativo ? valoresAtuais(av.ativo) : null;
                  const etiqueta = !av.ativo ? <span className="chip-cel">Desligada · ligar?</span> : ["atencao", "resolver"].includes(av.estado) ? <Estado tipo={av.estado}>{av.titulo}</Estado> : <span className="chip-cel decisao">Acompanhando</span>;
                  return (
                    <Fragment key={l.chave}>
                      <tr className="linha-clicavel linha-loja-ads" onClick={() => setAberta(aberta === l.chave ? null : l.chave)}>
                        <td>
                          <b>{l.item.nome}</b> <CanalTag canal={l.canal} />
                          <div className="muted-cel">produtos sem Ads próprio (reserva) · equilíbrio da loja {um(l.equilibrio)}</div>
                        </td>
                        <td className="o-que-fazer">
                          <div className="oqf">
                            {etiqueta}
                            {av.ativo && !["atencao", "resolver"].includes(av.estado) && <span className="muted-cel">{av.titulo}</span>}
                            {ac.botao && (
                              <button type="button" className={`btn btn-mini ${["resolver", "atencao"].includes(av.estado) ? "primary" : ""}`} onClick={(ev) => (ev.stopPropagation(), fazerLinha(l))}>
                                {ac.botao}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="num">{um(av.numeros?.roas)}{av.numeros?.retorno != null && <div className="sub-num">retorno {um(av.numeros.retorno)}×</div>}</td>
                        <td className="num">{um(l.equilibrio)}</td>
                        <td className="num">{vals?.meta ? um(vals.meta) : "—"}</td>
                        <td className="num">{av.ativo ? (vals?.orcamento ? BRL(vals.orcamento) : "ilimitado") : "—"}</td>
                        <td>{(() => { const prox = proximaAds(av, hoje); return prox ? <span className={prox.atrasada ? "prox-atrasada" : "muted-cel"}>{prox.texto}</span> : <span className="muted-cel">—</span>; })()}</td>
                      </tr>
                      {aberta === l.chave && (
                        <tr className="linha-detalhe">
                          <td colSpan={7}>
                            <DetalheLoja l={l} hoje={hoje} onFazer={() => fazerLinha(l)} onNovo={() => setPeriodoDlg({ linha: l })} onAjuste={(sug) => setAjusteDlg({ linha: l, ...sug })} onEncerrar={() => setEncerrarDlg({ linha: l })} onPausar={() => rodar(() => pausarPeriodoAds(l.av.ativo, hoje), "Campanha da loja marcada como pausada")} onExcluir={(periodo) => setExcluirDlg({ periodo })} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })()}
                {SECOES_ADS.map(([sec, tituloSec]) => {
                  const doSec = linhas.filter((l) => secaoAds(l.av, l) === sec);
                  if (!doSec.length) return null;
                  return (
                    <Fragment key={sec}>
                      <tr className={`secao-lista secao-${sec === "oport" ? "subir" : sec}`}>
                        <td colSpan={7}>
                          {sec === "oport" ? "↑ " : sec === "fazer" ? "! " : ""}
                          {tituloSec} <span className="filtro-n">{doSec.length}</span>
                        </td>
                      </tr>
                {doSec.map((l) => {
                  const av = l.av;
                  const ac = acaoDoAds(av);
                  const prox = proximaAds(av, hoje);
                  const vals = av.ativo ? valoresAtuais(av.ativo) : null;
                  const roasSemana = av.numeros?.roasSemana;
                  return (
                    <Fragment key={l.chave}>
                      <tr className="linha-clicavel" onClick={() => setAberta(aberta === l.chave ? null : l.chave)}>
                        <td>
                          <b>{l.item.nome}</b> <CanalTag canal={l.canal} />
                          {l.rampa && <span className="muted-cel"> · em rampa</span>}
                          {l.sazonal && l.sazonal.fase !== "fora" && (
                            <span className="chip-cel decisao" title={l.sazonal.texto}>
                              {l.sazonal.nome}: {l.sazonal.titulo}
                              {l.sazonal.fim ? ` até ${dm(l.sazonal.fim)}` : ""}
                            </span>
                          )}
                          <div className="muted-cel">
                            {l.tipo === "grupo" ? (l.mix ? `ticket médio ${BRL(l.preco)}` : `pior opção: ${l.pior?.rotulo || "—"} ${BRL(l.preco)}`) : BRL(l.preco)} · lucro {l.lucro != null ? BRL(l.lucro) : "—"}
                            {l.tipo === "grupo" && ` · ${l.ops.length} opções${l.rampaGrupo ? ` · rampa ${l.rampaGrupo.g.pctAtual}%` : ""}`}
                          </div>
                          {av.avisoMeta && <span className="chip-cel atencao">meta alta pra começar</span>}
                          {l.semAds && <span className="chip-cel">sem Ads por escolha{l.semAds.desde ? ` · desde ${dm(l.semAds.desde)}` : ""}</span>}
                          {vals?.automatico && <span className="chip-cel decisao">lance automático</span>}
                        </td>
                        <td className="o-que-fazer">
                          <div className="oqf">
                            {l.semAds ? <span className="muted-cel">o app sugeriria: {av.titulo}</span> : <Situacao av={av} compacto />}
                            {ac.botao && !l.semAds && (
                              <button
                                type="button"
                                className={`btn btn-mini ${av.estado === "oportunidade" ? "btn-verde" : ["resolver", "atencao"].includes(av.estado) || av.avisoMeta ? "primary" : ""}`}
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  fazerLinha(l);
                                }}
                              >
                                {ac.botao}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="num" style={{ color: roasSemana == null || !av.empate ? undefined : roasSemana >= av.empate ? "var(--good)" : "var(--bad)" }}>
                          {um(roasSemana)}
                          {av.numeros?.retorno != null && <div className="sub-num">retorno {um(av.numeros.retorno)}×</div>}
                        </td>
                        <td className="num">{um(av.empate)}</td>
                        <td className="num">{vals?.meta ? um(vals.meta) : "—"}</td>
                        <td className="num">{vals?.orcamento ? BRL(vals.orcamento) : "—"}</td>
                        <td>{prox ? <span className={prox.atrasada ? "prox-atrasada" : "muted-cel"}>{prox.texto}</span> : <span className="muted-cel">—</span>}</td>
                      </tr>
                      {aberta === l.chave && (
                        <tr className="linha-detalhe">
                          <td colSpan={7}>
                            <Detalhe
                              l={l}
                              onFazer={() => fazerLinha(l)}
                              regrasA={regrasA}
                              hoje={hoje}
                              onNovo={() => setPeriodoDlg({ linha: l })}
                              onAjuste={(sug) => setAjusteDlg({ linha: l, ...sug })}
                              onEncerrar={() => setEncerrarDlg({ linha: l })}
                              onExcluir={(periodo) => setExcluirDlg({ periodo, rampa: l.rampa?.r || null })}
                              onPausar={() => rodar(() => pausarPeriodoAds(l.av.ativo, hoje), "Pausado pra revisar — o período continua; marque “Despausei” quando religar")}
                              onDespausar={() => rodar(() => despausarPeriodoAds(l.av.ativo, hoje), "Despausado — a conferência recomeça em 3 dias")}
                              onRevisei={() => rodar(() => reviseiSemVendaAds(l.av.ativo, hoje), "Ok — o app confere de novo em 3 dias")}
                              onSemAds={(marcar) => semAdsPorEscolha(l, marcar)}
                              onAndamento={() => setAndamentoDlg(true)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {periodoDlg && <PeriodoAdsDialog nome={periodoDlg.linha.item.nome} loja={periodoDlg.linha.tipo === "loja"} autoPadrao={periodoDlg.linha.tipo !== "loja" && !(periodoDlg.linha.periodos || []).some((p) => p.tipo !== "teste")} av={periodoDlg.linha.av} teste={testeDe(periodoDlg.linha)} hoje={hoje} regrasA={regrasA} salvando={salvando} onCancelar={() => setPeriodoDlg(null)} onSalvar={salvarPeriodo} />}
      {andamentoDlg && (
        <AndamentoDialog
          linhas={[...(linhasAds.lojaLinha?.av.ativo ? [linhasAds.lojaLinha] : []), ...linhasAds.linhas.filter((l) => l.av.ativo)]}
          todas={linhasAds.linhas}
          onEstender={(l, p, fim) => rodar(() => estenderPeriodoAds(p, fim), `${l.item.nome}: fim do período estendido até ${dm(fim)}`)}
          onCriar={criarPeloCsv}
          hoje={hoje}
          salvando={salvando}
          onCancelar={() => setAndamentoDlg(false)}
          onSalvar={salvarAndamento}
          onToast={onToast}
        />
      )}
      {ajusteDlg && <AjusteDialog d={ajusteDlg} hoje={hoje} salvando={salvando} onCancelar={() => setAjusteDlg(null)} onSalvar={salvarAjuste} onToast={onToast} />}
      {encerrarDlg && <EncerrarAdsDialog nome={encerrarDlg.linha.item.nome} teste={encerrarDlg.linha.av.ativo?.tipo === "teste"} hoje={hoje} salvando={salvando} onCancelar={() => setEncerrarDlg(null)} onSalvar={encerrar} />}
      {excluirDlg && (
        <ConfirmDialog
          titulo="Excluir este período de Ads?"
          mensagem={`${dm(excluirDlg.periodo.inicio)}${excluirDlg.periodo.fim ? `–${dm(excluirDlg.periodo.fim)}` : " (ligado)"}. As semanas registradas continuam; só o período (datas, meta, orçamento e ajustes) é apagado.`}
          confirmarLabel="Excluir período"
          perigo
          onConfirm={excluir}
          onCancel={() => setExcluirDlg(null)}
        />
      )}
    </>
  );
}

// Passos do "3 dias sem venda" (método do Luan): o que arrumar vem do funil
// da Rampa (porOnde) ou dos números do Ads — impressões/cliques.
function passosSemVenda(l) {
  const sv = l.av.semVenda || {};
  const anuncio = (l.rampa || l.rampaGrupo)?.est?.anuncio || null;
  const passos = [{ t: "Pause o Ads na Shopee", d: "Marketing → Shopee Ads → este produto → Pausar." }];
  if (anuncio?.porOnde) passos.push({ t: `Arrume o anúncio: ${anuncio.porOnde}`, d: anuncio.titulo || "pelo funil da Rampa" });
  else if (sv.cliques >= 15) passos.push({ t: "Clicam mas não compram: preço, descrição, medidas e fotos de uso", d: `${sv.cliques} cliques pagos ${sv.prejuizo ? "e quase nenhuma venda" : "sem venda"} — compare o preço com o concorrente (ou um substituto) e confira frete e prazo.` });
  else passos.push({ t: "Pouca gente clica: troque a foto de capa e confira o título", d: "Fundo limpo, produto grande, uso real; a palavra que o cliente busca no começo do título." });
  passos.push({ t: "Volte aqui e escolha", d: "Pausei pra revisar (o período continua com as métricas) · Revisei (sem pausar) — o app confere de novo em 3 dias · ou encerrar." });
  return passos;
}

function Detalhe({ l, regrasA, hoje, onNovo, onAjuste, onEncerrar, onExcluir, onFazer, onPausar, onDespausar, onRevisei, onSemAds, onAndamento }) {
  const av = l.av;
  const n = av.numeros || {};
  const vals = av.ativo ? valoresAtuais(av.ativo) : null;
  const historico = [...l.periodos].sort((a, b) => String(b.inicio).localeCompare(String(a.inicio))).map((p) => ({ p, r: p.id === av.ativo?.id && av.numeros?.fonte === "andamento" ? { ...resumoPeriodo(p, l.semanas, l.preco, av.empate, regrasA), ...av.numeros } : resumoPeriodo(p, l.semanas, l.preco, av.empate, regrasA) }));
  const totalDias = av.ativo?.fim ? diasEntre(av.ativo.inicio, av.ativo.fim) + 1 : null;
  const diaAtual = (n.dias ?? 0) + 1;
  const tomRoas = (r) => (r == null || !av.empate ? "" : r >= av.empate ? " bom" : " ruim");
  const andamento = av.ativo ? andamentoValido(av.ativo, l.semanas) : null;
  const ret = n.lucroPorReal ?? retornoAds(n.roas, av.empate);
  const roasAnd = andamento && andamento.gasto > 0 ? (andamento.vendas * l.preco) / andamento.gasto : null;
  return (
    <div className="detalhe-cel ads-det">
      {(() => {
        const ac = acaoDoAds(av);
        const tipo = av.estado === "ok" ? "info" : av.estado;
        const ROT = { resolver: "Resolver agora", atencao: "Atenção", oportunidade: "Oportunidade — mais lucro", decisao: "Decisão sua em andamento", info: "Nada a fazer agora" };
        return (
          <AgoraRampa
            acao={{ tipo, rotulo: ROT[tipo], titulo: av.titulo, porque: av.texto, acao: ac.botao ? ac.k : null, botao: ac.botao, depois: ac.depois }}
            proxima={proximaAds(av, hoje)}
            onAcao={onFazer}
          />
        );
      })()}
      {(av.chave === "sem-venda-dia3" || av.chave === "ads-prejuizo" || av.chave === "parou-ads") && (
        <div className="ads-dia3">
          <ol className="passos-ads">
            {passosSemVenda(l).map((p, i) => (
              <li key={i}>
                <span className="passo-n">{i + 1}</span>
                <span>
                  <b>{p.t}</b>
                  <small>{p.d}</small>
                </span>
              </li>
            ))}
          </ol>
          <div className="acoes-ads">
            <button type="button" className="btn btn-mini primary" onClick={onPausar}>Pausei pra revisar</button>
            {av.semVenda?.podeEsperar && <button type="button" className="btn btn-mini" onClick={onRevisei}>Revisei o anúncio — conferir em 3 dias</button>}
            <button type="button" className="btn btn-mini" onClick={onEncerrar}>Pausei — encerrar período</button>
            {l.rampa && (
              <button type="button" className="link-btn" onClick={() => irParaAba("crescimento", { sub: "rampa", rampaId: l.rampa.r.id })}>
                abrir o checklist do anúncio
              </button>
            )}
          </div>
        </div>
      )}
      {av.avisoMeta && (
        <div className="alerta alerta-warn">
          <b>Meta alta pra começar — comece com {um(av.avisoMeta.sugerida)}</b>
          A meta {um(av.avisoMeta.meta)} passa de 2× o ROAS de equilíbrio ({um(av.minimo ?? av.empate)}): a Shopee fica seletiva demais e quase não entrega. Baixe na plataforma e registre aqui.
          <div style={{ marginTop: 6 }}>
            <button type="button" className="btn btn-mini primary" onClick={() => onAjuste({ orcamento: vals.orcamento, meta: av.avisoMeta.sugerida, motivo: "meta alta pra começar (equilíbrio × 1,3)" })}>
              Registrar ajuste: meta {um(av.avisoMeta.sugerida)}
            </button>
          </div>
        </div>
      )}
      {l.tipo === "grupo" && (
        <div className="alerta alerta-neutro">
          <b>Anúncio com vários itens</b>
          {l.mix
            ? `Equilíbrio pelo mix das vendas dos últimos 30 dias (${l.ops.map((o) => `${o.rotulo} ${Math.round((l.mix.pesos.get(o.idx) || 0) * 100)}%`).join(" · ")}).`
            : `Sem vendas por opção ainda: o equilíbrio é o da opção mais exigente (${l.pior?.rotulo || "—"}). O mix vem dos pedidos importados (Análise → Importar dados), pelo SKU de cada opção.`}
        </div>
      )}
      {av.ativo && (
        <div className="ads-cartao">
          <div className="ads-periodo">
            <div className="ads-periodo-cab">
              <span className="ads-rotulo">{av.ativo.tipo === "teste" ? "Teste de lançamento" : "Período atual"}</span>
              <b>
                {dm(av.ativo.inicio)} → {av.ativo.fim ? dm(av.ativo.fim) : "sem data final"}
              </b>
              <span className="ads-chips">
                <span className="chip-ads">{vals.orcamento ? `${BRL(vals.orcamento)}/dia` : "sem orçamento"}</span>
                <span className="chip-ads">{vals.automatico ? "lance automático" : `meta ${um(vals.meta)}`}</span>
                {av.pausado && <span className="chip-ads">pausado desde {dm(av.pausado.desde)}</span>}
                <span className="chip-ads">equilíbrio {um(av.empate)}</span>
                {vals.meta && av.empate ? <span className="chip-ads">meta sugerida {um(Math.ceil(av.empate * 1.3 * 10 - 1e-9) / 10)}</span> : null}
              </span>
            </div>
            {totalDias ? (
              <div className="ads-barra" title={`dia ${diaAtual} de ${totalDias}`}>
                <div style={{ width: `${Math.min(100, (diaAtual / totalDias) * 100)}%` }} />
                <small>dia {Math.min(diaAtual, totalDias)} de {totalDias}</small>
              </div>
            ) : (
              <small className="muted-cel">dia {diaAtual}</small>
            )}
          </div>
          <div className="ads-metricas">
            <div><span>Gasto</span><b>{BRL(n.gasto || 0)}</b></div>
            <div><span>Vendas via Ads</span><b>{n.vendas || 0}</b></div>
            <div><span>Cliques</span><b>{n.cliques || 0}</b></div>
            <div><span>ROAS</span><b className={`ads-roas${tomRoas(n.roas)}`}>{um(n.roas)}</b></div>
            <div><span>Custo por venda</span><b>{n.custoPorVenda != null ? BRL(n.custoPorVenda) : "—"}</b></div>
            <div><span>Retorno</span><b className={`ads-roas${ret == null ? "" : ret >= 1 ? " bom" : " ruim"}`}>{ret != null ? `${um(ret)}×` : "—"}</b></div>
          </div>
          {ret != null && <div className="muted-cel" style={{ marginTop: 2 }}>{textoRetorno(ret)} (antes de descontar o R$ 1)</div>}
          {andamento && (
            <div className="ads-andamento">
              <span className="ads-rotulo">Andamento até {dm(andamento.ate)}</span>
              <span>
                gasto <b>{BRL(andamento.gasto)}</b> · <b>{andamento.vendas}</b> venda{andamento.vendas === 1 ? "" : "s"} via Ads · {andamento.cliques} cliques · ROAS{" "}
                <b className={`ads-roas${tomRoas(roasAnd)}`}>{um(roasAnd)}</b>
                {andamento.custoPorVenda != null ? ` · ${BRL(andamento.custoPorVenda)} por venda` : ""}
              </span>
              <span className="muted-cel">acumulado desde {dm(av.ativo.inicio)}, informado por você — entra na decisão depois do aprendizado (enquanto nenhuma semana registrada cobrir essas datas)</span>
            </div>
          )}
          {n.constancia && (
            <div className="ads-semana">
              Vendas via Ads por dia: {um(n.constancia.agora)} nos últimos 3 dias × {um(n.constancia.antes)} nos 3 anteriores ({n.constancia.variacao >= 0 ? "+" : ""}
              {Math.round(n.constancia.variacao * 100)}%)
            </div>
          )}
          {n.roasSemana != null && (
            <div className="ads-semana">
              {n.medida?.fonte === "andamento" ? `${vals.ultimoAjuste && vals.ultimoAjuste > av.ativo.inicio ? "Desde o último ajuste" : "Desde o início"} (até ${dm(n.medida.ate)})` : "Última semana"}: ROAS <b className={`ads-roas${tomRoas(n.roasSemana)}`}>{um(n.roasSemana)}</b> · gastou {BRL(n.gastoSemana)}
              {n.usoOrc != null ? ` (${Math.round(n.usoOrc * 100)}% do orçamento)` : ""}
              {n.organico != null ? ` · ${Math.round(n.organico * 100)}% das vendas orgânicas` : ""}
            </div>
          )}
        </div>
      )}
      <div className="acoes-ads">
        {av.ativo ? (
          <>
            {/* Aumentei/Reduzi/Subi/Baixei a meta: botão do cartão "O que fazer agora" em cima. */}
            <button type="button" className="btn btn-mini" onClick={() => onAjuste({ orcamento: vals.orcamento, meta: vals.meta })}>
              Registrar ajuste
            </button>
            {av.pausado ? (
              <button type="button" className="btn btn-mini" onClick={onDespausar}>Despausei</button>
            ) : (
              av.ativo.tipo !== "teste" && <button type="button" className="btn btn-mini" onClick={onPausar} title="Pausou na Shopee pra arrumar o anúncio, sem encerrar: as métricas continuam no mesmo período">Pausei pra revisar</button>
            )}
            <button type="button" className="btn btn-mini" onClick={onAndamento}>Atualizar andamento</button>
            <button type="button" className="btn btn-mini" onClick={onEncerrar}>
              Encerrar período (pausei)
            </button>
          </>
        ) : (
          <>
            <button type="button" className={`btn btn-mini${NAO_RECOMENDA.has(av.chave) || l.semAds ? "" : " primary"}`} onClick={onNovo}>
              + Novo período de Ads
            </button>
            {l.semAds ? (
              <button type="button" className="btn btn-mini" onClick={() => onSemAds(false)}>Voltar a sugerir</button>
            ) : (
              <button type="button" className="btn btn-mini" onClick={() => onSemAds(true)} title="Some de Oportunidade, do Início e das marcas; fica em Sem Ads até você ligar ou voltar a sugerir">
                Não usar Ads por enquanto
              </button>
            )}
          </>
        )}
      </div>
      {historico.length > 0 && (
        <div className="historico-ads">
          <div className="ads-rotulo">Histórico de períodos</div>
          <table className="tabela-ads">
            <tbody>
              {historico.map(({ p, r }) => {
                const v = valoresAtuais(p);
                const ativo = periodoLigado(p, hoje);
                const nAj = Array.isArray(p.ajustes) ? p.ajustes.length : 0;
                return (
                  <tr key={p.id}>
                    <td>
                      <b>{dm(p.inicio)}–{p.fim ? dm(p.fim) : "agora"}</b>
                      {ativo && <span className="chip-ads ligado">ligado</span>}
                      {p.nota ? <div className="muted-cel">{p.nota}</div> : null}
                    </td>
                    <td className="muted-cel">
                      {v.orcamento ? `${BRL(v.orcamento)}/dia` : "—"}
                      {v.meta ? ` · meta ${um(v.meta)}` : ""}
                      {nAj > 0 ? ` · ${nAj} ajuste${nAj > 1 ? "s" : ""}` : ""}
                    </td>
                    <td className="num">
                      {BRL(r.gasto)} · {r.vendas} venda{r.vendas === 1 ? "" : "s"} · ROAS <span className={`ads-roas${tomRoas(r.roas)}`}>{um(r.roas)}</span>
                      {r.resultado && !ativo ? <div className="muted-cel">{r.resultado.texto}{p.motivo_fim && p.motivo_fim !== "encerrado" ? ` · ${p.motivo_fim}` : ""}</div> : null}
                    </td>
                    <td className="acao">
                      <button type="button" className="btn-icone" title="Excluir este período" onClick={() => onExcluir(p)}>×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="hint" style={{ margin: "4px 0 0" }}>Os números vêm do CSV do Shopee Ads (andamento) ou das semanas, o que estiver mais completo.</p>
        </div>
      )}
    </div>
  );
}

// GMV Max da Loja (v57): campanha da loja inteira, pros produtos sem Ads próprio.
function DetalheLoja({ l, hoje, onFazer, onNovo, onAjuste, onEncerrar, onPausar, onExcluir }) {
  const av = l.av;
  const n = av.numeros || {};
  const vals = av.ativo ? valoresAtuais(av.ativo) : null;
  const ac = acaoDoAds(av);
  const tipo = av.estado === "ok" ? "info" : av.estado;
  const ROT = { resolver: "Resolver agora", atencao: "Atenção", oportunidade: "Oportunidade", decisao: "Decisão sua em andamento", info: "Acompanhando" };
  return (
    <div className="detalhe-cel ads-det">
      <AgoraRampa acao={{ tipo, rotulo: ROT[tipo], titulo: av.titulo, porque: av.texto, acao: ac.botao ? ac.k : null, botao: ac.botao, depois: ac.depois }} proxima={proximaAds(av, hoje)} onAcao={onFazer} />
      {av.ativo && (
        <div className="ads-cartao">
          <div className="ads-periodo-cab">
            <span className="ads-rotulo">Campanha da loja</span>
            <b>{dm(av.ativo.inicio)} → {av.ativo.fim ? dm(av.ativo.fim) : "sem data final"}</b>
            <span className="ads-chips">
              <span className="chip-ads">meta {um(vals.meta)}</span>
              <span className="chip-ads">{vals.orcamento ? `${BRL(vals.orcamento)}/dia` : "orçamento ilimitado"}</span>
              <span className="chip-ads">equilíbrio da loja {um(l.equilibrio)}</span>
            </span>
          </div>
          <div className="ads-metricas">
            <div><span>Gasto</span><b>{BRL(n.gasto || 0)}</b></div>
            <div><span>Vendas da campanha</span><b>{BRL(n.receita || 0)}</b></div>
            <div><span>ROAS</span><b className={`ads-roas${n.roas == null || !l.equilibrio ? "" : n.roas >= l.equilibrio ? " bom" : " ruim"}`}>{um(n.roas)}</b></div>
            <div><span>Retorno</span><b>{n.retorno != null ? `${um(n.retorno)}×` : "—"}</b></div>
            <div><span>Andamento até</span><b>{n.ate ? dm(n.ate) : "—"}</b></div>
          </div>
        </div>
      )}
      <p className="hint" style={{ margin: "6px 0" }}>
        Equilíbrio da loja = faturamento ÷ lucro (antes do Ads) — {l.origemEq}. Cobre os produtos <b>sem Ads próprio</b>; os campeões seguem nas linhas deles. Entra no teto de Ads e no Vendas do mês.
      </p>
      <div className="acoes-ads">
        {av.ativo ? (
          <>
            <button type="button" className="btn btn-mini" onClick={() => onAjuste({ orcamento: vals.orcamento, meta: vals.meta })}>Registrar ajuste</button>
            {!av.pausado && <button type="button" className="btn btn-mini" onClick={onPausar}>Pausei</button>}
            <button type="button" className="btn btn-mini" onClick={onEncerrar}>Encerrar campanha</button>
          </>
        ) : (
          <button type="button" className="btn btn-mini primary" onClick={onNovo}>+ Ligar campanha da loja</button>
        )}
      </div>
      {l.periodos.length > 0 && (
        <div className="historico-ads">
          <div className="ads-rotulo">Histórico</div>
          <table className="tabela-ads">
            <tbody>
              {l.periodos.map((p) => (
                <tr key={p.id}>
                  <td><b>{dm(p.inicio)}–{p.fim ? dm(p.fim) : "agora"}</b>{periodoLigado(p, hoje) && <span className="chip-ads ligado">ligado</span>}</td>
                  <td className="muted-cel">{p.parcial?.ate ? `${BRL(p.parcial.gasto || 0)} gastos · ${BRL(p.parcial.receita || 0)} em vendas` : "sem andamento"}</td>
                  <td className="acao"><button type="button" className="btn-icone" title="Excluir" onClick={() => onExcluir(p)}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AjusteDialog({ d, hoje, salvando, onCancelar, onSalvar, onToast }) {
  const [f, setF] = useState({ data: hoje, orcamento: virg(d.orcamento ?? ""), meta: virg(d.meta ?? ""), motivo: d.motivo || "" });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const empate = d.linha.av.empate;
  const minimo = d.linha.av.minimo ?? empate;
  const { produtos, impressoras, farmConfig } = useCatalogo();
  // Aumentando o orçamento? Pergunta se a produção dá conta (decisão sua).
  const orcAtual = valoresAtuais(d.linha.av.ativo).orcamento || 0;
  const aumentando = num(f.orcamento) > orcAtual + 0.004;
  const [prodOk, setProdOk] = useState(false);
  const ult = (d.linha.semanas || []).length ? porSemana(d.linha.semanas[d.linha.semanas.length - 1]) : null;
  const vendasDia = ult ? num(ult.vendas) / 7 : null;
  const extraDia = ult && orcAtual > 0 ? (num(ult.ads_vendas) / 7) * (num(f.orcamento) / orcAtual - 1) : 0;
  const previsto = vendasDia != null ? vendasDia + Math.max(0, extraDia) : null;
  const cap = d.linha.tipo === "grupo" ? d.linha.capacidadeDia : capacidadeDoItem(d.linha.item, produtos || [], impressoras, farmConfig);
  const passa = previsto != null && cap != null && previsto > cap;
  const fmt = (v) => (v == null ? "—" : String(Math.round(v * 10) / 10).replace(".", ","));
  return (
    <EditarDialog titulo={`Ajuste de Ads — ${d.linha.item.nome}`} salvando={salvando} onCancelar={onCancelar} onSalvar={() => (aumentando && !prodOk ? onToast?.("Responda antes: consegue produzir o que vai vender?") : onSalvar(f))} salvarLabel="Registrar ajuste" classe="modal-box-md">
      <p className="hint" style={{ marginTop: 0 }}>Registre a mudança que você fez na plataforma. Depois dela, o app volta a esperar uns dias de aprendizado antes de sugerir outra.</p>
      <div className="grid-auto">
        <div className="field"><label>Data</label><input type="date" value={f.data} onChange={set("data")} /></div>
        <div className="field"><label>Orçamento diário (R$)</label><input type="text" inputMode="decimal" value={f.orcamento} onChange={set("orcamento")} /></div>
        <div className="field"><label>Meta de ROAS</label><input type="text" inputMode="decimal" value={f.meta} onChange={set("meta")} /></div>
      </div>
      {minimo && f.meta !== "" && num(f.meta) < minimo && (
        <div className="alerta alerta-warn">
          <b>Meta abaixo {minimo !== empate ? `do mínimo da temporada (${um(minimo)})` : `do ROAS de equilíbrio (${um(empate)})`}</b>
          {minimo !== empate ? "Na temporada o Ads tem que deixar pelo menos metade do lucro de cada venda." : "Com essa meta, a plataforma pode vender com prejuízo pra você."}
        </div>
      )}
      {aumentando && (
        <div className={`alerta ${passa ? "alerta-warn" : "alerta-neutro"}`}>
          <b>Consegue produzir?</b>
          {previsto != null ? `Com o orçamento novo você deve vender ~${fmt(previsto)} por dia (hoje ~${fmt(vendasDia)}). ` : "Ainda sem semana registrada pra estimar as vendas. "}
          {cap != null ? `Sua farm faz ~${cap} por dia deste item.` : "Sem tempo de impressão cadastrado pra calcular a capacidade da farm."}
          {passa ? " ⚠ Passa do que a farm produz hoje — considere outra impressora ou mantenha o orçamento." : ""}
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button type="button" className={`btn btn-mini${prodOk ? " primary" : ""}`} onClick={() => setProdOk(true)}>
              {prodOk ? "✓ Sim, consigo produzir" : "Sim, consigo produzir"}
            </button>
            <button
              type="button"
              className="btn btn-mini"
              onClick={() => {
                onToast?.("Ok — orçamento mantido. Veja a capacidade em Produção → Minha farm.");
                onCancelar();
              }}
            >
              Não — manter o orçamento
            </button>
          </div>
        </div>
      )}
      <div className="field"><label>Motivo (opcional)</label><input type="text" value={f.motivo} onChange={set("motivo")} /></div>
    </EditarDialog>
  );
}

function RegrasAds({ regrasA, salvando, onSalvar }) {
  const [f, setF] = useState({ aumento: String(Math.round(regrasA.aumento * 100)) });
  return (
    <div className="pad-painel">
      <div className="grid-auto">
        <div className="field"><label>Aumento por semana (%)</label><input type="number" min="1" max="100" value={f.aumento} onChange={(e) => setF((p) => ({ ...p, aumento: e.target.value }))} /></div>
      </div>
      <button type="button" className="btn primary" disabled={salvando} onClick={() => onSalvar(f)}>{salvando ? "Salvando…" : "Salvar regras"}</button>
    </div>
  );
}

// Andamento do Ads (v48): números ACUMULADOS desde o início de cada período
// ligado, até a data escolhida — à mão ou pelo CSV do Shopee Ads (todos de
// uma vez). Cada envio substitui o anterior; não encerra nada. Desde o plano
// de 14/10/2026 o andamento entra na decisão (depois do aprendizado). O CSV
// também pergunta (só age no "Sim"): período encerrado no app com gasto
// depois do fim → estender o fim; gasto sem período → criar o período.
function AndamentoDialog({ linhas, todas = [], hoje, salvando, onCancelar, onSalvar, onEstender, onCriar, onToast }) {
  const ontem = (() => {
    const d = new Date(`${hoje || hojeSP()}T12:00:00`);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const [ate, setAte] = useState(ontem);
  const [vals, setVals] = useState(() =>
    Object.fromEntries(
      linhas.map((l) => {
        const a = andamentoValido(l.av.ativo, l.semanas);
        const rec = l.tipo === "loja" && l.av.ativo?.parcial?.receita != null ? virg(l.av.ativo.parcial.receita) : "";
        return [l.chave, a ? { gasto: virg(a.gasto), cliques: String(a.cliques), vendas: String(a.vendas), receita: rec } : { gasto: "", cliques: "", vendas: "", receita: "" }];
      })
    )
  );
  const [doCsv, setDoCsv] = useState(() => new Set());
  const [avisos, setAvisos] = useState([]);
  const [perguntas, setPerguntas] = useState([]); // [{ chave, l, tipo: 'estender'|'criar', periodo?, data, valores }]
  const [lendo, setLendo] = useState(false);
  const esc = useEscada();
  const set = (chave, k) => (e) => setVals((p) => ({ ...p, [chave]: { ...p[chave], [k]: e.target.value } }));

  async function importar(e) {
    const arquivos = Array.from(e.target.files || []);
    e.target.value = "";
    if (!arquivos.length) return;
    setLendo(true);
    try {
      const lidos = [];
      for (const a of arquivos) lidos.push(await lerRelatorio(a));
      // Desempenho junto: aprende qual anúncio da Shopee é cada anúncio com vários itens.
      const canalShopee = (esc.canais || []).find((c) => c.tipo === "shopee") || null;
      if (canalShopee && lidos.some((r) => r.tipo === "desempenho"))
        cruzarGrupos(
          lidos,
          (esc.gruposAnuncio || [])
            .map((g) => ({ g, ficha: fichaDoGrupo({ grupo: g, canal: canalShopee, itens: esc.itens, precos: esc.precos, produtos: esc.produtos, kits: esc.kits, mapaRampa: esc.mapaRampa, publicacoes: esc.publicacoesCanal, clientePagaHoje: esc.clientePagaHoje }) }))
            .filter((x) => x.ficha)
            .map(({ g, ficha }) => ({ id: g.id, nome: g.nome, opcoes: ficha.opcoes.map((o, idx) => ({ idx, skus: ficha.linhas.filter((l) => l.opcao === o).map((l) => l.sku) })) }))
        );
      const shopeeTodas = todas.filter((l) => l.canal.tipo === "shopee");
      const res = adsPorItemApp(lidos, shopeeTodas.map((l) => ({ chave: l.chave, sku: l.item.sku, grupoId: l.tipo === "grupo" ? l.id : null })));
      const shopee = linhas.filter((l) => l.canal.tipo === "shopee");
      const marc = new Set();
      setVals((p) => {
        const n = { ...p };
        for (const l of shopee) {
          const x = res.porChave[l.chave];
          // Sem linha no CSV (e SKU já conhecido) = sem gasto no período exportado.
          if (x) n[l.chave] = { gasto: virg(x.gasto), cliques: String(x.cliques), vendas: String(x.vendas) };
          else if (res.zerados.includes(l.chave)) n[l.chave] = { gasto: "0", cliques: "0", vendas: "0" };
          else continue;
          marc.add(l.chave);
        }
        return n;
      });
      setDoCsv(marc);
      if (res.periodo?.ate) setAte(res.periodo.ate);
      const av = [...res.avisos];
      if (res.periodo?.de)
        for (const l of shopee)
          if (res.periodo.de > l.av.ativo.inicio)
            av.push(`${l.item.nome}: o CSV começa em ${dm(res.periodo.de)}, mas o período de Ads começou em ${dm(l.av.ativo.inicio)} — exporte desde o início do período (o andamento é acumulado).`);
      // Gasto no CSV de item SEM período ligado: estender o último ou criar um.
      const pergs = [];
      if (res.periodo?.de && res.periodo?.ate)
        for (const l of shopeeTodas) {
          if (l.av.ativo) continue;
          const x = res.porChave[l.chave];
          if (!x || !(x.gasto > 0)) continue;
          const ult = (l.periodos || [])[0] || null;
          const valores = { gasto: x.gasto, cliques: x.cliques, vendas: x.vendas };
          if (ult && ult.fim && ult.fim < res.periodo.ate && ult.fim >= somarDias(res.periodo.de, -1))
            pergs.push({ chave: l.chave, l, tipo: "estender", periodo: ult, data: res.periodo.ate, valores });
          else if (!ult || !ult.fim || ult.fim < res.periodo.de) pergs.push({ chave: l.chave, l, tipo: "criar", data: res.periodo.de, ate: res.periodo.ate, valores });
        }
      setPerguntas(pergs);
      for (const a of res.adsSemPar.filter((x) => x.conhecido)) av.push(`Anúncio ${a.nome || a.itemId}: ${BRL(a.gasto)} de Ads, mas não está ligado a nenhum produto/anúncio do app com preço salvo.`);
      setAvisos(av);
    } catch (err) {
      onToast?.(err.message || "Não foi possível ler o arquivo");
    } finally {
      setLendo(false);
    }
  }

  async function responder(q, sim) {
    if (sim) {
      const ok = q.tipo === "estender" ? await onEstender(q.l, q.periodo, q.data) : await onCriar(q.l, q.data, q.ate, q.valores);
      if (!ok) return;
    }
    setPerguntas((p) => p.filter((x) => x.chave !== q.chave));
  }

  function salvar() {
    const lista = [];
    for (const l of linhas) {
      const v = vals[l.chave];
      if (!v || [v.gasto, v.cliques, v.vendas, v.receita].every((x) => x === "" || x == null)) continue;
      lista.push({ periodo: l.av.ativo, valores: { ate, gasto: num(v.gasto), cliques: Math.round(num(v.cliques)), vendas: Math.round(num(v.vendas)), ...(l.tipo === "loja" ? { receita: num(v.receita) } : {}) } });
    }
    onSalvar(lista);
  }

  return (
    <EditarDialog titulo="Atualizar andamento do Ads" classe="modal-andamento" salvando={salvando} onCancelar={onCancelar} onSalvar={salvar} salvarLabel="Salvar andamento">
      <p className="hint" style={{ marginTop: 0 }}>
        Números <b>acumulados desde o início</b> de cada período de Ads até a data abaixo. Cada envio <b>substitui</b> o anterior (nunca soma). Não encerra o período. Depois do aprendizado, a
        decisão do Ads usa o andamento mais novo — atualize a cada 3 dias. As semanas são montadas sozinhas com os pedidos e esse CSV.
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 10 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Até (inclusive)</label>
          <input type="date" value={ate} max={hoje} onChange={(e) => setAte(e.target.value)} />
        </div>
        <button
          type="button"
          className="btn btn-mini primary"
          onClick={() => {
            onCancelar();
            trocarSubAba("ohra:analise-sub", "importar");
            irParaAba("analise");
          }}
        >
          📥 CSV do Shopee Ads: enviar na central →
        </button>
        <label className="btn btn-mini" style={{ cursor: "pointer" }} title="Também dá pra escolher o CSV aqui">
          {lendo ? "Lendo…" : "📄 arquivo"}
          <input type="file" accept=".csv,.xlsx" multiple hidden onChange={importar} />
        </label>
        <Ajuda texto="Shopee: Marketing → Shopee Ads → escolha o período DO INÍCIO do período de Ads até ontem → Exportar dados → Dados Gerais de Anúncios. O app liga cada anúncio ao produto pelo SKU (e o anúncio com vários itens pelas variações) — se pedir, importe junto (uma vez) o relatório de desempenho do produto; depois ele lembra." />
      </div>
      {perguntas.map((q) => (
        <div key={q.chave} className="alerta alerta-warn" style={{ margin: "0 0 8px" }}>
          <b>
            {q.l.item.nome}: {BRL(q.valores.gasto)} de Ads no CSV
          </b>
          {q.tipo === "estender"
            ? `O período terminou em ${dm(q.periodo.fim)} no app, mas o CSV vai até ${dm(q.data)} com gasto. Estender o fim até ${dm(q.data)}?`
            : `Não há período de Ads ligado no app. Criar um período a partir de ${dm(q.data)} (início do CSV), com o andamento até ${dm(q.ate)}?`}
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button type="button" className="btn btn-mini primary" disabled={salvando} onClick={() => responder(q, true)}>
              Sim
            </button>
            <button type="button" className="btn btn-mini" disabled={salvando} onClick={() => responder(q, false)}>
              Não
            </button>
          </div>
        </div>
      ))}
      {avisos.map((a) => (
        <div key={a} className="alerta alerta-warn" style={{ margin: "0 0 8px" }}>{a}</div>
      ))}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th className="num">Gasto (R$)</th>
              <th className="num">Cliques</th>
              <th className="num">Vendas via Ads</th>
              {linhas.some((l) => l.tipo === "loja") && <th className="num">Vendas (R$)</th>}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const v = vals[l.chave] || {};
              const cls = doCsv.has(l.chave) ? "campo-importado" : undefined;
              const a = andamentoValido(l.av.ativo, l.semanas);
              return (
                <tr key={l.chave}>
                  <td style={{ minWidth: 200 }}>
                    <b>{l.item.nome}</b> <CanalTag canal={l.canal} />
                    <div className="muted-cel">
                      período desde {dm(l.av.ativo.inicio)}
                      {a ? ` · último andamento até ${dm(a.ate)}` : ""}
                    </div>
                  </td>
                  <td className="num"><input type="text" inputMode="decimal" className={cls} style={{ width: 90 }} value={v.gasto ?? ""} onChange={set(l.chave, "gasto")} /></td>
                  <td className="num"><input type="text" inputMode="numeric" className={cls} style={{ width: 70 }} value={v.cliques ?? ""} onChange={set(l.chave, "cliques")} /></td>
                  <td className="num"><input type="text" inputMode="numeric" className={cls} style={{ width: 70 }} value={v.vendas ?? ""} onChange={set(l.chave, "vendas")} /></td>
                  {linhas.some((x) => x.tipo === "loja") && (
                    <td className="num">
                      {l.tipo === "loja" ? <input type="text" inputMode="decimal" style={{ width: 90 }} value={v.receita ?? ""} onChange={set(l.chave, "receita")} placeholder="GMV" title="Vendas da campanha da loja em R$ (GMV) desde o início" /> : null}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </EditarDialog>
  );
}

// Teto de Ads da loja (out/2026): tabela progressiva — cada % vale só pro
// pedaço do faturamento (últimos 30 dias) dentro da faixa — e nunca mais que
// metade do lucro do período. Percentuais editáveis (lojas.config_escada.ads.faixasTeto).
function TabelaTeto({ regrasA, T, salvando, onSalvar }) {
  const faixas = regrasA.faixasTeto || REGRAS_ADS.faixasTeto;
  const [edit, setEdit] = useState(null);
  const paraEdit = (fs) => fs.map((x) => (x.fixo != null ? { ...x, fixo: String(x.fixo).replace(".", ",") } : { ...x, pct: String(Math.round(x.pct * 1000) / 10).replace(".", ",") }));
  const lista = edit ?? paraEdit(faixas);
  const comoNum = lista.map((x) => (x.fixo != null ? { ate: x.ate, fixo: num(x.fixo) } : { ate: x.ate, pct: num(x.pct) / 100 }));
  const tetoTabela = tetoPorFaixas(T.faturamento, comoNum);
  const inicios = lista.map((_, i) => (i === 0 ? 0 : num(lista[i - 1].ate)));
  return (
    <div className="panel">
      <h3 className="section-title">
        Teto de Ads da loja — fase {faseDaLoja(T.faturamento)}
        <Ajuda texto="O Ads é acelerador, a loja é orgânica. Até R$ 1.000 vale um valor fixo (loja começando). Acima disso, cada percentual vale só pro pedaço do faturamento dentro da faixa (como imposto de renda), então vender mais nunca diminui a verba — e o teto nunca passa de metade do lucro dos últimos 30 dias (já sem custo de produção e taxas), sem cair abaixo do valor fixo. É teto, não meta: quem decide aumentar é o lucro de cada produto." />
      </h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Faixa do faturamento (30 dias)</th>
              <th className="num">Quanto pode</th>
              <th>Fase</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((x, i) => {
              const ini = inicios[i];
              const fim = x.ate == null ? null : num(x.ate);
              const atual = T.faturamento > ini && (fim == null || T.faturamento <= fim) ? true : T.faturamento === 0 && i === 0;
              return (
                <tr key={i} className={atual ? "linha-sel" : undefined}>
                  <td>{fim == null ? `acima de ${BRL(ini)}` : ini === 0 ? `até ${BRL(fim)}` : `${BRL(ini)} a ${BRL(fim)}`}{atual ? " ← você está aqui" : ""}</td>
                  <td className="num">
                    {x.fixo != null ? (
                      <>
                        R$ <input type="text" inputMode="decimal" style={{ width: 70, textAlign: "right" }} value={x.fixo} onChange={(e) => setEdit(lista.map((y, j) => (j === i ? { ...y, fixo: e.target.value } : y)))} /> fixo
                      </>
                    ) : (
                      <>
                        <input type="text" inputMode="decimal" style={{ width: 70, textAlign: "right" }} value={x.pct} onChange={(e) => setEdit(lista.map((y, j) => (j === i ? { ...y, pct: e.target.value } : y)))} />% do pedaço
                      </>
                    )}
                  </td>
                  <td className="muted-cel">{faseDaLoja(fim ?? ini + 1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="pad-painel">
        Últimos 30 dias: faturamento {BRL(T.faturamento)} · pela tabela {BRL(tetoTabela)} · metade do lucro {BRL(T.pelaTrava)} → <b>teto {BRL(T.teto)}</b> · gasto {BRL(T.gasto)}
        {edit && (
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" className="btn btn-mini primary" disabled={salvando} onClick={() => onSalvar(comoNum)}>{salvando ? "Salvando…" : "Salvar tabela"}</button>
            <button type="button" className="btn btn-mini" onClick={() => setEdit(null)}>Cancelar</button>
            <button type="button" className="link-btn" onClick={() => setEdit(paraEdit(REGRAS_ADS.faixasTeto))}>voltar ao padrão</button>
          </div>
        )}
      </div>
    </div>
  );
}
