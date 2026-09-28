import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useRankingData } from "../hooks/useRankingData.js";
import { BRL } from "../lib/format.js";
import { calcularAnuncio, descontoDoItem, descontoPadraoCanal, gruposRegra4x } from "../lib/escada.js";
import { gruposDoSeletor, itemTipoDoId } from "../lib/variacoes.js";
import { nomeCanal } from "../lib/canais.js";
import BuscaItem from "./BuscaItem.jsx";
import CanalTag from "./CanalTag.jsx";
import Ajuda from "./Ajuda.jsx";

const LIMITE_NOME_OPCAO = 30; // Shopee: nome de cada opção de variação
const pctTxt = (d) => `${Math.round(d * 1000) / 10}`.replace(".", ",");

// 3º Ficha do anúncio — monta, pra UM produto (ou kit) e UM canal, as tabelas
// prontas pra criar o anúncio na plataforma: variações (Cor × Quantidade) e
// produtos (SKU = SKU do item + sufixo da cor, preço original, promo, cliente
// paga). Os preços vêm do que foi salvo em Precificação (Avulso / Por
// quantidade) e do desconto exibido (Anunciar). Regras por canal:
// Shopee/TikTok/próprio = um anúncio com Cor × Quantidade (Shopee divide se a
// regra de 4× estourar); ML/Shein = quantidade não é variação → um anúncio por
// quantidade, com variação de Cor. Cores ficam em produtos_cadastro/kits
// .cores_anuncio (schema v31).
export default function FichaAnuncio({ onToast, onIrPara }) {
  const { itens, canais, precos, produtos, kits } = useRankingData();
  const [sel, setSel] = useState("");
  const [canalId, setCanalId] = useState("");
  const [novaCor, setNovaCor] = useState({ nome: "", sufixo: "" });
  const [salvandoCor, setSalvandoCor] = useState(false);

  const canal = canais.find((c) => c.id === canalId) || canais[0] || null;
  const opcoesBusca = useMemo(() => gruposDoSeletor(itens.filter((i) => !i.id.startsWith("v:"))), [itens]);
  const isKit = sel.startsWith("k:");
  const donoId = sel ? sel.slice(2) : null;
  const dono = !sel ? null : isKit ? kits.find((k) => k.id === donoId) : produtos.find((p) => p.id === donoId);
  const itemBase = sel ? itens.find((i) => i.id === sel) : null;
  const cores = (Array.isArray(dono?.cores_anuncio) ? dono.cores_anuncio : []).filter((c) => c && String(c.nome || "").trim());

  // Itens do anúncio: o produto (1 un.) + variações por quantidade, ou o kit.
  const itensLista = useMemo(() => {
    if (!itemBase) return [];
    if (isKit) return [itemBase];
    const vars = itens.filter((i) => i.id.startsWith("v:") && i.produtoId === donoId).sort((a, b) => (a.pecas || 0) - (b.pecas || 0));
    return [itemBase, ...vars];
  }, [itemBase, isKit, itens, donoId]);

  const ficha = useMemo(() => {
    if (!canal || !itensLista.length) return null;
    const qtdDe = (it) => (it.id.startsWith("v:") ? it.pecas || it.quantidade || 1 : 1);
    const qtdLabel = (it) => `${qtdDe(it)} un.`;
    const linhasDe = (it) => {
      const tipo = itemTipoDoId(it.id);
      const s = precos.find((p) => p.item_tipo === tipo && p.item_id === it.id.slice(2) && p.canal_id === canal.id);
      const { desconto } = descontoDoItem(it.id, canal, { itens, produtos, kits });
      const an = s && Number(s.preco) > 0 ? calcularAnuncio(Number(s.preco), desconto) : null;
      return (cores.length ? cores : [null]).map((cor) => ({
        item: it,
        sku: `${it.sku || ""}${cor?.sufixo || ""}`,
        semSku: !it.sku,
        cor: cor?.nome || null,
        qtd: isKit ? null : qtdLabel(it),
        an,
      }));
    };
    const temQtd = !isKit && itensLista.length > 1;
    const quantidadeSeparada = temQtd && (canal.tipo === "ml" || canal.tipo === "shein");
    const nomeBase = itemBase?.nome || "";
    const sufixoCores = cores.length > 1 ? ` — ${cores.map((c) => c.nome).join(" e ")}` : cores.length === 1 ? ` — ${cores[0].nome}` : "";

    let grupos;
    let regra4x = null;
    if (quantidadeSeparada) grupos = itensLista.map((it) => [it]);
    else if (canal.tipo === "shopee" && temQtd) {
      const precosN = itensLista.map((it) => {
        const l = linhasDe(it)[0];
        return { n: qtdDe(it), promo: l.an?.clientePaga ?? 0, original: l.an?.original ?? 0, it };
      });
      const comPreco = precosN.filter((x) => x.promo > 0);
      regra4x = comPreco.length ? gruposRegra4x(comPreco) : null;
      if (regra4x && !regra4x.ok) {
        grupos = regra4x.grupos.map((ns) => itensLista.filter((it) => ns.includes(qtdDe(it))));
        const semPreco = itensLista.filter((it) => !comPreco.find((x) => x.it === it));
        if (semPreco.length) grupos[0] = [...grupos[0], ...semPreco];
      } else grupos = [itensLista];
    } else grupos = [itensLista];

    const anuncios = grupos.map((g) => {
      const linhas = g.flatMap(linhasDe);
      const unico = g.length === 1 ? g[0] : null;
      const titulo = quantidadeSeparada && unico && qtdDe(unico) > 1 ? `Kit ${qtdDe(unico)} ${nomeBase}${sufixoCores}` : `${nomeBase}${sufixoCores}`;
      const variacoes = [];
      if (cores.length) variacoes.push({ nome: "Cor", opcoes: cores.map((c) => c.nome) });
      if (g.length > 1) variacoes.push({ nome: "Quantidade", opcoes: g.map(qtdLabel) });
      const precificadas = linhas.filter((l) => l.an);
      const razao =
        precificadas.length > 1 ? Math.max(...precificadas.map((l) => l.an.original)) / Math.min(...precificadas.map((l) => l.an.clientePaga)) : precificadas.length ? precificadas[0].an.original / precificadas[0].an.clientePaga : null;
      return { titulo, linhas, variacoes, temQtdColuna: g.length > 1, razao };
    });

    const todasLinhas = anuncios.flatMap((a) => a.linhas);
    const nomesOpcao = [...cores.map((c) => c.nome), ...(temQtd ? itensLista.map(qtdLabel) : [])];
    const nomesLongos = nomesOpcao.filter((n) => n.length > LIMITE_NOME_OPCAO);
    const semPreco = [...new Set(todasLinhas.filter((l) => !l.an).map((l) => l.item.id))].map((id) => itensLista.find((i) => i.id === id));
    const semSku = [...new Set(todasLinhas.filter((l) => l.semSku).map((l) => l.item.id))].map((id) => itensLista.find((i) => i.id === id));
    return { anuncios, nomesLongos, semPreco, semSku, quantidadeSeparada, regra4x, temQtd };
  }, [canal, itensLista, precos, itens, produtos, kits, cores, isKit, itemBase]);

  // Kits de produtos diferentes que usam este produto — cada um tem a própria ficha.
  const kitsComProduto = !isKit && donoId ? itens.filter((i) => i.id.startsWith("k:") && (i.componentes || []).some((c) => c.produtoId === donoId)) : [];

  async function salvarCores(lista) {
    if (!supabase || !dono) return false;
    setSalvandoCor(true);
    const { error } = await supabase
      .from(isKit ? "kits" : "produtos_cadastro")
      .update({ cores_anuncio: lista.length ? lista : null })
      .eq("id", donoId);
    setSalvandoCor(false);
    if (error) {
      onToast(/cores_anuncio|column/i.test(error.message) ? "Rode o SQL v31 no Supabase pra salvar as cores" : `Não foi possível salvar: ${error.message}`);
      return false;
    }
    return true;
  }
  async function adicionarCor() {
    const nome = novaCor.nome.trim();
    if (!nome) return;
    let sufixo = novaCor.sufixo.trim() || `-${nome.normalize("NFD").replace(/[^A-Za-z]/g, "").slice(0, 1).toUpperCase()}`;
    if (!sufixo.startsWith("-")) sufixo = `-${sufixo}`;
    if (cores.some((c) => c.sufixo.toUpperCase() === sufixo.toUpperCase())) {
      onToast(`O sufixo ${sufixo} já está em uso — escolha outro`);
      return;
    }
    if (await salvarCores([...cores, { nome, sufixo: sufixo.toUpperCase() }])) setNovaCor({ nome: "", sufixo: "" });
  }
  async function removerCor(sufixo) {
    await salvarCores(cores.filter((c) => c.sufixo !== sufixo));
  }

  async function copiar(texto, rotulo) {
    try {
      await navigator.clipboard.writeText(texto);
      onToast(`${rotulo} copiada — cole na planilha ou na plataforma`);
    } catch {
      onToast("Não deu pra copiar automaticamente neste navegador");
    }
  }
  const num = (v) => String(Number(v).toFixed(2)).replace(".", ",");
  const tsvVariacoes = (a) => ["Variação\tOpções", ...a.variacoes.map((v) => `${v.nome}\t${v.opcoes.join(", ")}`)].join("\n");
  const tsvProdutos = (a) =>
    [
      ["SKU", ...(cores.length ? ["Cor"] : []), ...(a.temQtdColuna ? ["Quantidade"] : []), "Preço original", "Promoção %", "Cliente paga"].join("\t"),
      ...a.linhas.map((l) => [l.sku, ...(cores.length ? [l.cor] : []), ...(a.temQtdColuna ? [l.qtd] : []), l.an ? num(l.an.original) : "", l.an ? String(l.an.promo) : "", l.an ? num(l.an.clientePaga) : ""].join("\t")),
    ].join("\n");

  function exportarCsv() {
    if (!ficha) return;
    const rows = [["Anúncio", "SKU", "Cor", "Quantidade", "Preço original", "Promoção %", "Cliente paga"]];
    ficha.anuncios.forEach((a) => a.linhas.forEach((l) => rows.push([a.titulo, l.sku, l.cor || "", l.qtd || "", l.an ? num(l.an.original) : "", l.an ? String(l.an.promo) : "", l.an ? num(l.an.clientePaga) : ""])));
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ficha-${String(itemBase?.sku || itemBase?.nome || "item").toLowerCase().replace(/\s+/g, "-")}-${String(canal?.tipo || "canal")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <>
      <div className="aviso-fluxo">
        Os preços vêm de <b>Precificação</b> (1º Avulso / 2º Por quantidade). Aqui você só monta o anúncio: copia as variações, os SKUs, o <b>preço original</b> e a <b>promo</b> pra plataforma.
      </div>
      <div className="ficha-topo">
        <div className="panel">
          <h3 className="section-title">
            <span>
              Produto e canal
              <Ajuda texto="Escolha um produto (a ficha inclui as variações de 2, 3… unidades dele) ou um kit (ficha própria). O canal define o formato: Shopee/TikTok = um anúncio com Cor × Quantidade; Mercado Livre/Shein = um anúncio por quantidade, com variação de Cor." />
            </span>
          </h3>
          <div className="field">
            <label>Produto ou kit</label>
            <BuscaItem grupos={opcoesBusca} value={sel} onChange={setSel} vazio="— escolha um produto ou kit —" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Canal</label>
            <div className="ficha-canais">
              {canais.map((c) => (
                <button key={c.id} type="button" className={`ficha-canal${canal?.id === c.id ? " on" : ""}`} onClick={() => setCanalId(c.id)}>
                  <CanalTag canal={c} />
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="panel">
          <h3 className="section-title">
            <span>
              Cores {isKit ? "do kit" : "do produto"}
              <Ajuda texto="Cadastre uma vez por produto as cores (ou versões) que vão como opção no anúncio, com o sufixo do SKU. SKU de cada opção = SKU do item + sufixo (ex.: GATO2 + -P = GATO2-P) — o mesmo em todos os canais e na Olist. No kit, cada combinação é uma “cor” (ex.: “Gato Preto + Cão Branco”, -GP-CB). Sem cores = uma opção por item, SKU sem sufixo." />
            </span>
          </h3>
          {!dono ? (
            <div className="hint" style={{ margin: 0 }}>Escolha um produto ou kit ao lado.</div>
          ) : (
            <>
              <div className="ficha-cores">
                {cores.map((c) => (
                  <span key={c.sufixo} className="ficha-cor">
                    {c.nome} <code>{c.sufixo}</code>
                    <button type="button" className="del" title="Remover" disabled={salvandoCor} onClick={() => removerCor(c.sufixo)}>
                      ×
                    </button>
                  </span>
                ))}
                {!cores.length && <span className="hint" style={{ margin: 0 }}>Nenhuma cor ainda — o anúncio sai sem variação de cor.</span>}
              </div>
              <div className="ficha-add-cor">
                <input placeholder={isKit ? "ex.: Gato Preto + Cão Branco" : "ex.: Preto"} value={novaCor.nome} maxLength={LIMITE_NOME_OPCAO} onChange={(e) => setNovaCor({ ...novaCor, nome: e.target.value })} onKeyDown={(e) => e.key === "Enter" && adicionarCor()} />
                <input className="ficha-sufixo" placeholder="-P" value={novaCor.sufixo} maxLength={12} onChange={(e) => setNovaCor({ ...novaCor, sufixo: e.target.value })} onKeyDown={(e) => e.key === "Enter" && adicionarCor()} />
                <button type="button" className="btn btn-sm" disabled={salvandoCor || !novaCor.nome.trim()} onClick={adicionarCor}>
                  + Cor
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {!sel || !canal ? (
        <div className="empty">{canais.length ? "Escolha um produto ou kit pra montar a ficha do anúncio." : "Cadastre seus canais em Configuração → Canais."}</div>
      ) : ficha ? (
        <>
          <div className="ficha-checks">
            {ficha.nomesLongos.length ? (
              <span className="chk warn">⚠ Nome com mais de {LIMITE_NOME_OPCAO} caracteres: {ficha.nomesLongos.join(", ")}</span>
            ) : (
              <span className="chk ok">✓ Nomes das opções com até {LIMITE_NOME_OPCAO} caracteres</span>
            )}
            {canal.tipo === "shopee" &&
              ficha.temQtd &&
              (ficha.regra4x && !ficha.regra4x.ok ? (
                <span className="chk warn">⚠ Regra de 4×: dividido em {ficha.anuncios.length} anúncios</span>
              ) : ficha.anuncios[0]?.razao ? (
                <span className="chk ok">
                  ✓ Regra de 4×: {ficha.anuncios[0].razao.toFixed(1).replace(".", ",")}× (cabe num anúncio só)
                </span>
              ) : null)}
            {ficha.quantidadeSeparada && <span className="chk ok">✓ Quantidades em anúncios próprios ({nomeCanal(canal)})</span>}
            {ficha.semPreco.length ? (
              <button type="button" className="chk warn chk-btn" onClick={() => onIrPara?.(ficha.semPreco.some((i) => i.id.startsWith("v:")) ? "quantidade" : "avulso")}>
                ⚠ Sem preço salvo na {nomeCanal(canal)}: {ficha.semPreco.map((i) => (i.id.startsWith("v:") ? `${i.pecas} un.` : i.nome)).join(", ")} → salvar
              </button>
            ) : (
              <span className="chk ok">✓ Todos os itens com preço salvo na {nomeCanal(canal)}</span>
            )}
            {ficha.semSku.length > 0 && <span className="chk warn">⚠ Sem SKU no cadastro: {ficha.semSku.map((i) => (i.id.startsWith("v:") ? `${i.pecas} un.` : i.nome)).join(", ")}</span>}
          </div>

          {ficha.anuncios.map((a, idx) => (
            <div className="ficha-anuncio" key={idx}>
              <div className="ficha-anuncio-cab">
                <span className="ficha-n">ANÚNCIO {idx + 1}</span>
                <b>{a.titulo}</b>
                <span className="ficha-sp" />
                <span className="ficha-meta">
                  desconto {pctTxt(descontoPadraoCanal(canal))}% · {a.linhas.length} {a.linhas.length === 1 ? "opção" : "opções"}
                </span>
              </div>
              <div className="ficha-blocos">
                <div className="ficha-bloco">
                  <h4>
                    Variações
                    <span className="ficha-sp" />
                    {a.variacoes.length > 0 && (
                      <button type="button" className="link-btn" onClick={() => copiar(tsvVariacoes(a), "Tabela de variações")}>
                        copiar
                      </button>
                    )}
                  </h4>
                  {a.variacoes.length ? (
                    <table>
                      <thead>
                        <tr>
                          <th>Variação</th>
                          <th>Opções</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.variacoes.map((v) => (
                          <tr key={v.nome}>
                            <td>{v.nome}</td>
                            <td>
                              {v.opcoes.map((o) => (
                                <span key={o} className={`ficha-opt${o.length > LIMITE_NOME_OPCAO ? " longa" : ""}`} title={`${o.length} caracteres`}>
                                  {o}
                                </span>
                              ))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="hint" style={{ margin: 0 }}>Sem variação — anúncio simples.</div>
                  )}
                </div>
                <div className="ficha-bloco">
                  <h4>
                    Produtos
                    <span className="ficha-sp" />
                    <button type="button" className="link-btn" onClick={() => copiar(tsvProdutos(a), "Tabela de produtos")}>
                      copiar tabela
                    </button>
                  </h4>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>SKU</th>
                          {cores.length > 0 && <th>Cor</th>}
                          {a.temQtdColuna && <th>Qtd.</th>}
                          <th className="num">Preço original</th>
                          <th className="num">Promo</th>
                          <th className="num">Cliente paga</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.linhas.map((l) => (
                          <tr key={`${l.item.id}|${l.cor || ""}`}>
                            <td className="ficha-sku">{l.sku || <span style={{ color: "var(--warn)" }}>sem SKU</span>}</td>
                            {cores.length > 0 && <td>{l.cor}</td>}
                            {a.temQtdColuna && <td>{l.qtd}</td>}
                            {l.an ? (
                              <>
                                <td className="num">
                                  <b>{BRL(l.an.original)}</b>
                                </td>
                                <td className="num">{l.an.promo ? `${l.an.promo}%` : "—"}</td>
                                <td className="num" style={{ color: "var(--ink-soft)" }}>
                                  {BRL(l.an.clientePaga)}
                                  {l.an.clientePaga - l.an.real > 0.004 && <span className="ficha-centavo"> +{Math.round((l.an.clientePaga - l.an.real) * 100)}¢</span>}
                                </td>
                              </>
                            ) : (
                              <td className="num" colSpan={3} style={{ color: "var(--warn)" }}>
                                sem preço salvo
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          ))}

          <div className="ficha-rodape">
            <button type="button" className="btn btn-sm" onClick={exportarCsv}>
              Exportar CSV desta ficha
            </button>
            {kitsComProduto.length > 0 && (
              <span className="hint" style={{ margin: 0 }}>
                Kits com este produto (ficha própria): {kitsComProduto.map((k) => k.nome).join(", ")}
              </span>
            )}
          </div>
        </>
      ) : null}
    </>
  );
}
