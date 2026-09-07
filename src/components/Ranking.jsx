import { useEffect, useState } from "react";
import { BRL, PCT } from "../lib/format.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useRankingData, calcularRanking, LUCRATIVIDADE_PADRAO } from "../hooks/useRankingData.js";
import { supabase } from "../lib/supabaseClient.js";
import Ajuda from "./Ajuda.jsx";

// Ranking por retorno: pra cada produto E kit cadastrado, olha o lucro
// líquido por unidade (quanto cai no bolso de verdade, já descontado tudo,
// à lucratividade padrão do app) e ordena do que mais retorna pro que menos
// retorna. De propósito NÃO é ranking de venda/popularidade — isso é
// assunto pro futuro ERP; aqui é só "onde vale mais a pena focar produção e
// divulgação" do ponto de vista financeiro.
export default function Ranking() {
  const { lojaId } = useLoja();
  const { itens, canais, carregando } = useRankingData();
  const [canalFiltro, setCanalFiltro] = useState("melhor"); // "melhor" ou o id de um canal específico
  const [tipoFiltro, setTipoFiltro] = useState("todos"); // "todos" | "produtos" | "kits"
  const [busca, setBusca] = useState("");

  // Troca de loja invalida o filtro de canal escolhido (o canal pode nem
  // existir na loja nova).
  useEffect(() => {
    setCanalFiltro("melhor");
  }, [lojaId]);

  const ranking = calcularRanking(itens, canais, { canalFiltro, tipoFiltro }).filter((linha) => {
    const alvo = busca.trim().toLowerCase();
    if (!alvo) return true;
    return linha.item.nome.toLowerCase().includes(alvo) || (linha.item.sku || "").toLowerCase().includes(alvo);
  });

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
          <>
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
            <div className="field" style={{ maxWidth: 320, marginTop: 12, marginBottom: 0 }}>
              <input type="text" placeholder="Buscar por nome ou SKU…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
          </>
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
              {busca.trim()
                ? "Nenhum produto ou kit encontrado pra essa busca."
                : "Nenhum produto ou kit com custo cadastrado ainda — cadastre em Cadastros → Produtos ou Cadastros → Kits."}
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Item</th>
                    <th>SKU</th>
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
                      <td>{linha.item.sku || <span style={{ color: "var(--ink-faint)" }}>—</span>}</td>
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
