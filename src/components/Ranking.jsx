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
import Ajuda from "./Ajuda.jsx";

const ML_CATEGORIAS = Object.keys(ML_CATEGORY_PCT);

// Ranking por retorno: pra cada produto cadastrado, olha o lucro líquido por
// unidade (quanto cai no bolso de verdade, já descontado tudo) e ordena do
// que mais retorna pro que menos retorna. De propósito NÃO é ranking de
// venda/popularidade — isso é assunto pro futuro ERP; aqui é só "onde vale
// mais a pena focar produção e divulgação" do ponto de vista financeiro.
export default function Ranking() {
  const { lojaId } = useLoja();
  const [produtos, setProdutos] = useState([]);
  const [canais, setCanais] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [lucratividadeVisao, setLucratividadeVisao] = useState(20);
  const [mlCategoriaVisao, setMlCategoriaVisao] = useState(ML_CATEGORIAS[0]);
  const [mlTipoAnuncioVisao, setMlTipoAnuncioVisao] = useState("classico");
  const [canalFiltro, setCanalFiltro] = useState("melhor"); // "melhor" ou o id de um canal específico

  useEffect(() => {
    if (!supabase) {
      setCarregando(false);
      return;
    }
    let ativo = true;
    async function carregar() {
      try {
        let query = supabase.from("produtos_cadastro").select("*").order("nome", { ascending: true });
        if (lojaId) query = query.eq("loja_id", lojaId);
        const { data, error } = await query;
        if (!ativo) return;
        if (!error) setProdutos(data || []);
      } catch {
        // falha de rede — mantém o que já estava carregado
      } finally {
        if (ativo) setCarregando(false);
      }
    }
    carregar();
    const canal = supabase
      .channel("ranking-produtos-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "produtos_cadastro" }, carregar)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [lojaId]);

  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    async function carregar() {
      let query = supabase.from("canais").select("*").eq("ativo", true).order("tipo");
      if (lojaId) query = query.eq("loja_id", lojaId);
      const { data, error } = await query;
      if (!ativo) return;
      if (!error) setCanais(data || []);
    }
    carregar();
    const canal = supabase
      .channel("ranking-canais-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "canais" }, carregar)
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

  function lucroPorCanal(p, canal) {
    const custoProduto = arredondarPreco(Number(p.custo_producao) || 0);
    const frete = arredondarPreco(Number(p.frete_padrao) || 0);
    const embalagem = arredondarPreco(Number(p.embalagem_padrao) || 0);
    if (custoProduto + frete + embalagem <= 0) return null;
    const base = {
      custoProduto,
      frete,
      embalagem,
      lucratividadePct: (parseFloat(lucratividadeVisao) || 0) / 100,
      imposto: canal.imposto_pct || 0,
      custosFixosPct: canal.custos_fixos_pct || 0,
    };
    if (canal.tipo === "shopee") return resolverFaixaShopee(base).resultado;
    if (canal.tipo === "ml") return resolverFaixaML(mlCategoriaVisao, base, mlTipoAnuncioVisao).resultado;
    if (canal.tipo === "tiktok") return resolverFaixaTikTok(base).resultado;
    return calcCanalCustom(canal, base);
  }

  const ranking = useMemo(() => {
    if (canais.length === 0) return [];
    const canaisAlvo = canalFiltro === "melhor" ? canais : canais.filter((c) => c.id === canalFiltro);
    if (canaisAlvo.length === 0) return [];
    return produtos
      .map((p) => {
        let melhor = null;
        for (const c of canaisAlvo) {
          const r = lucroPorCanal(p, c);
          if (r?.lucro != null && (melhor == null || r.lucro > melhor.lucro)) {
            melhor = { canal: c, lucro: r.lucro, margem: r.margem };
          }
        }
        return melhor ? { produto: p, ...melhor } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.lucro - a.lucro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtos, canais, canalFiltro, lucratividadeVisao, mlCategoriaVisao, mlTipoAnuncioVisao]);

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
          <Ajuda texto="Ordena seus produtos pelo que mais deixa dinheiro no seu bolso por unidade vendida (lucro líquido, com a lucratividade simulada abaixo) — não é ranking de venda/popularidade, isso fica pro ERP futuro. Serve pra decidir onde vale mais a pena focar produção e divulgação. Use o filtro de canal pra ver o retorno só num marketplace específico, ou deixe em 'Melhor canal' pra ver o teto de cada produto." />
        </h3>
        {canais.length > 0 ? (
          <div className="row3" style={{ marginBottom: 0 }}>
            <div className="field">
              <label>Canal</label>
              <select value={canalFiltro} onChange={(e) => setCanalFiltro(e.target.value)}>
                <option value="melhor">Melhor canal (recomendado)</option>
                {canais.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Lucratividade desejada pra simular (%)</label>
              <input
                type="number"
                step="1"
                value={lucratividadeVisao}
                onChange={(e) => setLucratividadeVisao(e.target.value)}
              />
            </div>
            {canais.some((c) => c.tipo === "ml") && (canalFiltro === "melhor" || canais.find((c) => c.id === canalFiltro)?.tipo === "ml") && (
              <div className="field">
                <label>Categoria/anúncio (Mercado Livre)</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <select value={mlCategoriaVisao} onChange={(e) => setMlCategoriaVisao(e.target.value)} style={{ flex: 1 }}>
                    {ML_CATEGORIAS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <select value={mlTipoAnuncioVisao} onChange={(e) => setMlTipoAnuncioVisao(e.target.value)} style={{ flex: 1 }}>
                    <option value="classico">Clássico</option>
                    <option value="premium">Premium</option>
                  </select>
                </div>
              </div>
            )}
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
              Nenhum produto com custo cadastrado ainda (custo + frete + embalagem precisa ser maior que zero) — cadastre em Cadastros → Produtos.
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Produto</th>
                    <th>{canalFiltro === "melhor" ? "Melhor canal" : "Canal"}</th>
                    <th className="num">Lucro/un.</th>
                    <th className="num">Margem</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((linha, idx) => (
                    <tr key={linha.produto.id}>
                      <td>{idx + 1}º</td>
                      <td>{linha.produto.nome}</td>
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
