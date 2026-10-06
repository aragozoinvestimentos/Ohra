import { useMemo, useState } from "react";
import { alertaPreco } from "../lib/estrategia.js";
import FreteAviso from "./FreteAviso.jsx";
import { supabase } from "../lib/supabaseClient.js";
import { useEscada } from "../hooks/useEscada.js";
import { BRL } from "../lib/format.js";
import { calcularAnuncio, descontoDoItem, descontoPadraoCanal, gruposRegra4x } from "../lib/escada.js";
import { gruposDoSeletor, itemTipoDoId } from "../lib/variacoes.js";
import { nomeCanal } from "../lib/canais.js";
import BuscaItem from "./BuscaItem.jsx";
import CanalTag from "./CanalTag.jsx";
import Ajuda from "./Ajuda.jsx";

const LIMITE_NOME_OPCAO = 30; // Shopee: nome de cada opção de variação
const MAX_VARIACOES = 2; // variações do produto (além da quantidade)
const NOMES_SUGERIDOS = ["Cor", "Modelo", "Tamanho", "Estampa", "Acabamento"];
const ATRIBUTOS_ML = ["cor", "tamanho"]; // quase sempre existem como atributo da categoria no ML/Shein
const pctTxt = (d) => `${Math.round(d * 1000) / 10}`.replace(".", ",");

// Lê `cores_anuncio` (schema v31): formato antigo = lista de opções de Cor
// [{nome, sufixo}]; formato novo = { variacoes: [{ nome, opcoes: [{nome, sufixo}] }] }.
function lerVariacoes(valor) {
  if (Array.isArray(valor)) return valor.length ? [{ nome: "Cor", opcoes: valor.filter((o) => o && o.nome) }] : [];
  if (valor && Array.isArray(valor.variacoes)) return valor.variacoes.filter((v) => v && v.nome).map((v) => ({ nome: v.nome, opcoes: (v.opcoes || []).filter((o) => o && o.nome) }));
  return [];
}
const sufixoAuto = (nome) => `-${String(nome).normalize("NFD").replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase() || "X"}`;
function combinacoes(variacoes) {
  const ativas = variacoes.filter((v) => v.opcoes.length);
  return ativas.reduce((acc, v) => acc.flatMap((c) => v.opcoes.map((o) => [...c, o])), [[]]);
}

// 3º Ficha do anúncio — pra UM produto (inclui as variações de quantidade
// dele) ou kit e UM canal, monta as tabelas pra criar o anúncio: variações e
// produtos (SKU = SKU do item + sufixos das opções, preço original, promo,
// cliente paga). Os preços vêm de Precificação (1º Avulso / 2º Por
// quantidade) e do desconto exibido (4º Anunciar). Até 2 variações próprias
// (Cor, Modelo, Tamanho… — só o que NÃO muda custo). Regras por canal:
// Shopee/TikTok/próprio aceitam até 2 variações por anúncio — com a quantidade
// dá 3, e aí junta as duas numa só ("Preto · Sentado") ou separa a quantidade
// em anúncios; ML/Shein = um anúncio por quantidade, com as variações. SKU do
// item editável direto na tabela (✎).
export default function FichaAnuncio({ onToast, onIrPara }) {
  const { itens, canais, precos, produtos, kits, mapaRampa, clientePagaHoje } = useEscada();
  // Itens em rampa (Crescimento) vendendo num preço diferente do salvo: a
  // ficha usa os números da Rampa (riscado fixo no alvo + promo do degrau).
  const rampaMapa = mapaRampa; // useEscada: mesma conta da Rampa (lib/rampaAnuncio.js)
  const [sel, setSel] = useState("");
  const [canalId, setCanalId] = useState("");
  const [novaOpcao, setNovaOpcao] = useState({}); // { [idxVariacao]: { nome, sufixo } }
  // Anúncios abertos/recolhidos: o 1º abre, os seguintes (2, 3… — muitas vezes
  // só simulação, não cadastrados) começam recolhidos. Chave item|canal|nº.
  const [abertos, setAbertos] = useState({});
  const [salvando, setSalvando] = useState(false);
  const [modoTres, setModoTres] = useState("juntar"); // "juntar" | "separar" — quando dá 3 variações
  const [skuEdit, setSkuEdit] = useState(null); // { itemId, valor }

  const canal = canais.find((c) => c.id === canalId) || canais[0] || null;
  const opcoesBusca = useMemo(() => gruposDoSeletor(itens.filter((i) => !i.id.startsWith("v:"))), [itens]);
  const isKit = sel.startsWith("k:");
  const donoId = sel ? sel.slice(2) : null;
  const dono = !sel ? null : isKit ? kits.find((k) => k.id === donoId) : produtos.find((p) => p.id === donoId);
  const itemBase = sel ? itens.find((i) => i.id === sel) : null;
  const variacoes = useMemo(() => lerVariacoes(dono?.cores_anuncio), [dono]);

  const itensLista = useMemo(() => {
    if (!itemBase) return [];
    if (isKit) return [itemBase];
    const vars = itens.filter((i) => i.id.startsWith("v:") && i.produtoId === donoId).sort((a, b) => (a.pecas || 0) - (b.pecas || 0));
    return [itemBase, ...vars];
  }, [itemBase, isKit, itens, donoId]);

  const ficha = useMemo(() => {
    if (!canal || !itensLista.length) return null;
    const ativas = variacoes.filter((v) => v.opcoes.length);
    const combos = combinacoes(variacoes);
    const qtdDe = (it) => (it.id.startsWith("v:") ? it.pecas || it.quantidade || 1 : 1);
    const qtdLabel = (it) => `${qtdDe(it)} un.`;
    const temQtd = !isKit && itensLista.length > 1;
    const mlShein = canal.tipo === "ml" || canal.tipo === "shein";
    const tiersNecessarios = ativas.length + (temQtd ? 1 : 0);
    const tresVariacoes = !mlShein && tiersNecessarios > 2;
    const quantidadeSeparada = temQtd && (mlShein || (tresVariacoes && modoTres === "separar"));
    const juntar = tresVariacoes && modoTres === "juntar" && ativas.length === 2;

    const linhasDe = (it) => {
      const tipo = itemTipoDoId(it.id);
      const s = precos.find((p) => p.item_tipo === tipo && p.item_id === it.id.slice(2) && p.canal_id === canal.id);
      const { desconto } = descontoDoItem(it.id, canal, { itens, produtos, kits });
      const ra = rampaMapa.get(`${it.id}|${canal.id}`) || null;
      const an = ra
        ? { original: ra.original, promo: ra.promo, clientePaga: ra.clientePaga, real: ra.real, emRampa: true, acima: ra.acima }
        : s && Number(s.preco) > 0
          ? calcularAnuncio(Number(s.preco), desconto)
          : null;
      return combos.map((combo) => ({
        item: it,
        sku: `${it.sku || ""}${combo.map((o) => o.sufixo || "").join("")}`,
        sufixos: combo.map((o) => o.sufixo || "").join(""),
        semSku: !it.sku,
        opcoes: combo.map((o) => o.nome),
        qtd: isKit ? null : qtdLabel(it),
        an,
        // Regra de 4×: sempre pelo preço SALVO (a promo temporária da rampa não decide o anúncio).
        anSalvo: s && Number(s.preco) > 0 ? calcularAnuncio(Number(s.preco), desconto) : an,
      }));
    };

    const nomeBase = itemBase?.nome || "";
    const resumo = ativas.map((v) => (v.opcoes.length <= 3 ? v.opcoes.map((o) => o.nome).join(" e ") : `${v.opcoes.length} ${v.nome.toLowerCase()}s`)).join(" · ");
    const sufixoTitulo = resumo ? ` — ${resumo}` : "";

    let grupos;
    let regra4x = null;
    if (quantidadeSeparada) grupos = itensLista.map((it) => [it]);
    else if (canal.tipo === "shopee" && temQtd) {
      const precosN = itensLista.map((it) => {
        const l = linhasDe(it)[0];
        return { n: qtdDe(it), promo: l.anSalvo?.clientePaga ?? 0, original: l.anSalvo?.original ?? 0, it };
      });
      const comPreco = precosN.filter((x) => x.promo > 0);
      regra4x = comPreco.length ? gruposRegra4x(comPreco) : null;
      if (regra4x && !regra4x.ok) {
        grupos = regra4x.grupos.map((ns) => itensLista.filter((it) => ns.includes(qtdDe(it))));
        const semPreco = itensLista.filter((it) => !comPreco.find((x) => x.it === it));
        if (semPreco.length) grupos[0] = [...grupos[0], ...semPreco];
      } else grupos = [itensLista];
    } else grupos = [itensLista];

    // colunas/variações de cada anúncio
    const colunasAttr = juntar ? [ativas.map((v) => v.nome).join(" e ")] : ativas.map((v) => v.nome);
    const valoresAttr = (l) => (juntar ? [l.opcoes.join(" · ")] : l.opcoes);
    const anuncios = grupos.map((g) => {
      const linhas = g.flatMap(linhasDe);
      const unico = g.length === 1 ? g[0] : null;
      const titulo = quantidadeSeparada && unico && qtdDe(unico) > 1 ? `Kit ${qtdDe(unico)} ${nomeBase}${sufixoTitulo}` : `${nomeBase}${sufixoTitulo}`;
      const tabelaVar = [];
      if (juntar) tabelaVar.push({ nome: colunasAttr[0], opcoes: combos.map((c) => c.map((o) => o.nome).join(" · ")) });
      else ativas.forEach((v) => tabelaVar.push({ nome: v.nome, opcoes: v.opcoes.map((o) => o.nome) }));
      if (g.length > 1) tabelaVar.push({ nome: "Quantidade", opcoes: g.map(qtdLabel) });
      const precificadas = linhas.filter((l) => l.an);
      const razao = precificadas.length ? Math.max(...precificadas.map((l) => (l.anSalvo || l.an).original)) / Math.min(...precificadas.map((l) => (l.anSalvo || l.an).clientePaga)) : null;
      return { titulo, linhas, tabelaVar, temQtdColuna: g.length > 1, razao };
    });

    const todasLinhas = anuncios.flatMap((a) => a.linhas);
    const nomesOpcao = [...new Set(anuncios.flatMap((a) => a.tabelaVar.flatMap((t) => t.opcoes)))];
    const nomesLongos = nomesOpcao.filter((n) => n.length > LIMITE_NOME_OPCAO);
    const semPreco = [...new Set(todasLinhas.filter((l) => !l.an).map((l) => l.item.id))].map((id) => itensLista.find((i) => i.id === id));
    const semSku = [...new Set(todasLinhas.filter((l) => l.semSku).map((l) => l.item.id))].map((id) => itensLista.find((i) => i.id === id));
    const attrsForaML = mlShein ? ativas.filter((v) => !ATRIBUTOS_ML.includes(v.nome.trim().toLowerCase())).map((v) => v.nome) : [];
    return { anuncios, colunasAttr, valoresAttr, nomesLongos, semPreco, semSku, quantidadeSeparada, regra4x, temQtd, tresVariacoes, attrsForaML };
  }, [canal, itensLista, precos, itens, produtos, kits, variacoes, isKit, itemBase, modoTres, rampaMapa]);

  const kitsComProduto = !isKit && donoId ? itens.filter((i) => i.id.startsWith("k:") && (i.componentes || []).some((c) => c.produtoId === donoId)) : [];

  // ---- variações do produto (salvas em cores_anuncio, formato novo)
  async function salvarVariacoes(lista) {
    if (!supabase || !dono) return false;
    setSalvando(true);
    const limpo = lista.filter((v) => v.nome.trim());
    const { error } = await supabase
      .from(isKit ? "kits" : "produtos_cadastro")
      .update({ cores_anuncio: limpo.length ? { variacoes: limpo } : null })
      .eq("id", donoId);
    setSalvando(false);
    if (error) {
      onToast(/cores_anuncio|column/i.test(error.message) ? "Rode o SQL v31 no Supabase pra salvar as variações" : `Não foi possível salvar: ${error.message}`);
      return false;
    }
    return true;
  }
  function adicionarVariacao() {
    if (variacoes.length >= MAX_VARIACOES) return;
    const usados = new Set(variacoes.map((v) => v.nome.toLowerCase()));
    const nome = NOMES_SUGERIDOS.find((n) => !usados.has(n.toLowerCase())) || `Variação ${variacoes.length + 1}`;
    salvarVariacoes([...variacoes, { nome, opcoes: [] }]);
  }
  function renomearVariacao(idx, nome) {
    const n = nome.trim();
    if (!n || n === variacoes[idx].nome) return;
    salvarVariacoes(variacoes.map((v, i) => (i === idx ? { ...v, nome: n } : v)));
  }
  function removerVariacao(idx) {
    salvarVariacoes(variacoes.filter((_, i) => i !== idx));
  }
  async function adicionarOpcao(idx) {
    const d = novaOpcao[idx] || {};
    const nome = String(d.nome || "").trim();
    if (!nome) return;
    let sufixo = String(d.sufixo || "").trim() || sufixoAuto(nome);
    if (!sufixo.startsWith("-")) sufixo = `-${sufixo}`;
    sufixo = sufixo.toUpperCase();
    if (variacoes[idx].opcoes.some((o) => o.sufixo.toUpperCase() === sufixo)) {
      onToast(`O sufixo ${sufixo} já está em uso em ${variacoes[idx].nome} — escolha outro`);
      return;
    }
    const nova = variacoes.map((v, i) => (i === idx ? { ...v, opcoes: [...v.opcoes, { nome, sufixo }] } : v));
    if (await salvarVariacoes(nova)) setNovaOpcao((prev) => ({ ...prev, [idx]: { nome: "", sufixo: "" } }));
  }
  function removerOpcao(idx, sufixo) {
    salvarVariacoes(variacoes.map((v, i) => (i === idx ? { ...v, opcoes: v.opcoes.filter((o) => o.sufixo !== sufixo) } : v)));
  }

  // ---- SKU do item (produto, variação de quantidade ou kit) direto na tabela
  async function salvarSku() {
    const e = skuEdit;
    setSkuEdit(null);
    if (!e || !supabase) return;
    const it = itens.find((i) => i.id === e.itemId);
    const novo = String(e.valor).trim();
    if (!it || novo === (it.sku || "")) return;
    const tabela = e.itemId.startsWith("k:") ? "kits" : e.itemId.startsWith("v:") ? "produto_variacoes" : "produtos_cadastro";
    const { error } = await supabase.from(tabela).update({ sku: novo || null }).eq("id", e.itemId.slice(2));
    if (error) onToast(`Não foi possível salvar o SKU: ${error.message}`);
    else onToast(novo ? `SKU salvo: ${novo}` : "SKU removido");
  }

  // Copiar um valor só (SKU, preço original, promo) — mostra ✓ na hora.
  const [copiado, setCopiado] = useState(null);
  async function copiarValor(texto, chave) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(chave);
      setTimeout(() => setCopiado((c) => (c === chave ? null : c)), 1200);
    } catch {
      onToast("Não deu pra copiar automaticamente neste navegador");
    }
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
  const tsvVariacoes = (a) => ["Variação\tOpções", ...a.tabelaVar.map((v) => `${v.nome}\t${v.opcoes.join(", ")}`)].join("\n");
  const tsvProdutos = (a) =>
    [
      ["SKU", ...ficha.colunasAttr, ...(a.temQtdColuna ? ["Quantidade"] : []), "Preço original", "Promoção %", "Cliente paga"].join("\t"),
      ...a.linhas.map((l) => [l.sku, ...ficha.valoresAttr(l), ...(a.temQtdColuna ? [l.qtd] : []), l.an ? num(l.an.original) : "", l.an ? String(l.an.promo) : "", l.an ? num(l.an.clientePaga) : ""].join("\t")),
    ].join("\n");

  function exportarCsv() {
    if (!ficha) return;
    const rows = [["Anúncio", "SKU", ...ficha.colunasAttr, "Quantidade", "Preço original", "Promoção %", "Cliente paga"]];
    ficha.anuncios.forEach((a) => a.linhas.forEach((l) => rows.push([a.titulo, l.sku, ...ficha.valoresAttr(l), l.qtd || "", l.an ? num(l.an.original) : "", l.an ? String(l.an.promo) : "", l.an ? num(l.an.clientePaga) : ""])));
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ficha-${String(itemBase?.sku || itemBase?.nome || "item").toLowerCase().replace(/\s+/g, "-")}-${String(canal?.tipo || "canal")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const rotuloItem = (i) => (i.id.startsWith("v:") ? `${i.pecas} un.` : i.nome);

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
              <Ajuda texto="Escolha um produto (a ficha inclui as variações de 2, 3… unidades dele) ou um kit (ficha própria). O canal define o formato: Shopee/TikTok = um anúncio com até 2 variações (as suas + Quantidade); Mercado Livre/Shein = um anúncio por quantidade, com as suas variações." />
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
          <h3 className="section-title h3-split">
            <span>
              Variações {isKit ? "do kit" : "do produto"}
              <Ajuda texto="Até 2 variações (Cor, Modelo, Tamanho, Estampa… ou um nome seu), cada uma com as opções e o sufixo do SKU. SKU de cada opção = SKU do item + sufixos (ex.: GATO-2 + -P + -S = GATO-2-P-S). Use só pro que NÃO muda o custo — todas as opções saem com o mesmo preço do item. Se a opção muda custo/preço (ex.: tamanho G gasta mais filamento), cadastre como produto separado. Sem variações = uma opção por item." />
            </span>
            {dono && variacoes.length < MAX_VARIACOES && (
              <button type="button" className="btn btn-sm" disabled={salvando} onClick={adicionarVariacao}>
                + Adicionar variação
              </button>
            )}
          </h3>
          {!dono ? (
            <div className="hint" style={{ margin: 0 }}>Escolha um produto ou kit ao lado.</div>
          ) : !variacoes.length ? (
            <div className="hint" style={{ margin: 0 }}>Nenhuma variação — o anúncio sai com uma opção por item. Clique em “+ Adicionar variação” (ex.: Cor).</div>
          ) : (
            variacoes.map((v, idx) => (
              <div className="ficha-var" key={`${idx}-${v.nome}`}>
                <div className="ficha-var-cab">
                  <input className="ficha-var-nome" list="ficha-nomes-var" defaultValue={v.nome} maxLength={20} onBlur={(e) => renomearVariacao(idx, e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.target.blur()} title="Nome da variação (aparece no anúncio)" />
                  <button type="button" className="del" title="Remover esta variação" disabled={salvando} onClick={() => removerVariacao(idx)}>
                    ×
                  </button>
                </div>
                <div className="ficha-cores">
                  {v.opcoes.map((o) => (
                    <span key={o.sufixo} className="ficha-cor">
                      {o.nome} <code>{o.sufixo}</code>
                      <button type="button" className="del" title="Remover opção" disabled={salvando} onClick={() => removerOpcao(idx, o.sufixo)}>
                        ×
                      </button>
                    </span>
                  ))}
                  {!v.opcoes.length && <span className="hint" style={{ margin: 0 }}>Sem opções ainda.</span>}
                </div>
                <div className="ficha-add-cor">
                  <input
                    placeholder={`nova opção de ${v.nome.toLowerCase()}`}
                    value={novaOpcao[idx]?.nome || ""}
                    maxLength={LIMITE_NOME_OPCAO}
                    onChange={(e) => setNovaOpcao((prev) => ({ ...prev, [idx]: { ...(prev[idx] || {}), nome: e.target.value } }))}
                    onKeyDown={(e) => e.key === "Enter" && adicionarOpcao(idx)}
                  />
                  <input className="ficha-sufixo" placeholder="-P" value={novaOpcao[idx]?.sufixo || ""} maxLength={12} onChange={(e) => setNovaOpcao((prev) => ({ ...prev, [idx]: { ...(prev[idx] || {}), sufixo: e.target.value } }))} onKeyDown={(e) => e.key === "Enter" && adicionarOpcao(idx)} />
                  <button type="button" className="btn btn-sm" disabled={salvando || !String(novaOpcao[idx]?.nome || "").trim()} onClick={() => adicionarOpcao(idx)}>
                    + Opção
                  </button>
                </div>
              </div>
            ))
          )}
          <datalist id="ficha-nomes-var">
            {NOMES_SUGERIDOS.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
      </div>

      {!sel || !canal ? (
        <div className="empty">{canais.length ? "Escolha um produto ou kit pra montar a ficha do anúncio." : "Cadastre seus canais em Configuração → Canais."}</div>
      ) : ficha ? (
        <>
          {ficha.tresVariacoes && (
            <div className="ficha-escolha">
              <span>
                <b>{nomeCanal(canal)} aceita no máximo 2 variações por anúncio</b> — com {variacoes.filter((v) => v.opcoes.length).map((v) => v.nome).join(", ")} e Quantidade seriam 3. Como montar?
              </span>
              <div className="subabas">
                <button type="button" className={`btn${modoTres === "juntar" ? " primary" : ""}`} onClick={() => setModoTres("juntar")}>
                  Juntar {variacoes.filter((v) => v.opcoes.length).map((v) => v.nome).join(" e ")} numa só
                </button>
                <button type="button" className={`btn${modoTres === "separar" ? " primary" : ""}`} onClick={() => setModoTres("separar")}>
                  Quantidade em anúncios separados
                </button>
              </div>
            </div>
          )}
          <div className="ficha-checks">
            {ficha.nomesLongos.length ? (
              <span className="chk warn">⚠ Nome com mais de {LIMITE_NOME_OPCAO} caracteres: {ficha.nomesLongos.join(", ")}</span>
            ) : (
              <span className="chk ok">✓ Nomes das opções com até {LIMITE_NOME_OPCAO} caracteres</span>
            )}
            {canal.tipo === "shopee" &&
              ficha.temQtd &&
              !ficha.quantidadeSeparada &&
              (ficha.regra4x && !ficha.regra4x.ok ? (
                <span className="chk warn">⚠ Regra de 4×: dividido em {ficha.anuncios.length} anúncios</span>
              ) : ficha.anuncios[0]?.razao ? (
                <span className="chk ok">✓ Regra de 4×: {ficha.anuncios[0].razao.toFixed(1).replace(".", ",")}× (cabe num anúncio só)</span>
              ) : null)}
            {ficha.quantidadeSeparada && <span className="chk ok">✓ Quantidades em anúncios próprios</span>}
            {ficha.attrsForaML.length > 0 && <span className="chk warn">⚠ Confira se a categoria do {nomeCanal(canal)} aceita “{ficha.attrsForaML.join("”, “")}” como variação — se não, use anúncios separados</span>}
            {ficha.semPreco.length ? (
              <button type="button" className="chk warn chk-btn" onClick={() => onIrPara?.(ficha.semPreco.some((i) => i.id.startsWith("v:")) ? "quantidade" : "avulso")}>
                ⚠ Sem preço salvo na {nomeCanal(canal)}: {ficha.semPreco.map(rotuloItem).join(", ")} → salvar
              </button>
            ) : (
              <span className="chk ok">✓ Todos os itens com preço salvo na {nomeCanal(canal)}</span>
            )}
            {ficha.semSku.length > 0 && <span className="chk warn">⚠ Sem SKU: {ficha.semSku.map(rotuloItem).join(", ")} — clique no ✎ da tabela</span>}
          </div>

          {ficha.anuncios.map((a, idx) => {
            const chaveAb = `${sel}|${canal?.id}|${idx}`;
            const aberto = abertos[chaveAb] ?? (idx === 0 || ficha.anuncios.length === 1);
            const qtds = [...new Set(a.linhas.map((l) => l.qtd).filter(Boolean))];
            return (
            <div className={`ficha-anuncio${aberto ? "" : " recolhido"}`} key={idx}>
              <button type="button" className="ficha-anuncio-cab" aria-expanded={aberto} onClick={() => setAbertos((prev) => ({ ...prev, [chaveAb]: !aberto }))} title={aberto ? "Recolher este anúncio" : "Abrir este anúncio"}>
                <span className="seta-ficha">{aberto ? "▾" : "▸"}</span>
                <span className="ficha-n">ANÚNCIO {idx + 1}</span>
                <b>{a.titulo}</b>
                <span className="ficha-sp" />
                <span className="ficha-meta">
                  {!aberto && qtds.length > 0 ? `${qtds.join(", ")} · ` : ""}desconto {pctTxt(descontoPadraoCanal(canal))}% · {a.linhas.length} {a.linhas.length === 1 ? "opção" : "opções"}
                </span>
              </button>
              {aberto && (
              <div className="ficha-blocos">
                <div className="ficha-bloco">
                  <h4>
                    Variações
                    <span className="ficha-sp" />
                    {a.tabelaVar.length > 0 && (
                      <button type="button" className="link-btn" onClick={() => copiar(tsvVariacoes(a), "Tabela de variações")}>
                        copiar
                      </button>
                    )}
                  </h4>
                  {a.tabelaVar.length ? (
                    <table>
                      <thead>
                        <tr>
                          <th>Variação</th>
                          <th>Opções</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.tabelaVar.map((v) => (
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
                          {ficha.colunasAttr.map((c) => (
                            <th key={c}>{c}</th>
                          ))}
                          {a.temQtdColuna && <th>Qtd.</th>}
                          <th className="num">Preço original</th>
                          <th className="num">Promo</th>
                          <th className="num">Cliente paga</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.linhas.map((l) => (
                          <tr key={`${l.item.id}|${l.sufixos}`}>
                            <td className="ficha-sku">
                              {skuEdit?.itemId === l.item.id ? (
                                <span className="ficha-sku-edit">
                                  <input
                                    autoFocus
                                    value={skuEdit.valor}
                                    onChange={(e) => setSkuEdit({ ...skuEdit, valor: e.target.value })}
                                    onBlur={salvarSku}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") e.target.blur();
                                      if (e.key === "Escape") setSkuEdit(null);
                                    }}
                                  />
                                  {l.sufixos}
                                </span>
                              ) : (
                                <>
                                  {l.semSku ? <span style={{ color: "var(--warn)" }}>sem SKU{l.sufixos}</span> : l.sku}
                                  {!l.semSku && (
                                    <button type="button" className={`link-btn ficha-copiar${copiado === `sku|${l.sku}` ? " ok" : ""}`} title="Copiar SKU" onClick={() => copiarValor(l.sku, `sku|${l.sku}`)}>
                                      {copiado === `sku|${l.sku}` ? "✓" : "⧉"}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="link-btn ficha-sku-btn"
                                    title={`Editar o SKU de ${rotuloItem(l.item)} (vale pra todas as opções dele)`}
                                    onClick={() => setSkuEdit({ itemId: l.item.id, valor: l.item.sku || "" })}
                                  >
                                    ✎
                                  </button>
                                </>
                              )}
                            </td>
                            {ficha.valoresAttr(l).map((vv, i) => (
                              <td key={i}>{vv}</td>
                            ))}
                            {a.temQtdColuna && <td>{l.qtd}</td>}
                            {l.an ? (
                              <>
                                <td className="num">
                                  <button type="button" className={`ficha-valor${copiado === `po|${l.sku}` ? " ok" : ""}`} title="Clique pra copiar o preço original" onClick={() => copiarValor(num(l.an.original), `po|${l.sku}`)}>
                                    <b>{BRL(l.an.original)}</b>
                                    <span className="ficha-copiar-ic">{copiado === `po|${l.sku}` ? "✓" : "⧉"}</span>
                                  </button>
                                </td>
                                <td className="num">
                                  {l.an.promo ? (
                                    <button type="button" className={`ficha-valor${copiado === `pr|${l.sku}` ? " ok" : ""}`} title="Clique pra copiar a promoção %" onClick={() => copiarValor(String(l.an.promo), `pr|${l.sku}`)}>
                                      {l.an.promo}%<span className="ficha-copiar-ic">{copiado === `pr|${l.sku}` ? "✓" : "⧉"}</span>
                                    </button>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                                <td className="num" style={{ color: "var(--ink-soft)" }}>
                                  {BRL(l.an.clientePaga)}
                                  {l.an.clientePaga - l.an.real > 0.004 && <span className="ficha-centavo"> +{Math.round((l.an.clientePaga - l.an.real) * 100)}¢</span>}
                                  {canal && alertaPreco({ preco: l.an.real, canal, valorCliente: clientePagaHoje(l.item, canal) ?? l.an.clientePaga }).frete && (
                                    <div>
                                      <FreteAviso frete={alertaPreco({ preco: l.an.real, canal, valorCliente: clientePagaHoje(l.item, canal) ?? l.an.clientePaga }).frete} compacto />
                                    </div>
                                  )}
                                  {l.an.emRampa && (
                                    <div>
                                      <span className="rampa-tag" title="Em rampa de preço (Vender → Crescimento): números do degrau atual — riscado fixo no alvo, só a promo muda. No alvo volta pro preço salvo.">
                                        {l.an.acima ? "testando acima · preço da Rampa" : "em rampa · preço da Rampa"}
                                      </span>
                                    </div>
                                  )}
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
              )}
            </div>
            );
          })}

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
