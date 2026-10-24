import { Fragment, useMemo, useState } from "react";
import { useEscada } from "../hooks/useEscada.js";
import { useVendasReais } from "../hooks/useVendasReais.js";
import { agruparPorItem, curvaABC, somarDias } from "../lib/pedidos.js";
import { hojeSP } from "../lib/datas.js";
import { useCatalogo } from "../hooks/useCatalogo.js";
import { impressoraDoProduto } from "../lib/farm.js";
import { abrirProduto } from "../lib/anuncios.js";
import { BRL } from "../lib/format.js";
import CanalTag from "./CanalTag.jsx";
import Ajuda from "./Ajuda.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import { excluirItemCompleto, kitsQueUsam } from "../lib/excluirItem.js";
import { excluirVariacaoTodos } from "../lib/tirarDoCanal.js";
import { recarregarCatalogo } from "../lib/catalogoStore.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { configCalendario, quandoVendeDe, rotuloQuando, TIPOS_QUANDO } from "../lib/calendario.js";

// Filtros do Catálogo (painel "Filtros ▾"). Regra: todo atributo novo do
// produto que dê pra filtrar entra AQUI (um grupo a mais em FILTROS_VAZIO e no painel).
const FILTROS_VAZIO = { tipo: "todos", quando: "", impressora: "", canal: "", rampa: "", semSku: false, abc: "", origem: "" };

// Cadastros → Catálogo: tudo que foi cadastrado (produtos com as variações,
// kits) numa lista só, pra CONSULTAR sem abrir Precificação. Só lê — os números
// vêm do catálogo ao vivo (useEscada) e os avisos de preço de alertaDe.
const num = (v) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};
const g = (v) => (v ? `${Math.round(v)} g` : "—");

export default function CatalogoLista({ onToast }) {
  const dados = useEscada();
  const { itens, produtos, canais, precos, rampas, carregando } = dados;
  const { impressoras, produtos: produtosCrus } = useCatalogo();
  // × no fim da linha: excluir o produto/kit (ou a variação) com confirmação.
  const [excluir, setExcluir] = useState(null); // { item, aviso }
  async function pedirExcluir(it) {
    if (it.tipo === "Variação") return setExcluir({ item: it, aviso: null });
    const nomes = await kitsQueUsam(it, itens);
    setExcluir({ item: it, aviso: nomes.length ? `Está no(s) kit(s): ${nomes.join(", ")} — sai desses kits.` : null });
  }
  async function confirmarExcluir() {
    const it = excluir.item;
    if (it.tipo === "Variação") {
      const erros = await excluirVariacaoTodos({ variacaoId: it.id.slice(2), n: Number(it.quantidade) || null, produto: (produtosCrus || []).find((p) => p.id === it.produtoId) || null });
      recarregarCatalogo();
      setExcluir(null);
      return onToast?.(erros.length ? `Variação excluída, mas: ${erros.join("; ")}` : "Variação excluída");
    }
    const r = await excluirItemCompleto(it, itens);
    if (!r.ok) return onToast?.(r.msg);
    setExcluir(null);
    onToast?.(`${it.tipo === "Kit" ? "Kit" : "Produto"} excluído`);
  }
  const [busca, setBusca] = useState("");
  const [filtros, setFiltros] = useState(FILTROS_VAZIO);
  const [verFiltros, setVerFiltros] = useState(false);
  const tipo = filtros.tipo;
  const { lojas, lojaId } = useLoja();
  const cal = useMemo(() => configCalendario(lojas.find((l) => l.id === lojaId)?.config_escada), [lojas, lojaId]);
  // Curva ABC (aba Análise, v55): pelo lucro dos pedidos dos últimos 90 dias,
  // produto agrupado com as variações. Sem pedidos = sem selo.
  const reais = useVendasReais({ itens, canais, cfgDoProduto: dados.cfgDoProduto });
  const classeAbc = useMemo(() => {
    const hoje = hojeSP();
    const de = somarDias(hoje, -89);
    const g = agruparPorItem(reais.linhas.filter((l) => l.data >= de && l.data <= hoje), { itens, porPai: true });
    return new Map(curvaABC(g, { crit: "lucro" }).linhas.map((l) => [l.chave, l.classe]));
  }, [reais.linhas, itens]);
  const [comVariacoes, setComVariacoes] = useState(() => new Set());

  const precoDoCanal = (it, canalId) => {
    const t = it.id[0] === "k" ? "kit" : it.id[0] === "v" ? "variacao" : "produto";
    return precos.some((p) => p.item_tipo === t && p.item_id === it.id.slice(2) && p.canal_id === canalId && num(p.preco) > 0);
  };
  const precoDe = (it, c) => {
    const t = it.id[0] === "k" ? "kit" : it.id[0] === "v" ? "variacao" : "produto";
    return precos.find((p) => p.item_tipo === t && p.item_id === it.id.slice(2) && p.canal_id === c.id) || null;
  };
  const alvo = busca.trim().toLowerCase();
  const bate = (it) => !alvo || it.nome.toLowerCase().includes(alvo) || (it.sku || "").toLowerCase().includes(alvo);
  // Filtros que só valem pra produto (kit não tem Quando vende, impressora nem rampa).
  const soProduto = !!(filtros.quando || filtros.impressora || filtros.rampa || filtros.origem);
  const passaProduto = (p, vs) => {
    const prod = produtos.find((x) => x.id === p.id.slice(2));
    if (filtros.quando) {
      const q = quandoVendeDe(prod);
      if (filtros.quando === "sem" ? !!q : q?.tipo !== filtros.quando) return false;
    }
    if (filtros.origem && (prod?.origem === "revenda" ? "revenda" : "fabricado") !== filtros.origem) return false;
    if (filtros.impressora && impressoraDoProduto(prod, impressoras)?.id !== filtros.impressora) return false;
    if (filtros.rampa) {
      const em = rampas.some((r) => r.produto_id === prod?.id);
      if (filtros.rampa === "sim" ? !em : em) return false;
    }
    if (filtros.canal && ![p, ...vs].some((x) => precoDoCanal(x, filtros.canal))) return false;
    if (filtros.semSku && ![p, ...vs].some((x) => !x.sku)) return false;
    if (!passaAbc(p)) return false;
    return true;
  };
  const passaAbc = (it) => !filtros.abc || (filtros.abc === "sem" ? !classeAbc.has(it.id) : classeAbc.get(it.id) === filtros.abc);
  const passaKit = (k) => !soProduto && passaAbc(k) && (!filtros.canal || precoDoCanal(k, filtros.canal)) && (!filtros.semSku || !k.sku);
  const linhas = useMemo(() => {
    const prods = itens.filter((i) => i.tipo === "Produto");
    const vars = itens.filter((i) => i.tipo === "Variação");
    const kits = itens.filter((i) => i.tipo === "Kit");
    const out = [];
    if (tipo !== "kits")
      for (const p of prods) {
        const vs = vars.filter((v) => v.produtoId === p.id.slice(2));
        if ((bate(p) || vs.some(bate)) && passaProduto(p, vs)) out.push({ item: p, variacoes: vs, abrirVars: !!alvo && !bate(p) });
      }
    if (tipo !== "produtos") for (const k of kits) if (bate(k) && passaKit(k)) out.push({ item: k, variacoes: [] });
    return out.sort((a, b) => a.item.nome.localeCompare(b.item.nome));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, filtros, alvo, produtos, impressoras, rampas, precos, classeAbc]);
  const ativos = [
    filtros.tipo !== "todos" && { k: "tipo", txt: filtros.tipo === "kits" ? "só kits" : "só produtos" },
    filtros.quando && { k: "quando", txt: filtros.quando === "sem" ? "sem classificação" : TIPOS_QUANDO.find((t) => t.chave === filtros.quando)?.rotulo.replace("…", "").toLowerCase() },
    filtros.origem && { k: "origem", txt: filtros.origem === "revenda" ? "só revenda" : "só fabricados" },
    filtros.impressora && { k: "impressora", txt: impressoras.find((x) => x.id === filtros.impressora)?.nome || "impressora" },
    filtros.canal && { k: "canal", txt: `com preço em ${canais.find((c) => c.id === filtros.canal)?.nome || "canal"}` },
    filtros.rampa && { k: "rampa", txt: filtros.rampa === "sim" ? "em rampa" : "fora da rampa" },
    filtros.semSku && { k: "semSku", txt: "sem SKU" },
    filtros.abc && { k: "abc", txt: filtros.abc === "sem" ? "sem venda (90 dias)" : `curva ABC: ${filtros.abc}` },
  ].filter(Boolean);
  const tirar = (k) => setFiltros((f) => ({ ...f, [k]: FILTROS_VAZIO[k] }));

  if (carregando) return <div className="panel"><div className="empty">Carregando…</div></div>;

  const canaisDo = (it) => canais.map((c) => ({ c, s: precoDe(it, c) })).filter((x) => x.s && num(x.s.preco) > 0);

  const linha = (it, { filho = false, nVars = 0, varsAbertas = false } = {}) => {
    const prod = it.tipo === "Produto" ? produtos.find((p) => p.id === it.id.slice(2)) : null;
    const imp = prod ? impressoraDoProduto(prod, impressoras) : null;
    const salvos = canaisDo(it);
    return (
      <tr key={it.id} className={`linha-clicavel${filho ? " linha-filha" : ""}`} onClick={() => (it.tipo === "Variação" ? abrirProduto(`p:${it.produtoId}`, "variacoes") : abrirProduto(it.id))} title="Abrir a página do produto">
        <td>
          {filho ? "↳ " : ""}
          <b>{filho ? it.nomeVariacao || it.nome : it.nome}</b>
          {!filho && classeAbc.get(it.id) && (
            <span className={`selo-abc ${classeAbc.get(it.id)}`} title={`Curva ABC (lucro dos pedidos dos últimos 90 dias): classe ${classeAbc.get(it.id)} — ver em Análise → Curva ABC`}>
              {classeAbc.get(it.id)}
            </span>
          )}
          <div className="muted-cel">
            {it.tipo}
            {it.sku ? ` · ${it.sku}` : " · sem SKU"}
            {prod && quandoVendeDe(prod) && quandoVendeDe(prod).tipo !== "ano" ? ` · ${rotuloQuando(quandoVendeDe(prod), cal)}` : ""}
            {nVars > 0 && (
              <button
                type="button"
                className="link-btn"
                style={{ marginLeft: 6 }}
                onClick={(e) => {
                  e.stopPropagation();
                  setComVariacoes((s) => {
                    const n = new Set(s);
                    if (n.has(it.id)) n.delete(it.id);
                    else n.add(it.id);
                    return n;
                  });
                }}
              >
                {varsAbertas ? "▾" : "▸"} {nVars} variaç{nVars === 1 ? "ão" : "ões"}
              </button>
            )}
          </div>
        </td>
        <td className="num"><b>{BRL(it.custoTotal)}</b></td>
        <td className="num">{g(it.peso)}</td>
        <td className="muted-cel">
          {prod?.origem === "revenda" ? "revenda — comprado pronto" : prod ? `${imp?.nome || "—"} · chapa de ${Math.max(1, num(prod.pecas_por_impressao) || 1)}${prod.producao_detalhe ? "" : " · custo à mão"}` : it.tipo === "Kit" ? `${it.pecas} peças` : `${it.quantidade} un.`}
        </td>
        <td>
          <span className="catalogo-canais">
            {salvos.length ? salvos.map(({ c, s }) => <CanalTag key={c.id} canal={c} title={BRL(s.preco)}>{`${c.nome} ${BRL(s.preco)}`}</CanalTag>) : <span className="muted-cel">sem preço salvo</span>}
          </span>
        </td>
        <td className="td-excluir">
          <button
            type="button"
            className="del"
            title={`Excluir ${it.tipo === "Kit" ? "este kit" : it.tipo === "Variação" ? "esta variação" : "este produto"}`}
            aria-label="Excluir"
            onClick={(e) => {
              e.stopPropagation();
              pedirExcluir(it);
            }}
          >
            ×
          </button>
        </td>
      </tr>
    );
  };

  return (
    <div className="panel">
      <h3 className="section-title">
        Catálogo
        <Ajuda texto="Tudo que você cadastrou, num lugar só, pra consultar: custo de hoje, peso, impressora/chapa e os preços salvos por canal. Clique numa linha pra abrir a página do produto (custo, canais, cadastro, variações). Aqui nada é gravado — editar abre o cadastro." />
      </h3>
      <div className="toolbar">
        <input type="search" placeholder="Buscar por nome ou SKU" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 280 }} />
        <button type="button" className={`btn btn-mini${verFiltros ? " primary" : ""}`} onClick={() => setVerFiltros((v) => !v)}>
          Filtros {verFiltros ? "▴" : "▾"}
          {ativos.length ? ` (${ativos.length})` : ""}
        </button>
        {ativos.map((a) => (
          <span key={a.k} className="chip-filtro">
            {a.txt}
            <button type="button" className="btn-icone" title="Tirar este filtro" onClick={() => tirar(a.k)}>
              ×
            </button>
          </span>
        ))}
        {ativos.length > 1 && (
          <button type="button" className="link-btn" onClick={() => setFiltros(FILTROS_VAZIO)}>
            limpar
          </button>
        )}
        <span className="muted-cel">{linhas.length} ite{linhas.length === 1 ? "m" : "ns"}</span>
      </div>
      {verFiltros && (
        <div className="painel-filtros">
          <div className="field">
            <label>Tipo</label>
            <select value={filtros.tipo} onChange={(e) => setFiltros({ ...filtros, tipo: e.target.value })}>
              <option value="todos">Todos</option>
              <option value="produtos">Produtos</option>
              <option value="kits">Kits</option>
            </select>
          </div>
          <div className="field">
            <label>Quando vende</label>
            <select value={filtros.quando} onChange={(e) => setFiltros({ ...filtros, quando: e.target.value })}>
              <option value="">Qualquer</option>
              {TIPOS_QUANDO.map((t) => (
                <option key={t.chave} value={t.chave}>
                  {t.rotulo.replace("…", "")}
                </option>
              ))}
              <option value="sem">Sem classificação</option>
            </select>
          </div>
          <div className="field">
            <label>Origem</label>
            <select value={filtros.origem} onChange={(e) => setFiltros({ ...filtros, origem: e.target.value })}>
              <option value="">Qualquer</option>
              <option value="fabricado">Fabricado</option>
              <option value="revenda">Revenda (comprado pronto)</option>
            </select>
          </div>
          <div className="field">
            <label>Impressora</label>
            <select value={filtros.impressora} onChange={(e) => setFiltros({ ...filtros, impressora: e.target.value })}>
              <option value="">Qualquer</option>
              {(impressoras || []).filter((x) => x.ativa !== false).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nome}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Com preço no canal</label>
            <select value={filtros.canal} onChange={(e) => setFiltros({ ...filtros, canal: e.target.value })}>
              <option value="">Qualquer</option>
              {canais.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Rampa</label>
            <select value={filtros.rampa} onChange={(e) => setFiltros({ ...filtros, rampa: e.target.value })}>
              <option value="">Qualquer</option>
              <option value="sim">Em rampa</option>
              <option value="nao">Fora da rampa</option>
            </select>
          </div>
          <div className="field">
            <label>Curva ABC (90 dias)</label>
            <select value={filtros.abc} onChange={(e) => setFiltros({ ...filtros, abc: e.target.value })}>
              <option value="">Qualquer</option>
              <option value="A">A · não pode faltar</option>
              <option value="B">B · pode crescer</option>
              <option value="C">C · revisar</option>
              <option value="sem">Sem venda nos pedidos</option>
            </select>
          </div>
          <label className="check-filtro">
            <input type="checkbox" checked={filtros.semSku} onChange={(e) => setFiltros({ ...filtros, semSku: e.target.checked })} /> Sem SKU
          </label>
        </div>
      )}
      {!linhas.length ? (
        <div className="empty">{alvo || ativos.length ? "Nada encontrado com essa busca/esses filtros." : "Nada cadastrado ainda."}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Custo hoje</th>
                <th className="num">Peso</th>
                <th>Produção</th>
                <th>Preço salvo</th>
                <th className="td-excluir" aria-label="Excluir"></th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(({ item, variacoes, abrirVars }) => {
                const varsAbertas = abrirVars || comVariacoes.has(item.id);
                return (
                  <Fragment key={item.id}>
                    {linha(item, { nVars: variacoes.length, varsAbertas })}
                    {varsAbertas &&
                      variacoes.map((v) => (
                        <Fragment key={v.id}>
                          {linha(v, { filho: true })}
                        </Fragment>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {excluir && (
        <ConfirmDialog
          titulo={`Excluir ${excluir.item.tipo === "Kit" ? "kit" : excluir.item.tipo === "Variação" ? "variação" : "produto"}`}
          mensagem={
            excluir.item.tipo === "Variação"
              ? `Excluir a variação "${excluir.item.nome}" de todos os canais (preço salvo, anúncio marcado e afiliado dela)? Não é possível desfazer.`
              : `Excluir "${excluir.item.nome}" por completo${excluir.item.tipo === "Produto" ? ", com as variações dele," : ""} e todos os preços salvos em qualquer canal? Não é possível desfazer.${excluir.aviso ? ` ${excluir.aviso}` : ""}`
          }
          confirmarLabel="Excluir"
          perigo
          onConfirm={confirmarExcluir}
          onCancel={() => setExcluir(null)}
        />
      )}
    </div>
  );
}
