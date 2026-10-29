import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useRankingData } from "../hooks/useRankingData.js";
import { useCrescimento } from "../hooks/useCrescimento.js";
import { useLancamentosCaixa } from "../hooks/useLancamentosCaixa.js";
import { recarregarCatalogo } from "../lib/catalogoStore.js";
import { LIMITE_MEI_PADRAO, limiteMei, regimeDaLoja } from "../lib/revenda.js";
import { configSimples } from "../lib/simples.js";
import { BRL } from "../lib/format.js";
import { hojeSP } from "../lib/datas.js";

const num = (v) => Number(String(v ?? "").replace(",", ".")) || 0;
const dmy = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

// Configuração → Regras → Impostos da loja (revenda, 24/10/2026; sem SQL —
// lojas.config_escada.impostos). MEI: nenhum imposto por venda; o DAS é fixo
// por mês (conta fixa no Caixa) e o app acompanha o limite de faturamento do ANO.
// Simples Nacional: por enquanto o imposto (%) de cada canal; a alíquota
// automática pela faixa entra na Fase 2. Valores de lei ficam editáveis.
export default function ImpostosLoja({ onToast }) {
  const { lojas, lojaId, atualizar } = useLoja();
  const loja = lojas.find((l) => l.id === lojaId) || null;
  const cfg = loja?.config_escada || {};
  const reg = regimeDaLoja(cfg);
  const { canais } = useRankingData();
  const { pedidosValidos } = useCrescimento();
  const { lancamentos } = useLancamentosCaixa();
  const [form, setForm] = useState(null);
  const cs = configSimples(cfg);
  const f = form || {
    regime: reg.regime || "",
    limiteAnual: String(reg.limiteAnual).replace(".", ","),
    dasMensal: reg.dasMensal ? String(reg.dasMensal).replace(".", ",") : "",
    anexoRevenda: cs.anexoRevenda,
    anexoFabricado: cs.anexoFabricado,
    rbt12Manual: cs.rbt12Manual ? String(cs.rbt12Manual).replace(".", ",") : "",
  };
  const hoje = hojeSP();
  const lim = useMemo(() => (reg.regime === "mei" ? limiteMei({ pedidos: pedidosValidos || [], limite: reg.limiteAnual, hoje }) : null), [reg.regime, reg.limiteAnual, pedidosValidos, hoje]);
  const comImposto = (canais || []).filter((c) => Number(c.imposto_pct) > 0);
  const temDas = (lancamentos || []).some((l) => l.tipo === "saida" && l.recorrencia === "mensal" && /\bDAS\b/i.test(l.descricao || ""));

  const salvar = async () => {
    if (!loja) return;
    const impostos = { regime: f.regime || null, limiteAnual: num(f.limiteAnual) || LIMITE_MEI_PADRAO, dasMensal: num(f.dasMensal) || null, anexoRevenda: f.anexoRevenda || "I", anexoFabricado: f.anexoFabricado || "II", rbt12Manual: num(f.rbt12Manual) || null };
    // Virou ME (MEI → Simples): o app pede uma revisão (Início + aba Fiscal) até "Pronto, revisei".
    if (reg.regime === "mei" && impostos.regime === "simples") impostos.revisarME = true;
    else if (impostos.regime === "simples" && cfg.impostos?.revisarME) impostos.revisarME = true;
    const r = await atualizar(loja.id, { configEscada: { ...cfg, impostos } });
    onToast?.(r.ok ? "Impostos da loja salvos" : `Não foi possível salvar: ${r.error}`);
    if (r.ok) setForm(null);
  };
  const zerarCanais = async () => {
    const r = await supabase.from("canais").update({ imposto_pct: 0 }).in("id", comImposto.map((c) => c.id));
    recarregarCatalogo();
    onToast?.(r.error ? `Não foi possível: ${r.error.message}` : "Imposto dos canais zerado (MEI não paga imposto por venda)");
  };
  const criarDas = async () => {
    const valor = num(f.dasMensal) || reg.dasMensal;
    if (!valor) return onToast?.("Digite o valor do DAS mensal e salve antes");
    const d = new Date(`${hoje}T12:00:00`);
    if (d.getDate() > 20) d.setMonth(d.getMonth() + 1);
    d.setDate(20);
    const { error } = await supabase.from("lancamentos_caixa").insert({ loja_id: lojaId || null, tipo: "saida", categoria: "taxas", descricao: "DAS MEI", valor, data_prevista: d.toISOString().slice(0, 10), recorrencia: "mensal", pago_com: "loja" });
    window.dispatchEvent(new Event("focus"));
    onToast?.(error ? `Não foi possível: ${error.message}` : "Conta fixa \"DAS MEI\" criada no Caixa (todo dia 20)");
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="check-inline" style={{ gap: 14 }}>
        <b>Regime:</b>
        <label>
          <input type="radio" checked={f.regime === "mei"} onChange={() => setForm({ ...f, regime: "mei" })} /> MEI
        </label>
        <label>
          <input type="radio" checked={f.regime === "simples"} onChange={() => setForm({ ...f, regime: "simples" })} /> Simples Nacional (ME)
        </label>
        {!reg.regime && <span className="muted-cel">não escolhido — vale o imposto (%) de cada canal, como antes</span>}
      </div>
      {f.regime === "mei" && (
        <>
          <p className="hint" style={{ margin: 0 }}>
            No MEI não há imposto em cada venda: o preço e o lucro não descontam nada. O DAS é fixo por mês — vira uma conta fixa no Caixa e aparece no lucro líquido do mês. O app soma 3D + revenda e acompanha o limite de faturamento do ano. Confira com o contador o limite e o DAS deste ano (os valores mudam).
          </p>
          <div className="grid-auto">
            <label>
              Limite de faturamento por ano (R$)
              <input inputMode="decimal" value={f.limiteAnual} onChange={(e) => setForm({ ...f, limiteAnual: e.target.value })} />
            </label>
            <label>
              DAS por mês (R$)
              <input inputMode="decimal" placeholder="o valor do boleto" value={f.dasMensal} onChange={(e) => setForm({ ...f, dasMensal: e.target.value })} />
            </label>
          </div>
        </>
      )}
      {f.regime === "simples" && (
        <>
          <p className="hint" style={{ margin: 0 }}>
            O app calcula a alíquota efetiva pelo faturamento dos últimos 12 meses (pedidos importados) e separa o que tem ICMS-ST e PIS/COFINS monofásico (pagam menos DAS) — veja em Dinheiro → Fiscal. Nos preços e no lucro vale o imposto (%) de cada canal: lá dá pra usar a alíquota média do mês com um clique. Confirme o anexo com o contador (depende do CNAE).
          </p>
          <div className="grid-auto">
            <label>
              Revenda (comprado pronto) entra no
              <select value={f.anexoRevenda} onChange={(e) => setForm({ ...f, anexoRevenda: e.target.value })}>
                <option value="I">Anexo I — comércio</option>
                <option value="II">Anexo II — indústria</option>
              </select>
            </label>
            <label>
              Fabricado por você (3D) entra no
              <select value={f.anexoFabricado} onChange={(e) => setForm({ ...f, anexoFabricado: e.target.value })}>
                <option value="II">Anexo II — indústria (CNAE de fabricação)</option>
                <option value="I">Anexo I — comércio (CNAE só de comércio)</option>
              </select>
            </label>
            <label>
              Faturamento dos últimos 12 meses (R$, opcional)
              <input inputMode="decimal" placeholder="vazio = pelos pedidos importados" value={f.rbt12Manual} onChange={(e) => setForm({ ...f, rbt12Manual: e.target.value })} />
            </label>
          </div>
        </>
      )}
      <div>
        <button type="button" className="btn primary" onClick={salvar} disabled={!form}>
          Salvar
        </button>
      </div>
      {reg.regime === "mei" && lim && (
        <div className={`alerta ${lim.atencao ? "alerta-warn" : "alerta-neutro"}`}>
          <b>
            Faturado em {hoje.slice(0, 4)}: {BRL(lim.faturado)} de {BRL(lim.limite)} ({Math.round(lim.pct * 100)}%)
          </b>
          Pelos pedidos importados (o que os clientes pagaram). No ritmo dos últimos 90 dias, o ano fecha em ~{BRL(lim.projecao)}
          {lim.passaEm ? ` — passa do limite por volta de ${dmy(lim.passaEm)}. Converse com o contador sobre virar ME.` : "."}
        </div>
      )}
      {reg.regime === "mei" && comImposto.length > 0 && (
        <div className="alerta alerta-warn">
          <b>
            {comImposto.length} {comImposto.length === 1 ? "canal tem" : "canais têm"} imposto por venda ({comImposto.map((c) => c.nome).join(", ")})
          </b>
          No MEI o imposto não sai de cada venda.{" "}
          <button type="button" className="link-btn" onClick={zerarCanais}>
            Zerar o imposto desses canais
          </button>
        </div>
      )}
      {reg.regime === "mei" && !temDas && (
        <div className="alerta alerta-neutro">
          <b>O DAS ainda não está no Caixa</b>
          <button type="button" className="link-btn" onClick={criarDas}>
            Criar conta fixa "DAS MEI" (todo dia 20)
          </button>
        </div>
      )}
    </div>
  );
}
