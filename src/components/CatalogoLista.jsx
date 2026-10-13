import { Fragment, useMemo, useState } from "react";
import { useEscada } from "../hooks/useEscada.js";
import { useCatalogo } from "../hooks/useCatalogo.js";
import { useAnunciosGrupo } from "../hooks/useAnunciosGrupo.js";
import { gruposPorItem } from "../lib/anunciosGrupo.js";
import { custoProdutoPorPeca } from "../lib/calc.js";
import { impressoraDoProduto } from "../lib/farm.js";
import { linhasDoKit } from "../lib/planoKit.js";
import { estadoDoAlerta } from "../lib/estados.js";
import { irParaAba } from "../lib/navegar.js";
import { pedirPasso } from "../lib/passosPreco.js";
import { BRL, PCT } from "../lib/format.js";
import CanalTag from "./CanalTag.jsx";
import Estado from "./Estado.jsx";
import Ajuda from "./Ajuda.jsx";

// Cadastros → Catálogo: tudo que foi cadastrado (produtos com as variações,
// kits) numa lista só, pra CONSULTAR sem abrir Precificação. Só lê — os números
// vêm do catálogo ao vivo (useEscada) e os avisos de preço de alertaDe.
const num = (v) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};
const g = (v) => (v ? `${Math.round(v)} g` : "—");

export default function CatalogoLista({ onEditar }) {
  const dados = useEscada();
  const { itens, produtos, canais, precos, materiais, rampas, alertaDe, carregando } = dados;
  const { impressoras } = useCatalogo();
  const { grupos } = useAnunciosGrupo();
  const mapaGrupos = useMemo(() => gruposPorItem(grupos), [grupos]);
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState("todos");
  const [aberto, setAberto] = useState(null); // id do item com o detalhe aberto
  const [comVariacoes, setComVariacoes] = useState(() => new Set());

  const precoDe = (it, c) => {
    const t = it.id[0] === "k" ? "kit" : it.id[0] === "v" ? "variacao" : "produto";
    return precos.find((p) => p.item_tipo === t && p.item_id === it.id.slice(2) && p.canal_id === c.id) || null;
  };
  const alvo = busca.trim().toLowerCase();
  const bate = (it) => !alvo || it.nome.toLowerCase().includes(alvo) || (it.sku || "").toLowerCase().includes(alvo);
  const linhas = useMemo(() => {
    const prods = itens.filter((i) => i.tipo === "Produto");
    const vars = itens.filter((i) => i.tipo === "Variação");
    const kits = itens.filter((i) => i.tipo === "Kit");
    const out = [];
    if (tipo !== "kits")
      for (const p of prods) {
        const vs = vars.filter((v) => v.produtoId === p.id.slice(2));
        if (bate(p) || vs.some(bate)) out.push({ item: p, variacoes: vs, abrirVars: !!alvo && !bate(p) });
      }
    if (tipo !== "produtos") for (const k of kits) if (bate(k)) out.push({ item: k, variacoes: [] });
    return out.sort((a, b) => a.item.nome.localeCompare(b.item.nome));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, tipo, alvo]);

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
    return (
      <tr className="linha-detalhe">
        <td colSpan={5}>
          <div className="detalhe-cel catalogo-det">
            <div className="catalogo-det-col">
              <div className="ads-rotulo">Custo de hoje</div>
              {r && (
                <div className="kv-cel muted-cel">
                  material {BRL(r.material)} · energia {BRL(r.energia)} · máquina {BRL(r.roiPeca)} · manutenção {BRL(r.manutencao)} · falhas {BRL(r.falhas)} · acabamento {BRL(r.acabamento)}
                </div>
              )}
              {kitLinhas.map((l) => (
                <div key={l.produto.id} className="kv-cel">
                  {l.quantidade} × {l.produto.nome} ({BRL(l.custoPeca)}/peça{l.manual ? ", à mão" : `, chapa de ${l.pecasChapa}`}) = {BRL(l.subtotal)}
                </div>
              ))}
              <div className="kv-cel">
                produção {BRL(it.custoProducao ?? it.custoTotal)} · embalagem {BRL(it.embalagem ?? 0)} · frete {BRL(it.freteProduto ?? it.frete ?? 0)} = <b>{BRL(it.custoTotal)}</b>
              </div>
              <div className="kv-cel muted-cel">peso de envio {g(it.peso)}</div>
            </div>
            <div className="catalogo-det-col">
              <div className="ads-rotulo">Preço salvo por canal</div>
              {canaisDo(it).length ? (
                canaisDo(it).map(({ c, s }) => {
                  const est = estadoDoAlerta(alertaDe(it, c));
                  return (
                    <div key={c.id} className="kv-cel">
                      <CanalTag canal={c} /> {BRL(s.preco)} · lucro {BRL(s.lucro)} · {PCT(s.margem)} {est && <Estado tipo={est.tipo}>{est.motivo}</Estado>}
                    </div>
                  );
                })
              ) : (
                <div className="muted-cel">Sem preço salvo em nenhum canal.</div>
              )}
              {rampasDo.map((x) => (
                <div key={x.id} className="kv-cel"><Estado tipo="decisao">em rampa · {canais.find((c) => c.id === x.canal_id)?.nome || "canal"}</Estado></div>
              ))}
              {emKits.length > 0 && <div className="kv-cel muted-cel">Nos kits: {emKits.map((k) => k.nome).join(", ")}</div>}
              {emGrupos.length > 0 && <div className="kv-cel muted-cel">Nos anúncios: {emGrupos.map((x) => x.grupo.nome).join(", ")}</div>}
            </div>
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
        <div className="subabas" style={{ margin: 0 }}>
          {[["todos", "Todos"], ["produtos", "Produtos"], ["kits", "Kits"]].map(([k, r]) => (
            <button key={k} type="button" className={`btn btn-mini${tipo === k ? " primary" : ""}`} onClick={() => setTipo(k)}>{r}</button>
          ))}
        </div>
        <span className="muted-cel">{linhas.length} ite{linhas.length === 1 ? "m" : "ns"}</span>
      </div>
      {!linhas.length ? (
        <div className="empty">{alvo ? "Nada encontrado com essa busca." : "Nada cadastrado ainda."}</div>
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
