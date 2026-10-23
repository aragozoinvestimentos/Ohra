import { useEffect, useMemo, useState } from "react";
import { useCrescimento } from "../hooks/useCrescimento.js";
import { useLembrado } from "../hooks/useLembrado.js";
import { usePreferencia } from "../hooks/usePreferencia.js";
import { CHAVE_CARRINHOS, CUPOM_DIAS, ESTADOS_CARRINHO, JANELA_RECUPERA, carrinhosAbandonados, lembrarCarrinhos, resumoCarrinhos } from "../lib/carrinhos.js";
import { hojeSP } from "../lib/datas.js";
import { BRL, PCT } from "../lib/format.js";
import CanalTag from "./CanalTag.jsx";
import Estado from "./Estado.jsx";
import Kpis from "./Kpis.jsx";
import Ajuda from "./Ajuda.jsx";

// Análise → Carrinhos abandonados (23/10/2026): pedidos fechados e não pagos
// ("Dados incompletos" na Olist) — fora das vendas no app todo — e quantos
// voltaram em até 7 dias (o cupom de recuperação vale 3). Só lê; a única
// gravação é a memória de quais pedidos já foram vistos não pagos.
const dm = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : "");
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const PERIODOS = [
  { k: "30", rot: "Últimos 30 dias", dias: 30 },
  { k: "90", rot: "Últimos 90 dias", dias: 90 },
  { k: "tudo", rot: "Tudo", dias: null },
];

export default function CarrinhosAbandonados() {
  const cres = useCrescimento();
  const hoje = hojeSP();
  const [memoria, setMemoria, info] = usePreferencia(CHAVE_CARRINHOS, {});
  const [periodo, setPeriodo] = useLembrado("ohra:carrinhos:periodo", "30");
  const [canalF, setCanalF] = useState("");
  const linhas = cres.pedidosValidos;
  const carregado = info?.carregado !== false;

  // Pedido não pago já no banco e ainda fora da memória → lembra (assim, se for
  // pago depois, continua contando como carrinho recuperado).
  useEffect(() => {
    if (!carregado) return;
    const nova = lembrarCarrinhos(memoria, linhas, hoje);
    if (nova) setMemoria(nova);
  }, [linhas, memoria, hoje, setMemoria, carregado]);

  const { lista } = useMemo(() => carrinhosAbandonados({ linhas, memoria, hoje }), [linhas, memoria, hoje]);
  const canais = useMemo(() => {
    const m = new Map();
    for (const c of lista) if (c.canal) m.set(c.canal.id, c.canal);
    return [...m.values()];
  }, [lista]);
  const p = PERIODOS.find((x) => x.k === periodo) || PERIODOS[0];
  const desde = p.dias ? somarDias(hoje, -(p.dias - 1)) : null;
  const vis = lista.filter((c) => (!desde || c.data >= desde) && (!canalF || c.canal_id === canalF));
  const r = resumoCarrinhos(vis);

  return (
    <div>
      <div className="toolbar">
        <div className="subabas">
          {PERIODOS.map((x) => (
            <button key={x.k} type="button" className={`btn${periodo === x.k ? " primary" : ""}`} onClick={() => setPeriodo(x.k)}>
              {x.rot}
            </button>
          ))}
        </div>
        {canais.length > 1 && (
          <select value={canalF} onChange={(e) => setCanalF(e.target.value)}>
            <option value="">Todas as plataformas</option>
            {canais.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        )}
        <Ajuda
          texto={`Pedido que o cliente fechou e não pagou — na Olist vem como "Dados incompletos", sem os dados de envio. Ele NÃO conta como venda em lugar nenhum do app (vendas, lucro, curvas, rampa, avaliações, caixa). Recuperado: o mesmo pedido foi pago depois, ou o mesmo cliente comprou em até ${JANELA_RECUPERA} dias. Provável: saiu outro pedido do mesmo produto na mesma plataforma em até ${JANELA_RECUPERA} dias, mas não deu pra confirmar que é o mesmo cliente (a plataforma pode mandar outro contato). O cupom de recuperação vale ${CUPOM_DIAS} dias; a conta de ${JANELA_RECUPERA} dias é a métrica.`}
        />
      </div>
      <Kpis
        itens={[
          { label: "Carrinhos abandonados", valor: String(r.n), sub: r.aguardando ? `${r.aguardando} ainda dentro dos ${JANELA_RECUPERA} dias` : null },
          { label: "Valor que ficou no carrinho", valor: BRL(r.valor) },
          {
            label: "Recuperados",
            valor: `${r.recuperados}${r.provaveis ? ` (+${r.provaveis} provável${r.provaveis > 1 ? "is" : ""})` : ""}`,
            sub: r.taxa != null ? `taxa ${PCT(r.taxa)}${r.provaveis ? ` · até ${PCT(r.taxaComProvaveis)} com os prováveis` : ""}` : "sem carrinho fechado ainda",
            tom: r.recuperados ? "good" : undefined,
          },
          { label: "Valor recuperado", valor: BRL(r.valorRecuperado) },
        ]}
      />
      {vis.length ? (
        <div className="panel">
          <h3>Pedidos não pagos</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Plataforma</th>
                  <th>Pedido</th>
                  <th>Produto</th>
                  <th className="num">Valor</th>
                  <th>Situação</th>
                  <th>Compra que recuperou</th>
                </tr>
              </thead>
              <tbody>
                {vis.map((c) => {
                  const e = ESTADOS_CARRINHO[c.estado];
                  return (
                    <tr key={c.pedido}>
                      <td>{dm(c.data)}</td>
                      <td>{c.canal ? <CanalTag canal={c.canal} /> : "—"}</td>
                      <td className="muted-cel">{c.ordem || `Olist ${c.pedido}`}</td>
                      <td>
                        {c.itens.map((i, k) => (
                          <div key={k}>
                            {i.q > 1 ? `${i.q}× ` : ""}
                            {i.nome}
                          </div>
                        ))}
                      </td>
                      <td className="num">{BRL(c.valor)}</td>
                      <td>
                        <Estado tipo={e.tipo} title={e.dica}>
                          {e.rot}
                        </Estado>
                        {c.estado === "aguardando" && (
                          <div className="muted-cel">{hoje <= c.cupomAte ? `cupom até ${dm(c.cupomAte)}` : `conta até ${dm(c.ateRecuperar)}`}</div>
                        )}
                      </td>
                      <td className="muted-cel">{c.por ? `${dm(c.por.data)}${c.por.pedido !== c.pedido ? ` · ${c.por.ordem || `Olist ${c.por.pedido}`}` : " · mesmo pedido"}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="empty">Nenhum pedido não pago {p.dias ? `nos ${p.rot.toLowerCase()}` : "nos pedidos importados"} ✓</div>
      )}
    </div>
  );
}
