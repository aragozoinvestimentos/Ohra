import { useMemo, useState } from "react";
import { BRL } from "../lib/format.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { lerXls } from "../lib/lerXls.js";
import { andamentoDoCsv, juntarAds, juntarDesempenho, cruzarGrupos, lembrarIdsShopee, lerRelatorio, lerXlsx, relatorioDoGuardado, relatorioParaGuardar } from "../lib/relatorioShopee.js";
import { PLATAFORMAS, caixaDosPedidos, interpretarPedidosOlist, ligarSku, plataformaDoNumero, tipoEIdDoItem, normSku } from "../lib/pedidos.js";
import { excluirVendaFisica, gravarPedidos, ignorarSku, registrarImportacao, registrarVendaFisica, sincronizarCaixa } from "../lib/pedidosAcoes.js";
import { EmbalagemOrganicoVenda } from "./EmbalagemOrganico.jsx";
import { canalComEmbalagem } from "../lib/embalagemCanal.js";
import { estenderPeriodoAds, iniciarPeriodoAds, salvarAndamentoAds } from "../lib/adsAcoes.js";
import { fichaDoGrupo } from "../lib/anunciosGrupo.js";
import { recarregarPedidos } from "../hooks/usePedidos.js";
import { gruposDoSeletor } from "../lib/variacoes.js";
import { irParaAba } from "../lib/navegar.js";
import { trocarSubAba } from "../lib/subAbas.js";
import { canalDireto } from "../lib/canais.js";
import CanalTag from "./CanalTag.jsx";
import BuscaItem from "./BuscaItem.jsx";
import Ajuda from "./Ajuda.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";

// Aba Análise → 1 · Importar dados (schema v55): UM lugar pra subir todos os
// arquivos. Um bloco por plataforma (padrão igual pra todas): pedidos da
// Olist + os relatórios de anúncio da plataforma (Shopee: Desempenho e Ads).
// Cada botão mostra de onde puxar, o último envio e ✓/✗; arquivo errado não
// importa nada. Venda física fica no cartão próprio. Pedidos ENTREGUES viram
// entrada no Fluxo de Caixa (uma por plataforma × semana); enviados = a receber.
const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const dm = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : "");
const diasDesde = (iso, hoje) => (iso ? Math.round((new Date(`${hoje}T12:00:00`) - new Date(`${String(iso).slice(0, 10)}T12:00:00`)) / 86400000) : null);
const dataDoEnvio = (imp) => (imp?.criado_em ? new Date(imp.criado_em).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }) : null);
const ICONE = { ok: "✓", erro: "✗", velho: "!", nunca: "–", pend: "?" };
const CHAVE_CONFERIDA = "ohra:plataforma-conferida";
const horaSP = (iso) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }) : "");
// Identifica uma lista pelo conteúdo (os nomes dos arquivos da Shopee costumam ser iguais).
const assinatura = (r) => (r.tipo === "ads" ? [...r.porItem.entries()].map(([id, a]) => `${id}:${a.gasto}`).sort().join(",") : (r.itens || []).map((i) => i.itemId).sort().join(","));
const conferidas = () => {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_CONFERIDA) || "{}") || {};
  } catch {
    return {};
  }
};

async function lerPlanilha(arquivo) {
  const buf = await arquivo.arrayBuffer();
  const b = new Uint8Array(buf);
  if (b[0] === 0x50 && b[1] === 0x4b) return (await lerXlsx(buf))[0]?.linhas || [];
  return lerXls(buf);
}

export default function CentralImportacao({ esc, ped, linhas, linhasAds, hoje, onToast }) {
  const { lojaId } = useLoja();
  const { itens, canais, produtos, kits, precos, cfgDoProduto, gruposAnuncio: grupos = [] } = esc;
  const [resultado, setResultado] = useState({}); // relatorio → { t, txt }
  const [pend, setPend] = useState(null); // { plat, canal, itens, pendentes:[{sku, descricao, un}], arquivo, periodo }
  const [perguntas, setPerguntas] = useState([]);
  const [avisos, setAvisos] = useState({}); // relatorio → [texto]
  const [ocupado, setOcupado] = useState(null);
  const [fisico, setFisico] = useState(null); // form aberto
  const [excluir, setExcluir] = useState(null);
  const ignorados = useMemo(() => new Set((ped.ignorados || []).map((g) => normSku(g.sku))), [ped.ignorados]);
  const okOrdenadas = useMemo(() => (ped.importacoes || []).filter((i) => i.ok).sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em))), [ped.importacoes]);
  const ultimaImp = (rel) => [...okOrdenadas].reverse().find((i) => i.relatorio === rel) || null;
  const ctx = { itens, canais, cfgDoProduto, itemNoCanal: esc.itemNoCanal };

  // ---------- Pedidos da Olist ----------
  async function enviarPedidos(plat, canal, arquivo) {
    const rel = `pedidos:${plat.id}`;
    setOcupado(rel);
    try {
      const { itens: lidos, periodo, plataformas } = interpretarPedidosOlist(await lerPlanilha(arquivo));
      const outras = [...plataformas].filter((x) => x && x !== plat.id);
      if (outras.length) {
        const nome = PLATAFORMAS.find((p) => p.id === outras[0])?.nome;
        throw new Error(`Os pedidos deste arquivo não parecem da ${plat.nome} (o número ${lidos.find((i) => plataformaDoNumero(i.ordem_compra) === outras[0])?.ordem_compra} é do ${nome}). Nada foi importado.`);
      }
      if (!plat.conferido && !plataformas.has(plat.id) && !conferidas()[plat.id]) {
        setPend({ plat, canal, lidos, periodo, arquivo: arquivo.name, confirmar: true });
        setOcupado(null);
        return;
      }
      prepararSkus(plat, canal, lidos, periodo, arquivo.name);
    } catch (e) {
      setResultado((r) => ({ ...r, [rel]: { t: "erro", txt: e.message || "Não foi possível ler o arquivo." } }));
    }
    setOcupado(null);
  }
  function prepararSkus(plat, canal, lidos, periodo, arquivo) {
    const ligados = lidos.map((i) => ({ ...i, it: ligarSku(i.sku, itens) }));
    const pendMap = new Map();
    for (const i of ligados)
      if (!i.it && i.sku && !ignorados.has(i.sku)) {
        const x = pendMap.get(i.sku) || { sku: i.sku, descricao: i.descricao, un: 0 };
        x.un += num(i.quantidade);
        pendMap.set(i.sku, x);
      }
    if (pendMap.size) setPend({ plat, canal, lidos: ligados, periodo, arquivo, pendentes: [...pendMap.values()], resolvidos: {} });
    else gravar(plat, canal, ligados, periodo, arquivo);
  }
  async function gravar(plat, canal, ligados, periodo, arquivo) {
    const rel = `pedidos:${plat.id}`;
    setOcupado(rel);
    setPend(null);
    const existentes = new Set((ped.pedidos || []).map((p) => p.chave));
    const validos = ligados.filter((i) => i.it);
    const semItem = ligados.filter((i) => !i.it);
    const rows = validos.map(({ it, ...i }) => ({ ...i, canal_id: canal.id, plataforma: plat.id, ...tipoEIdDoItem(it) }));
    const r = await gravarPedidos({ lojaId, linhas: rows });
    if (!r.ok) {
      setResultado((x) => ({ ...x, [rel]: { t: "erro", txt: r.msg } }));
      setOcupado(null);
      return;
    }
    const novos = rows.filter((x) => !existentes.has(x.chave)).length;
    const cancel = new Set(rows.filter((x) => /cancel|devolv/i.test(x.situacao)).map((x) => x.pedido)).size;
    // Caixa com todos os pedidos (os de antes + estes)
    const porChave = new Map((ped.pedidos || []).map((p) => [p.chave, p]));
    for (const x of rows) porChave.set(x.chave, { ...porChave.get(x.chave), ...x });
    const cx = await sincronizarCaixa({ lojaId, pedidos: [...porChave.values()], ctx });
    const pedN = new Set(rows.map((x) => x.pedido)).size;
    const resumo = `${dm(periodo.de)} a ${dm(periodo.ate)} · ${pedN} pedido${pedN === 1 ? "" : "s"} no arquivo, ${novos} ite${novos === 1 ? "m novo" : "ns novos"}${cancel ? ` (${cancel} cancelado${cancel > 1 ? "s" : ""})` : ""}${semItem.length ? ` · ${new Set(semItem.map((i) => i.sku)).size} SKU fora (pendente/descartado)` : ""}`;
    await registrarImportacao({ lojaId, relatorio: rel, arquivo, periodo, ok: true, resumo });
    setResultado((x) => ({ ...x, [rel]: { t: "ok", txt: `${resumo} · agora` } }));
    setAvisos((a) => ({ ...a, [rel]: cx.ok ? cx.avisos : [cx.msg] }));
    recarregarPedidos();
    window.dispatchEvent(new Event("focus"));
    setOcupado(null);
    onToast?.(`${plat.nome}: pedidos importados${cx.ok ? " · Fluxo de Caixa atualizado (entregues)" : ""}`);
  }
  async function descartarSku(sku) {
    const r = await ignorarSku({ lojaId, sku });
    if (!r.ok) return onToast?.(r.msg);
    setPend((p) => (p ? { ...p, resolvidos: { ...p.resolvidos, [sku]: "desc" } } : p));
  }
  function cadastrarSku(sku) {
    try {
      navigator.clipboard?.writeText(sku);
    } catch {
      // sem área de transferência
    }
    setPend((p) => (p ? { ...p, resolvidos: { ...p.resolvidos, [sku]: "cad" } } : p));
    onToast?.(`SKU ${sku} copiado — cole no cadastro do produto. Depois reenvie o arquivo pra completar.`);
    trocarSubAba("ohra:cadastros-sub", "produtos");
    irParaAba("cadastros");
  }

  // ---------- Shopee: Desempenho e Ads ----------
  const shopee = canais.find((c) => c.tipo === "shopee") || null;
  function aprenderGrupos(lidos) {
    if (!shopee || !lidos.some((r) => r.tipo === "desempenho")) return;
    cruzarGrupos(
      lidos,
      grupos
        .map((g) => ({ g, ficha: fichaDoGrupo({ grupo: g, canal: shopee, itens, precos, produtos, kits, mapaRampa: esc.mapaRampa, publicacoes: esc.publicacoesCanal, clientePagaHoje: esc.clientePagaHoje }) }))
        .filter((x) => x.ficha)
        .map(({ g, ficha }) => ({ id: g.id, nome: g.nome, opcoes: ficha.opcoes.map((o, idx) => ({ idx, skus: ficha.linhas.filter((l) => l.opcao === o).map((l) => l.sku) })) }))
    );
  }
  async function enviarShopee(tipo, arquivos) {
    const rel = `shopee:${tipo}`;
    setOcupado(rel);
    try {
      const lidos = [];
      for (const a of arquivos) lidos.push(await lerRelatorio(a));
      if (lidos.some((x) => x.tipo !== tipo)) throw new Error(tipo === "desempenho" ? "Isto é o CSV do Shopee Ads — suba no botão “Ads (CSV)”. Nada foi importado." : "Isto é o relatório de Desempenho — suba no botão “Desempenho do produto”. Nada foi importado.");
      // A Shopee separa os anúncios em listas (melhor desempenho, recém-cadastrados…):
      // os arquivos escolhidos juntos viram um relatório só.
      const juntar = tipo === "ads" ? juntarAds : juntarDesempenho;
      const novo = juntar(lidos);
      if (novo.periodosDiferentes) throw new Error(`Os arquivos têm períodos diferentes — exporte todas as listas com o mesmo período${tipo === "ads" ? " (do início do período de Ads até ontem)" : ""}. Nada foi importado.`);
      // Listas enviadas uma de cada vez: junta com as já enviadas do MESMO período
      // (a mesma lista enviada de novo substitui a anterior, não soma).
      const ant = ultimaImp(rel);
      const mesmoPeriodo = ant?.dados && novo.periodo && String(ant.periodo_de).slice(0, 10) === novo.periodo.de && String(ant.periodo_ate).slice(0, 10) === novo.periodo.ate;
      const partesAnt = mesmoPeriodo ? (ant.dados.partes || [{ ...ant.dados, arquivo: ant.arquivo, em: ant.criado_em }]).map(relatorioDoGuardado).filter(Boolean) : [];
      const agora = new Date().toISOString();
      const novas = lidos.map((x) => ({ ...x, em: agora }));
      const assinNovas = new Set(novas.map(assinatura));
      const partes = [...partesAnt.filter((x) => !assinNovas.has(assinatura(x))), ...novas];
      const r = juntar(partes.map((x, i) => ({ ...x, arquivo: `${i}|${x.arquivo || ""}` })));
      const listas = partes.map((x) => {
        const n = tipo === "ads" ? x.porItem.size : (x.itens || []).length;
        return `${n} anúncio${n === 1 ? "" : "s"} (${horaSP(x.em)})`;
      });
      const txtListas = partes.length > 1 ? ` · ${partes.length} listas: ${listas.join(" + ")}` : "";
      const arquivo = { name: partes.map((x) => x.arquivo).filter(Boolean).join(" + ") || arquivos[0].name };
      lembrarIdsShopee([r]);
      aprenderGrupos([r]);
      let resumo = "";
      if (tipo === "desempenho") {
        const lig = (r.itens || []).filter((i) => ligarSku(i.sku, itens)).length;
        resumo = `${dm(r.periodo?.de)} a ${dm(r.periodo?.ate)}${txtListas} · ${(r.itens || []).length} anúncios no total, ${lig} ligados ao app — o Registrar semana já vem preenchido`;
      } else {
        const res = andamentoDoCsv([r], linhasAds?.linhas || []);
        let n = 0;
        for (const l of (linhasAds?.linhas || []).filter((x) => x.av?.ativo && x.canal?.tipo === "shopee")) {
          const x = res.porChave[l.chave] || (res.zerados.includes(l.chave) ? { gasto: 0, cliques: 0, vendas: 0 } : null);
          if (!x || !res.periodo?.ate) continue;
          const s = await salvarAndamentoAds(l.av.ativo, { ate: res.periodo.ate, gasto: num(x.gasto), cliques: Math.round(num(x.cliques)), vendas: Math.round(num(x.vendas)) });
          if (!s.ok) throw new Error(s.msg);
          n++;
        }
        setPerguntas(res.perguntas || []);
        setAvisos((a) => ({ ...a, [rel]: res.avisos || [] }));
        resumo = `${dm(res.periodo?.de)} a ${dm(res.periodo?.ate)}${txtListas} · andamento atualizado em ${n} anúncio${n === 1 ? "" : "s"} com Ads ligado`;
        window.dispatchEvent(new Event("focus"));
      }
      const g = await registrarImportacao({ lojaId, relatorio: rel, arquivo: arquivo.name, periodo: r.periodo, ok: true, resumo, dados: { ...relatorioParaGuardar({ ...r, arquivo: arquivo.name }), partes: partes.map(relatorioParaGuardar) } });
      if (!g.ok) throw new Error(g.msg);
      setResultado((x) => ({ ...x, [rel]: { t: "ok", txt: `${resumo} · enviado agora (${horaSP(agora)})${partesAnt.length && partes.length > partesAnt.length ? " — juntou com a lista anterior" : ""}` } }));
      recarregarPedidos();
    } catch (e) {
      setResultado((x) => ({ ...x, [rel]: { t: "erro", txt: e.message || "Não foi possível ler o arquivo." } }));
    }
    setOcupado(null);
  }
  async function responder(q, sim) {
    if (sim) {
      const r =
        q.tipo === "estender"
          ? await estenderPeriodoAds(q.periodo, q.data)
          : await (async () => {
              const c = await iniciarPeriodoAds({ lojaId, tipo: q.l.tipo, id: q.l.id, canalId: q.l.canal.id, inicio: q.data, nota: "criado pelo CSV do Shopee Ads" });
              if (c.ok && c.periodo) await salvarAndamentoAds(c.periodo, { ate: q.ate, ...q.valores });
              return c;
            })();
      if (!r.ok) return onToast?.(r.msg);
      window.dispatchEvent(new Event("focus"));
      onToast?.(q.tipo === "estender" ? `${q.l.item.nome}: fim do período estendido até ${dm(q.data)}` : `${q.l.item.nome}: período de Ads criado desde ${dm(q.data)}`);
    }
    setPerguntas((p) => p.filter((x) => x.chave !== q.chave));
  }

  // ---------- Status de cada botão ----------
  function status(rel, limiteDias) {
    const r = resultado[rel];
    if (r) return r;
    const u = ultimaImp(rel);
    if (!u) return { t: "nunca", txt: "nunca enviado" };
    const d = diasDesde(dataDoEnvio(u), hoje);
    const quando = (d === 0 ? "hoje" : d === 1 ? "ontem" : `há ${d} dias`) + (d <= 1 ? ` às ${horaSP(u.criado_em)}` : "");
    return { t: d > limiteDias ? "velho" : "ok", txt: `${u.resumo || ""} · enviado ${quando}${d > limiteDias ? " — hora de atualizar" : ""}` };
  }
  // Chamado como função (não como <Componente/>): definido dentro do render,
  // um componente seria recriado a cada atualização e o <input type=file>
  // remontado — a escolha do arquivo se perdia se a tela atualizasse com a
  // janela de arquivos aberta (era preciso enviar 2 vezes).
  const relat = ({ rel, nome, onde, limite, onArquivo, aceita = ".xls,.xlsx,.csv", multiplo = false }) => {
    const st = status(rel, limite);
    return (
      <div className="ana-relat">
        <div className="ana-relat-nome">{nome}</div>
        <label className={`btn btn-mini${st.t === "velho" || st.t === "nunca" ? " primary" : ""}${ocupado ? " disabled" : ""}`}>
          {ocupado === rel ? "Lendo…" : "Enviar arquivo"}
          <input type="file" accept={aceita} hidden multiple={multiplo} disabled={!!ocupado} onChange={(e) => { const fs = Array.from(e.target.files || []); e.target.value = ""; if (fs.length) onArquivo(multiplo ? fs : fs[0]); }} />
        </label>
        <div className="ana-relat-onde">De onde puxar: {onde}</div>
        <div className={`ana-status ${st.t}`}>
          <span className="ic">{ICONE[st.t]}</span>
          <span>{st.txt}</span>
        </div>
        {(avisos[rel] || []).map((a) => (
          <div key={a} className="ana-aviso">⚠ {a}</div>
        ))}
      </div>
    );
  };

  // ---------- Venda física ----------
  const fisicas = useMemo(() => (ped.pedidos || []).filter((p) => p.origem === "fisico").sort((a, b) => String(b.data).localeCompare(String(a.data))), [ped.pedidos]);
  const mes = hoje.slice(0, 7);
  const fisMes = fisicas.filter((f) => String(f.data).slice(0, 7) === mes);
  const gruposBusca = useMemo(() => gruposDoSeletor(itens), [itens]);
  const precoSugerido = (itemId) => {
    const tipo = { p: "produto", v: "variacao", k: "kit" }[itemId?.[0]];
    const diretos = canais.filter((c) => canalDireto(c));
    const s = precos.find((p) => p.item_tipo === tipo && p.item_id === itemId?.slice(2) && diretos.some((c) => c.id === p.canal_id)) || precos.find((p) => p.item_tipo === tipo && p.item_id === itemId?.slice(2));
    return s ? String(s.preco).replace(".", ",") : "";
  };
  async function salvarFisico() {
    const item = itens.find((i) => i.id === fisico.itemId);
    if (!item) return onToast?.("Escolha o produto");
    if (!(num(fisico.qtd) > 0) || !(num(fisico.preco) > 0)) return onToast?.("Informe quantidade e preço");
    setOcupado("fisico");
    const r = await registrarVendaFisica({ lojaId, item, quantidade: num(fisico.qtd), preco: num(fisico.preco), data: fisico.data, pagamento: fisico.pagamento, observacao: fisico.obs || null });
    if (!r.ok) {
      setOcupado(null);
      return onToast?.(r.msg);
    }
    const nova = r.linha;
    await sincronizarCaixa({ lojaId, pedidos: [...(ped.pedidos || []), nova], ctx });
    setOcupado(null);
    setFisico(null);
    recarregarPedidos();
    window.dispatchEvent(new Event("focus"));
    onToast?.(`Venda física registrada: ${item.nome} × ${fisico.qtd} — entrou nas vendas e no caixa`);
  }
  async function confirmarExcluir() {
    const f = excluir;
    setExcluir(null);
    const r = await excluirVendaFisica(f.id);
    if (!r.ok) return onToast?.(r.msg);
    await sincronizarCaixa({ lojaId, pedidos: (ped.pedidos || []).filter((p) => p.id !== f.id), ctx });
    recarregarPedidos();
    window.dispatchEvent(new Event("focus"));
    onToast?.("Venda física excluída (caixa atualizado)");
  }

  // ---------- Caixa ----------
  const caixa = useMemo(() => caixaDosPedidos(linhas), [linhas]);
  const recentes = (lista) => [...lista].sort((a, b) => b.semana.localeCompare(a.semana)).slice(0, 8);
  const totRec = caixa.lancamentos.reduce((t, x) => t + x.valor, 0);
  const totArec = caixa.aReceber.reduce((t, x) => t + x.valor, 0);

  if (!ped.disponivel)
    return (
      <div className="panel">
        <h3>Importar dados</h3>
        <div className="empty">
          Falta rodar o <b>supabase/schema_v55.sql</b> no SQL Editor do Supabase (tabelas da aba Análise). Depois recarregue a página.
        </div>
      </div>
    );

  const pendentesN = PLATAFORMAS.filter((p) => canais.some((c) => c.tipo === p.tipo)).filter((p) => ["velho", "nunca"].includes(status(`pedidos:${p.id}`, 7).t) && ultimaImp(`pedidos:${p.id}`)).length;
  const cards = PLATAFORMAS.map((p) => {
    const canal = canais.find((c) => c.tipo === p.tipo) || null;
    const aviso = !canal
      ? `Canal ${p.nome} não cadastrado — cadastre em Configuração → Canais pra importar.`
      : !p.conferido && !conferidas()[p.id]
        ? `Falta conferir o formato do número do pedido — no 1º envio o app pede confirmação.${p.id === "ml" ? " Relatório de Ads do Mercado Livre: mande um exemplo quando ligar Ads lá." : ""}`
        : null;
    return (
      <div key={p.id} className={`panel${p.id === "shopee" ? " alto" : ""}`}>
        <h3>
          <CanalTag tipo={p.tipo} nome={p.nome} /> <span className="dir">pedidos pela Olist{p.id === "shopee" ? " + relatórios de anúncio" : ""}</span>
        </h3>
        {aviso && <div className="ana-relat"><div className="ana-aviso-cfg">⚠ {aviso}</div></div>}
        {canal &&
          relat({
            rel: `pedidos:${p.id}`,
            nome: "Pedidos (Olist)",
            limite: 7,
            onde: <>Olist → Vendas → Pedidos de venda → <b>E-commerce = {p.nome}</b> → período → Exportar</>,
            onArquivo: (f) => enviarPedidos(p, canal, f),
          })}
        {canal && pend && pend.plat.id === p.id && (
          <div className="ana-pend">
            {pend.confirmar ? (
              <>
                <b>1º envio da {p.nome}: confirme que estes {new Set(pend.lidos.map((i) => i.pedido)).size} pedidos ({dm(pend.periodo.de)} a {dm(pend.periodo.ate)}) são mesmo da {p.nome}.</b>
                <div className="faint">Ex.: nº no marketplace {pend.lidos[0]?.ordem_compra || "—"}. O app lembra a confirmação.</div>
                <div className="ana-pend-acoes">
                  <button type="button" className="btn btn-mini primary" onClick={() => { const c = conferidas(); c[p.id] = true; try { localStorage.setItem(CHAVE_CONFERIDA, JSON.stringify(c)); } catch { /* sem localStorage */ } prepararSkus(p, canal, pend.lidos, pend.periodo, pend.arquivo); }}>Sim, são da {p.nome}</button>
                  <button type="button" className="btn btn-mini" onClick={() => setPend(null)}>Cancelar</button>
                </div>
              </>
            ) : (
              <>
                <b>Antes de gravar: {pend.pendentes.length} SKU{pend.pendentes.length > 1 ? "s não estão cadastrados" : " não está cadastrado"} no app</b>
                {pend.pendentes.map((s) => (
                  <div key={s.sku} className="ana-pend-lin">
                    <span>
                      <b>{s.sku}</b> · {s.descricao.slice(0, 60)} ({s.un} un.)
                    </span>
                    {pend.resolvidos[s.sku] === "desc" ? (
                      <span className="faint">✗ descartado — não entra nas contas</span>
                    ) : pend.resolvidos[s.sku] === "cad" ? (
                      <span className="faint">↗ cadastrando — reenvie o arquivo depois</span>
                    ) : (
                      <>
                        <button type="button" className="btn btn-mini primary" onClick={() => cadastrarSku(s.sku)}>Cadastrar agora</button>
                        <button type="button" className="btn btn-mini" onClick={() => descartarSku(s.sku)}>Descartar</button>
                      </>
                    )}
                  </div>
                ))}
                <div className="faint">Os outros pedidos já podem ser gravados. O que ficar pendente entra depois, reenviando o mesmo arquivo (nada duplica).</div>
                <div className="ana-pend-acoes">
                  <button type="button" className="btn btn-mini primary" onClick={() => gravar(pend.plat, pend.canal, pend.lidos, pend.periodo, pend.arquivo)}>Gravar o resto</button>
                  <button type="button" className="btn btn-mini" onClick={() => setPend(null)}>Cancelar</button>
                </div>
              </>
            )}
          </div>
        )}
        {canal && p.id === "shopee" && (
          <>
            {relat({
              rel: "shopee:desempenho",
              nome: "Desempenho do produto (funil)",
              limite: 7,
              aceita: ".xlsx",
              multiplo: true,
              onde: <>Shopee → Dados → Informações Gerenciais → Produto → Performance do produto → <b>Exportar</b> (Últimos 7 dias). Se aparecer mais de uma lista (ex.: “melhor desempenho” e “recém-cadastrados”), exporte <b>todas com o mesmo período</b> e envie uma depois da outra — elas se juntam</>,
              onArquivo: (fs) => enviarShopee("desempenho", fs),
            })}
            {relat({
              rel: "shopee:ads",
              nome: "Ads (CSV)",
              limite: 3,
              aceita: ".csv",
              multiplo: true,
              onde: <>Shopee → Marketing → Shopee Ads → <b>Exportar dados → Dados Gerais de Anúncios</b> (do início do período de Ads até ontem). Se tiver mais de uma lista (ex.: “melhor desempenho” e “recém-cadastrados”), exporte <b>todas com o mesmo período</b> e envie uma depois da outra — elas se juntam</>,
              onArquivo: (fs) => enviarShopee("ads", fs),
            })}
            {perguntas.map((q) => (
              <div key={q.chave} className="ana-pend">
                <b>{q.l.item.nome}: {BRL(q.valores.gasto)} de Ads no CSV</b>
                <div>{q.tipo === "estender" ? `O período terminou em ${dm(q.periodo.fim)} no app, mas o CSV vai até ${dm(q.data)} com gasto. Estender o fim até ${dm(q.data)}?` : `Não há período de Ads ligado no app. Criar um período a partir de ${dm(q.data)} (início do CSV)?`}</div>
                <div className="ana-pend-acoes">
                  <button type="button" className="btn btn-mini primary" onClick={() => responder(q, true)}>Sim</button>
                  <button type="button" className="btn btn-mini" onClick={() => responder(q, false)}>Não</button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    );
  });

  const cartaoFisico = (
    <div className="panel" key="fisico">
      <h3>
        <CanalTag tipo="custom" nome="Venda física" /> <span className="dir">balcão, feira, encomenda fora da Olist · entra nas vendas e no caixa</span>
      </h3>
      <div className="ana-relat">
        <div className="ana-relat-nome">
          Registradas em {new Date(`${hoje}T12:00:00`).toLocaleDateString("pt-BR", { month: "long" })}: {fisMes.length} · {BRL(fisMes.reduce((t, f) => t + num(f.quantidade) * num(f.valor_unitario), 0))}
        </div>
        <button type="button" className="btn btn-mini primary" onClick={() => setFisico(fisico ? null : { itemId: "", qtd: "1", preco: "", data: hoje, pagamento: "Pix", obs: "" })}>
          {fisico ? "Fechar" : "+ Registrar venda física"}
        </button>
        <div className="ana-relat-onde">Também vale pra encomenda paga por Pix. Entra em Vendas do mês, curva ABC, XYZ, comprados juntos e no Fluxo de Caixa (recebido na data).</div>
      </div>
      {fisico && (
        <div className="ana-form-fisico">
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>Produto (nome ou SKU)</label>
            <BuscaItem grupos={gruposBusca} value={fisico.itemId} onChange={(id) => setFisico((f) => ({ ...f, itemId: id, preco: f.preco || precoSugerido(id) }))} vazio="— escolha o item —" />
          </div>
          {fisico.itemId && (
            <div style={{ gridColumn: "1 / -1" }}>
              <EmbalagemOrganicoVenda
                item={itens.find((i) => i.id === fisico.itemId)}
                canal={canais.find((c) => canalComEmbalagem(c)) || null}
                itemNoCanal={esc.itemNoCanal}
                produtos={produtos}
                kits={kits}
                embalagens={esc.embalagens || []}
                onToast={onToast}
              />
            </div>
          )}
          <div className="field"><label>Quantidade</label><input type="number" min="1" value={fisico.qtd} onChange={(e) => setFisico((f) => ({ ...f, qtd: e.target.value }))} /></div>
          <div className="field">
            <label>Preço de venda (R$)</label>
            <input type="text" inputMode="decimal" value={fisico.preco} onChange={(e) => setFisico((f) => ({ ...f, preco: e.target.value }))} />
            {(() => {
              const it = itens.find((i) => i.id === fisico.itemId);
              const q = num(fisico.qtd) || 1;
              const pc = num(it?.pecas) || 1;
              if (!it) return null;
              return (
                <div className="faint" style={{ marginTop: 3 }}>
                  {pc > 1 ? `do ${it.nomeVariacao || it.nome.split(" — ").pop()} inteiro (${pc} peças)` : "por unidade"}
                  {q > 1 && num(fisico.preco) > 0 ? ` · ${q} × = ${BRL(q * num(fisico.preco))}` : ""}
                </div>
              );
            })()}
          </div>
          <div className="field"><label>Data</label><input type="date" value={fisico.data} max={hoje} onChange={(e) => setFisico((f) => ({ ...f, data: e.target.value }))} /></div>
          <div className="field">
            <label>Recebi por</label>
            <select value={fisico.pagamento} onChange={(e) => setFisico((f) => ({ ...f, pagamento: e.target.value }))}>
              <option>Pix</option>
              <option>Dinheiro</option>
              <option>Cartão</option>
              <option>Outro</option>
            </select>
          </div>
          <div className="field"><label>Observação</label><input type="text" value={fisico.obs} onChange={(e) => setFisico((f) => ({ ...f, obs: e.target.value }))} placeholder="opcional" /></div>
          <div className="field" style={{ alignSelf: "end" }}>
            <button type="button" className="btn primary" disabled={ocupado === "fisico"} onClick={salvarFisico}>{ocupado === "fisico" ? "Salvando…" : "Salvar venda"}</button>
          </div>
        </div>
      )}
      {fisicas.slice(0, 8).map((f) => (
        <div key={f.id} className="ana-fis-lin">
          <span>
            <span className="faint">{dm(f.data)}</span> · {f.descricao} × {num(f.quantidade)}
          </span>
          <span className="faint">{f.pagamento || ""}</span>
          <b>{BRL(num(f.quantidade) * num(f.valor_unitario))}</b>
          <button type="button" className="btn btn-icone" title="Excluir esta venda física" onClick={() => setExcluir(f)}>×</button>
        </div>
      ))}
      {!fisicas.length && <div className="ana-relat-onde" style={{ padding: "0 14px 12px" }}>Nenhuma venda física registrada ainda.</div>}
    </div>
  );

  return (
    <>
      <div className="kpis">
        <div className="kpi"><div className="l">Pedidos importados</div><div className="v">{new Set((ped.pedidos || []).filter((p) => p.origem === "olist").map((p) => p.pedido)).size}</div><div className="s">{(ped.pedidos || []).length ? `${dm([...ped.pedidos].sort((a, b) => String(a.data).localeCompare(String(b.data)))[0]?.data)} a ${dm([...ped.pedidos].sort((a, b) => String(b.data).localeCompare(String(a.data)))[0]?.data)} · + ${fisicas.length} vendas físicas` : "nenhum ainda"}</div></div>
        <div className="kpi"><div className="l">Último envio</div><div className="v">{(() => { const u = okOrdenadas[okOrdenadas.length - 1]; if (!u) return "—"; const d = diasDesde(dataDoEnvio(u), hoje); return d === 0 ? "hoje" : d === 1 ? "ontem" : `há ${d} dias`; })()}</div><div className="s">{okOrdenadas[okOrdenadas.length - 1]?.relatorio?.replace("pedidos:", "pedidos · ").replace("shopee:", "Shopee · ") || "nenhum"}</div></div>
        <div className={`kpi${pendentesN ? " warn" : ""}`}><div className="l">Pedidos pendentes</div><div className="v">{pendentesN ? `${pendentesN} plataforma${pendentesN > 1 ? "s" : ""}` : "em dia"}</div><div className="s">último envio há mais de 7 dias</div></div>
        <div className="kpi"><div className="l">Lançado no caixa</div><div className="v">{BRL(totRec)}</div><div className="s">entregues + vendas físicas · a receber {BRL(totArec)} (fora do saldo)</div></div>
      </div>

      <div className="ana-fontes">
        {cards[0]}
        {cartaoFisico}
        {cards.slice(1)}
      </div>

      <div className="panel">
        <h3 className="section-title">
          O que foi pro Fluxo de Caixa
          <Ajuda texto="Uma entrada por plataforma × semana com os pedidos ENTREGUES (o que a plataforma repassa = pago pelo cliente − taxas do canal, com as taxas de hoje) e uma por semana das vendas físicas. A receber (enviado, ainda não entregue) só aparece aqui: não soma no saldo nem na projeção. Reenviando o arquivo, o que virou Entregue passa pra recebido e o que foi cancelado/devolvido sai. Se já houver uma entrada de venda lançada à mão na mesma semana e canal, o app avisa (pra não contar duas vezes)." />
          <span className="dir">uma linha por plataforma × semana</span>
        </h3>
        <div className="ana-caixa-resumo">
          <div><span className="faint">Recebido (entra no saldo)</span><b style={{ color: "var(--good)" }}>{BRL(totRec)}</b></div>
          <div><span className="faint">A receber (só aparece — fora do saldo e da projeção)</span><b>{BRL(totArec)}</b></div>
        </div>
        {[...recentes(caixa.lancamentos).map((x) => ({ ...x, arec: false })), ...recentes(caixa.aReceber).map((x) => ({ ...x, arec: true }))]
          .sort((a, b) => b.semana.localeCompare(a.semana))
          .map((x) => (
            <div key={(x.arec ? "a" : "r") + x.origem_import} className={`ana-caixa-lin${x.arec ? " arec" : ""}`}>
              <span><span className="bolinha" style={{ background: x.arec ? "var(--ink-faint)" : "var(--good)" }} />{x.descricao}</span>
              <span className="faint">{x.arec ? "a receber · fora do saldo" : "recebido"}</span>
              <b>{BRL(x.valor)}</b>
            </div>
          ))}
        {!caixa.lancamentos.length && !caixa.aReceber.length && <div className="empty">Nada ainda — importe os pedidos ou registre uma venda física.</div>}
        {Object.values(avisos).flat().filter((a) => /caixa/.test(a)).map((a) => <div key={a} className="ana-aviso" style={{ margin: "0 14px 10px" }}>⚠ {a}</div>)}
      </div>

      <div className="panel">
        <h3>Como fica a semana</h3>
        <div className="ana-guia">
          <div><b>1× por semana (≈ 5 min)</b>Pedidos da Olist de cada plataforma que vendeu + os relatórios de anúncio dela (Shopee: Desempenho e Ads). Depois o Registrar semana curto: avaliações, nota, 1–2★ e conhecidos.</div>
          <div><b>A cada 3 dias</b>Só o relatório de Ads de cada plataforma com Ads ligado (Shopee hoje).</div>
          <div><b>Venda física</b>Quando vender: “+ Registrar venda física”.</div>
          <div><b>O app faz sozinho</b>Ignora pedido repetido, separa cancelados, liga pelo SKU, lança no caixa e calcula o lucro com as taxas e o custo de hoje. Nome, CPF, endereço e telefone do cliente são ignorados.</div>
        </div>
      </div>

      {excluir && (
        <ConfirmDialog
          titulo="Excluir esta venda física?"
          mensagem={`${dm(excluir.data)} · ${excluir.descricao} × ${num(excluir.quantidade)} (${BRL(num(excluir.quantidade) * num(excluir.valor_unitario))}). A entrada no caixa da semana é recalculada.`}
          confirmarLabel="Excluir"
          perigo
          onConfirm={confirmarExcluir}
          onCancel={() => setExcluir(null)}
        />
      )}
    </>
  );
}
