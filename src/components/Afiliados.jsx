import { rotuloEstrategia } from "../lib/estrategia.js";
import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { BRL, PCT } from "../lib/format.js";
import { normalizarTexto } from "../lib/texto.js";
import { gruposDoSeletor, itemTipoDoId } from "../lib/variacoes.js";
import {
  DIAS_SEM_DIVULGAR,
  STATUS_PARCEIRO,
  comissaoMaxima,
  custoAmostra,
  idPrefixado,
  padraoDoCanal,
  resumoParceiro,
  statusEfetivo,
  sugestoesAfiliado,
  vendasPorOrigem,
} from "../lib/afiliados.js";
import Kpis from "./Kpis.jsx";
import Ajuda from "./Ajuda.jsx";
import CanalTag from "./CanalTag.jsx";
import TopbarAcoes from "./TopbarAcoes.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import EditarDialog from "./EditarDialog.jsx";
import BuscaItem from "./BuscaItem.jsx";

const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const pct = (f) => `${Math.round(num(f) * 100)}%`;
const dataBR = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
const TIPO_ROTULO = { produto: "produto", variacao: "variação", kit: "kit" };
const msgV35 = (e) => (/afiliado|schema cache|does not exist/.test(e?.message || "") ? "Falta rodar o supabase/schema_v35.sql no Supabase" : `Não foi possível salvar: ${e?.message}`);

export default function Afiliados({ dados, af, rampasH, regras, linhasAf, mapaAf, semana, hoje, podeRegistrar, onRegistrar, onToast }) {
  const { lojaId } = useLoja();
  const { itens, canais } = dados;
  const { config, parceiros, registros, disponivel, carregando } = af;
  const [filtro, setFiltro] = useState("relevantes");
  const [busca, setBusca] = useState("");
  const [editItem, setEditItem] = useState(null); // linha de comissão
  const [parceiroForm, setParceiroForm] = useState(null); // { parceiro } | { inicial }
  const [excluir, setExcluir] = useState(null);
  const [salvando, setSalvando] = useState(false);

  const sugestoes = useMemo(
    () => sugestoesAfiliado({ linhas: linhasAf, parceiros, afRegistros: registros, regras, itens, hoje }),
    [linhasAf, parceiros, registros, regras, itens, hoje]
  );
  const origem = useMemo(
    () => vendasPorOrigem({ afRegistros: registros, rampaRegistros: rampasH.registros, rampas: rampasH.rampas, hoje }),
    [registros, rampasH.registros, rampasH.rampas, hoje]
  );

  const ativos = linhasAf.filter((l) => l.conf.ativo);
  const termos = normalizarTexto(busca).split(" ").filter(Boolean);
  const tabela = linhasAf.filter((l) => {
    if (filtro === "ativos" && !l.conf.ativo) return false;
    if (filtro === "relevantes" && (l.situacao === "sem" || l.situacao === "apertado")) return false;
    if (termos.length) {
      const t = normalizarTexto(`${l.item.nome} ${l.item.sku || ""} ${l.canal.nome}`);
      if (!termos.every((x) => t.includes(x))) return false;
    }
    return true;
  });

  // --- gravações ---
  async function salvarItem(l, { ativo, comissao }, msg) {
    const row = l.conf.row;
    const campos = { ativo, comissao: comissao == null ? null : comissao, atualizado_em: new Date().toISOString() };
    const { error } = row
      ? await supabase.from("afiliado_config").update(campos).eq("id", row.id)
      : await supabase.from("afiliado_config").insert({ ...campos, loja_id: lojaId || null, canal_id: l.canal.id, item_tipo: l.tipo, item_id: l.id });
    if (error) {
      onToast?.(msgV35(error));
      return false;
    }
    if (msg) onToast?.(msg);
    return true;
  }

  async function salvarPadrao(canal, { ativo, comissao }) {
    const { row } = padraoDoCanal(config, canal.id);
    const campos = { ativo, comissao, atualizado_em: new Date().toISOString() };
    const { error } = row
      ? await supabase.from("afiliado_config").update(campos).eq("id", row.id)
      : await supabase.from("afiliado_config").insert({ ...campos, loja_id: lojaId || null, canal_id: canal.id, item_tipo: null, item_id: null });
    if (error) return onToast?.(msgV35(error));
    onToast?.(ativo ? `${canal.nome}: campanha aberta com ${pct(comissao)}` : `${canal.nome}: campanha aberta desligada`);
  }

  async function mudarStatus(p, status) {
    const campos = { status, status_desde: hoje };
    if (status === "amostra" && !p.amostra_data) campos.amostra_data = hoje;
    const { error } = await supabase.from("afiliados").update(campos).eq("id", p.id);
    if (error) return onToast?.(msgV35(error));
    onToast?.(`${p.nome}: ${STATUS_PARCEIRO.find((s) => s.chave === status)?.rotulo}`);
  }

  async function excluirParceiro() {
    const p = excluir;
    setExcluir(null);
    const { error } = await supabase.from("afiliados").delete().eq("id", p.id);
    if (error) return onToast?.(`Não foi possível excluir: ${error.message}`);
    onToast?.(`${p.nome} excluído (as vendas registradas ficam, sem parceiro)`);
  }

  async function acaoSugestao(a) {
    if (a.tipo === "usar") return salvarItem(a.linha, { ativo: true, comissao: a.comissao }, `${a.linha.item.nome}: comissão ${pct(a.comissao)} neste item`);
    if (a.tipo === "desativar") return salvarItem(a.linha, { ativo: false, comissao: a.linha.conf.row?.comissao ?? null }, `${a.linha.item.nome} saiu da campanha`);
    if (a.tipo === "ativar") return salvarItem(a.linha, { ativo: true, comissao: null }, `${a.linha.item.nome} na campanha com ${pct(a.linha.conf.padrao)} — ative também no painel de afiliados do canal`);
    if (a.tipo === "divulgou") return mudarStatus(a.parceiro, "divulgou");
    if (a.tipo === "amostra")
      return setParceiroForm({
        inicial: { canal_id: a.linha.canal.id, amostra_item: idPrefixado(a.linha.tipo, a.linha.id), comissao: a.linha.conf.comissao ?? a.linha.conf.padrao ?? null },
      });
  }

  if (!supabase)
    return (
      <div className="panel">
        <div className="empty">Configure o Supabase pra usar Afiliados.</div>
      </div>
    );
  if (!disponivel)
    return (
      <div className="panel">
        <h3>Afiliados</h3>
        <div className="empty">
          Falta criar as tabelas de afiliados no banco — rode o <strong>supabase/schema_v35.sql</strong> no SQL Editor do Supabase e recarregue a página.
        </div>
      </div>
    );

  const canaisPadrao = canais.map((c) => ({ canal: c, ...padraoDoCanal(config, c.id) }));
  const comPadrao = canaisPadrao.filter((c) => c.comissao);
  const excecoes = ativos.filter((l) => l.conf.fonte === "propria");
  const s = semana;
  const pctAds = s.adsReceita > 0 ? s.adsGasto / s.adsReceita : null;

  // custo por venda (últimas semanas do gráfico)
  const tot = origem.reduce((a, w) => ({ af: a.af + w.afiliado, com: a.com + w.comissao, ads: a.ads + w.ads, gasto: a.gasto + w.adsGasto }), { af: 0, com: 0, ads: 0, gasto: 0 });

  return (
    <div className="af-pagina">
      <TopbarAcoes aba="crescimento">
        <button type="button" className="btn" onClick={() => setParceiroForm({ inicial: {} })}>
          + Parceiro
        </button>
        <button type="button" className="btn primary" onClick={onRegistrar} disabled={!podeRegistrar}>
          Registrar semana
        </button>
      </TopbarAcoes>

      <Kpis
        itens={[
          {
            label: "Itens com afiliado",
            valor: String(ativos.length),
            sub: comPadrao.length ? comPadrao.map((c) => `${c.canal.nome} · campanha aberta ${pct(c.comissao)}`).join(" · ") : "nenhuma campanha aberta configurada",
          },
          {
            label: "Vendas via afiliado",
            valor: s.temRegistro ? String(s.vendasAf) : "—",
            sub: s.temRegistro ? (s.total > 0 ? `${PCT(s.vendasAf / s.total)} das vendas da semana (${s.total})` : "na semana") : "registre a semana pra ver",
          },
          {
            label: "Comissão paga",
            valor: s.temRegistro ? BRL(s.comissao) : "—",
            sub: s.temRegistro
              ? `${s.receitaAf > 0 ? `${PCT(s.comissao / s.receitaAf)} da receita via afiliado` : "—"}${pctAds != null ? ` · Ads: ${PCT(pctAds)}` : ""}`
              : "na semana",
          },
          {
            label: "Lucro após comissão",
            valor: s.temRegistro ? BRL(s.lucroAf) : "—",
            sub: s.temRegistro ? `das ${s.vendasAf} vendas via afiliado` : "—",
            tom: s.temRegistro && s.lucroAf < 0 ? "bad" : undefined,
          },
        ]}
      />

      <div className="panel">
        <h3 className="section-title">
          <span>
            Comissão por item
            <Ajuda texto="Sua margem vem primeiro: afiliado só entra com o que sobra. Recomendada = o menor entre (1) o % que ainda deixa a sua margem desejada inteira, (2) metade do lucro ÷ preço — parte das vendas via afiliado o cliente faria de qualquer jeito, e nelas a comissão só tira do lucro — e (3) a máxima. Máxima = maior % que ainda deixa o lucro mínimo da loja (margem mínima ou lucro mínimo em R$); acima dela é prejuízo pro seu mínimo. Sem recomendada = não há espaço acima da sua margem neste preço: não precisa ativar. Tudo com o custo e as taxas de hoje; a comissão é sobre o preço e sai do seu lucro. Produto em rampa abaixo do alvo usa o preço do degrau e fica como “não usar ainda”: com lucro perto do 0 a 0 não sobra pra comissão. Clique na comissão atual pra ativar, desativar ou dar um % próprio ao item." />
          </span>
          <span className="h3-contagem">quanto dá pra pagar sem passar do lucro mínimo</span>
        </h3>
        <div className="toolbar">
          <input type="text" placeholder="Buscar item ou canal…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <div className="subabas subabas-compacta">
            {[
              ["relevantes", "Com margem"],
              ["ativos", "Com afiliado"],
              ["todos", "Todos"],
            ].map(([k, label]) => (
              <button key={k} type="button" className={`btn${filtro === k ? " primary" : ""}`} onClick={() => setFiltro(k)}>
                {label}
              </button>
            ))}
          </div>
          <span className="toolbar-info">
            {tabela.length} de {linhasAf.length}
          </span>
        </div>
        {carregando ? (
          <div className="empty">Carregando…</div>
        ) : !linhasAf.length ? (
          <div className="empty">Nenhum item com preço salvo ainda. Salve preços em Precificação por Canal.</div>
        ) : !tabela.length ? (
          <div className="empty">Nada neste filtro.</div>
        ) : (
          <div className="table-wrap lista-rampa lista-afiliado">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Canal</th>
                  <th className="num">Preço</th>
                  <th className="num">Lucro</th>
                  <th className="num">Recomendada</th>
                  <th className="centro">Comissão atual</th>
                  <th className="num">Lucro com afiliado</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {tabela.map((l) => (
                  <tr key={l.chave} className={l.situacao === "acima" ? "linha-ruim" : ""}>
                    <td>
                      <b>{l.item.nome}</b>
                      <div className="sub-linha">
                        {TIPO_ROTULO[l.tipo]}
                        {l.tipo === "kit" && l.item.pecas ? ` · ${l.item.pecas} peças` : ""}
                        {l.rampa ? (l.emRampa ? ` · em rampa (vendendo ${BRL(l.preco)})` : " · no alvo") : ""}
                        {!l.emRampa && rotuloEstrategia(l.estrategia) ? ` · ${rotuloEstrategia(l.estrategia)}` : ""}
                      </div>
                    </td>
                    <td>
                      <CanalTag canal={l.canal} />
                    </td>
                    <td className="num">{BRL(l.preco)}</td>
                    <td className="num">{BRL(l.lucro)}</td>
                    <td className="num">
                      {l.naoUsar ? (
                        "—"
                      ) : l.recomendada != null ? (
                        <>
                          <b>{pct(l.recomendada)}</b>
                          <div className="sub-num" title="Afiliado ganha por venda · máxima = o que ainda deixa o lucro mínimo">
                            {BRL(l.recomendada * l.preco)}/venda · máx. {pct(l.max)}
                          </div>
                        </>
                      ) : l.max >= 0.01 ? (
                        <>
                          <span className="muted-cel">—</span>
                          <div className="sub-num">máx. {pct(l.max)}</div>
                        </>
                      ) : (
                        <span className="neg">sem folga</span>
                      )}
                    </td>
                    <td className="centro">
                      {l.conf.ativo ? (
                        <button type="button" className="badge acc comissao-chip" onClick={() => setEditItem(l)} title="Mudar o %, dar um % próprio ou desativar">
                          {pct(l.conf.comissao)} · {l.conf.fonte === "propria" ? "do item" : "padrão"} <span aria-hidden="true">✎</span>
                        </button>
                      ) : l.naoUsar ? (
                        <span className="muted-cel" title="Em rampa abaixo do alvo: o lucro perto do 0 a 0 não deixa espaço pra comissão">
                          —
                        </span>
                      ) : (
                        <button type="button" className="btn btn-mini" onClick={() => setEditItem(l)} title="Ativar a comissão neste item">
                          + Ativar
                        </button>
                      )}
                    </td>
                    <td className={`num${l.lucroCom != null && l.lucroCom < l.lucroMin - 0.004 ? " neg" : ""}`}>{l.lucroCom != null ? BRL(l.lucroCom) : "—"}</td>
                    <td>
                      <Situacao
                        l={l}
                        onUsar={(c) => salvarItem(l, { ativo: true, comissao: c }, `${l.item.nome}: comissão ${pct(c)} neste item`)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h3 className="section-title">
          <span>
            Configuração da comissão
            <Ajuda texto="Campanha aberta = a comissão que qualquer afiliado do canal recebe pelos itens que você ativar. Item com % próprio (exceção) usa o dele no lugar do padrão. Configure o mesmo % no painel de afiliados do canal — aqui é só o acompanhamento." />
          </span>
        </h3>
        <div className="cfg-afiliado">
          {canaisPadrao.map((c) => (
            <PadraoCanal key={`${c.canal.id}-${c.row?.atualizado_em || ""}`} item={c} onSalvar={(v) => salvarPadrao(c.canal, v)} />
          ))}
        </div>
        <div className="sub-linha" style={{ marginTop: 8 }}>
          Exceções por item: <b>{excecoes.length}</b>
          {excecoes.length ? ` — ${excecoes.map((l) => `${l.item.nome} (${l.canal.nome}): ${pct(l.conf.comissao)}`).join(" · ")}` : " — nenhuma"}
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>
          Dica: o marketplace desconta a comissão do repasse — não lance no Fluxo de Caixa, o repasse já chega líquido.
        </p>
      </div>

      <div className="panel">
        <h3 className="section-title">
          <span>
            Parceiros
            <Ajuda texto={`Campanhas exclusivas e amostras. Status: convidado → amostra enviada → divulgou → ativo → parado. Amostra enviada há mais de ${DIAS_SEM_DIVULGAR} dias sem post aparece como parado. Custo da amostra = custo de produção + embalagem das peças (ao vivo) + o frete que você informar. Retorno = lucro gerado pelas vendas dele (já sem comissão) ÷ custo da amostra.`} />
          </span>
          <button type="button" className="btn btn-mini" onClick={() => setParceiroForm({ inicial: {} })}>
            + Parceiro
          </button>
        </h3>
        {!parceiros.length ? (
          <div className="empty">Nenhum parceiro ainda. Quando tiver um item com boas avaliações, a sugestão “mandar amostra” aparece aqui embaixo.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Parceiro</th>
                  <th>Status</th>
                  <th>Amostra</th>
                  <th className="num">Custo amostra</th>
                  <th className="num">Comissão</th>
                  <th className="num">Vendas</th>
                  <th className="num">Comissão paga</th>
                  <th className="num">Retorno da amostra</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {parceiros.map((p) => {
                  const r = resumoParceiro(p, { registros, mapaLinhas: mapaAf, itens });
                  const st = statusEfetivo(p, hoje, registros);
                  const canal = canais.find((c) => c.id === p.canal_id);
                  const amostraItem = r.amostra?.item;
                  // comissão do parceiro acima da máxima do item da amostra?
                  const linhaAm = p.amostra_item_id && canal ? mapaAf.get(`${p.amostra_item_tipo}|${p.amostra_item_id}|${canal.id}`) : null;
                  const acima = linhaAm && !linhaAm.emRampa && p.comissao != null && num(p.comissao) > linhaAm.max + 1e-9;
                  return (
                    <tr key={p.id}>
                      <td>
                        <b>{p.nome}</b>
                        <div className="sub-linha">
                          {[p.nicho, p.rede].filter(Boolean).join(" · ")}
                          {canal && (
                            <>
                              {p.nicho || p.rede ? " · " : ""}
                              <CanalTag canal={canal} />
                            </>
                          )}
                        </div>
                      </td>
                      <td>
                        <select className="select-status" value={p.status} onChange={(e) => mudarStatus(p, e.target.value)}>
                          {STATUS_PARCEIRO.map((s) => (
                            <option key={s.chave} value={s.chave}>
                              {s.rotulo}
                            </option>
                          ))}
                        </select>
                        {st.auto && <div className="sub-num neg">parado · {st.dias} dias sem divulgar</div>}
                        {st.vendeu > 0 && <div className="sub-num pos">já vendeu {st.vendeu} — marque “divulgou”</div>}
                      </td>
                      <td>
                        {amostraItem ? (
                          <>
                            {amostraItem.nome}
                            {num(p.amostra_qtd) > 1 ? ` × ${p.amostra_qtd}` : ""}
                            <div className="sub-linha">
                              {p.amostra_data ? `enviada ${dataBR(p.amostra_data)}` : "a enviar"}
                              {p.status === "amostra" && st.dias != null && !st.auto ? ` · ${st.dias} dia${st.dias === 1 ? "" : "s"}` : ""}
                            </div>
                          </>
                        ) : (
                          <span className="muted-cel">—</span>
                        )}
                      </td>
                      <td className="num">
                        {r.amostra ? (
                          <>
                            {BRL(r.amostra.total)}
                            <div className="sub-num">
                              peças {BRL(r.amostra.pecas)}
                              {r.amostra.frete ? ` + frete ${BRL(r.amostra.frete)}` : ""}
                            </div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={`num${acima ? " neg" : ""}`}>
                        {p.comissao != null ? pct(p.comissao) : "—"}
                        {acima && <div className="sub-num">máx. {pct(linhaAm.max)}</div>}
                      </td>
                      <td className="num">{r.vendas || (p.status === "convidado" ? "—" : 0)}</td>
                      <td className="num">{r.comissao ? BRL(r.comissao) : "—"}</td>
                      <td className="num">
                        {r.retorno != null ? (
                          <>
                            <b className={r.retorno >= 1 ? "pos" : "neg"}>{r.retorno.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}×</b>
                            <div className="sub-num">lucro {BRL(r.lucro)}</div>
                          </>
                        ) : r.vendas ? (
                          <span className="sub-num">lucro {BRL(r.lucro)}</span>
                        ) : p.status === "amostra" || p.status === "divulgou" ? (
                          <span className="muted-cel">aguardando vendas</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="num">
                        <div className="acoes-linha">
                          <button type="button" className="link-btn" onClick={() => setParceiroForm({ parceiro: p })} title="Editar">
                            ✎
                          </button>
                          <button type="button" className="link-btn" onClick={() => setExcluir(p)} title="Excluir">
                            ×
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h3 className="section-title">
          <span>Vendas por origem</span>
          <span className="h3-contagem">todas as rampas e itens com afiliado, por semana</span>
        </h3>
        <GraficoOrigem semanas={origem} />
        <div className="cmp-custo">
          <div>
            <small>Custo por venda via afiliado</small>
            <b>{tot.af ? BRL(tot.com / tot.af) : "—"}</b>
            <span className="muted-cel"> · só paga se vender</span>
          </div>
          <div>
            <small>Custo por venda via Ads</small>
            <b>{tot.ads ? BRL(tot.gasto / tot.ads) : "—"}</b>
            <span className="muted-cel"> · paga pelo clique</span>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3 className="section-title">
          <span>Sugestões</span>
          <span className="h3-contagem">{sugestoes.length || "nenhuma agora"}</span>
        </h3>
        {!sugestoes.length ? (
          <div className="empty">Tudo em ordem. Configure a campanha aberta acima pra começar a ver o que dá pra ativar.</div>
        ) : (
          <ul className="sug-af">
            {sugestoes.map((sg) => (
              <li key={sg.chave}>
                <span className={`sug-af-ic ${sg.tom}`}>{sg.icone}</span>
                <div>
                  <b>{sg.titulo}</b>
                  <div className="sub-linha">{sg.texto}</div>
                </div>
                {sg.acao && (
                  <button type="button" className="btn btn-mini" onClick={() => acaoSugestao(sg.acao)}>
                    {sg.acao.rotulo}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {editItem && (
        <ItemComissaoDialog
          l={editItem}
          salvando={salvando}
          onCancelar={() => setEditItem(null)}
          onSalvar={async (v) => {
            setSalvando(true);
            const ok = await salvarItem(editItem, v, v.ativo ? `${editItem.item.nome}: ${v.comissao != null ? pct(v.comissao) : `padrão (${pct(editItem.conf.padrao)})`} em ${editItem.canal.nome}` : `${editItem.item.nome} saiu da campanha`);
            setSalvando(false);
            if (ok) setEditItem(null);
          }}
        />
      )}
      {parceiroForm && (
        <ParceiroDialog
          parceiro={parceiroForm.parceiro || null}
          inicial={parceiroForm.inicial || {}}
          itens={itens}
          canais={canais}
          mapaAf={mapaAf}
          hoje={hoje}
          lojaId={lojaId}
          onToast={onToast}
          onClose={() => setParceiroForm(null)}
        />
      )}
      {excluir && (
        <ConfirmDialog
          titulo="Excluir parceiro"
          mensagem={`Excluir ${excluir.nome}? As vendas já registradas continuam, só sem o parceiro.`}
          confirmarLabel="Excluir"
          perigo
          onConfirm={excluirParceiro}
          onCancel={() => setExcluir(null)}
        />
      )}
    </div>
  );
}

function Situacao({ l, onUsar }) {
  // % pra onde levar a comissão quando ela está alta demais.
  const alvo = l.recomendada ?? (l.situacao === "acima" && l.max >= 0.01 ? l.max : null);
  if (l.situacao === "acima" || l.situacao === "alta")
    return (
      <div className="sit-af">
        <span className={`badge ${l.situacao === "acima" ? "bad" : "warn"}`}>{l.situacao === "acima" ? "acima da máxima" : "come sua margem"}</span>
        {alvo ? (
          <button type="button" className="link-btn" onClick={() => onUsar(alvo)}>
            usar {pct(alvo)} só neste item
          </button>
        ) : (
          <span className="sub-num">tire da campanha</span>
        )}
      </div>
    );
  if (l.situacao === "rampa")
    return (
      <span className="badge neutro" title="Estratégia do preço em crescimento (escolhida, rampa ou peça em rampa): lucro baixo de propósito, sem espaço pra comissão">
        {l.emRampa || l.estrategia?.origem === "rampa" ? "em rampa" : l.estrategia?.origem === "kit-em-rampa" ? "peça em rampa" : "em crescimento"}: não usar ainda
      </span>
    );
  if (l.situacao === "atracao")
    return (
      <span className="badge neutro" title="Avulso marcado como atração: o lucro vem do kit. Dá pra ativar, mas o app não sugere">
        atração: só se quiser
      </span>
    );
  if (l.situacao === "ok") return <span className="badge good">✓ ok</span>;
  if (l.situacao === "pode") return <span className="badge acc">pode ativar até {pct(l.recomendada)}</span>;
  if (l.situacao === "apertado")
    return (
      <span className="badge neutro" title="Há folga até o lucro mínimo, mas nada acima da sua margem desejada — afiliado só se houver espaço">
        sem espaço acima da sua margem
      </span>
    );
  return <span className="badge neutro">sem folga pra comissão</span>;
}

function PadraoCanal({ item, onSalvar }) {
  const { canal, row } = item;
  const [ativo, setAtivo] = useState(!!row?.ativo);
  const [valor, setValor] = useState(row?.comissao != null ? String(Math.round(num(row.comissao) * 1000) / 10).replace(".", ",") : "");
  const mudou = ativo !== !!row?.ativo || (ativo && Math.abs(num(valor) / 100 - num(row?.comissao)) > 1e-6);
  return (
    <div className="cfg-af-linha">
      <CanalTag canal={canal} />
      <label className="check-inline">
        <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> campanha aberta
      </label>
      {ativo ? (
        <span className="cfg-af-pct">
          <input type="text" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="12" /> %
        </span>
      ) : (
        <span className="muted-cel">sem afiliado</span>
      )}
      {mudou && (
        <button
          type="button"
          className="btn btn-mini primary"
          onClick={() => {
            if (ativo && !(num(valor) > 0 && num(valor) < 100)) return;
            onSalvar({ ativo, comissao: ativo ? num(valor) / 100 : row?.comissao ?? null });
          }}
          disabled={ativo && !(num(valor) > 0 && num(valor) < 100)}
        >
          Salvar
        </button>
      )}
      {ativo && !mudou && <span className="muted-cel">vale pra todos os itens ativados</span>}
    </div>
  );
}

function ItemComissaoDialog({ l, salvando, onCancelar, onSalvar }) {
  const [ativo, setAtivo] = useState(l.conf.ativo || !l.conf.row);
  const propria = l.conf.row?.comissao;
  const [valor, setValor] = useState(propria != null ? String(Math.round(num(propria) * 1000) / 10).replace(".", ",") : "");
  const c = valor !== "" ? num(valor) / 100 : l.conf.padrao;
  const lucroCom = c != null && l.lucro != null ? l.lucro - c * l.preco : null;
  const invalido = ativo && (valor !== "" ? !(num(valor) > 0 && num(valor) < 100) : !l.conf.padrao);
  return (
    <EditarDialog
      titulo={`Comissão — ${l.item.nome}`}
      salvando={salvando}
      onCancelar={onCancelar}
      salvarLabel="Salvar"
      classe="modal-box-md"
      onSalvar={() => !invalido && onSalvar({ ativo, comissao: valor === "" ? null : num(valor) / 100 })}
    >
      <p className="hint" style={{ marginTop: 0 }}>
        <CanalTag canal={l.canal} /> · vendendo {BRL(l.preco)} · lucro {BRL(l.lucro)} · mínimo {BRL(l.lucroMin)} · recomendada <b>{l.recomendada != null ? pct(l.recomendada) : "—"}</b> · máxima <b>{l.max >= 0.01 ? pct(l.max) : "sem folga"}</b>
        {l.emRampa ? " · em rampa abaixo do alvo (o ideal é esperar chegar no alvo)" : ""}
      </p>
      <label className="check-inline">
        <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Item na campanha de afiliados
      </label>
      {ativo && (
        <div className="field" style={{ maxWidth: 260, marginTop: 10 }}>
          <label>Comissão própria (%)</label>
          <input type="text" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder={l.conf.padrao ? `padrão ${Math.round(l.conf.padrao * 100)}` : "sem padrão no canal"} />
        </div>
      )}
      {ativo && !l.conf.padrao && valor === "" && <p className="hint neg">Este canal não tem campanha aberta — informe um % próprio ou configure a campanha aberta.</p>}
      {ativo && lucroCom != null && (
        <p className={`hint${lucroCom < l.lucroMin - 0.004 ? " neg" : ""}`}>
          Com {pct(c)}: lucro {BRL(lucroCom)} por venda via afiliado{lucroCom < l.lucroMin - 0.004 ? " — abaixo do mínimo da loja" : ""}.
        </p>
      )}
    </EditarDialog>
  );
}

function ParceiroDialog({ parceiro, inicial, itens, canais, mapaAf, hoje, lojaId, onToast, onClose }) {
  const base = parceiro || {};
  const [f, setF] = useState(() => ({
    nome: base.nome || "",
    rede: base.rede || "",
    nicho: base.nicho || "",
    canal_id: base.canal_id || inicial.canal_id || canais[0]?.id || "",
    comissao: base.comissao != null ? String(Math.round(num(base.comissao) * 1000) / 10).replace(".", ",") : inicial.comissao != null ? String(Math.round(inicial.comissao * 100)) : "",
    status: base.status || (inicial.amostra_item ? "amostra" : "convidado"),
    amostra_item: base.amostra_item_id ? idPrefixado(base.amostra_item_tipo, base.amostra_item_id) : inicial.amostra_item || "",
    amostra_qtd: String(base.amostra_qtd || 1),
    amostra_data: base.amostra_data || (inicial.amostra_item ? hoje : ""),
    amostra_frete: base.amostra_frete != null ? String(base.amostra_frete).replace(".", ",") : "",
    observacao: base.observacao || "",
  }));
  const [salvando, setSalvando] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const grupos = useMemo(() => gruposDoSeletor(itens), [itens]);
  const tipo = f.amostra_item ? itemTipoDoId(f.amostra_item) : null;
  const ca = f.amostra_item ? custoAmostra({ amostra_item_tipo: tipo, amostra_item_id: f.amostra_item.slice(2), amostra_qtd: num(f.amostra_qtd) || 1, amostra_frete: num(f.amostra_frete) }, itens) : null;
  const linhaAm = f.amostra_item && f.canal_id ? mapaAf.get(`${tipo}|${f.amostra_item.slice(2)}|${f.canal_id}`) : null;
  const maxAm = linhaAm && !linhaAm.emRampa ? comissaoMaxima(linhaAm.preco, linhaAm.lucro, linhaAm.cfg) : null;

  async function salvar() {
    if (!f.nome.trim()) return onToast?.("Informe o nome ou @ do parceiro");
    if (f.comissao !== "" && !(num(f.comissao) > 0 && num(f.comissao) < 100)) return onToast?.("Comissão entre 0 e 100%");
    const campos = {
      nome: f.nome.trim(),
      rede: f.rede.trim() || null,
      nicho: f.nicho.trim() || null,
      canal_id: f.canal_id || null,
      comissao: f.comissao === "" ? null : num(f.comissao) / 100,
      status: f.status,
      amostra_item_tipo: f.amostra_item ? tipo : null,
      amostra_item_id: f.amostra_item ? f.amostra_item.slice(2) : null,
      amostra_qtd: Math.max(1, Math.round(num(f.amostra_qtd) || 1)),
      amostra_data: f.amostra_item && f.amostra_data ? f.amostra_data : null,
      amostra_frete: f.amostra_frete === "" ? null : num(f.amostra_frete),
      observacao: f.observacao.trim() || null,
    };
    if (!parceiro || parceiro.status !== f.status) campos.status_desde = hoje;
    setSalvando(true);
    const { error } = parceiro
      ? await supabase.from("afiliados").update(campos).eq("id", parceiro.id)
      : await supabase.from("afiliados").insert({ ...campos, loja_id: lojaId || null });
    setSalvando(false);
    if (error) return onToast?.(msgV35(error));
    onToast?.(parceiro ? `${campos.nome} atualizado` : `${campos.nome} adicionado`);
    onClose();
  }

  return (
    <EditarDialog titulo={parceiro ? `Editar ${parceiro.nome}` : "Novo parceiro"} salvando={salvando} onSalvar={salvar} onCancelar={onClose} salvarLabel={parceiro ? "Salvar" : "Adicionar"} classe="modal-box-md">
      <div className="grid-auto">
        <div className="field">
          <label>Nome ou @</label>
          <input type="text" value={f.nome} onChange={set("nome")} placeholder="@perfil" />
        </div>
        <div className="field">
          <label>Rede</label>
          <input type="text" value={f.rede} onChange={set("rede")} placeholder="Instagram, TikTok, grupo…" />
        </div>
        <div className="field">
          <label>Nicho</label>
          <input type="text" value={f.nicho} onChange={set("nicho")} placeholder="decoração, pets…" />
        </div>
        <div className="field">
          <label>Canal</label>
          <select value={f.canal_id} onChange={set("canal_id")}>
            {canais.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Comissão (%)</label>
          <input type="text" inputMode="decimal" value={f.comissao} onChange={set("comissao")} placeholder="ex.: 15" />
        </div>
        <div className="field">
          <label>Status</label>
          <select value={f.status} onChange={set("status")}>
            {STATUS_PARCEIRO.map((s) => (
              <option key={s.chave} value={s.chave}>
                {s.rotulo}
              </option>
            ))}
          </select>
        </div>
      </div>
      <h4 className="sub-titulo-modal">Amostra (opcional)</h4>
      <div className="field">
        <label>Item enviado</label>
        <BuscaItem grupos={grupos} value={f.amostra_item} onChange={(id) => setF((p) => ({ ...p, amostra_item: id }))} vazio="— sem amostra —" />
      </div>
      {f.amostra_item && (
        <div className="grid-auto">
          <div className="field">
            <label>Quantidade</label>
            <input type="number" min="1" value={f.amostra_qtd} onChange={set("amostra_qtd")} />
          </div>
          <div className="field">
            <label>Data de envio</label>
            <input type="date" value={f.amostra_data} onChange={set("amostra_data")} />
          </div>
          <div className="field">
            <label>Frete (R$)</label>
            <input type="text" inputMode="decimal" value={f.amostra_frete} onChange={set("amostra_frete")} placeholder="0,00" />
          </div>
        </div>
      )}
      {ca && (
        <p className="hint">
          Custo da amostra: <b>{BRL(ca.total)}</b> (peças {BRL(ca.pecas)}
          {ca.frete ? ` + frete ${BRL(ca.frete)}` : ""}).
          {maxAm != null &&
            ` Comissão desse item no canal: recomendada ${linhaAm.recomendada != null ? pct(linhaAm.recomendada) : "— (sem espaço acima da sua margem)"} · máxima ${maxAm >= 0.01 ? pct(maxAm) : "sem folga"}.`}
          {linhaAm?.emRampa && " Item em rampa abaixo do alvo: ainda sem folga pra comissão."}
          {maxAm != null && f.comissao !== "" && num(f.comissao) / 100 > maxAm + 1e-9 && <b className="neg"> A comissão do parceiro passa da máxima.</b>}
        </p>
      )}
      <div className="field">
        <label>Observação</label>
        <input type="text" value={f.observacao} onChange={set("observacao")} />
      </div>
    </EditarDialog>
  );
}

const COR = { organico: "var(--af-org)", ads: "var(--af-ads)", afiliado: "var(--af-af)" };

function GraficoOrigem({ semanas }) {
  const max = Math.max(4, ...semanas.map((w) => w.total));
  const passo = max <= 10 ? 2 : max <= 20 ? 5 : max <= 50 ? 10 : max <= 100 ? 20 : Math.ceil(max / 5 / 50) * 50;
  const topo = Math.ceil(max / passo) * passo;
  const W = 900;
  const H = 190;
  const x0 = 40;
  const y0 = 150;
  const y1 = 18;
  const y = (v) => y0 - (v / topo) * (y0 - y1);
  const larg = (W - x0 - 10) / semanas.length;
  const bw = Math.min(64, larg * 0.5);
  const vazio = semanas.every((w) => !w.total);
  const ticks = [];
  for (let v = 0; v <= topo; v += passo) ticks.push(v);
  return (
    <div className="grafico-origem">
      <div className="leg-origem">
        <span><i style={{ background: COR.organico }} />Orgânico</span>
        <span><i style={{ background: COR.ads }} />Ads</span>
        <span><i style={{ background: COR.afiliado }} />Afiliado</span>
      </div>
      {vazio ? (
        <div className="empty">Sem semanas registradas ainda — use “Registrar semana”.</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Vendas por origem por semana">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={x0} x2={W - 10} y1={y(v)} y2={y(v)} className="go-grade" />
              <text x={x0 - 8} y={y(v) + 4} textAnchor="end" className="go-eixo">{v}</text>
            </g>
          ))}
          {semanas.map((w, k) => {
            const cx = x0 + larg * k + larg / 2;
            const partes = [
              ["afiliado", w.afiliado],
              ["ads", w.ads],
              ["organico", w.organico],
            ];
            let base = 0;
            return (
              <g key={w.semana}>
                <title>{`Semana de ${dataBR(w.semana)}: ${w.total} vendas — orgânico ${w.organico}, Ads ${w.ads}, afiliado ${w.afiliado}`}</title>
                {partes.map(([k2, v]) => {
                  if (!v) return null;
                  const yTop = y(base + v);
                  const h = y(base) - yTop;
                  base += v;
                  return <rect key={k2} x={cx - bw / 2} y={yTop} width={bw} height={Math.max(0, h)} fill={COR[k2]} />;
                })}
                <text x={cx} y={H - 22 + 14} textAnchor="middle" className="go-eixo">{dataBR(w.semana)}</text>
                {w.total > 0 && (
                  <text x={cx} y={y(w.total) - 5} textAnchor="middle" className="go-total">{w.total}</text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
