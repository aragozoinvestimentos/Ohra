import { Fragment, useMemo, useState } from "react";
import { useEscada } from "../hooks/useEscada.js";
import { useCatalogo } from "../hooks/useCatalogo.js";
import { useAnunciosGrupo } from "../hooks/useAnunciosGrupo.js";
import { gruposPorItem } from "../lib/anunciosGrupo.js";
import { custoProdutoPorPeca } from "../lib/calc.js";
import { impressoraDoProduto } from "../lib/farm.js";
import { linhasDoKit } from "../lib/planoKit.js";
import { estadoDoAlerta } from "../lib/estados.js";
import { lucroNoPreco } from "../lib/escada.js";
import { irParaAba } from "../lib/navegar.js";
import { pedirPasso } from "../lib/passosPreco.js";
import { BRL, PCT } from "../lib/format.js";
import CanalTag from "./CanalTag.jsx";
import Estado from "./Estado.jsx";
import Ajuda from "./Ajuda.jsx";
import QuandoVende from "./QuandoVende.jsx";
import { useLoja } from "../lib/LojaContext.jsx";
import { configCalendario, quandoVendeDe, rotuloQuando, TIPOS_QUANDO } from "../lib/calendario.js";

// Filtros do Catálogo (painel "Filtros ▾"). Regra: todo atributo novo do
// produto que dê pra filtrar entra AQUI (um grupo a mais em FILTROS_VAZIO e no painel).
const FILTROS_VAZIO = { tipo: "todos", quando: "", impressora: "", canal: "", rampa: "", semSku: false };

// Cadastros → Catálogo: tudo que foi cadastrado (produtos com as variações,
// kits) numa lista só, pra CONSULTAR sem abrir Precificação. Só lê — os números
// vêm do catálogo ao vivo (useEscada) e os avisos de preço de alertaDe.
const num = (v) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};
const g = (v) => (v ? `${Math.round(v)} g` : "—");

export default function CatalogoLista({ onEditar, onToast }) {
  const dados = useEscada();
  const { itens, produtos, canais, precos, materiais, rampas, alertaDe, mapaRampa, cfgDoProduto, carregando } = dados;
  const { impressoras } = useCatalogo();
  const { grupos } = useAnunciosGrupo();
  const mapaGrupos = useMemo(() => gruposPorItem(grupos), [grupos]);
  const [busca, setBusca] = useState("");
  const [filtros, setFiltros] = useState(FILTROS_VAZIO);
  const [verFiltros, setVerFiltros] = useState(false);
  const tipo = filtros.tipo;
  const { lojas, lojaId } = useLoja();
  const cal = useMemo(() => configCalendario(lojas.find((l) => l.id === lojaId)?.config_escada), [lojas, lojaId]);
  const [aberto, setAberto] = useState(null); // id do item com o detalhe aberto
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
  const soProduto = !!(filtros.quando || filtros.impressora || filtros.rampa);
  const passaProduto = (p, vs) => {
    const prod = produtos.find((x) => x.id === p.id.slice(2));
    if (filtros.quando) {
      const q = quandoVendeDe(prod);
      if (filtros.quando === "sem" ? !!q : q?.tipo !== filtros.quando) return false;
    }
    if (filtros.impressora && impressoraDoProduto(prod, impressoras)?.id !== filtros.impressora) return false;
    if (filtros.rampa) {
      const em = rampas.some((r) => r.produto_id === prod?.id);
      if (filtros.rampa === "sim" ? !em : em) return false;
    }
    if (filtros.canal && ![p, ...vs].some((x) => precoDoCanal(x, filtros.canal))) return false;
    if (filtros.semSku && ![p, ...vs].some((x) => !x.sku)) return false;
    return true;
  };
  const passaKit = (k) => !soProduto && (!filtros.canal || precoDoCanal(k, filtros.canal)) && (!filtros.semSku || !k.sku);
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
  }, [itens, filtros, alvo, produtos, impressoras, rampas, precos]);
  const ativos = [
    filtros.tipo !== "todos" && { k: "tipo", txt: filtros.tipo === "kits" ? "só kits" : "só produtos" },
    filtros.quando && { k: "quando", txt: filtros.quando === "sem" ? "sem classificação" : TIPOS_QUANDO.find((t) => t.chave === filtros.quando)?.rotulo.replace("…", "").toLowerCase() },
    filtros.impressora && { k: "impressora", txt: impressoras.find((x) => x.id === filtros.impressora)?.nome || "impressora" },
    filtros.canal && { k: "canal", txt: `com preço em ${canais.find((c) => c.id === filtros.canal)?.nome || "canal"}` },
    filtros.rampa && { k: "rampa", txt: filtros.rampa === "sim" ? "em rampa" : "fora da rampa" },
    filtros.semSku && { k: "semSku", txt: "sem SKU" },
  ].filter(Boolean);
  const tirar = (k) => setFiltros((f) => ({ ...f, [k]: FILTROS_VAZIO[k] }));

  if (carregando) return <div className="panel"><div className="empty">Carregando…</div></div>;

  const canaisDo = (it) => canais.map((c) => ({ c, s: precoDe(it, c) })).filter((x) => x.s && num(x.s.preco) > 0);

  const linha = (it, { filho = false, nVars = 0, varsAbertas = false } = {}) => {
    const prod = it.tipo === "Produto" ? produtos.find((p) => p.id === it.id.slice(2)) : null;
    const imp = prod ? impressoraDoProduto(prod, impressoras) : null;
    const salvos = canaisDo(it);
    return (
      <tr key={it.id} className={`linha-clicavel${filho ? " linha-filha" : ""}`} onClick={() => setAberto(aberto === it.id ? null : it.id)}>
        <td>
          {filho ? "↳ " : ""}
          <b>{filho ? it.nomeVariacao || it.nome : it.nome}</b>
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
          {prod ? `${imp?.nome || "—"} · chapa de ${Math.max(1, num(prod.pecas_por_impressao) || 1)}${prod.producao_detalhe ? "" : " · custo à mão"}` : it.tipo === "Kit" ? `${it.pecas} peças` : `${it.quantidade} un.`}
        </td>
        <td>
          <span className="catalogo-canais">
            {salvos.length ? salvos.map(({ c, s }) => <CanalTag key={c.id} canal={c} title={BRL(s.preco)}>{`${c.nome} ${BRL(s.preco)}`}</CanalTag>) : <span className="muted-cel">sem preço salvo</span>}
          </span>
        </td>
      </tr>
    );
  };

  const detalhe = (it) => {
    const prod = it.tipo !== "Kit" ? produtos.find((p) => p.id === (it.produtoId || it.id.slice(2))) : null;
    const r = it.tipo === "Produto" && prod?.producao_detalhe ? custoProdutoPorPeca(prod, materiais) : null;
    const kitLinhas = it.tipo === "Kit" ? linhasDoKit(it.componentes, produtos) : [];
    const emKits = it.tipo === "Produto" ? itens.filter((k) => k.tipo === "Kit" && (k.componentes || []).some((c) => c.produtoId === it.id.slice(2))) : [];
    const emGrupos = mapaGrupos.get(it.id) || [];
    const rampasDo = prod ? rampas.filter((x) => x.produto_id === prod.id) : [];
    const editarAlvo = it.tipo === "Kit" ? { tipo: "kit", id: it.id.slice(2) } : { tipo: "produto", id: prod?.id };
    // Composição do custo (barra + linhas): produção quebrada quando há detalhamento.
    const partes = [];
    if (r) {
      const base = [
        ["Material", r.material],
        ["Energia", r.energia],
        ["Máquina", r.roiPeca],
        ["Manutenção", r.manutencao],
        ["Falhas", r.falhas],
        ["Acabamento", r.acabamento],
      ];
      base.forEach(([n, v]) => partes.push({ nome: n, valor: v }));
      const resto = r.total - base.reduce((t, [, v]) => t + v, 0);
      if (resto > 0.005) partes.push({ nome: "Consumíveis e modelagem", valor: resto });
    } else if (kitLinhas.length) {
      kitLinhas.forEach((l) => partes.push({ nome: `${l.quantidade} × ${l.produto.nome}`, valor: l.subtotal, sub: `${BRL(l.custoPeca)}/peça${l.manual ? " · à mão" : ` · chapa de ${l.pecasChapa}`}` }));
    } else partes.push({ nome: "Produção", valor: it.custoProducao ?? 0 });
    if (num(it.embalagem) > 0) partes.push({ nome: "Embalagem", valor: num(it.embalagem) });
    const frete = num(it.freteProduto ?? it.frete);
    if (frete > 0) partes.push({ nome: "Frete", valor: frete });
    const total = partes.reduce((t, x) => t + x.valor, 0) || 1;
    const salvosDet = canaisDo(it);
    const imp = prod ? impressoraDoProduto(prod, impressoras) : null;
    const info = [
      `peso de envio ${g(it.peso)}`,
      prod && it.tipo === "Produto" ? `${imp?.nome || "sem impressora"} · chapa de ${Math.max(1, num(prod.pecas_por_impressao) || 1)}` : null,
      prod && !prod.producao_detalhe ? "custo de produção digitado à mão" : null,
    ].filter(Boolean);
    return (
      <tr className="linha-detalhe">
        <td colSpan={5}>
          <div className="detalhe-cel catalogo-det">
            <div className="cat-card">
              <div className="cat-card-cab">
                <span className="ads-rotulo">Custo de hoje</span>
                <b className="cat-total">{BRL(it.custoTotal)}</b>
              </div>
              <div className="cat-barra" aria-hidden="true">
                {partes.map((x, k) => (
                  <span key={x.nome} className={`cat-cor-${k % 8}`} style={{ width: `${(x.valor / total) * 100}%` }} title={`${x.nome}: ${BRL(x.valor)}`} />
                ))}
              </div>
              <div className="cat-linhas">
                {partes.map((x, k) => (
                  <div key={x.nome} className="cat-linha">
                    <span className={`cat-ponto cat-cor-${k % 8}`} />
                    <span className="cat-nome">
                      {x.nome}
                      {x.sub && <small>{x.sub}</small>}
                    </span>
                    <span className="cat-pct">{Math.round((x.valor / total) * 100)}%</span>
                    <span className="cat-val">{BRL(x.valor)}</span>
                  </div>
                ))}
              </div>
              <div className="cat-info">{info.join(" · ")}</div>
            </div>

            <div className="cat-card">
              <div className="cat-card-cab">
                <span className="ads-rotulo">Preço salvo por canal</span>
                {rampasDo.map((x) => (
                  <Estado key={x.id} tipo="decisao">em rampa · {canais.find((c) => c.id === x.canal_id)?.nome || "canal"}</Estado>
                ))}
              </div>
              {salvosDet.length ? (
                <table className="cat-precos">
                  <thead>
                    <tr>
                      <th>Canal</th>
                      <th className="num">Preço</th>
                      <th className="num">Lucro</th>
                      <th className="num">Margem</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {salvosDet.map(({ c, s }) => {
                      const est = estadoDoAlerta(alertaDe(it, c));
                      // Em rampa (ou variação/kit derivado): alvo = preço salvo; agora = preço da Rampa.
                      const ra = mapaRampa?.get(`${it.id}|${c.id}`) || null;
                      const agora = ra && Math.abs(num(ra.real) - num(s.preco)) >= 0.005 ? num(ra.real) : null;
                      const lucroAgora = agora != null ? lucroNoPreco(c, agora, it.custoTotal, it.peso, cfgDoProduto(it.produtoId || (it.id[0] === "p" ? it.id.slice(2) : null))) : null;
                      return (
                        <Fragment key={c.id}>
                          <tr className={agora != null ? "cat-alvo" : undefined}>
                            <td>
                              <CanalTag canal={c} />
                              {agora != null && <small className="cat-rotulo">alvo (preço salvo)</small>}
                            </td>
                            <td className="num"><b>{BRL(s.preco)}</b></td>
                            <td className="num" style={num(s.lucro) < 0 ? { color: "var(--bad)" } : undefined}>{BRL(s.lucro)}</td>
                            <td className="num">{PCT(s.margem)}</td>
                            <td>{est && <Estado tipo={est.tipo}>{est.motivo}</Estado>}</td>
                          </tr>
                          {agora != null && (
                            <tr className="cat-agora">
                              <td>
                                <span className="cat-seta">↳</span> <small className="cat-rotulo">agora · {ra.acima ? "testando acima do alvo" : "em rampa"}</small>
                              </td>
                              <td className="num"><b>{BRL(agora)}</b></td>
                              <td className="num" style={lucroAgora != null && lucroAgora < 0 ? { color: "var(--bad)" } : undefined}>{lucroAgora != null ? BRL(lucroAgora) : "—"}</td>
                              <td className="num">{lucroAgora != null && agora > 0 ? PCT(lucroAgora / agora) : "—"}</td>
                              <td><Estado tipo="decisao">até chegar no alvo</Estado></td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="muted-cel">Sem preço salvo em nenhum canal.</div>
              )}
              {(emKits.length > 0 || emGrupos.length > 0) && (
                <div className="cat-info">
                  {emKits.length > 0 && <div>Nos kits: {emKits.map((k) => k.nome).join(", ")}</div>}
                  {emGrupos.length > 0 && <div>Nos anúncios: {emGrupos.map((x) => x.grupo.nome).join(", ")}</div>}
                </div>
              )}
            </div>

            {it.tipo === "Produto" && prod && (
              <div className="cat-card cat-quando">
                <QuandoVende produtoId={prod.id} onToast={onToast} compacto />
              </div>
            )}

            <div className="catalogo-acoes">
              {editarAlvo.id && <button type="button" className="btn btn-mini" onClick={() => onEditar(editarAlvo)}>✎ editar cadastro</button>}
              {prod && it.tipo === "Produto" && <button type="button" className="btn btn-mini" onClick={() => irParaAba("producao", { produtoId: prod.id })}>Calcular custo</button>}
              {it.tipo !== "Variação" && (
                <button type="button" className="btn btn-mini" onClick={() => { pedirPasso("avulso", it.id, null); irParaAba("avulso"); }}>
                  Precificar
                </button>
              )}
              <button type="button" className="btn btn-mini" onClick={() => irParaAba("historico", { busca: (prod?.nome || it.nome) })}>Produtos precificados →</button>
            </div>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="panel">
      <h3 className="section-title">
        Catálogo
        <Ajuda texto="Tudo que você cadastrou, num lugar só, pra consultar: custo de hoje, peso, impressora/chapa e os preços salvos por canal. Clique numa linha pra ver o detalhe. Aqui nada é gravado — editar abre o cadastro." />
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
              </tr>
            </thead>
            <tbody>
              {linhas.map(({ item, variacoes, abrirVars }) => {
                const varsAbertas = abrirVars || comVariacoes.has(item.id);
                return (
                  <Fragment key={item.id}>
                    {linha(item, { nVars: variacoes.length, varsAbertas })}
                    {aberto === item.id && detalhe(item)}
                    {varsAbertas &&
                      variacoes.map((v) => (
                        <Fragment key={v.id}>
                          {linha(v, { filho: true })}
                          {aberto === v.id && detalhe(v)}
                        </Fragment>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
