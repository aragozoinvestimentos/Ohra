import { useEffect, useMemo, useState } from "react";
import { useEscada } from "../hooks/useEscada.js";
import { useCrescimento } from "../hooks/useCrescimento.js";
import { useCatalogo } from "../hooks/useCatalogo.js";
import { abrirAnuncio, montarAnuncios } from "../lib/anuncios.js";
import { irParaAba, pegarPedido } from "../lib/navegar.js";
import { pedirPasso } from "../lib/passosPreco.js";
import { impressoraDoProduto } from "../lib/farm.js";
import { configCalendario, quandoVendeDe, rotuloQuando } from "../lib/calendario.js";
import { configOrganicoDoItem } from "../lib/embalagemCanal.js";
import { gruposPorItem } from "../lib/anunciosGrupo.js";
import { adsNaJanela } from "../lib/ads.js";
import { hojeSP } from "../lib/datas.js";
import { BRL, PCT } from "../lib/format.js";
import CanalTag from "./CanalTag.jsx";
import Estado from "./Estado.jsx";
import Kpis from "./Kpis.jsx";
import DetalheItem from "./DetalheItem.jsx";

// Página do produto (remap 21/10/2026, aprovado pela prévia): o produto (ou
// kit) em si — vale pra todos os canais. Visão geral com um cartão por canal
// (abre o Painel do anúncio), Cadastro em passos com "falta X", Custo e
// Variações/kits. Só lê; editar abre o cadastro de sempre.
const ABAS = [
  { k: "visao", rot: "Visão geral" },
  { k: "cadastro", rot: "Cadastro" },
  { k: "custo", rot: "Custo" },
  { k: "variacoes", rot: "Variações e kits" },
];
const SEL_KEY = "ohra:pagina-produto";
const num = (v) => Number(v) || 0;
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

function lerSel() {
  try {
    return sessionStorage.getItem(SEL_KEY) || null;
  } catch {
    return null;
  }
}

/** Passos do cadastro e o que falta (só leitura — o editor é o de Cadastros). */
function passosDoCadastro({ it, prod, kit, esc, produtoEmbalagens, kitEmbalagens, impressoras, cal, canaisCom }) {
  if (!it) return [];
  const ehKit = it.id.startsWith("k:");
  const ok = (b) => !!b;
  if (ehKit) {
    const embKit = (kitEmbalagens || []).filter((e) => e.kit_id === kit?.id);
    return [
      { k: "dados", rot: "Dados do kit", ok: ok(it.nome && it.sku), res: [it.nome, it.sku ? `SKU ${it.sku}` : "sem SKU"].join(" · "), falta: !it.sku ? "SKU" : null, editar: "cadastro" },
      { k: "composicao", rot: "Peças do kit", ok: ok((it.componentes || []).length), res: (it.componentes || []).map((c) => `${c.quantidade}× ${esc.produtos.find((p) => p.id === c.produtoId)?.nome || "peça"}`).join(" · ") || "sem peças", falta: !(it.componentes || []).length ? "peças" : null, editar: "cadastro" },
      { k: "embalagem", rot: "Embalagem", ok: ok(embKit.length || num(it.embalagem) > 0), res: num(it.embalagem) > 0 ? `${BRL(it.embalagem)} por kit` : "sem embalagem", falta: !(embKit.length || num(it.embalagem) > 0) ? "embalagem" : null, editar: "cadastro" },
      { k: "canais", rot: "Onde vende", ok: ok(canaisCom.length), res: canaisCom.length ? canaisCom.map((c) => c.nome).join(" · ") : "sem preço salvo em nenhum canal", falta: !canaisCom.length ? "preço em algum canal" : null, editar: "lancar" },
      { k: "anuncio", rot: "Anúncio", ok: true, res: kit?.cores_anuncio?.variacoes?.length ? `variações: ${kit.cores_anuncio.variacoes.map((v) => v.nome).join(", ")}` : "sem cores/variações próprias (opcional)", falta: null, editar: "ficha" },
    ];
  }
  const q = quandoVendeDe(prod);
  const imp = prod ? impressoraDoProduto(prod, impressoras) : null;
  const receita = (produtoEmbalagens || []).filter((e) => e.produto_id === prod?.id);
  const org = configOrganicoDoItem(it, { produtos: esc.produtos, kits: esc.kits }).config;
  const vars = esc.itens.filter((i) => i.id.startsWith("v:") && i.produtoId === prod?.id);
  const temProd = !!prod?.producao_detalhe;
  return [
    {
      k: "dados",
      rot: "Dados do produto",
      ok: ok(it.sku && num(prod?.peso_g) > 0),
      res: [it.sku ? `SKU ${it.sku}` : "sem SKU", num(prod?.peso_g) > 0 ? `${Math.round(num(prod.peso_g))} g` : "sem peso", q ? rotuloQuando(q, cal) : "quando vende: sem classificação"].join(" · "),
      falta: [!it.sku && "SKU", !(num(prod?.peso_g) > 0) && "peso"].filter(Boolean).join(", ") || null,
      editar: "cadastro",
    },
    {
      k: "producao",
      rot: "Produção e custo",
      ok: temProd,
      res: temProd ? [imp?.nome || "impressora padrão", prod.material_nome || prod.producao_detalhe?.materialNome || "filamento", `chapa de ${Math.max(1, num(prod.pecas_por_impressao) || 1)}`, `fabricação ${BRL(it.custoProducao)}`].join(" · ") : `custo digitado à mão (${BRL(it.custoProducao)}) — sem detalhamento`,
      falta: !temProd ? "detalhamento do custo" : null,
      editar: "custo",
    },
    {
      k: "embalagem",
      rot: "Embalagem",
      ok: ok(receita.length || num(it.embalagem) > 0),
      res: [num(it.embalagem) > 0 ? `marketplace ${BRL(it.embalagem)}` : "sem embalagem", org ? (org.modo === "canal" ? "orgânico: a do canal" : org.modo === "sem" ? "orgânico: sem embalagem" : "orgânico: própria") : "orgânico: ainda não definido"].join(" · "),
      falta: !(receita.length || num(it.embalagem) > 0) ? "embalagem" : null,
      editar: "cadastro",
    },
    { k: "variacoes", rot: "Variações de quantidade", ok: true, res: vars.length ? vars.map((v) => v.nomeVariacao || v.nome).join(" · ") : "só o avulso (opcional)", falta: null, editar: "quantidade" },
    { k: "canais", rot: "Onde vende", ok: ok(canaisCom.length), res: canaisCom.length ? canaisCom.map((c) => c.nome).join(" · ") : "sem preço salvo em nenhum canal", falta: !canaisCom.length ? "preço em algum canal" : null, editar: "lancar" },
    { k: "anuncio", rot: "Anúncio", ok: true, res: prod?.cores_anuncio?.variacoes?.length ? `variações: ${prod.cores_anuncio.variacoes.map((v) => `${v.nome} (${(v.opcoes || []).map((o) => o.nome).join(", ")})`).join(" · ")}` : "sem cores/variações próprias (opcional)", falta: null, editar: "ficha" },
  ];
}

export default function PaginaProduto({ onToast, onEditar }) {
  const esc = useEscada();
  const cres = useCrescimento();
  const cat = useCatalogo();
  const hoje = hojeSP();
  const [itemId, setItemId] = useState(lerSel);
  const [aba, setAba] = useState("visao");

  useEffect(() => {
    const aplicar = (p) => {
      if (!p?.itemId) return;
      setItemId(p.itemId);
      setAba(p.aba || "visao");
    };
    aplicar(pegarPedido("produto"));
    const ouvir = (e) => e.detail.aba === "produto" && aplicar(pegarPedido("produto"));
    window.addEventListener("ohra:ir-para", ouvir);
    return () => window.removeEventListener("ohra:ir-para", ouvir);
  }, []);
  useEffect(() => {
    try {
      if (itemId) sessionStorage.setItem(SEL_KEY, itemId);
    } catch {
      // sem sessionStorage — só não lembra
    }
  }, [itemId]);

  const it = itemId ? esc.itens.find((i) => i.id === itemId) || null : null;
  const linhas = useMemo(() => montarAnuncios({ esc, cres, pedidos: cres.pedidosValidos, hoje }), [esc, cres, hoje]);
  const meus = linhas.filter((l) => l.itemId === itemId);
  const mapaGrupos = useMemo(() => gruposPorItem(esc.gruposAnuncio || []), [esc.gruposAnuncio]);

  if (!it)
    return (
      <div className="panel">
        <div className="empty">
          Escolha um produto no catálogo.{" "}
          <button type="button" className="link-btn" onClick={() => irParaAba("cadastros")}>Abrir o catálogo →</button>
        </div>
      </div>
    );

  const ehKit = it.id.startsWith("k:");
  const prod = ehKit ? null : esc.produtos.find((p) => p.id === it.id.slice(2)) || null;
  const kit = ehKit ? (esc.kits || []).find((k) => k.id === it.id.slice(2)) || null : null;
  const cal = configCalendario(esc.cfgLoja);
  const canaisCom = esc.canais.filter((c) => meus.some((l) => l.canal.id === c.id));
  const passos = passosDoCadastro({ it, prod, kit, esc, produtoEmbalagens: esc.produtoEmbalagens, kitEmbalagens: cat.kitEmbalagens, impressoras: cat.impressoras || [], cal, canaisCom });
  const completos = passos.filter((p) => p.ok).length;
  const vendas = meus.reduce((t, l) => ({ un: t.un + l.vendas.unidades, lucro: t.lucro + l.vendas.lucro, fat: t.fat + l.vendas.faturamento }), { un: 0, lucro: 0, fat: 0 });
  const de30 = somarDias(hoje, -30);
  const ads30 = meus.reduce((t, l) => t + (l.ads ? adsNaJanela(l.ads.periodos, l.ads.semanas, de30, hoje).gasto : 0), 0);
  const emKits = !ehKit ? esc.itens.filter((k) => k.id.startsWith("k:") && (k.componentes || []).some((c) => c.produtoId === prod?.id)) : [];
  const emGrupos = mapaGrupos.get(it.id) || [];
  const editarCadastro = () => onEditar?.(ehKit ? "kit" : "produto", it.id.slice(2));
  const fazer = (p) => {
    if (p.editar === "cadastro") return editarCadastro();
    if (p.editar === "custo") return prod ? irParaAba("producao", { produtoId: prod.id }) : editarCadastro();
    if (p.editar === "quantidade" || p.editar === "ficha") {
      pedirPasso(p.editar, it.id, canaisCom[0]?.id || null);
      return irParaAba(p.editar);
    }
    if (p.editar === "lancar") {
      pedirPasso("avulso", it.id, null);
      return irParaAba("avulso");
    }
  };

  return (
    <div className="pagina-produto">
      <div className="pa-cab">
        <div className="pa-titulo">
          <div className="pa-trilha">
            <button type="button" className="link-btn" onClick={() => irParaAba("cadastros")}>← Catálogo</button>
          </div>
          <h2>{it.nome}</h2>
          <div className="pa-chips">
            <span className="muted-cel">
              {ehKit ? "Kit" : "Produto"}
              {it.sku ? ` · ${it.sku}` : " · sem SKU"}
            </span>
            {completos === passos.length ? <Estado tipo="oportunidade" icone={null}>✓ cadastro completo</Estado> : <Estado tipo="atencao">{`cadastro ${completos} de ${passos.length}`}</Estado>}
            {prod && quandoVendeDe(prod) && <span className="muted-cel">{rotuloQuando(quandoVendeDe(prod), cal)}</span>}
          </div>
        </div>
        <div className="pa-botoes">
          <button type="button" className="btn btn-mini primary" onClick={editarCadastro}>✎ Editar cadastro</button>
          {prod && (
            <button type="button" className="btn btn-mini" onClick={() => irParaAba("producao", { produtoId: prod.id })}>
              Simular custo
            </button>
          )}
        </div>
      </div>

      <div className="pa-abas" role="tablist">
        {ABAS.map((a) => (
          <button key={a.k} type="button" role="tab" className={aba === a.k ? "ativo" : ""} onClick={() => setAba(a.k)}>
            {a.rot}
            {a.k === "cadastro" && completos < passos.length && <i className="pa-marca st-atencao" aria-hidden="true" />}
          </button>
        ))}
      </div>

      {aba === "visao" && (
        <>
          <Kpis
            itens={[
              { label: "Custo hoje (repor)", valor: BRL(it.custoTotal), sub: `fabricação ${BRL(it.custoProducao)} · embalagem ${BRL(it.embalagem)}` },
              { label: "Vendas 30 dias", valor: `${vendas.un} un.`, sub: meus.filter((l) => l.vendas.unidades).map((l) => `${l.canal.nome} ${l.vendas.unidades}`).join(" · ") || "pedidos importados" },
              { label: "Lucro 30 dias", valor: BRL(vendas.lucro), tom: vendas.lucro > 0 ? "good" : undefined, sub: "antes do Ads · custo e taxas de hoje" },
              { label: "Ads 30 dias", valor: BRL(ads30), sub: ads30 > 0 ? `lucro depois do Ads ${BRL(vendas.lucro - ads30)}` : "sem Ads" },
            ]}
          />
          <div className="panel">
            <h3>
              Onde ele vende <span className="dir">clique num canal → Painel do anúncio</span>
            </h3>
            <div className="pp-cartoes">
              {esc.canais.map((c) => {
                const l = meus.find((x) => x.canal.id === c.id);
                if (!l)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className="pp-cartao vazio"
                      onClick={() => {
                        pedirPasso("avulso", it.id, c.id);
                        irParaAba("avulso");
                      }}
                    >
                      <b>+ Lançar em {c.nome}</b>
                      <span className="muted-cel">abre o passo a passo (1º Avulso → … → 5º Anunciar)</span>
                    </button>
                  );
                return (
                  <button key={c.id} type="button" className="pp-cartao" onClick={() => abrirAnuncio(it.id, c.id)}>
                    <span className="pp-cartao-cab">
                      <CanalTag canal={c} />
                      {l.emRampa && l.rampa && <Estado tipo="decisao" icone={null}>{`rampa ${l.rampa.est.i + 1}/${l.rampa.est.degraus.length}`}</Estado>}
                      {l.estado && l.estado.tipo !== "decisao" && <Estado tipo={l.estado.tipo} title={l.estado.motivo}>{String(l.estado.motivo).split(":")[0]}</Estado>}
                    </span>
                    <small className="muted-cel">{l.emRampa ? "preço agora" : "preço salvo"}</small>
                    <b className="pp-preco">
                      {l.agora ? BRL(l.agora.preco) : "—"}
                      {l.emRampa && l.alvo && <small> alvo {BRL(l.alvo.preco)}</small>}
                    </b>
                    <span className="muted-cel">
                      lucro {l.agora ? BRL(l.agora.lucro) : "—"}
                      {l.agora?.margem != null ? ` · ${PCT(l.agora.margem)}` : ""} · {l.vendas.unidades} vendas 30d
                      {l.adsNum?.retorno != null ? ` · Ads ${String(Math.round(l.adsNum.retorno * 10) / 10).replace(".", ",")}×` : ""}
                    </span>
                    {l.variacoes?.length > 0 && <span className="muted-cel">{l.variacoes.map((v) => v.nomeVariacao || v.nome).join(" · ")}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          {(emKits.length > 0 || emGrupos.length > 0) && (
            <div className="panel">
              <h3>Também está em</h3>
              <div className="pa-corpo pa-chips">
                {emKits.map((k) => (
                  <button key={k.id} type="button" className="chip-filtro" onClick={() => { setItemId(k.id); setAba("visao"); }}>
                    {k.nome} (kit)
                  </button>
                ))}
                {emGrupos.map((x) => (
                  <span key={x.grupo.id} className="chip-filtro">Anúncio: {x.grupo.nome}</span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {aba === "cadastro" && (
        <div className="panel">
          <h3>
            Cadastro em passos <span className="dir">{completos} de {passos.length} completos</span>
          </h3>
          <div className="pp-progresso">
            <i style={{ width: `${(completos / passos.length) * 100}%` }} />
          </div>
          <div className="pp-passos">
            {passos.map((p, i) => (
              <div key={p.k} className={`pp-passo${p.ok ? "" : " falta"}`}>
                <span className="pp-n">{i + 1}</span>
                <div className="pp-passo-txt">
                  <b>{p.rot}</b>
                  <span className="muted-cel">{p.res}</span>
                  {p.falta && <Estado tipo="atencao">{`falta: ${p.falta}`}</Estado>}
                </div>
                <button type="button" className="btn btn-mini" onClick={() => fazer(p)}>
                  {p.editar === "lancar" ? "+ Lançar em um canal" : p.editar === "quantidade" ? "Por quantidade" : p.editar === "ficha" ? "Ficha do anúncio" : p.editar === "custo" ? "Calcular custo" : "✎ Editar"}
                </button>
              </div>
            ))}
          </div>
          <p className="muted-cel pa-corpo">
            "✎ Editar" abre o formulário do cadastro (Produtos → Cadastro de produtos) já com este {ehKit ? "kit" : "produto"}; os outros botões abrem a ferramenta de cada passo com ele escolhido.
          </p>
        </div>
      )}

      {aba === "custo" && (
        <div className="panel">
          <h3>Custo de hoje e preço por canal</h3>
          <DetalheItem it={it} onEditar={() => editarCadastro()} onToast={onToast} />
        </div>
      )}

      {aba === "variacoes" && <AbaVariacoes it={it} prod={prod} esc={esc} emKits={emKits} onAbrirKit={(id) => { setItemId(id); setAba("visao"); }} />}
    </div>
  );
}

function AbaVariacoes({ it, prod, esc, emKits, onAbrirKit }) {
  const vars = prod ? esc.itens.filter((i) => i.id.startsWith("v:") && i.produtoId === prod.id) : [];
  const linhasItens = [it, ...vars];
  const canais = esc.canais;
  const salvo = (x, c) => {
    const t = x.id[0] === "k" ? "kit" : x.id[0] === "v" ? "variacao" : "produto";
    return esc.precos.find((p) => p.item_tipo === t && p.item_id === x.id.slice(2) && p.canal_id === c.id && num(p.preco) > 0) || null;
  };
  return (
    <>
      <div className="panel">
        <h3>
          {prod ? "Quantidades (variações)" : "Kit"}
          {prod && (
            <span className="dir">
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  pedirPasso("quantidade", it.id, null);
                  irParaAba("quantidade");
                }}
              >
                criar/editar no 2º Por quantidade →
              </button>
            </span>
          )}
        </h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Custo hoje</th>
                {canais.map((c) => (
                  <th key={c.id} className="num">
                    <CanalTag canal={c} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhasItens.map((x) => (
                <tr key={x.id}>
                  <td>
                    {x.id === it.id ? (prod ? "1 unidade" : x.nome) : x.nomeVariacao || x.nome}
                    {x.sku && <div className="sub-num">{x.sku}</div>}
                  </td>
                  <td className="num">{BRL(x.custoTotal)}</td>
                  {canais.map((c) => {
                    const s = salvo(x, c);
                    const ag = s ? esc.agoraDe(x, c) : null;
                    return (
                      <td key={c.id} className="num">
                        {s ? (
                          <>
                            {BRL(ag?.agora?.preco ?? s.preco)}
                            <div className="sub-num">lucro {BRL(ag?.agora?.lucro ?? s.lucro)}</div>
                          </>
                        ) : (
                          <span className="muted-cel">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {emKits.length > 0 && (
        <div className="panel">
          <h3>Kits com este produto</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Kit</th>
                  <th className="num">Custo hoje</th>
                  <th>Canais</th>
                </tr>
              </thead>
              <tbody>
                {emKits.map((k) => (
                  <tr key={k.id} className="linha-clicavel" onClick={() => onAbrirKit(k.id)}>
                    <td>
                      <b>{k.nome}</b>
                      {k.sku && <div className="sub-num">{k.sku}</div>}
                    </td>
                    <td className="num">{BRL(k.custoTotal)}</td>
                    <td>
                      {canais
                        .filter((c) => salvo(k, c))
                        .map((c) => (
                          <CanalTag key={c.id} canal={c}>{`${c.nome} ${BRL(salvo(k, c).preco)}`}</CanalTag>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
