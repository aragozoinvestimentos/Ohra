import { useEffect, useMemo, useState } from "react";
import {
  ML_CATEGORY_PCT,
  resolverFaixaShopee,
  resolverFaixaML,
  resolverFaixaTikTok,
  calcCanalCustom,
} from "../lib/calc.js";
import { arredondarPreco } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { totalItens } from "../components/SeletorItens.jsx";

// Lucratividade e categoria/tipo de anúncio (ML) usados só pra achar o
// preço/lucro de referência de cada produto — fixos de propósito, tanto
// aqui quanto no Ranking e na tela de descanso, pra manter os dois
// consistentes entre si. Quem quiser simular outra meta usa Precificação
// por Canal ou Comparativo.
export const LUCRATIVIDADE_PADRAO = 20;
export const ML_CATEGORIA_PADRAO = Object.keys(ML_CATEGORY_PCT)[0];
export const ML_TIPO_ANUNCIO_PADRAO = "classico";

function lucroPorCanal(custoTotal, canal) {
  if (custoTotal <= 0) return null;
  const base = {
    custoProduto: custoTotal,
    frete: 0,
    embalagem: 0,
    lucratividadePct: LUCRATIVIDADE_PADRAO / 100,
    imposto: canal.imposto_pct || 0,
    custosFixosPct: canal.custos_fixos_pct || 0,
  };
  if (canal.tipo === "shopee") return resolverFaixaShopee(base).resultado;
  if (canal.tipo === "ml") return resolverFaixaML(ML_CATEGORIA_PADRAO, base, ML_TIPO_ANUNCIO_PADRAO).resultado;
  if (canal.tipo === "tiktok") return resolverFaixaTikTok(base).resultado;
  return calcCanalCustom(canal, base);
}

// Dado o catálogo unificado (produtos + kits, já com custoTotal) e os
// canais ativos, monta o ranking ordenado por lucro — usado tanto pela
// aba Ranking quanto pela tela de descanso, sempre com a mesma lógica.
export function calcularRanking(itens, canais, { canalFiltro = "melhor", tipoFiltro = "todos" } = {}) {
  if (canais.length === 0) return [];
  const canaisAlvo = canalFiltro === "melhor" ? canais : canais.filter((c) => c.id === canalFiltro);
  if (canaisAlvo.length === 0) return [];
  const itensAlvo =
    tipoFiltro === "produtos" ? itens.filter((i) => i.tipo === "Produto") : tipoFiltro === "kits" ? itens.filter((i) => i.tipo === "Kit") : itens;
  return itensAlvo
    .map((item) => {
      let melhor = null;
      for (const c of canaisAlvo) {
        const r = lucroPorCanal(item.custoTotal, c);
        if (r?.lucro != null && (melhor == null || r.lucro > melhor.lucro)) {
          melhor = { canal: c, lucro: r.lucro, margem: r.margem };
        }
      }
      return melhor ? { item, ...melhor } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.lucro - a.lucro);
}

// Busca produtos, kits e canais da loja atual (com realtime) e monta o
// catálogo unificado de itens com custo total — a mesma base de dados que
// alimenta o Ranking e a tela de descanso.
export function useRankingData() {
  const { lojaId } = useLoja();
  const [produtos, setProdutos] = useState([]);
  const [kits, setKits] = useState([]);
  const [kitProdutosTodos, setKitProdutosTodos] = useState([]);
  const [kitEmbalagensTodos, setKitEmbalagensTodos] = useState([]);
  const [embalagensCatalogo, setEmbalagensCatalogo] = useState([]);
  const [canais, setCanais] = useState([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setCarregando(false);
      return;
    }
    let ativo = true;
    async function carregar() {
      try {
        let qp = supabase.from("produtos_cadastro").select("*").order("nome", { ascending: true });
        let qc = supabase.from("canais").select("*").eq("ativo", true).order("tipo");
        let qk = supabase.from("kits").select("*").order("nome");
        let qe = supabase.from("embalagens").select("*").order("nome");
        if (lojaId) {
          qp = qp.eq("loja_id", lojaId);
          qc = qc.eq("loja_id", lojaId);
          qk = qk.eq("loja_id", lojaId);
          qe = qe.eq("loja_id", lojaId);
        }
        const [rp, rc, rk, re] = await Promise.all([qp, qc, qk, qe]);
        if (!ativo) return;
        if (!rp.error) setProdutos(rp.data || []);
        if (!rc.error) setCanais(rc.data || []);
        if (!rk.error) setKits(rk.data || []);
        if (!re.error) setEmbalagensCatalogo(re.data || []);

        const kitIds = (rk.data || []).map((k) => k.id);
        const [kpResp, keResp] = await Promise.all([
          kitIds.length ? supabase.from("kit_produtos").select("*").in("kit_id", kitIds) : Promise.resolve({ data: [] }),
          kitIds.length ? supabase.from("kit_embalagens").select("*").in("kit_id", kitIds) : Promise.resolve({ data: [] }),
        ]);
        if (!ativo) return;
        setKitProdutosTodos(kpResp.data || []);
        setKitEmbalagensTodos(keResp.data || []);
      } catch {
        // falha de rede — mantém o que já estava carregado
      } finally {
        if (ativo) setCarregando(false);
      }
    }
    carregar();
    const canal = supabase
      .channel("ranking-data-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "produtos_cadastro" }, carregar)
      .on("postgres_changes", { event: "*", schema: "public", table: "canais" }, carregar)
      .on("postgres_changes", { event: "*", schema: "public", table: "kits" }, carregar)
      .on("postgres_changes", { event: "*", schema: "public", table: "kit_produtos" }, carregar)
      .on("postgres_changes", { event: "*", schema: "public", table: "kit_embalagens" }, carregar)
      .on("postgres_changes", { event: "*", schema: "public", table: "embalagens" }, carregar)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [lojaId]);

  const catalogoProdutosBase = useMemo(
    () => produtos.map((p) => ({ id: p.id, nome: p.nome, preco: Number(p.custo_producao) || 0, unidade: "un" })),
    [produtos]
  );
  const catalogoEmbalagensBase = useMemo(
    () => embalagensCatalogo.map((m) => ({ id: m.id, nome: m.nome, preco: m.preco, unidade: m.unidade })),
    [embalagensCatalogo]
  );

  function custoKitTotal(k) {
    const prodItens = kitProdutosTodos.filter((r) => r.kit_id === k.id).map((r) => ({ itemId: r.produto_id, quantidade: r.quantidade }));
    const embItens = kitEmbalagensTodos.filter((r) => r.kit_id === k.id).map((r) => ({ itemId: r.embalagem_id, quantidade: r.quantidade }));
    return totalItens(catalogoProdutosBase, prodItens) + totalItens(catalogoEmbalagensBase, embItens);
  }

  // Lista unificada: cada produto cadastrado com custo total (produção +
  // frete + embalagem) e cada kit cadastrado com seu custo total (produtos
  // + embalagem do kit) num só lugar.
  const itens = useMemo(() => {
    const doProdutos = produtos.map((p) => ({
      id: `p:${p.id}`,
      nome: p.nome,
      tipo: "Produto",
      custoTotal: arredondarPreco((Number(p.custo_producao) || 0) + (Number(p.frete_padrao) || 0) + (Number(p.embalagem_padrao) || 0)),
    }));
    const doKits = kits.map((k) => ({
      id: `k:${k.id}`,
      nome: k.nome,
      tipo: "Kit",
      custoTotal: arredondarPreco(custoKitTotal(k)),
    }));
    return [...doProdutos, ...doKits];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtos, kits, kitProdutosTodos, kitEmbalagensTodos, embalagensCatalogo]);

  return {
    itens,
    canais,
    carregando,
    contagemProdutos: produtos.length,
    contagemKits: kits.length,
  };
}
