import { Fragment, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { usePreferencia } from "../hooks/usePreferencia.js";
import { useAcoesComerciais } from "../hooks/useAcoesComerciais.js";
import { registrarAcao } from "../lib/acoesComerciaisAcoes.js";
import { cuponsAtivos } from "../lib/cupomLoja.js";
import { padraoDoCanal } from "../lib/afiliados.js";
import { useCrescimento } from "../hooks/useCrescimento.js";
import { DIAS_TESTE, FRACAO_AFILIADO, MIN_VENDAS_MIX, PCT_MAX_SIM, anunciosDaLoja, estadoTeste, linhasDaLoja, parteDoAfiliado, maisVendidos, maxSeguroDoItem, minimoAfiliado, resultadoAfiliados, resumoProposta, simularComissaoLoja, sugestaoComissaoLoja, vendasPorItemCanal } from "../lib/comissaoLoja.js";
import { BRL } from "../lib/format.js";
import { canalDireto } from "../lib/canais.js";
import { irParaAba } from "../lib/navegar.js";
import Kpis from "./Kpis.jsx";
import Ajuda from "./Ajuda.jsx";
import Estado from "./Estado.jsx";

// Vender mais → Afiliados → Comissão (29/10/2026): UM % pra loja inteira (o que se põe na Shopee
// em "afiliados do vendedor") + exceção por anúncio (a comissão própria SUBSTITUI a da loja,
// nunca soma). Regra: o afiliado fica com no máximo metade do lucro (preço de agora + pior caso
// com o cupom ativo); mínimo da Shopee 4% (Regras). Teste de 15 dias por comissão. Afiliado só
// mexe em comissão — nunca em preço. Conta ÚNICA em lib/comissaoLoja.js.
const GRUPO_SIT = { ok: 0, "menos-metade": 0, abaixo: 1, prejuizo: 1, insuficiente: 2, desligado: 3 };
const pctTxt = (p) => `${Math.round(p * 100)}%`;
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const SIT = {
  ok: [null, "✓ apto"],
  "menos-metade": ["atencao", "leva mais da metade"],
  abaixo: ["resolver", "não compensa"],
  prejuizo: ["resolver", "prejuízo"],
  insuficiente: ["info", "dados insuficientes"],
  desligado: [null, "sem afiliado"],
};

export default function ComissaoLoja({ dados, linhasAf, config, pedidos, registros, mapaAf, lojaId, hoje, onToast }) {
  const canais = useMemo(() => (dados.canais || []).filter((c) => !canalDireto(c)), [dados.canais]);
  const [canalId, setCanalId] = useState(() => (canais.find((c) => c.tipo === "shopee") || canais[0])?.id || "");
  const canal = canais.find((c) => c.id === canalId) || null;
  const vendas = useMemo(() => vendasPorItemCanal(pedidos, hoje), [pedidos, hoje]);
  const faixas = useMemo(() => cuponsAtivos(dados.cfgLoja, canalId), [dados.cfgLoja, canalId]);
  const { soNoGrupo } = useCrescimento();
  // Por ANÚNCIO (30/10/2026): a Shopee põe o % no anúncio inteiro — as variações vêm juntas.
  const linhasItem = useMemo(() => linhasDaLoja({ linhasAf, canalId, faixasCupom: faixas, vendas, config }), [linhasAf, canalId, faixas, vendas, config]);
  const linhas = useMemo(
    () => anunciosDaLoja({ linhas: linhasItem, itens: dados.itens, canalId, config, grupos: dados.gruposAnuncio, soNoGrupo, anunciado: (it) => (dados.cobraNoCanal && canal ? dados.cobraNoCanal(it, canal) : true) }),
    [linhasItem, dados, canalId, config, soNoGrupo, canal]
  );
  const [aberto, setAberto] = useState(null);
  const top = useMemo(() => maisVendidos(linhas), [linhas]);
  const sug = useMemo(() => sugestaoComissaoLoja(linhas), [linhas]);
  const minimo = minimoAfiliado(dados.cfgLoja);
  const minPct = Math.round(minimo * 100);
  const padrao = padraoDoCanal(config, canalId);
  const naShopee = padrao?.comissao || null;
  const [pct, setPct] = useState(() => Math.round((naShopee || minimo) * 100));
  const sim = useMemo(() => simularComissaoLoja(linhas, pct / 100), [linhas, pct]);
  // Aptos em cima; os que não compensam (abaixo do mínimo/prejuízo) embaixo; sem dados no fim.
  const ordenadas = useMemo(() => [...sim.linhas].sort((a, b) => GRUPO_SIT[a.situacao] - GRUPO_SIT[b.situacao]), [sim.linhas]);
  const [registrar, setRegistrar] = useState(false);
  const [editItem, setEditItem] = useState(null); // { chave, valor }
  const [testes, setTestes] = usePreferencia("afiliados:testes", {});

  // Cada comissão registrada abre um teste de 15 dias e entra no histórico (acoes_comerciais).
  function abrirTeste(chave, valor, antes, item) {
    const t = { ...(testes || {}) };
    if (valor != null) t[chave] = { pct: valor, inicio: hoje };
    else delete t[chave];
    setTestes(t);
    registrarAcao({
      lojaId,
      itemTipo: item?.tipo || null,
      itemId: item?.id || null,
      canalId: canal.id,
      tipo: "afiliado",
      data: hoje,
      antes: antes != null ? pctTxt(antes) : "sem afiliado",
      depois: valor != null ? pctTxt(valor) : "desligado",
      observacao: item ? `comissão própria — ${item.item.nome}` : "comissão da loja",
    });
  }

  async function salvarNaShopee(valor) {
    if (!canal) return;
    const campos = { ativo: valor != null, comissao: valor, atualizado_em: new Date().toISOString() };
    const { error } = padrao.row
      ? await supabase.from("afiliado_config").update(campos).eq("id", padrao.row.id)
      : await supabase.from("afiliado_config").insert({ ...campos, loja_id: lojaId || null, canal_id: canal.id, item_tipo: null, item_id: null });
    if (error) return onToast?.(`Não foi possível salvar: ${error.message}`);
    abrirTeste(`loja|${canal.id}`, valor, naShopee, null);
    setRegistrar(false);
    onToast?.(valor != null ? `${canal.nome}: comissão da loja ${pctTxt(valor)} registrada — teste até ${dm(somar(hoje, DIAS_TESTE))}` : `${canal.nome}: comissão da loja desligada`);
  }

  async function salvarPropria(l, valor) {
    let error;
    if (valor == null) {
      if (l.propriaRow) ({ error } = await supabase.from("afiliado_config").delete().eq("id", l.propriaRow.id));
    } else {
      const campos = { ativo: true, comissao: valor, atualizado_em: new Date().toISOString() };
      const row = (config || []).find((r) => r.canal_id === canal.id && r.item_tipo === l.tipo && r.item_id === l.id);
      ({ error } = row ? await supabase.from("afiliado_config").update(campos).eq("id", row.id) : await supabase.from("afiliado_config").insert({ ...campos, loja_id: lojaId || null, canal_id: canal.id, item_tipo: l.tipo, item_id: l.id }));
    }
    if (error) return onToast?.(`Não foi possível salvar: ${error.message}`);
    abrirTeste(`item|${l.tipo}|${l.id}|${canal.id}`, valor, l.propria, l);
    setEditItem(null);
    onToast?.(valor != null ? `${l.item.nome}: ${pctTxt(valor)} no anúncio inteiro (ponha o mesmo na Shopee)` : `${l.item.nome}: volta pra comissão da loja`);
    return true;
  }

  // % antigo salvo numa variação (ou num item de anúncio com vários itens): a Shopee não separa
  // por variação — passa pro anúncio inteiro e só então apaga a linha antiga.
  async function passarProAnuncio(l, ant) {
    const ok = await salvarPropria(l, ant.pct);
    if (ok !== true) return;
    const { error } = await supabase.from("afiliado_config").delete().in("id", l.antigas.map((x) => x.row.id));
    if (error) return onToast?.(`O anúncio ficou com ${pctTxt(ant.pct)}, mas a comissão antiga não saiu: ${error.message}`);
    onToast?.(`${l.item.nome}: ${pctTxt(ant.pct)} no anúncio inteiro`);
  }

  // Chave ligado/desligado (30/10/2026): desligar = você tirou o anúncio da campanha na Shopee
  // ("Remover"). Grava a linha do anúncio com ativo = false (guarda o % próprio, se havia);
  // religar volta o % próprio ou apaga a linha (volta o da loja).
  async function alternarAfiliado(l) {
    const row = l.linhaAnuncio || (config || []).find((r) => r.canal_id === canal.id && r.item_tipo === l.tipo && r.item_id === l.id);
    const antes = l.desligado ? null : comissaoEmTxt(l);
    let error;
    if (l.desligado) {
      if (row && Number(row.comissao) > 0) ({ error } = await supabase.from("afiliado_config").update({ ativo: true, atualizado_em: new Date().toISOString() }).eq("id", row.id));
      else if (row) ({ error } = await supabase.from("afiliado_config").delete().eq("id", row.id));
    } else {
      const campos = { ativo: false, atualizado_em: new Date().toISOString() };
      ({ error } = row ? await supabase.from("afiliado_config").update(campos).eq("id", row.id) : await supabase.from("afiliado_config").insert({ ...campos, comissao: null, loja_id: lojaId || null, canal_id: canal.id, item_tipo: l.tipo, item_id: l.id }));
    }
    if (error) return onToast?.(`Não foi possível salvar: ${error.message}`);
    const t = { ...(testes || {}) };
    delete t[`item|${l.tipo}|${l.id}|${canal.id}`];
    setTestes(t);
    registrarAcao({ lojaId, itemTipo: l.tipo, itemId: l.id, canalId: canal.id, tipo: "afiliado", data: hoje, antes: antes || "desligado", depois: l.desligado ? "ligado" : "desligado", observacao: `afiliado ${l.desligado ? "ligado" : "desligado"} — ${l.item.nome}` });
    onToast?.(l.desligado ? `${l.item.nome}: afiliado ligado de novo (ponha de volta na campanha da ${canal.nome})` : `${l.item.nome}: sem afiliado — confira se removeu na campanha da ${canal.nome}`);
  }
  const comissaoEmTxt = (l) => pctTxt(l.propria != null ? l.propria : naShopee || 0);

  function responderTeste(chave, resposta) {
    const t = { ...(testes || {}) };
    if (!t[chave]) return;
    t[chave] = { ...t[chave], resposta, em: hoje };
    setTestes(t);
  }

  if (!canal) return <div className="panel"><div className="empty">Nenhum marketplace cadastrado.</div></div>;

  const inicial = sug.sugerida ? (sug.sugerida >= minPct ? minPct : null) : null;
  const naoAguenta = sug.decide > 0 && sug.sugerida != null && sug.sugerida < minPct;

  return (
    <>
      <div className="panel">
        <h3 className="section-title">
          <span>
            Comissão
            <Ajuda texto={`O % que você põe na Shopee em "afiliados do vendedor" vale pra loja toda; num anúncio você pode pôr um % próprio, que SUBSTITUI o da loja (não soma). Regra: o afiliado fica com no máximo metade do lucro (${pctTxt(FRACAO_AFILIADO)}), pelo PREÇO DE AGORA e no pior caso com o cupom ativo: a comissão sobre o preço sem o cupom e o seu lucro com o cupom. Mínimo da Shopee: ${minPct}% (Regras). Afiliado só mexe em comissão — o app nunca sugere mudar preço por causa dele.`} />
          </span>
          {canais.length > 1 && (
            <select value={canalId} onChange={(e) => setCanalId(e.target.value)} aria-label="Canal">
              {canais.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          )}
        </h3>
        <Kpis
          itens={[
            { label: "Comissão sugerida", valor: sug.sugerida ? `${sug.sugerida}%` : "—", sub: sug.sugerida === 0 ? "um dos que mais vendem não aguenta nem 1%" : !sug.sugerida ? "sem lucro pra dividir nos que mais vendem" : linhas.some((l) => l.vendas > 0) ? "os que mais vendem (90 dias) ficam com ≥ metade do lucro" : "sem vendas importadas: todos os produtos contam" },
            { label: "Começar com", valor: inicial ? `${inicial}%` : "—", sub: inicial ? `o mínimo da Shopee; dá pra subir 1 ponto por teste até ${sug.sugerida}%` : naoAguenta ? `os que mais vendem não aguentam o mínimo de ${minPct}%` : "—", tom: naoAguenta ? "warn" : undefined },
            { label: "Teto", valor: sug.teto ? `${sug.teto}%` : "—", sub: "acima disso algum dos que mais vendem fica abaixo do lucro mínimo" },
            {
              label: `Na ${canal.nome} hoje`,
              valor: naShopee ? pctTxt(naShopee) : "—",
              sub: naShopee ? (sug.teto && naShopee * 100 > sug.teto ? "⚠ acima do teto" : sug.sugerida && naShopee * 100 > sug.sugerida ? "acima da sugerida" : "dentro da sugerida") : "ainda não registrada",
              tom: naShopee && sug.teto && naShopee * 100 > sug.teto ? "warn" : undefined,
            },
          ]}
        />
        {naoAguenta && (
          <div className="alerta alerta-warn">
            <b>Não compensa oferecer afiliado na loja toda agora:</b> com o mínimo de {minPct}% os produtos que mais vendem ficam com menos da metade do lucro. Se quiser, use afiliado só nos anúncios que aguentam ("% deste anúncio" na tabela).
          </div>
        )}
        <div className="toolbar" style={{ gap: 8 }}>
          {registrar ? (
            <>
              <span>Registrar a comissão da loja que está na {canal.nome}:</span>
              <button type="button" className="btn btn-mini primary" onClick={() => salvarNaShopee(pct / 100)}>
                {pct}% (o do simulador)
              </button>
              {naShopee && (
                <button type="button" className="btn btn-mini" onClick={() => salvarNaShopee(null)}>
                  Desliguei na {canal.nome}
                </button>
              )}
              <button type="button" className="link-btn" style={{ margin: 0 }} onClick={() => setRegistrar(false)}>
                cancelar
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-mini" onClick={() => setRegistrar(true)}>
              {naShopee ? "✎ Mudei na Shopee" : "Registrar o que pus na Shopee"}
            </button>
          )}
        </div>
        <div className="af-sim">
          <label htmlFor="af-pct" className="rotulo">
            Simulador
          </label>
          <input id="af-pct" type="range" min="1" max={PCT_MAX_SIM} value={pct} onChange={(e) => setPct(Number(e.target.value))} />
          <input type="number" min="1" max={PCT_MAX_SIM} value={pct} onChange={(e) => setPct(Math.max(1, Math.min(PCT_MAX_SIM, Number(e.target.value) || 1)))} aria-label="Comissão em %" style={{ width: 70 }} />
          <b className="af-sim-v">{pct}%</b>
          {sug.sugerida > 0 && (
            <button type="button" className="btn btn-mini" onClick={() => setPct(sug.sugerida)}>
              usar a sugerida
            </button>
          )}
          <span className="af-sim-res">
            <b>{sim.ok}</b> aptos · <b>{sim.menosMetade}</b> afiliado leva mais da metade · <b>{sim.abaixo + sim.prejuizo}</b> não compensam
            {sim.desligado ? (
              <>
                {" "}
                · <b>{sim.desligado}</b> desligados
              </>
            ) : null}
            {sim.insuficiente ? (
              <>
                {" "}
                · <b>{sim.insuficiente}</b> sem dados
              </>
            ) : null}{" "}
            · {pct < minPct ? `⚠ abaixo do mínimo da Shopee (${minPct}%)` : !sug.sugerida ? "" : pct <= sug.sugerida ? "✓ dentro da sugerida" : pct <= sug.teto ? "acima da sugerida, abaixo do teto" : "⚠ acima do teto"}
          </span>
        </div>
        {!linhas.length ? (
          <div className="empty">Nenhum produto com preço salvo na {canal.nome}.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Anúncio</th>
                  <th className="num">Preço agora</th>
                  <th className="num">Vendas 90d</th>
                  <th className="num">Lucro sem afiliado</th>
                  <th className="num">Comissão</th>
                  <th className="num">Afiliado ganha</th>
                  <th className="num">Você fica</th>
                  <th className="num">Máx. seguro</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {ordenadas.map((l, i) => {
                  const [tipo, rot] = SIT[l.situacao];
                  const divisa = i > 0 && GRUPO_SIT[l.situacao] !== GRUPO_SIT[ordenadas[i - 1].situacao] ? GRUPO_SIT[l.situacao] : null;
                  const ed = editItem?.chave === l.chave;
                  const nVar = l.variacoes?.length || 1;
                  const abre = aberto === l.chave;
                  return (
                    <Fragment key={l.chave}>
                      {divisa && (
                        <tr className="linha-divisa">
                          <td colSpan={9}>
                            <b>{divisa === 1 ? `Não compensam com ${pct}%` : divisa === 3 ? "Sem afiliado (você desligou)" : "Sem dados (falta custo cadastrado)"}</b>
                            <span className="muted-cel"> · {ordenadas.filter((x) => GRUPO_SIT[x.situacao] === divisa).length}</span>
                          </td>
                        </tr>
                      )}
                      <tr className={abre ? "linha-atual" : ""}>
                        <td>
                          <button type="button" className="link-btn" style={{ margin: 0, textAlign: "left" }} onClick={() => setAberto(abre ? null : l.chave)}>
                            {abre ? "▾" : "▸"} <b>{l.item.nome}</b>
                          </button>
                          {l.emRampa && <Estado tipo="decisao">em rampa</Estado>}
                          {top.has(l.chave) && l.vendas > 0 && <span className="muted-cel"> · mais vende</span>}
                          <div className="sub-linha">
                            {l.tipo === "grupo" ? `vários itens · ${nVar} opç${nVar === 1 ? "ão" : "ões"}` : l.tipo === "kit" ? "kit" : nVar > 1 ? `${nVar} variações` : "1 unidade"}
                            {l.cupom > 0 ? ` · com o cupom: −${BRL(l.cupom)}` : ""}
                          </div>
                          {l.antigas?.length > 0 && <div className="sub-linha"><Estado tipo="atencao">⚠ % antigo numa variação</Estado></div>}
                        </td>
                        <td className="num">{l.precoMax && l.precoMax !== l.preco ? `${BRL(l.preco)} – ${BRL(l.precoMax)}` : BRL(l.preco)}</td>
                        <td className="num">{l.vendas || "—"}</td>
                        <td className="num">{l.insuficiente || l.lucro == null ? "—" : BRL(l.lucro)}</td>
                        <td className="num">
                          {ed ? (
                            <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                              <input type="number" min="1" max="60" value={editItem.valor} onChange={(e) => setEditItem({ ...editItem, valor: e.target.value })} style={{ width: 56 }} aria-label="% deste anúncio" />
                              <button type="button" className="btn btn-mini primary" onClick={() => Number(editItem.valor) > 0 && salvarPropria(l, Number(editItem.valor) / 100)}>
                                ok
                              </button>
                              <button type="button" className="link-btn" style={{ margin: 0 }} onClick={() => setEditItem(null)}>
                                ×
                              </button>
                            </span>
                          ) : (
                            <>
                              <ChaveAfiliado ligado={!l.desligado} onAlternar={() => alternarAfiliado(l)} />
                              {l.desligado ? (
                                <div className="sub-linha">removido na {canal.nome}</div>
                              ) : (
                                <>
                              {pctTxt(l.em)}
                              <div className="sub-linha">
                                {l.propria != null ? (
                                  <>
                                    só neste anúncio ·{" "}
                                    <button type="button" className="link-btn" style={{ margin: 0 }} onClick={() => salvarPropria(l, null)}>
                                      voltar ao da loja
                                    </button>
                                  </>
                                ) : (
                                  <button type="button" className="link-btn" style={{ margin: 0 }} onClick={() => setEditItem({ chave: l.chave, valor: String(l.maxSeguro >= minPct ? minPct : l.maxSeguro || minPct) })}>
                                    % deste anúncio
                                  </button>
                                )}
                              </div>
                                </>
                              )}
                            </>
                          )}
                        </td>
                        <td className="num">{l.desligado ? "—" : BRL(l.comissao)}</td>
                        <td className={`num${l.lucroCom < 0 ? " neg" : ""}`}>{l.insuficiente ? "—" : BRL(l.lucroCom)}</td>
                        <td className="num">{l.insuficiente ? "—" : l.maxSeguro >= minPct ? `${l.maxSeguro}%` : <span className="muted-cel" title={`não aguenta o mínimo da Shopee (${minPct}%)`}>abaixo de {minPct}%</span>}</td>
                        <td>{tipo ? <Estado tipo={tipo}>{rot}</Estado> : <span className="muted-cel">{rot}</span>}</td>
                      </tr>
                      {abre && (
                        <tr className="linha-detalhe">
                          <td colSpan={9} style={{ whiteSpace: "normal" }}>
                            <DetalheAnuncioAf l={l} minPct={minPct} onPassar={(ant) => passarProAnuncio(l, ant)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint" style={{ marginBottom: 0 }}>
          Uma linha por anúncio (a Shopee põe a comissão no anúncio inteiro): com mais de uma variação, lucro, afiliado ganha e você fica são a média — clique no anúncio pra ver cada variação. A comissão sai do lucro — o preço não muda por causa de afiliado. Anúncio que não aguenta: ponha um % próprio menor nele (se a Shopee deixar) ou deixe a comissão da loja mais baixa. O marketplace desconta a comissão do repasse: não lance no Fluxo de Caixa.
        </p>
      </div>
      <AcompanhamentoAfiliados testes={testes} linhas={linhas} canal={canal} comissaoLoja={naShopee} sugerida={sug.sugerida} hoje={hoje} onResponder={responderTeste} />
      <PropostaAfiliado linhas={linhas} canal={canal} lojaId={lojaId} hoje={hoje} onToast={onToast} />
      <ResultadoAfiliados registros={registros} mapaAf={mapaAf} hoje={hoje} />
    </>
  );
}

// Chave ligado/desligado do afiliado no anúncio (mesmo visual da chave do teto de Ads).
function ChaveAfiliado({ ligado, onAlternar }) {
  return (
    <label className={`chave-teto chave-af${ligado ? " ligada" : ""}`} title={ligado ? "Afiliado ligado neste anúncio — clique se você removeu ele da campanha na Shopee" : "Sem afiliado neste anúncio — clique pra ligar de novo"}>
      <button type="button" role="switch" aria-checked={ligado} className="chave-switch" onClick={onAlternar}>
        <span className="chave-bolinha" />
      </button>
      <span>{ligado ? "ligado" : "desligado"}</span>
    </label>
  );
}

const REGRA_MAX = {
  vendas: (l) => `pela média das vendas de 90 dias de cada variação (${l.variacoes.filter((v) => Number(v.lucro) > 0).reduce((t, v) => t + (Number(v.vendas) || 0), 0)} vendas — ${MIN_VENDAS_MIX} ou mais)`,
  apertadas: () => `pela média das 2 variações mais apertadas (menos de ${MIN_VENDAS_MIX} vendas em 90 dias)`,
  unica: () => "pela única variação anunciada",
};

// Detalhe do anúncio: cada variação com o que o afiliado ganha e o que sobra pra você.
function DetalheAnuncioAf({ l, minPct, onPassar }) {
  const regra = REGRA_MAX[l._regra];
  return (
    <div className="detalhe-cel">
      {l.antigas?.length > 0 &&
        l.antigas.map((a) => (
          <div key={a.row.id} className="alerta alerta-warn">
            {`Você tinha ${pctTxt(a.pct)} só em ${a.nome} — a Shopee não separa a comissão por variação, ela vale pro anúncio inteiro.`}{" "}
            <button type="button" className="btn btn-mini" onClick={() => onPassar(a)}>
              Passar {pctTxt(a.pct)} pro anúncio
            </button>
          </div>
        ))}
      {l.desligado && (
        <div className="alerta alerta-neutro">
          {`Sem afiliado neste anúncio (você desligou). Abaixo, como ficaria se ligar de novo com ${pctTxt(l.emSeLigar || 0)} da loja.`}
        </div>
      )}
      <p className="hint" style={{ marginTop: 0 }}>
        Com <b>{pctTxt(l.desligado ? l.emSeLigar || 0 : l.em)}</b> {l.propria != null ? "(deste anúncio)" : "(da loja)"} — vale pra todas as variações. Máximo seguro <b>{l.maxSeguro >= 1 ? `${l.maxSeguro}%` : "—"}</b>
        {regra ? ` ${regra(l)}` : ""}, com a trava: nenhuma variação no prejuízo nem abaixo do lucro mínimo.
        {l.maxSeguro > 0 && l.maxSeguro < minPct ? ` Abaixo do mínimo da Shopee (${minPct}%).` : ""}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l.tipo === "grupo" ? "Opção" : "Variação"}</th>
              <th className="num">Preço agora</th>
              <th className="num">Vendas 90d</th>
              <th className="num">Lucro sem afiliado</th>
              <th className="num">Afiliado ganha</th>
              <th className="num">Sobra pra você</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {l.variacoes.map((v) => {
              const p = parteDoAfiliado(v, l.desligado ? l.emSeLigar || 0 : l.em);
              return (
                <tr key={v.chave}>
                  <td>{v.item.nome}</td>
                  <td className="num">{BRL(v.preco)}</td>
                  <td className="num">{v.vendas || "—"}</td>
                  <td className="num">{v.insuficiente ? "—" : BRL(v.lucro)}</td>
                  <td className="num">
                    {BRL(p.comissao)}
                    {p.leva != null && <div className="sub-linha">{Math.round(p.leva * 100)}% do lucro</div>}
                  </td>
                  <td className={`num${p.lucroCom < 0 ? " neg" : ""}`}>{v.insuficiente ? "—" : BRL(p.lucroCom)}</td>
                  <td>
                    {v.insuficiente ? (
                      <span className="muted-cel">sem custo cadastrado</span>
                    ) : p.semLucro ? (
                      <span className="muted-cel">já sem lucro antes do afiliado (assunto de preço)</span>
                    ) : p.situacao === "prejuizo" ? (
                      <Estado tipo="resolver">prejuízo</Estado>
                    ) : p.situacao === "abaixo" ? (
                      <Estado tipo="resolver">abaixo do lucro mínimo</Estado>
                    ) : p.passaMetade ? (
                      <Estado tipo="info">passa da metade do lucro</Estado>
                    ) : (
                      <span className="muted-cel">✓</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function somar(iso, n) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Acompanhamento: um teste de 15 dias por comissão registrada (loja e própria de anúncio) +
// o histórico das mudanças (acoes_comerciais, tipo "afiliado").
function AcompanhamentoAfiliados({ testes, linhas, canal, comissaoLoja, sugerida, hoje, onResponder }) {
  const { acoes } = useAcoesComerciais();
  const hist = (acoes || []).filter((a) => a.tipo === "afiliado" && a.canal_id === canal.id).sort((a, b) => String(b.data).localeCompare(String(a.data)) || String(b.criado_em || "").localeCompare(String(a.criado_em || "")));
  const nomeItem = (id) => linhas.find((l) => l.id === id)?.item.nome;
  const lista = Object.entries(testes || {})
    .filter(([k]) => k.endsWith(`|${canal.id}`))
    .map(([k, t]) => {
      const ehLoja = k.startsWith("loja|");
      const l = ehLoja ? null : linhas.find((x) => `item|${x.tipo}|${x.id}|${canal.id}` === k);
      const atual = ehLoja ? comissaoLoja : l?.propria;
      if (!atual || Math.round(atual * 100) !== Math.round(Number(t.pct) * 100)) return null;
      return { k, t, nome: ehLoja ? "Comissão da loja" : l?.item.nome || "anúncio", e: estadoTeste(t, hoje, ehLoja ? sugerida : maxSeguroDoItem(l)) };
    })
    .filter(Boolean);
  const ROT = {
    andamento: (e) => <span className="muted-cel">em teste · confere em {dm(e.avaliarEm)}</span>,
    avaliar: () => <Estado tipo="atencao">⚠ avaliar</Estado>,
    subir: (e) => <Estado tipo="oportunidade">↑ testar {e.proximo}%</Estado>,
    maximo: () => <span className="muted-cel">já no máximo seguro — manter</span>,
    ok: () => <Estado tipo="oportunidade">✓ teve afiliado — manter e acompanhar</Estado>,
  };
  if (!lista.length && !hist.length) return null;
  return (
    <div className="panel">
      <h3 className="section-title">
        <span>
          Acompanhamento
          <Ajuda texto={`Cada comissão registrada vira um teste de ${DIAS_TESTE} dias. No fim, confira no painel da Shopee (Afiliados) se alguém se afiliou ou vendeu: se ninguém, o app sugere subir 1 ponto — só se ainda couber na regra da metade do lucro. Ele nunca sugere subir só porque os dias passaram. Mudou na Shopee? Registre aqui e o teste recomeça.`} />
        </span>
      </h3>
      {lista.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Comissão</th>
                <th className="num">%</th>
                <th>Desde</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map(({ k, t, nome, e }) => (
                <tr key={k}>
                  <td>{nome}</td>
                  <td className="num">{pctTxt(Number(t.pct))}</td>
                  <td>
                    {dm(t.inicio)} · {e.dias} dia{e.dias === 1 ? "" : "s"}
                  </td>
                  <td>{ROT[e.estado](e)}</td>
                  <td>
                    {(e.estado === "avaliar" || e.estado === "andamento") && (
                      <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                        <button type="button" className="btn btn-mini" onClick={() => onResponder(k, "nao")}>
                          Ninguém se afiliou/vendeu
                        </button>
                        <button type="button" className="btn btn-mini" onClick={() => onResponder(k, "sim")}>
                          Teve afiliado ou venda
                        </button>
                      </span>
                    )}
                    {e.estado === "subir" && <span className="muted-cel">suba na Shopee e registre o % novo aqui</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hist.length > 0 && (
        <>
          <h3>Histórico</h3>
          <ul className="inicio-mini">
            {hist.slice(0, 12).map((a) => (
              <li key={a.id}>
                <span>
                  {dm(String(a.data))} · {a.item_id ? nomeItem(a.item_id) || "anúncio" : "loja toda"}: {a.valor_antes} → <b>{a.valor_depois}</b>
                  {a.conclusao ? ` · ${a.conclusao}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="hint" style={{ marginBottom: 0 }}>
            O que mudou depois de cada ajuste não é só da comissão — preço, Ads e época também mexem nas vendas.{" "}
            <button type="button" className="link-btn" style={{ margin: 0 }} onClick={() => irParaAba("anuncios")}>
              ver nos anúncios
            </button>
          </p>
        </>
      )}
    </div>
  );
}

// Proposta pra um afiliado específico: produtos + % → lucro de cada, quantas vendas pagam a amostra.
// Guardada em preferencias_loja `afiliados:propostas` (lista; sem SQL) e o parceiro é criado na tabela afiliados.
function PropostaAfiliado({ linhas, canal, lojaId, hoje, onToast }) {
  const [propostas, setPropostas] = usePreferencia("afiliados:propostas", []);
  const [aberta, setAberta] = useState(false);
  const [nome, setNome] = useState("");
  const [pct, setPct] = useState(15);
  const [amostra, setAmostra] = useState(1);
  const [sel, setSel] = useState([]);
  const escolhidas = linhas.filter((l) => sel.includes(l.chave));
  const custoAmostra = (Number(amostra) || 0) * escolhidas.reduce((t, l) => t + (Number(l.item.custoTotal) || 0), 0);
  const r = resumoProposta(linhas, sel, pct / 100, custoAmostra);
  const alternar = (k) => setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  async function salvar() {
    if (!nome.trim() || !sel.length) return onToast?.("Informe o afiliado e escolha os produtos");
    const { data, error } = await supabase
      .from("afiliados")
      .insert({ loja_id: lojaId || null, nome: nome.trim(), canal_id: canal.id, comissao: pct / 100, status: "convidado", status_desde: hoje, observacao: `proposta: ${escolhidas.map((l) => l.item.nome).join(", ")}` })
      .select("id")
      .single();
    if (error) return onToast?.(`Não foi possível salvar: ${error.message}`);
    setPropostas([...(propostas || []), { id: data?.id || null, nome: nome.trim(), canal_id: canal.id, pct: pct / 100, chaves: sel, amostra: Number(amostra) || 0, em: hoje }]);
    onToast?.(`Proposta pra ${nome.trim()} salva — ele entrou em Parceiros como convidado`);
    setNome("");
    setSel([]);
    setAberta(false);
  }
  async function copiar() {
    const txt = ["Produto\tPreço\tComissão", ...escolhidas.map((l) => `${l.item.nome}\t${BRL(l.preco)}\t${pct}%`)].join("\n");
    try {
      await navigator.clipboard.writeText(txt);
      onToast?.("Lista copiada");
    } catch {
      onToast?.("Não deu pra copiar neste navegador");
    }
  }

  return (
    <div className="panel">
      <h3 className="section-title">
        <span>
          Proposta pra um afiliado
          <Ajuda texto="Pra quando você convidar alguém com um % só pra ele (campanha direcionada / amostra): escolha os anúncios e o %, veja o lucro de cada um (média das variações) antes de enviar. Salvar cria o parceiro (convidado) e guarda a proposta." />
        </span>
        <button type="button" className="btn btn-mini" onClick={() => setAberta((a) => !a)}>
          {aberta ? "Fechar" : "+ Nova proposta"}
        </button>
      </h3>
      {(propostas || []).length > 0 && !aberta && (
        <ul className="inicio-mini">
          {propostas.slice(-5).reverse().map((p, i) => (
            <li key={`${p.id || i}`}>
              <span>
                <b>{p.nome}</b> · {pctTxt(p.pct)} · {p.chaves.length} produto{p.chaves.length === 1 ? "" : "s"} · {p.em.slice(8, 10)}/{p.em.slice(5, 7)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {aberta && (
        <>
          <div className="grid-auto">
            <label>
              Afiliado (@)
              <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="@perfil" />
            </label>
            <label>
              Comissão da proposta (%)
              <input type="number" min="1" max="60" value={pct} onChange={(e) => setPct(Number(e.target.value) || 1)} />
            </label>
            <label>
              Amostra (peças de cada produto)
              <input type="number" min="0" value={amostra} onChange={(e) => setAmostra(e.target.value)} />
            </label>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th />
                  <th>Anúncio</th>
                  <th className="num">Preço agora</th>
                  <th className="num">Lucro sem</th>
                  <th className="num">Comissão</th>
                  <th className="num">Lucro com</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const c = r.linhas.find((x) => x.chave === l.chave);
                  const [tipo, rot] = c ? SIT[c.situacao] : [null, ""];
                  return (
                    <tr key={l.chave} className={sel.includes(l.chave) ? "linha-atual" : ""}>
                      <td>
                        <input type="checkbox" checked={sel.includes(l.chave)} onChange={() => alternar(l.chave)} aria-label={l.item.nome} />
                      </td>
                      <td>{l.item.nome}</td>
                      <td className="num">{BRL(l.preco)}</td>
                      <td className="num">{BRL(l.lucro)}</td>
                      <td className="num">{c ? BRL(c.comissao) : "—"}</td>
                      <td className={`num${c && c.lucroCom < 0 ? " neg" : ""}`}>{c ? BRL(c.lucroCom) : "—"}</td>
                      <td>{c ? tipo ? <Estado tipo={tipo}>{rot}</Estado> : <span className="muted-cel">{rot}</span> : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {r.n > 0 && (
            <div className={`alerta ${r.ruins ? "alerta-warn" : "alerta-good"}`}>
              <b>
                {r.n} produto{r.n === 1 ? "" : "s"} a {pct}%:
              </b>{" "}
              você fica com {BRL(r.media)} por venda em média.
              {r.ruins ? ` ${r.ruins} ficam abaixo do mínimo ou no prejuízo.` : ""}
              {r.vendasParaPagar ? ` A amostra (~${BRL(custoAmostra)}) se paga com ${r.vendasParaPagar} vendas desse afiliado.` : ""}
            </div>
          )}
          <div className="toolbar" style={{ gap: 8 }}>
            <button type="button" className="btn primary" onClick={salvar}>
              Salvar proposta
            </button>
            <button type="button" className="btn" onClick={copiar} disabled={!sel.length}>
              Copiar a lista pra enviar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Resultado: o afiliado tem que dar lucro. Fonte hoje: vendas via afiliado registradas
// (afiliado_registros); quando chegar o 1º arquivo da Shopee com venda de afiliado, entra ele.
function ResultadoAfiliados({ registros, mapaAf, hoje }) {
  const lucroPorVenda = (r) => {
    const l = mapaAf?.get(`${r.item_tipo}|${r.item_id}|${r.canal_id}`);
    return l?.lucro ?? 0;
  };
  const res = resultadoAfiliados(registros, { hoje, lucroPorVenda });
  return (
    <div className="panel">
      <h3 className="section-title">
        <span>Resultado — o afiliado tem que dar lucro</span>
        <span className="h3-contagem">últimos 30 dias</span>
      </h3>
      {!res.temDados ? (
        <div className="alerta alerta-neutro">
          <b>Aguardando a 1ª venda por afiliado.</b> Quando sair, exporte da Shopee a Minha Renda / o extrato do saldo (a comissão aparece descontada no pedido) e me mande o arquivo — aí o app passa a ler sozinho em Atualizar dados.
        </div>
      ) : (
        <Kpis
          itens={[
            { label: "Vendas via afiliado", valor: String(res.vendas) },
            { label: "Comissão paga", valor: BRL(res.comissao) },
            { label: "Lucro depois da comissão", valor: BRL(res.depois), tom: res.depois < 0 ? "bad" : undefined, sub: "venda nova — sem afiliado não existia" },
            { label: "Veredito", valor: res.veredito === "prejuizo" ? "! prejuízo" : "✓ valeu", tom: res.veredito === "prejuizo" ? "bad" : "good", sub: res.veredito === "prejuizo" ? "baixe a comissão ou desligue" : "" },
          ]}
        />
      )}
    </div>
  );
}

