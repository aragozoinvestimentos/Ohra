import { useMemo, useState } from "react";
import { useLoja } from "../lib/LojaContext.jsx";
import { useCatalogo } from "../hooks/useCatalogo.js";
import { useCrescimento } from "../hooks/useCrescimento.js";
import { useRevenda } from "../hooks/useRevenda.js";
import { supabase } from "../lib/supabaseClient.js";
import { recarregarCatalogo } from "../lib/catalogoStore.js";
import { limiteMei, regimeDaLoja } from "../lib/revenda.js";
import { ANEXOS, LIMITE_SIMPLES, NOME_TIPO, SUBLIMITE_ICMS, aliquotaEfetiva, dasDoMes, faixaDe } from "../lib/simples.js";
import { abrirProduto } from "../lib/anuncios.js";
import { irParaAba } from "../lib/navegar.js";
import { hojeSP } from "../lib/datas.js";
import { BRL } from "../lib/format.js";
import Kpis from "./Kpis.jsx";

// Dinheiro → Fiscal (28/10/2026): acompanhamento, NÃO emite nota (quem emite é a Olist)
// e não substitui o contador. MEI: limite do ano e DAS fixo. Simples: alíquota efetiva
// pelos 12 meses, DAS estimado do mês separado por anexo e por ST/monofásico (lib/simples.js),
// produtos sem NCM e as notas de compra do mês.
const NOMES_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const pct = (v, c = 2) => (v == null ? "—" : `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c })}%`);
const mudarMes = (mes, n) => {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");

export default function Fiscal({ onToast }) {
  const { lojas, lojaId } = useLoja();
  const cfgBruto = (lojas || []).find((l) => l.id === lojaId)?.config_escada;
  const cfgLoja = useMemo(() => cfgBruto || {}, [cfgBruto]);
  const reg = regimeDaLoja(cfgLoja);
  const cat = useCatalogo();
  const { pedidosValidos } = useCrescimento();
  const rev = useRevenda();
  const hoje = hojeSP();
  const [mes, setMes] = useState(hoje.slice(0, 7));
  const pedidos = useMemo(() => pedidosValidos || [], [pedidosValidos]);
  const das = useMemo(() => (reg.regime === "simples" ? dasDoMes({ pedidos, mes, cfgLoja, produtos: cat.produtos || [] }) : null), [reg.regime, pedidos, mes, cfgLoja, cat.produtos]);
  const lim = useMemo(() => (reg.regime === "mei" ? limiteMei({ pedidos, limite: reg.limiteAnual, hoje }) : null), [reg.regime, reg.limiteAnual, pedidos, hoje]);
  const revenda = (cat.produtos || []).filter((p) => p.origem === "revenda");
  const temColunaNcm = revenda.some((p) => "ncm" in p);
  const semNcm = temColunaNcm ? revenda.filter((p) => !p.ncm) : [];
  const notasMes = (rev.compras || []).filter((c) => String(c.emissao || "").slice(0, 7) === mes);
  const canais = cat.canaisTodos || cat.canais || [];

  const usarNosCanais = async (aliq) => {
    const ids = canais.filter((c) => c.ativo !== false && c.tipo !== "custom").map((c) => c.id);
    const r = await supabase.from("canais").update({ imposto_pct: Math.round(aliq * 10000) / 10000 }).in("id", ids);
    recarregarCatalogo();
    onToast?.(r.error ? `Não foi possível: ${r.error.message}` : `Imposto dos marketplaces = ${pct(aliq)} (preço e lucro já usam)`);
  };

  const seletor = (
    <div className="toolbar" style={{ gap: 6 }}>
      <button type="button" className="btn btn-mini" onClick={() => setMes(mudarMes(mes, -1))}>
        ‹
      </button>
      <b>
        {NOMES_MES[Number(mes.slice(5, 7)) - 1]} de {mes.slice(0, 4)}
      </b>
      <button type="button" className="btn btn-mini" onClick={() => setMes(mudarMes(mes, 1))} disabled={mes >= hoje.slice(0, 7)}>
        ›
      </button>
    </div>
  );

  if (!reg.regime)
    return (
      <div className="panel">
        <h3>Fiscal</h3>
        <div className="empty">
          Escolha o regime da loja (MEI ou Simples Nacional) em{" "}
          <button type="button" className="link-btn" onClick={() => irParaAba("regras")}>
            Configuração → Regras → Impostos da loja
          </button>
          .
        </div>
      </div>
    );

  const imposto = canais.filter((c) => c.ativo !== false && c.tipo !== "custom").map((c) => Number(c.imposto_pct) || 0);
  const media = das?.efetivaMedia;
  const canaisDiferem = media != null && imposto.some((v) => Math.abs(v - media) > 0.001);

  return (
    <>
      {seletor}
      {reg.regime === "mei" && lim && (
        <Kpis
          itens={[
            { label: "Regime", valor: "MEI", sub: "sem imposto por venda — DAS fixo por mês" },
            { label: `Faturado em ${hoje.slice(0, 4)}`, valor: BRL(lim.faturado), sub: `${Math.round(lim.pct * 100)}% do limite de ${BRL(lim.limite)}`, tom: lim.atencao ? "warn" : null },
            { label: "Ritmo do ano", valor: BRL(lim.projecao), sub: lim.passaEm ? `passa do limite por volta de ${dm(lim.passaEm)}` : "dentro do limite" },
            { label: "DAS por mês", valor: reg.dasMensal ? BRL(reg.dasMensal) : "—", sub: "conta fixa no Caixa" },
          ]}
        />
      )}
      {das && (
        <>
          <Kpis
            itens={[
              { label: "Faturamento 12 meses (RBT12)", valor: BRL(das.rbt.valor), sub: das.rbt.origem === "informado" ? "informado em Regras" : das.rbt.origem === "proporcional" ? `média de ${das.rbt.meses} ${das.rbt.meses === 1 ? "mês" : "meses"} × 12 (início de atividade)` : das.rbt.origem === "sem-historico" ? "sem pedidos antes deste mês — 1ª faixa" : "pelos pedidos importados" },
              { label: "Alíquota efetiva", valor: `${pct(aliquotaEfetiva(das.cfg.anexoRevenda, das.rbt.valor))} · ${pct(aliquotaEfetiva(das.cfg.anexoFabricado, das.rbt.valor))}`, sub: `revenda (Anexo ${das.cfg.anexoRevenda}) · fabricado (Anexo ${das.cfg.anexoFabricado}) · ${faixaDe("I", das.rbt.valor).n}ª faixa` },
              { label: "DAS estimado do mês", valor: BRL(das.das), sub: `sobre ${BRL(das.faturamento)} · média ${pct(media)}` },
              { label: "Limite do Simples", valor: `${Math.round((das.rbt.valor / LIMITE_SIMPLES) * 100)}%`, sub: das.rbt.valor > SUBLIMITE_ICMS ? "passou do sublimite de R$ 3,6 mi (ICMS fora do DAS)" : `de ${BRL(LIMITE_SIMPLES)}`, tom: das.rbt.valor > SUBLIMITE_ICMS ? "warn" : null },
            ]}
          />
          <div className="panel">
            <h3>DAS estimado — {NOMES_MES[Number(mes.slice(5, 7)) - 1]}</h3>
            {das.linhas.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Anexo</th>
                      <th>Tipo</th>
                      <th>Faturamento</th>
                      <th>Alíquota</th>
                      <th>Imposto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {das.linhas.map((l) => (
                      <tr key={`${l.anexo}|${l.tipo}`}>
                        <td>{ANEXOS[l.anexo].nome}</td>
                        <td>{NOME_TIPO[l.tipo]}</td>
                        <td>{BRL(l.faturamento)}</td>
                        <td>{pct(l.aliquota)}</td>
                        <td>{BRL(l.imposto)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={2}>
                        <b>Total</b>
                      </td>
                      <td>
                        <b>{BRL(das.faturamento)}</b>
                      </td>
                      <td>
                        <b>{pct(media)}</b>
                      </td>
                      <td>
                        <b>{BRL(das.das)}</b>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">Sem pedidos importados neste mês.</div>
            )}
            {canaisDiferem && (
              <div className="alerta alerta-neutro" style={{ marginTop: 8 }}>
                <b>O imposto dos marketplaces está diferente da alíquota média do mês ({pct(media)}).</b> Preço e lucro usam o imposto (%) de cada canal.{" "}
                <button type="button" className="link-btn" onClick={() => usarNosCanais(media)}>
                  Usar {pct(media)} nos marketplaces
                </button>
              </div>
            )}
            <p className="hint">
              Venda com ICMS-ST (comprada com CFOP 5405/CST 60) não paga a parte do ICMS no DAS; produto monofásico (cosméticos, perfumes…) não paga PIS/COFINS. O app lê isso do cadastro de cada produto (vem da nota de compra). É uma ESTIMATIVA — o valor oficial é o do PGDAS; confira com o contador.
            </p>
          </div>
        </>
      )}
      {semNcm.length > 0 && (
        <div className="panel">
          <h3>
            Produtos de revenda sem NCM <span className="h3-contagem">{semNcm.length}</span>
          </h3>
          <ul className="completar-lista">
            {semNcm.map((p) => (
              <li key={p.id}>
                <b>{p.nome}</b>{" "}
                <button type="button" className="link-btn" onClick={() => abrirProduto(`p:${p.id}`, "cadastro")}>
                  completar →
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="panel">
        <h3>
          Notas de compra do mês <span className="h3-contagem">{notasMes.length}</span>
        </h3>
        {notasMes.length ? (
          <ul className="completar-lista">
            {notasMes.map((c) => (
              <li key={c.id}>
                NF {c.numero} · {dm(c.emissao)} · {BRL(c.total_nota)}
                {Number(c.total_st) > 0 ? ` · ST ${BRL(c.total_st)}` : ""}
                {Number(c.difal) > 0 ? ` · DIFAL ${BRL(c.difal)}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <div className="hint">Nenhuma nota de compra importada neste mês (Operação → Estoque e compras).</div>
        )}
      </div>
      <p className="hint">O app não emite nota fiscal (quem emite é a Olist) e não substitui o contador: aqui é só acompanhamento.</p>
    </>
  );
}
