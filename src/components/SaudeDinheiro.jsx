import { useMemo } from "react";
import { useLancamentosCaixa } from "../hooks/useLancamentosCaixa.js";
import { useReservaProducao } from "../hooks/useReservaProducao.js";
import { useCrescimento } from "../hooks/useCrescimento.js";
import { useCaixinhas, mesAntes, fimDoMes } from "../hooks/useCaixinhas.js";
import { resumoCaixa, saldoRealizado } from "../lib/fluxoCaixa.js";
import { cascataDoPeriodo, despesasFixasDoMes } from "../lib/resumoLoja.js";
import { saudeDoDinheiro } from "../lib/saudeDinheiro.js";
import { NOME_CAIXINHA } from "../lib/caixinhas.js";
import { hojeSP } from "../lib/datas.js";
import { BRL } from "../lib/format.js";
import { irParaAba } from "../lib/navegar.js";
import Estado from "./Estado.jsx";

// Dinheiro → Saúde do dinheiro (01/11/2026): indicadores (lib/saudeDinheiro.js).
// Só lê; cada indicador leva pra tela onde se resolve.
const IR = {
  atrasadas: ["caixa", { sub: "caixa" }],
  folego: ["caixa", { sub: "contas" }],
  livre: ["caixa", { sub: "caixa" }],
  giro: ["caixa", { sub: "caixa" }],
  reserva: ["caixa", { sub: "caixa" }],
  margem: ["resumoMes", null],
  equilibrio: ["resumoMes", null],
  ads: ["crescimento", { sub: "ads" }],
  prolabore: ["caixa", { sub: "caixa" }],
  reinvestimento: ["caixa", { sub: "caixa" }],
};
const ROTULO = { ok: "ok", atencao: "atenção", resolver: "resolver", info: "informação" };
const TIPO = { ok: "oportunidade", atencao: "atencao", resolver: "resolver", info: "info" };

export default function SaudeDinheiro() {
  const hoje = hojeSP();
  const { lancamentos } = useLancamentosCaixa();
  const reserva = useReservaProducao();
  const cres = useCrescimento();
  const semTransf = useMemo(() => (lancamentos || []).filter((l) => l.categoria !== "transferencia"), [lancamentos]);
  const caixa = useMemo(() => saldoRealizado(lancamentos || [], hoje), [lancamentos, hoje]);
  const cx = useCaixinhas({ registros: reserva.registros, lancamentos: lancamentos || [], caixa, hoje });
  const s = useMemo(() => {
    const rc = resumoCaixa(semTransf, { hoje });
    const atr = (rc.atrasados || []).filter((l) => l.tipo === "saida");
    const fim = mesAntes(hoje.slice(0, 7));
    const ini = mesAntes(hoje.slice(0, 7), 3);
    const r3 = cascataDoPeriodo({ pedidos: cres.pedidosValidos || [], linhasAds: cres.linhasAds, lancamentos: lancamentos || [], de: `${ini}-01`, ate: fimDoMes(fim) }).total;
    return saudeDoDinheiro({
      caixa,
      saldos: cx.saldos,
      totalCaixinhas: cx.total,
      fixasMes: despesasFixasDoMes(lancamentos || [], hoje.slice(0, 7)).total,
      r3,
      atrasadas: atr.reduce((t, l) => t + Number(l.valor || 0), 0),
      nAtrasadas: atr.length,
      alvoGiro: cx.sug.alvoGiro,
      reservaMeses: cx.divisao.reservaMeses,
    });
  }, [semTransf, hoje, cres.pedidosValidos, cres.linhasAds, lancamentos, caixa, cx.saldos, cx.total, cx.sug.alvoGiro, cx.divisao.reservaMeses]);

  return (
    <div className="saude-dinheiro">
      <div className={`panel saude-topo saude-${s.pior}`}>
        <Estado tipo={TIPO[s.pior]}>{s.frase}</Estado>
        <span className="hint">
          Caixa da loja {BRL(caixa)} · nas caixinhas {BRL(cx.total)}
          {Object.entries(cx.saldos)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => ` · ${NOME_CAIXINHA[k]} ${BRL(v)}`)
            .join("")}
        </span>
      </div>
      <div className="saude-grade">
        {s.indicadores.map((x) => (
          <button key={x.chave} type="button" className={`saude-card saude-${x.estado}`} onClick={() => IR[x.chave] && irParaAba(IR[x.chave][0], IR[x.chave][1])}>
            <span className="saude-titulo">
              {x.titulo} <span className={`st st-${TIPO[x.estado]}`}>{ROTULO[x.estado]}</span>
            </span>
            <span className="saude-valor">{x.valor}</span>
            <span className="saude-frase">{x.frase}</span>
          </button>
        ))}
      </div>
      <p className="hint">Resultado e Ads pelos 3 últimos meses fechados (os pedidos importados); caixa e caixinhas de hoje. Só informa — clique num indicador pra abrir onde se resolve.</p>
    </div>
  );
}
