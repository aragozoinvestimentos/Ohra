import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { usePreferencia } from "../hooks/usePreferencia.js";
import { cuponsAtivos } from "../lib/cupomLoja.js";
import { padraoDoCanal } from "../lib/afiliados.js";
import { FRACAO_AFILIADO, PCT_MAX_SIM, linhasDaLoja, maisVendidos, resultadoAfiliados, resumoProposta, simularComissaoLoja, sugestaoComissaoLoja, vendasPorItemCanal } from "../lib/comissaoLoja.js";
import { BRL } from "../lib/format.js";
import { canalDireto } from "../lib/canais.js";
import Kpis from "./Kpis.jsx";
import Ajuda from "./Ajuda.jsx";
import Estado from "./Estado.jsx";

// Vender mais → Afiliados → Comissão da loja (29/10/2026, aprovado pela prévia): UM % pra loja
// inteira (o que se põe na Shopee em "afiliados do vendedor"), a sugestão pela regra "o afiliado
// fica com no máximo metade do lucro" (preço de agora + pior caso com o cupom ativo), o
// simulador, a proposta pra um afiliado específico e o resultado. Conta ÚNICA em lib/comissaoLoja.js.
const pctTxt = (p) => `${Math.round(p * 100)}%`;
const SIT = {
  ok: [null, "✓ ok"],
  "menos-metade": ["info", "fica com menos da metade"],
  abaixo: ["atencao", "abaixo do mínimo"],
  prejuizo: ["resolver", "prejuízo"],
};

export default function ComissaoLoja({ dados, linhasAf, config, pedidos, registros, mapaAf, lojaId, hoje, onToast }) {
  const canais = useMemo(() => (dados.canais || []).filter((c) => !canalDireto(c)), [dados.canais]);
  const [canalId, setCanalId] = useState(() => (canais.find((c) => c.tipo === "shopee") || canais[0])?.id || "");
  const canal = canais.find((c) => c.id === canalId) || null;
  const vendas = useMemo(() => vendasPorItemCanal(pedidos, hoje), [pedidos, hoje]);
  const faixas = useMemo(() => cuponsAtivos(dados.cfgLoja, canalId), [dados.cfgLoja, canalId]);
  const linhas = useMemo(() => linhasDaLoja({ linhasAf, canalId, faixasCupom: faixas, vendas }), [linhasAf, canalId, faixas, vendas]);
  const top = useMemo(() => maisVendidos(linhas), [linhas]);
  const sug = useMemo(() => sugestaoComissaoLoja(linhas), [linhas]);
  const padrao = padraoDoCanal(config, canalId);
  const naShopee = padrao?.ativo !== false && padrao?.comissao ? padrao.comissao : null;
  const [pct, setPct] = useState(() => Math.round((naShopee || 0.11) * 100));
  const sim = useMemo(() => simularComissaoLoja(linhas, pct / 100), [linhas, pct]);
  const [registrar, setRegistrar] = useState(false);

  async function salvarNaShopee(valor) {
    if (!canal) return;
    const campos = { ativo: valor != null, comissao: valor, atualizado_em: new Date().toISOString() };
    const { error } = padrao.row
      ? await supabase.from("afiliado_config").update(campos).eq("id", padrao.row.id)
      : await supabase.from("afiliado_config").insert({ ...campos, loja_id: lojaId || null, canal_id: canal.id, item_tipo: null, item_id: null });
    if (error) return onToast?.(`Não foi possível salvar: ${error.message}`);
    setRegistrar(false);
    onToast?.(valor != null ? `${canal.nome}: comissão da loja ${pctTxt(valor)} registrada (ponha o mesmo % no painel da Shopee)` : `${canal.nome}: comissão da loja desligada`);
  }

  if (!canal) return <div className="panel"><div className="empty">Nenhum marketplace cadastrado.</div></div>;

  return (
    <>
      <div className="panel">
        <h3 className="section-title">
          <span>
            Comissão da loja
            <Ajuda texto={`É o % que você põe na Shopee em "afiliados do vendedor": vale pra qualquer produto da loja. Regra: o afiliado fica com no máximo metade do lucro da venda (${pctTxt(FRACAO_AFILIADO)}), pelo PREÇO DE AGORA (o degrau da rampa) e no pior caso com o seu cupom ativo. A comissão é calculada sobre o que o cliente paga pelo produto, sem frete e sem o cupom; a taxa da Shopee continua por cima. Sugerida = os produtos que somam 80% das vendas (90 dias) ficam com pelo menos metade do lucro. Teto = acima disso algum deles fica abaixo do seu lucro mínimo.`} />
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
            { label: "Comissão sugerida", valor: sug.sugerida ? `${sug.sugerida}%` : "—", sub: !sug.sugerida ? "sem lucro pra dividir nos que mais vendem" : linhas.some((l) => l.vendas > 0) ? "os que mais vendem (90 dias) ficam com ≥ metade do lucro" : "sem vendas importadas: todos os produtos contam" },
            { label: "Teto", valor: sug.teto ? `${sug.teto}%` : "—", sub: "acima disso algum dos que mais vendem fica abaixo do lucro mínimo" },
            {
              label: `Na ${canal.nome} hoje`,
              valor: naShopee ? pctTxt(naShopee) : "—",
              sub: naShopee ? (sug.sugerida && naShopee * 100 > sug.teto ? "⚠ acima do teto" : sug.sugerida && naShopee * 100 > sug.sugerida ? "acima da sugerida" : "dentro da sugerida") : "ainda não registrada",
              tom: naShopee && sug.teto && naShopee * 100 > sug.teto ? "warn" : undefined,
            },
          ]}
        />
        <div className="toolbar" style={{ gap: 8 }}>
          {registrar ? (
            <>
              <span>Registrar a comissão que está na {canal.nome}:</span>
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
            <b>{sim.ok}</b> ok · <b>{sim.menosMetade}</b> com menos da metade · <b>{sim.abaixo}</b> abaixo do mínimo · <b>{sim.prejuizo}</b> no prejuízo ·{" "}
            {!sug.sugerida ? "" : pct <= sug.sugerida ? "✓ dentro da sugerida" : pct <= sug.teto ? "acima da sugerida, abaixo do teto" : "⚠ acima do teto"}
          </span>
        </div>
        {!linhas.length ? (
          <div className="empty">Nenhum produto com preço salvo na {canal.nome}.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="num">Preço agora</th>
                  <th className="num">Vendas 90d</th>
                  <th className="num">Lucro sem afiliado</th>
                  <th className="num">Comissão</th>
                  <th className="num">Lucro com afiliado</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {sim.linhas.map((l) => {
                  const [tipo, rot] = SIT[l.situacao];
                  return (
                    <tr key={l.chave}>
                      <td>
                        <b>{l.item.nome}</b>
                        {l.emRampa && <Estado tipo="decisao">em rampa</Estado>}
                        {top.has(l.chave) && l.vendas > 0 && <span className="muted-cel"> · mais vende</span>}
                        {l.cupom > 0 && <div className="sub-linha">com o cupom: −{BRL(l.cupom)}</div>}
                      </td>
                      <td className="num">{BRL(l.preco)}</td>
                      <td className="num">{l.vendas || "—"}</td>
                      <td className="num">{BRL(l.lucro)}</td>
                      <td className="num">{BRL(l.comissao)}</td>
                      <td className={`num${l.lucroCom < 0 ? " neg" : ""}`}>{BRL(l.lucroCom)}</td>
                      <td>{tipo ? <Estado tipo={tipo}>{rot}</Estado> : <span className="muted-cel">{rot}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint" style={{ marginBottom: 0 }}>
          Lista informativa: a comissão vale pra loja toda, então não há o que resolver produto por produto — se os vermelhos crescerem, baixe o %. O marketplace desconta a comissão do repasse: não lance no Fluxo de Caixa.
        </p>
      </div>
      <PropostaAfiliado linhas={linhas} canal={canal} lojaId={lojaId} hoje={hoje} onToast={onToast} />
      <ResultadoAfiliados registros={registros} mapaAf={mapaAf} hoje={hoje} />
    </>
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
          <Ajuda texto="Pra quando você convidar alguém com um % só pra ele (campanha direcionada / amostra): escolha os produtos e o %, veja o lucro de cada um antes de enviar. Salvar cria o parceiro (convidado) e guarda a proposta." />
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
                  <th>Produto</th>
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

