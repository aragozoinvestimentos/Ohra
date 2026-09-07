import { useEffect, useMemo, useState } from "react";
import { BRL, PCT, arredondarPreco } from "../lib/format.js";
import {
  ML_CATEGORY_PCT,
  resolverFaixaShopee,
  resolverFaixaML,
  resolverFaixaTikTok,
  calcCanalCustom,
} from "../lib/calc.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { totalItens } from "./SeletorItens.jsx";
import Ajuda from "./Ajuda.jsx";

// Lucratividade e categoria/tipo de anúncio (ML) usados só pra achar o
// preço/lucro de referência de cada produto — fixos de propósito. Esta aba
// é só pra ANALISAR o que já está cadastrado, não pra simular cenários
// (isso já existe em Precificação por Canal e Comparativo).
const LUCRATIVIDADE_PADRAO = 20;
const ML_CATEGORIA_PADRAO = Object.keys(ML_CATEGORY_PCT)[0];
const ML_TIPO_ANUNCIO_PADRAO = "classico";

// Ranking por retorno: pra cada produto E kit cadastrado, olha o lucro
// líquido por unidade (quanto cai no bolso de verdade, já descontado tudo,
// à lucratividade padrão do app) e ordena do que mais retorna pro que menos
// retorna. De propósito NÃO é ranking de venda/popularidade — isso é
// assunto pro futuro ERP; aqui é só "onde vale mais a pena focar produção e
// divulgação" do ponto de vista financeiro.
export default function Ranking() {
  const { lojaId } = useLoja();
  const [produtos, setProdutos] = useState([]);
  const [kits, setKits] = useState([]);
  const [kitProdutosTodos, setKitProdutosTodos] = useState([]);
  const [kitEmbalagensTodos, setKitEmbalagensTodos] = useState([]);
  const [embalagensCatalogo, setEmbalagensCatalogo] = useState([]);
  const [canais, setCanais] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [canalFiltro, setCanalFiltro] = useState("melhor"); // "melhor" ou o id de um canal específico
  const [tipoFiltro, setTipoFiltro] = useState("todos"); // "todos" | "produtos" | "kits"

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
      .channel("ranking-realtime")
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

  // Troca de loja invalida o filtro de canal escolhido (o canal pode nem
  // existir na loja nova).
  useEffect(() => {
    setCanalFiltro("melhor");
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

  // Lista unificada: cada produto cadastrado com custo total (produção +
  // frete + embalagem) e cada kit cadastrado com seu custo total (produtos +
  // embalagem do kit) — as "informações pertinentes" pedidas, num só lugar.
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

  const ranking = useMemo(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, canais, canalFiltro, tipoFiltro]);

  if (!supabase) {
    return (
      <div className="panel">
        <h3>Ranking por Retorno</h3>
        <div className="empty">Indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="panel">
        <h3 className="section-title">
          Ranking por retorno
          <Ajuda texto={`Lista produtos e kits cadastrados ordenados pelo lucro líquido por unidade (a ${LUCRATIVIDADE_PADRAO}% de lucratividade, o padrão do app) — não é ranking de venda/popularidade, isso fica pro ERP futuro. É só análise: pra simular outras metas de lucratividade, use Precificação por Canal ou Comparativo. Use "Mostrar" pra enxugar a lista só pra Produtos ou só pra Kits, e "Marketplace" pra ver o retorno num canal específico (ou deixe em 'Melhor canal' pra ver o teto de cada item).`} />
        </h3>
        {canais.length > 0 ? (
          <div className="row2" style={{ marginBottom: 0, maxWidth: 560 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Mostrar</label>
              <select value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value)}>
                <option value="todos">Produtos e Kits</option>
                <option value="produtos">Somente Produtos</option>
                <option value="kits">Somente Kits</option>
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Marketplace</label>
              <select value={canalFiltro} onChange={(e) => setCanalFiltro(e.target.value)}>
                <option value="melhor">Melhor canal (recomendado)</option>
                {canais.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="empty">Nenhum canal ativo cadastrado ainda — vá em Cadastros → Canais.</div>
        )}
      </div>

      {canais.length > 0 && (
        <div className="panel">
          {carregando ? (
            <div className="empty">Carregando…</div>
          ) : ranking.length === 0 ? (
            <div className="empty">
              Nenhum produto ou kit com custo cadastrado ainda — cadastre em Cadastros → Produtos ou Cadastros → Kits.
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Item</th>
                    <th>Tipo</th>
                    <th className="num">Custo total</th>
                    <th>{canalFiltro === "melhor" ? "Melhor canal" : "Canal"}</th>
                    <th className="num">Lucro/un.</th>
                    <th className="num">Margem</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((linha, idx) => (
                    <tr key={linha.item.id}>
                      <td>{idx + 1}º</td>
                      <td>{linha.item.nome}</td>
                      <td><span className="campo-anterior">{linha.item.tipo}</span></td>
                      <td className="num">{BRL(linha.item.custoTotal)}</td>
                      <td>{linha.canal.nome}</td>
                      <td className="num" style={{ color: linha.lucro >= 0 ? "var(--good)" : "var(--bad)", fontWeight: 600 }}>
                        {BRL(linha.lucro)}
                      </td>
                      <td className="num">{linha.margem != null ? PCT(linha.margem) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
