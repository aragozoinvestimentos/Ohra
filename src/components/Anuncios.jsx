import { useMemo, useState } from "react";
import { useEscada } from "../hooks/useEscada.js";
import { useCrescimento } from "../hooks/useCrescimento.js";
import { useLembrado } from "../hooks/useLembrado.js";
import { abrirAnuncio, montarAnuncios } from "../lib/anuncios.js";
import { irParaAba } from "../lib/navegar.js";
import { normalizarTexto } from "../lib/texto.js";
import { hojeSP } from "../lib/datas.js";
import { BRL, PCT } from "../lib/format.js";
import { ROTULO_ESTADO } from "../lib/estados.js";
import CanalTag from "./CanalTag.jsx";
import Estado, { PontoSaude } from "./Estado.jsx";
import Kpis from "./Kpis.jsx";
import Ajuda from "./Ajuda.jsx";

// Anúncios (remap 21/10/2026): cada produto/kit/anúncio com vários itens em
// cada canal onde tem preço salvo. Clicar abre o Painel do anúncio. Só lê —
// as contas são as de sempre (lib/anuncios.js junta).
const FILTROS = [
  { k: "todos", rot: "Todos" },
  { k: "fazer", rot: "Pra fazer" },
  { k: "oportunidade", rot: "Oportunidade" },
  { k: "rampa", rot: "Em rampa" },
  { k: "ads", rot: "Com Ads" },
  { k: "semvenda", rot: "Sem venda em 30 dias" },
];
const um = (v) => (v == null || !isFinite(v) ? "—" : String(Math.round(v * 10) / 10).replace(".", ","));

export default function Anuncios() {
  const esc = useEscada();
  const cres = useCrescimento();
  const hoje = hojeSP();
  const [canalF, setCanalF] = useLembrado("ohra:anuncios:canal", "");
  const [filtro, setFiltro] = useLembrado("ohra:anuncios:filtro", "todos");
  const [busca, setBusca] = useState("");

  const linhas = useMemo(() => montarAnuncios({ esc, cres, pedidos: cres.pedidosValidos, hoje }), [esc, cres, hoje]);
  const canaisCom = useMemo(() => esc.canais.filter((c) => linhas.some((l) => l.canal.id === c.id)), [esc.canais, linhas]);
  const doCanal = linhas.filter((l) => !canalF || l.canal.id === canalF);
  const passa = (l) => {
    if (filtro === "fazer") return l.estado && (l.estado.tipo === "resolver" || l.estado.tipo === "atencao");
    if (filtro === "oportunidade") return l.estado?.tipo === "oportunidade";
    if (filtro === "rampa") return l.emRampa || !!l.rampa;
    if (filtro === "ads") return !!l.ads?.av?.ativo;
    if (filtro === "semvenda") return !l.vendas.unidades;
    return true;
  };
  const q = normalizarTexto(busca);
  const PESO = { resolver: 0, atencao: 1, oportunidade: 2, decisao: 3 };
  const vis = doCanal
    .filter(passa)
    .filter((l) => !q || normalizarTexto(`${l.nome} ${l.sku}`).includes(q))
    .sort((a, b) => (PESO[a.estado?.tipo] ?? 9) - (PESO[b.estado?.tipo] ?? 9) || b.vendas.lucro - a.vendas.lucro || a.nome.localeCompare(b.nome));
  const fazer = doCanal.filter((l) => l.estado && (l.estado.tipo === "resolver" || l.estado.tipo === "atencao")).length;
  const oport = doCanal.filter((l) => l.estado?.tipo === "oportunidade").length;
  const un30 = doCanal.reduce((t, l) => t + l.vendas.unidades, 0);
  const lu30 = doCanal.reduce((t, l) => t + l.vendas.lucro, 0);

  return (
    <div>
      <Kpis
        itens={[
          { label: "Anúncios", valor: doCanal.length, sub: canalF ? esc.canais.find((c) => c.id === canalF)?.nome : `${canaisCom.length} canais` },
          { label: "Pra fazer agora", valor: fazer, tom: fazer ? "warn" : undefined, sub: "preço, rampa ou Ads pedindo ação" },
          { label: "Oportunidades", valor: oport, tom: oport ? "good" : undefined, sub: "subir degrau, aumentar Ads…" },
          { label: "Vendas 30 dias", valor: `${un30} un.`, sub: "pedidos importados" },
          { label: "Lucro 30 dias", valor: BRL(lu30), sub: "antes do Ads · custo e taxas de hoje" },
        ]}
      />
      <div className="toolbar">
        <input type="search" placeholder="Buscar produto ou SKU" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <div className="subabas">
          <button type="button" className={`btn${!canalF ? " primary" : ""}`} onClick={() => setCanalF("")}>Todos os canais</button>
          {canaisCom.map((c) => (
            <button key={c.id} type="button" className={`btn${canalF === c.id ? " primary" : ""}`} onClick={() => setCanalF(c.id)}>
              {c.nome}
            </button>
          ))}
        </div>
        <div className="subabas">
          {FILTROS.map((f) => (
            <button key={f.k} type="button" className={`btn${filtro === f.k ? " primary" : ""}`} onClick={() => setFiltro(f.k)}>
              {f.rot}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-mini primary" style={{ marginLeft: "auto" }} onClick={() => irParaAba("avulso")} title="O passo a passo de sempre: 1º Avulso → 2º Por quantidade → 3º Ficha → 4º Lançamento → 5º Anunciar">
          + Lançar em um canal
        </button>
      </div>
      <div className="panel">
        <h3 className="section-title">
          <span>
            Anúncios ({vis.length})
            <Ajuda texto="Cada linha é um produto (com as variações dele), kit ou anúncio com vários itens num canal onde tem preço salvo. Clique pra abrir o Painel do anúncio: resumo, vendas, preço, rampa, Ads, o que digitar e custo — tudo daquele produto naquele canal. Vendas e lucro = pedidos importados dos últimos 30 dias, com custo e taxas de hoje (antes do Ads)." />
          </span>
        </h3>
        {!vis.length ? (
          <div className="empty">{linhas.length ? "Nada com esse filtro." : "Nenhum produto com preço salvo ainda — comece em + Lançar em um canal."}</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Anúncio</th>
                  <th className="num">Preço agora</th>
                  <th className="num">Lucro/venda</th>
                  <th className="num">Vendas 30 dias</th>
                  <th>Rampa</th>
                  <th className="num">Ads</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {vis.map((l) => {
                  const av = l.ads?.av;
                  const ret = l.adsNum?.retorno ?? null;
                  const est = l.rampa?.est;
                  return (
                    <tr key={l.chave} className="linha-clicavel" onClick={() => abrirAnuncio(l.itemId, l.canal.id)}>
                      <td className="td-com-saude">
                        <PontoSaude estado={l.estado && l.estado.tipo !== "oportunidade" ? l.estado : null} />
                        <b>{l.nome}</b> <CanalTag canal={l.canal} />
                        <div className="sub-num">
                          {[l.sku, l.tipo === "kit" ? "kit" : null, l.tipo === "grupo" ? `${l.opcoes} opções · vários itens` : null, l.variacoes?.length ? `+ ${l.variacoes.map((v) => v.nomeVariacao || v.nome).join(", ")}` : null, l.soNoGrupo ? "só no anúncio com vários itens" : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </td>
                      <td className="num">
                        {l.agora ? BRL(l.agora.preco) : "—"}
                        {l.emRampa && l.alvo && <div className="sub-num">alvo {BRL(l.alvo.preco)}</div>}
                        {l.tipo === "grupo" && l.agora && <div className="sub-num">ticket médio</div>}
                      </td>
                      <td className={`num${l.agora && l.agora.lucro < 0 ? " neg" : ""}`}>
                        {l.agora ? BRL(l.agora.lucro) : "—"}
                        {l.agora?.margem != null && <div className="sub-num">{PCT(l.agora.margem)}</div>}
                      </td>
                      <td className="num">
                        {l.vendas.unidades ? (
                          <>
                            {l.vendas.unidades} un.
                            <div className="sub-num">lucro {BRL(l.vendas.lucro)}</div>
                          </>
                        ) : (
                          <span className="muted-cel">0</span>
                        )}
                        {l.vendasItem?.via?.length > 0 && <div className="sub-num" title="Vendas deste item por um anúncio com vários itens — contam lá, não neste anúncio">+ {l.vendasItem.via.reduce((t, g) => t + g.unidades, 0)} via {l.vendasItem.via.map((g) => g.nome).join(", ")}</div>}
                      </td>
                      <td>{est ? <Estado tipo="decisao" icone={null}>{est.noAlvo ? "no alvo" : `degrau ${est.i + 1} de ${est.degraus?.length || "?"}`}</Estado> : <span className="muted-cel">—</span>}</td>
                      <td className="num">
                        {av?.ativo ? (
                          <>
                            ROAS {um(l.adsNum?.roas)}
                            <div className="sub-num">{ret != null ? `retorno ${um(ret)}×` : "aprendendo"}</div>
                          </>
                        ) : (
                          <span className="muted-cel">{l.ads ? "sem Ads" : "—"}</span>
                        )}
                      </td>
                      <td>{l.estado ? <Estado tipo={l.estado.tipo} title={l.estado.motivo}>{curto(l.estado)}</Estado> : <span className="muted-cel">✓ ok</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const curto = (e) => {
  const m = String(e.motivo || ROTULO_ESTADO[e.tipo]).split(" · ")[0];
  return m.length > 46 ? `${m.slice(0, 44)}…` : m;
};
