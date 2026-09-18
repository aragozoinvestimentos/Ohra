import { useEffect, useMemo, useState } from "react";
import { BRL, PCT } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import SeletorItens, { totalItens } from "./SeletorItens.jsx";
import Termometro from "./Termometro.jsx";
import Ajuda from "./Ajuda.jsx";
import { useRankingData, calcularRanking } from "../hooks/useRankingData.js";

const MESES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// Soma o campo "lucro" dos itens escolhidos — mesma ideia de totalItens (de
// SeletorItens.jsx), que só soma "preco". Aqui precisamos dos dois ao mesmo
// tempo (faturamento E lucro do cenário simulado), por isso um helper à parte
// em vez de rodar o mesmo catálogo duas vezes com campos trocados.
function totalLucroItens(catalogo, itens) {
  return (itens || []).reduce((soma, it) => {
    const item = catalogo.find((c) => c.id === it.itemId);
    const qtd = Number(it.quantidade) || 0;
    return soma + (item ? Number(item.lucro) * qtd : 0);
  }, 0);
}

// Meta mensal (faturamento/lucro objetivo) + simulador de vendas: "se eu
// vender X, Y e Z, bate a meta desse mês?" — usando o preço e lucro REAIS já
// salvos em Preços por Canal pra cada produto/kit × canal, não uma conta
// teórica de custo + margem desejada (o objetivo é responder "quanto falta
// vender" com números que já refletem taxa de canal, imposto etc. de verdade).
export default function Metas({ onToast }) {
  const { lojaId } = useLoja();
  const [produtos, setProdutos] = useState([]);
  const [kits, setKits] = useState([]);
  const [canais, setCanais] = useState([]);
  const [precos, setPrecos] = useState([]);
  // Sem Supabase configurado não há nada pra carregar — inicializa já como
  // "não carregando" nesse caso (em vez de sincronizar isso depois, num
  // useEffect, o que dispara um segundo render à toa logo de cara).
  const [carregando, setCarregando] = useState(() => !!supabase);

  const [metaId, setMetaId] = useState(null);
  const [faturamentoObjetivo, setFaturamentoObjetivo] = useState("");
  const [lucroObjetivo, setLucroObjetivo] = useState("");
  const [salvandoMeta, setSalvandoMeta] = useState(false);

  const [itensVenda, setItensVenda] = useState([]); // [{ itemId, quantidade }] — itemId = id da linha em precos_canal

  // Mesma base de dados do Ranking (produtos+kits com custo total, canais e
  // preços salvos) só pra achar os melhores desempenhos — evita duplicar a
  // lógica de "qual o melhor canal de cada item" aqui.
  const { itens: itensRanking, canais: canaisRanking, precos: precosRanking } = useRankingData();

  // Mês corrente no formato 'YYYY-MM' — cada mês é uma linha própria em
  // metas_mensais, então virar o mês não apaga nada: só passa a ler/gravar
  // outra linha (ainda não criada, então os campos ficam em branco até você
  // definir a meta desse mês novo).
  const mesAtual = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, []);
  const mesLabel = `${MESES_PT[Number(mesAtual.split("-")[1]) - 1]}/${mesAtual.split("-")[0]}`;

  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    async function carregar() {
      try {
        let qp = supabase.from("produtos_cadastro").select("*").order("nome");
        let qk = supabase.from("kits").select("*").order("nome");
        let qc = supabase.from("canais").select("*").eq("ativo", true).order("tipo");
        let qpc = supabase.from("precos_canal").select("*");
        let qm = supabase.from("metas_mensais").select("*").eq("mes", mesAtual);
        if (lojaId) {
          qp = qp.eq("loja_id", lojaId);
          qk = qk.eq("loja_id", lojaId);
          qc = qc.eq("loja_id", lojaId);
          qpc = qpc.eq("loja_id", lojaId);
          qm = qm.eq("loja_id", lojaId);
        }
        const [rp, rk, rc, rpc, rm] = await Promise.all([qp, qk, qc, qpc, qm]);
        if (!ativo) return;
        if (!rp.error) setProdutos(rp.data || []);
        if (!rk.error) setKits(rk.data || []);
        if (!rc.error) setCanais(rc.data || []);
        if (!rpc.error) setPrecos(rpc.data || []);
        if (!rm.error) {
          const row = (rm.data || [])[0] || null;
          setMetaId(row?.id || null);
          setFaturamentoObjetivo(row?.faturamento_objetivo != null ? String(row.faturamento_objetivo) : "");
          setLucroObjetivo(row?.lucro_objetivo != null ? String(row.lucro_objetivo) : "");
        }
      } catch {
        // falha de rede — mantém o que já estava carregado
      } finally {
        if (ativo) setCarregando(false);
      }
    }
    carregar();
    // Sem isso, salvar um preço em Precificação por Canal ou mudar a meta em
    // outro aparelho só refletiria aqui depois de recarregar a página inteira.
    const ch = supabase
      .channel("metas-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "produtos_cadastro" }, carregar)
      .on("postgres_changes", { event: "*", schema: "public", table: "kits" }, carregar)
      .on("postgres_changes", { event: "*", schema: "public", table: "canais" }, carregar)
      .on("postgres_changes", { event: "*", schema: "public", table: "precos_canal" }, carregar)
      .on("postgres_changes", { event: "*", schema: "public", table: "metas_mensais" }, carregar)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(ch);
    };
  }, [lojaId, mesAtual]);

  // Troca de loja invalida o cenário simulado anterior (preços de outra
  // loja) — ajustado durante a renderização, não num useEffect (mesmo
  // padrão usado em OrcamentoVolume.jsx, evita disparar um efeito só pra
  // zerar um estado).
  const [lojaAnterior, setLojaAnterior] = useState(lojaId);
  if (lojaId !== lojaAnterior) {
    setLojaAnterior(lojaId);
    setItensVenda([]);
  }

  // Catálogo do simulador: uma linha por combinação produto/kit × canal que
  // JÁ tem preço salvo (Preços por Canal) — preco/lucro aqui são os valores
  // reais salvos, não recalculados. Sem preço salvo, não entra na lista (não
  // dá pra simular uma venda sem saber por quanto ela sai).
  const catalogoVendas = useMemo(() => {
    return precos
      .map((p) => {
        let nome, sku;
        if (p.item_tipo === "kit") {
          const kit = kits.find((k) => k.id === p.item_id);
          if (!kit) return null;
          nome = `[Kit] ${kit.nome}`;
          sku = kit.sku || "";
        } else {
          const prod = produtos.find((x) => x.id === p.item_id);
          if (!prod) return null;
          nome = prod.nome;
          sku = prod.sku || "";
        }
        const canalObj = canais.find((c) => c.id === p.canal_id);
        if (!canalObj) return null;
        return {
          id: p.id,
          nome: `${nome} — ${canalObj.nome}`,
          sku,
          preco: Number(p.preco) || 0,
          lucro: Number(p.lucro) || 0,
          unidade: "un",
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [precos, produtos, kits, canais]);

  // Top 5 melhores desempenhos (mesmo critério do Ranking: maior lucro,
  // considerando o melhor canal de cada produto/kit) que já têm preço
  // salvo — só esses têm uma linha correspondente em catalogoVendas pra
  // poder entrar no simulador com um clique.
  const topPerformers = useMemo(() => {
    const ranking = calcularRanking(itensRanking, canaisRanking, { precos: precosRanking });
    return ranking
      .filter((linha) => linha.origem === "salvo")
      .map((linha) => {
        const [tipo, id] = linha.item.id.split(":");
        const itemTipo = tipo === "k" ? "kit" : "produto";
        const linhaPreco = precosRanking.find(
          (p) => p.item_tipo === itemTipo && p.item_id === id && p.canal_id === linha.canal.id
        );
        if (!linhaPreco) return null;
        const noCatalogo = catalogoVendas.find((c) => c.id === linhaPreco.id);
        if (!noCatalogo) return null;
        return { catalogoId: linhaPreco.id, nome: noCatalogo.nome, lucro: linha.lucro };
      })
      .filter(Boolean)
      .slice(0, 5);
  }, [itensRanking, canaisRanking, precosRanking, catalogoVendas]);

  // Adiciona (ou soma +1 unidade, se já estiver no cenário) um item do
  // topPerformers ao simulador — mesmo formato { itemId, quantidade } que o
  // SeletorItens já usa, então o resto da tela (totais, termômetros) nem
  // percebe a diferença entre um item adicionado na mão ou por aqui.
  function adicionarTopPerformer(catalogoId) {
    setItensVenda((prev) => {
      const idx = prev.findIndex((it) => it.itemId === catalogoId);
      if (idx >= 0) {
        const copia = prev.slice();
        copia[idx] = { ...copia[idx], quantidade: (Number(copia[idx].quantidade) || 0) + 1 };
        return copia;
      }
      return [...prev, { itemId: catalogoId, quantidade: 1 }];
    });
  }

  const itensVendaValidos = itensVenda.filter((it) => it.itemId && (Number(it.quantidade) || 0) > 0);
  const totalPecasSimuladas = itensVendaValidos.reduce((soma, it) => soma + (Number(it.quantidade) || 0), 0);
  const faturamentoSimulado = totalItens(catalogoVendas, itensVendaValidos);
  const lucroSimulado = totalLucroItens(catalogoVendas, itensVendaValidos);

  const faturamentoObjetivoNum = parseFloat(faturamentoObjetivo) || 0;
  const lucroObjetivoNum = parseFloat(lucroObjetivo) || 0;

  async function salvarMeta() {
    if (!supabase) return;
    setSalvandoMeta(true);
    const payload = {
      loja_id: lojaId || null,
      mes: mesAtual,
      faturamento_objetivo: faturamentoObjetivo !== "" ? parseFloat(faturamentoObjetivo) || 0 : null,
      lucro_objetivo: lucroObjetivo !== "" ? parseFloat(lucroObjetivo) || 0 : null,
    };
    let error;
    if (metaId) {
      ({ error } = await supabase.from("metas_mensais").update(payload).eq("id", metaId));
    } else {
      const resp = await supabase.from("metas_mensais").insert(payload).select().single();
      error = resp.error;
      if (!error && resp.data) setMetaId(resp.data.id);
    }
    setSalvandoMeta(false);
    if (error) {
      onToast?.("Não foi possível salvar a meta agora — tente de novo");
      return;
    }
    onToast?.("Meta do mês salva");
  }

  if (!supabase) {
    return (
      <div className="panel">
        <h3>Metas</h3>
        <div className="empty">Indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      </div>
    );
  }

  return (
    <div className="grid2">
      <div>
        <div className="panel">
          <h3 className="section-title">
            Meta de {mesLabel}
            <Ajuda texto="Faturamento e lucro objetivo pra este mês — servem de referência pro simulador ao lado. Cada mês tem sua própria meta: quando o mês virar, este painel passa a mostrar a meta do mês novo (em branco até você definir), sem apagar a do mês anterior." />
          </h3>
          {carregando ? (
            <div className="empty">Carregando…</div>
          ) : (
            <>
              <div className="row2">
                <div className="field">
                  <label>Faturamento objetivo (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={faturamentoObjetivo}
                    onChange={(e) => setFaturamentoObjetivo(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Lucro líquido objetivo (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={lucroObjetivo}
                    onChange={(e) => setLucroObjetivo(e.target.value)}
                  />
                </div>
              </div>
              <button className="btn primary" onClick={salvarMeta} disabled={salvandoMeta}>
                {salvandoMeta ? "Salvando…" : "Salvar meta do mês"}
              </button>
            </>
          )}
        </div>
      </div>

      <div>
        <div className="panel">
          <h3 className="section-title">
            Simulador de vendas
            <Ajuda texto="Monte um cenário de vendas do mês escolhendo combinações produto/kit + canal que já têm preço salvo em Preços por Canal — usa o preço e o lucro REAIS de lá, não uma conta teórica, pra ver se esse cenário bateria a meta." />
          </h3>
          {catalogoVendas.length === 0 ? (
            <div className="empty">
              Nenhum preço salvo ainda — salve preços em Precificação por Canal (aparecem em Preços por Canal) pra poder simular vendas com valores reais.
            </div>
          ) : (
            <>
              {topPerformers.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <label>Adicionar melhores desempenhos (Ranking)</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                    {topPerformers.map((tp) => (
                      <button
                        type="button"
                        key={tp.catalogoId}
                        className="btn"
                        title={`Lucro: ${BRL(tp.lucro)}/un.`}
                        onClick={() => adicionarTopPerformer(tp.catalogoId)}
                      >
                        + {tp.nome} ({BRL(tp.lucro)})
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <SeletorItens
                catalogo={catalogoVendas}
                itens={itensVenda}
                onChange={setItensVenda}
                rotuloVazio="Nenhum preço salvo ainda."
              />
            </>
          )}
        </div>

        {itensVendaValidos.length > 0 && (
          <div className="panel">
            <h3 className="section-title">Resultado do cenário simulado</h3>
            <div className="kv"><span className="k">Peças vendidas</span><span className="v">{totalPecasSimuladas}</span></div>
            <div className="kv total"><span className="k">Faturamento simulado</span><span className="v">{BRL(faturamentoSimulado)}</span></div>
            <div className="kv"><span className="k">Lucro simulado</span><span className="v">{BRL(lucroSimulado)}</span></div>

            {faturamentoObjetivoNum > 0 && (
              <>
                <Termometro
                  valor={faturamentoSimulado / faturamentoObjetivoNum}
                  meta={1}
                  label={`Faturamento: ${PCT(faturamentoSimulado / faturamentoObjetivoNum)} da meta`}
                />
                {faturamentoSimulado < faturamentoObjetivoNum && (
                  <div className="hint" style={{ marginTop: 4, marginBottom: 0 }}>
                    Faltam {BRL(faturamentoObjetivoNum - faturamentoSimulado)} de faturamento pra bater a meta do mês.
                  </div>
                )}
              </>
            )}

            {lucroObjetivoNum > 0 && (
              <>
                <Termometro
                  valor={lucroSimulado / lucroObjetivoNum}
                  meta={1}
                  label={`Lucro: ${PCT(lucroSimulado / lucroObjetivoNum)} da meta`}
                />
                {lucroSimulado < lucroObjetivoNum && (
                  <div className="hint" style={{ marginTop: 4, marginBottom: 0 }}>
                    Faltam {BRL(lucroObjetivoNum - lucroSimulado)} de lucro pra bater a meta do mês.
                  </div>
                )}
              </>
            )}

            {faturamentoObjetivoNum <= 0 && lucroObjetivoNum <= 0 && (
              <div className="hint" style={{ marginTop: 4, marginBottom: 0 }}>
                Defina uma meta ao lado pra comparar esse cenário com o objetivo do mês.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
