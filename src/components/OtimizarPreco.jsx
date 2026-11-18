// Preço dinâmico → Otimizar preço (18/11/2026, aprovado pela prévia). Cartão do
// anúncio (O que fazer agora, mapa preço × Ads, medição, régua, histórico) e as
// janelas Ligar / Desligar. Contas em lib/otimizarPreco.js; gravações em
// lib/otimizarAcoes.js. A linha `b` é a do Ads (useCrescimento().linhasAds).
import { useState } from "react";
import Portal from "./Portal.jsx";
import Estado from "./Estado.jsx";
import { useLoja } from "../lib/LojaContext.jsx";
import { hojeISO } from "../lib/fluxoCaixa.js";
import { precoTxt, REGUA_OTIMIZAR, linhaDaRegua, REGRAS_OTIMIZAR, previaDoPasso } from "../lib/otimizarPreco.js";
import { anuncioDaRampa, anuncioDaRampaKit } from "../lib/rampaAnuncio.js";
import { precosDoDegrau } from "../lib/grupoRampa.js";
import PromoAviso from "./PromoAviso.jsx";
import { ligarOtimizar, passoOtimizar, manterOtimizar, desligarOtimizar, atualizarSalvoOtimizar } from "../lib/otimizarAcoes.js";
import { valoresAtuais } from "../lib/ads.js";
import { useEscada } from "../hooks/useEscada.js";

const BRL = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const dm = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : "");
const n1 = (v) => (v == null ? "—" : (Math.round(v * 10) / 10).toFixed(1).replace(".", ","));
const pct = (r) => (r == null ? "—" : `${Math.round(r * 100)}%`);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function acaoTexto(e) {
  if (!e) return null;
  if (e.acao === "subir" || e.acao === "confirmar") return `↑ Subir pra ${precoTxt(e.novo, e.grupo)}`;
  if (e.acao === "voltar") return `↓ Voltar pra ${precoTxt(e.novo, e.grupo)}`;
  return null;
}

/** Hook das ações (grava e avisa). */
function useAcoesOtimizar(b, onToast) {
  const { lojaId } = useLoja();
  const { precos } = useEscada();
  const [salvando, setSalvando] = useState(false);
  const hoje = hojeISO();
  const r = b?.otimizar?.rampaLinha?.r || null;
  const grupo = b?.tipo === "grupo";
  const nome = b?.item?.nome || "Anúncio";
  const rodar = async (fn, ok) => {
    setSalvando(true);
    const res = await fn();
    setSalvando(false);
    if (!res?.ok) return onToast?.(res?.msg || "Não foi possível salvar"), false;
    if (ok) onToast?.(ok);
    return true;
  };
  return {
    salvando,
    subir: (e, confirmar = false) => rodar(() => passoOtimizar({ lojaId, r, tipo: "subir", novo: e.novo, passo: e.passo, hoje, grupo, confirmar }), `${nome}: agora ${precoTxt(e.novo, grupo)} — troque só a promo na plataforma (Anunciar mostra o ↻)`),
    voltar: (novo) => rodar(() => passoOtimizar({ lojaId, r, tipo: "voltar", novo, hoje, grupo }), `${nome}: de volta a ${precoTxt(novo, grupo)} — ele vira o preço bom por ${REGRAS_OTIMIZAR.bloqueioDias} dias`),
    manter: () => rodar(() => manterOtimizar({ r, hoje }), `${nome}: preço mantido — o app volta a analisar em ${REGRAS_OTIMIZAR.bloqueioDias} dias`),
    desligar: (modo, preco) => rodar(() => desligarOtimizar({ lojaId, r, modo, preco, hoje, grupo }), `${nome}: Otimizar preço desligado`),
    ligar: (subir) => rodar(() => ligarOtimizar({ lojaId, b, hoje, vendasIniciais: b?.otimizar?.inicial?.()?.v14 || 0, subir }), subir ? `${nome}: Otimizar ligado e preço em ${precoTxt(subir.novo, grupo)} — troque só a promo na plataforma` : `${nome}: Otimizar preço ligado — o app avisa quando der pra subir`),
    atualizarSalvo: () => {
      const salvo = precos.find((p) => p.item_tipo === b.tipo && p.item_id === b.id && p.canal_id === b.canal.id);
      const preco = b.otimizar.atual;
      return rodar(() => atualizarSalvoOtimizar({ salvo, preco, custo: num(b.item.custoTotal), lucro: b.lucroEm?.(preco) ?? null }), `Preço salvo de ${nome} agora é ${BRL(preco)} (o novo alvo)`);
    },
  };
}

/** Cartão do Otimizar preço num anúncio. */
export function OtimizarCartao({ b, onToast }) {
  const ac = useAcoesOtimizar(b, onToast);
  const [ligarAberto, setLigarAberto] = useState(false);
  const [desligarAberto, setDesligarAberto] = useState(false);
  const [confirma, setConfirma] = useState(null); // { tipo, e }
  if (!b?.otimizar) return null;
  const op = b.otimizar;
  const e = op.estado;
  const grupo = op.grupo;
  const pt = (v) => precoTxt(v, grupo);

  if (!op.ot?.ligado)
    return (
      <div className="otim-cartao otim-desligado">
        <div className="otim-topo">
          <div>
            <div className="otim-rot">Otimizar preço</div>
            <div className="otim-tit">{op.ot?.desligadoEm ? `Desligado em ${dm(op.ot.desligadoEm)}` : "Desligado"}</div>
            <div className="otim-txt">Liga e o app passa a olhar o lucro do dia: sobe o preço aos poucos (só pela promo) enquanto o resultado deixa, e volta quando cai. Sem teto.</div>
          </div>
          {op.semRampaNoCanal ? (
            <span className="otim-txt">Este canal não usa Preço dinâmico (Configuração → Canais → Rampa).</span>
          ) : (
            <button className="btn primary" onClick={() => setLigarAberto(true)}>Ligar Otimizar preço</button>
          )}
        </div>
        {ligarAberto && <LigarOtimizarDialog b={b} salvando={ac.salvando} onCancelar={() => setLigarAberto(false)} onLigar={async (subir) => (await ac.ligar(subir)) && setLigarAberto(false)} />}
      </div>
    );

  const med = e?.med;
  const aqui = linhaDaRegua(e);
  const ativoAds = b.av?.ativo || null;
  const va = ativoAds ? valoresAtuais(ativoAds) : null;
  const adsEspera = e?.chave === "medindo" || e?.chave === "confirmar";
  const passos = op.ot.passos || [];
  const btn = acaoTexto(e);
  const podeSalvar = !grupo && e?.chave === "parado" && Math.abs(num(op.atual) - num(op.alvo)) > 0.004;

  return (
    <div className="otim-cartao">
      <div className={`otim-agora st-borda-${e?.tipo || "info"}`}>
        <div className="otim-rot">Otimizar preço · O que fazer agora</div>
        <div className="otim-tit">{e?.titulo || "Otimizar preço ligado"}</div>
        {e?.texto && <div className="otim-txt">{e.texto}</div>}
        <div className="otim-botoes">
          {btn && (
            <button className={`btn ${e.acao === "voltar" ? "" : "primary"}`} disabled={ac.salvando} onClick={() => setConfirma({ tipo: e.acao, e })}>
              {btn}
            </button>
          )}
          {(e?.acao === "manter" || e?.chave === "confirmar") && (
            <button className="btn" disabled={ac.salvando} onClick={() => ac.manter()}>
              {e?.chave === "confirmar" ? "Parar aqui" : `✓ Manter ${pt(op.atual)}`}
            </button>
          )}
          {e?.novoVoltar > 0 && (
            <button className="btn" disabled={ac.salvando} onClick={() => setConfirma({ tipo: "voltar", e: { ...e, novo: e.novoVoltar } })}>
              ↓ Voltar pra {pt(e.novoVoltar)}
            </button>
          )}
          {podeSalvar && (
            <button className="btn" disabled={ac.salvando} onClick={() => setConfirma({ tipo: "salvo", e })}>
              Atualizar o preço salvo pra {BRL(op.atual)}
            </button>
          )}
          <button className="btn otim-desligar" onClick={() => setDesligarAberto(true)}>Desligar</button>
        </div>
        {(e?.acao === "subir" || e?.acao === "voltar" || e?.acao === "confirmar") && <div className="otim-txt otim-faint">Depois: troque só a promo na plataforma (o preço cheio fica fixo — Anunciar mostra o ↻) e não mexa no Ads até a próxima decisão. Melhor mudar à noite.</div>}
      </div>

      <div className="otim-dois">
        <div>
          <div className="otim-sub">Mapa da estratégia</div>
          <div className="table-wrap">
            <table className="otim-tab">
              <thead>
                <tr><th></th><th>Preço</th><th>Ads</th></tr>
              </thead>
              <tbody>
                <tr><td className="otim-faint">Fase</td><td>Otimizar · degrau {e?.degrau ?? 0}</td><td>{ativoAds ? (va?.automatico ? `Lance automático · ${BRL(va?.orcamento)}/dia` : `Meta ${n1(va?.meta)} · ${BRL(va?.orcamento)}/dia`) : "desligado"}</td></tr>
                <tr><td className="otim-faint">Agora</td><td>{pt(op.atual)}{e?.acumulado > 0.0005 ? <small> +{Math.round(e.acumulado * 100)}% desde que ligou</small> : null}</td><td>{ativoAds ? "ligado" : "—"}</td></tr>
                <tr><td className="otim-faint">Medindo</td><td>{med?.depois ? `dia ${med.dias} · ${med.vendas} vendas` : e?.chave === "medindo" ? "começa amanhã" : "—"}</td><td>{b.av?.titulo && ativoAds ? <small>{b.av.titulo}</small> : "—"}</td></tr>
                <tr><td className="otim-faint">Próxima decisão</td><td>{e?.decideEm ? dm(e.decideEm) : e?.acao ? "agora" : "—"}</td><td>{ativoAds ? (adsEspera ? <Estado tipo="info">esperando o preço</Estado> : b.av?.decideEm ? dm(b.av.decideEm) : "—") : "—"}</td></tr>
                <tr><td className="otim-faint">Até o preço cheio</td><td>{op.espacoRiscado != null ? `+${Math.round(op.espacoRiscado * 100)}%` : "—"}</td><td>—</td></tr>
              </tbody>
            </table>
          </div>
          <div className="otim-txt otim-faint">Uma mudança por vez: o preço espera 7 dias depois de mudar o Ads, e o Ads espera a decisão do preço. Emergência (prejuízo) passa na frente.</div>
        </div>
        <div>
          <div className="otim-sub">A régua</div>
          <div className="table-wrap">
            <table className="otim-tab">
              <thead>
                <tr><th>Lucro do dia no degrau novo</th><th>O app sugere</th><th>Decide com</th></tr>
              </thead>
              <tbody>
                {REGUA_OTIMIZAR.map((l) => (
                  <tr key={l.k} className={aqui === l.k ? "otim-aqui" : ""}>
                    <td>{l.quando}{aqui === l.k && <b> ● você está aqui</b>}</td>
                    <td><Estado tipo={l.tipo}>{l.faz}</Estado></td>
                    <td className="otim-faint">{l.decide}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {med?.depois && (
        <div>
          <div className="otim-sub">Medição: {pt(med.de)} → {pt(med.para)} <span className="otim-faint">· antes {dm(med.antesDe)}–{dm(med.antesAte)} · depois desde {dm(med.depoisDe)} (o dia da mudança fica fora)</span></div>
          <div className="otim-kv">
            <div><span>Vendas/dia</span><b>{n1(med.depois.vendasDia)}</b><small>antes {n1(med.antes.vendasDia)}</small></div>
            <div><span>Lucro por venda</span><b>{BRL(med.depois.lucroVenda)}</b><small>antes {BRL(med.antes.lucroVenda)}</small></div>
            <div><span>Sobrou/dia (depois do Ads)</span><b>{BRL(med.depois.sobrouDia)}</b><small>antes {BRL(med.antes.sobrouDia)} · {pct(med.razao)}</small></div>
            <div><span>Ads/dia</span><b>{BRL(med.depois.adsDia)}</b><small>antes {BRL(med.antes.adsDia)}{med.depois.adsDesconhecido ? " · falta CSV" : ""}</small></div>
          </div>
          <div className="otim-amostra">
            <span>Amostra: <b>{med.vendas} vendas</b> · dia {med.dias}</span>
            <span className="otim-faint">decide com {REGRAS_OTIMIZAR.leituraDias} dias e {REGRAS_OTIMIZAR.minVendas} vendas{e?.meio ? ` · no meio, até ${REGRAS_OTIMIZAR.meioDias} dias ou ${REGRAS_OTIMIZAR.meioVendas} vendas` : ""}</span>
          </div>
          <div className="otim-barra"><i style={{ width: `${Math.min(100, Math.round((Math.min(med.dias / REGRAS_OTIMIZAR.leituraDias, med.vendas / REGRAS_OTIMIZAR.minVendas)) * 100))}%` }} /></div>
          {med.fator != null && <div className="otim-txt otim-faint">Temporada: os outros produtos de época da loja venderam {pct(med.fator)} do que vendiam antes — o resultado acima já está corrigido por isso (sem a correção: {pct(med.razaoBruta)}).</div>}
        </div>
      )}

      {passos.length > 0 && (
        <div>
          <div className="otim-sub">Histórico</div>
          <div className="table-wrap">
            <table className="otim-tab">
              <thead><tr><th>Quando</th><th>Mudança</th></tr></thead>
              <tbody>
                <tr><td>{dm(op.ot.desde)}</td><td>Ligado em {pt(op.ot.base)}</td></tr>
                {passos.map((p, k) => (
                  <tr key={k}><td>{dm(p.data)}</td><td>{p.tipo === "subir" ? `↑ ${pt(p.de)} → ${pt(p.para)}` : p.tipo === "voltar" ? `↓ voltou pra ${pt(p.para)} (preço bom)` : `✓ manteve ${pt(p.de)}`}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {confirma && (
        <ConfirmaOtim
          confirma={confirma}
          grupo={grupo}
          b={b}
          salvando={ac.salvando}
          onCancelar={() => setConfirma(null)}
          onOk={async () => {
            const { tipo, e: ee } = confirma;
            const ok = tipo === "salvo" ? await ac.atualizarSalvo() : tipo === "voltar" ? await ac.voltar(ee.novo) : await ac.subir(ee, tipo === "confirmar");
            if (ok) setConfirma(null);
          }}
        />
      )}
      {desligarAberto && <DesligarOtimizarDialog b={b} salvando={ac.salvando} onCancelar={() => setDesligarAberto(false)} onDesligar={async (modo, preco) => (await ac.desligar(modo, preco)) && setDesligarAberto(false)} />}
    </div>
  );
}

function ConfirmaOtim({ confirma, grupo, b, salvando, onCancelar, onOk }) {
  const { tipo, e } = confirma;
  const op = b.otimizar;
  const pt = (v) => precoTxt(v, grupo);
  const titulo = tipo === "salvo" ? `Atualizar o preço salvo pra ${BRL(op.atual)}?` : tipo === "voltar" ? `Voltar pra ${pt(e.novo)}?` : `Subir pra ${pt(e.novo)}?`;
  const lucroNovo = !grupo && b.lucroEm ? b.lucroEm(e?.novo) : null;
  return (
    <Portal>
      <div className="modal-overlay" onClick={onCancelar}>
        <div className="modal-box modal-box-larga" onClick={(x) => x.stopPropagation()} role="dialog" aria-modal="true">
          <h3>{titulo}</h3>
          <p className="modal-msg">
            {tipo === "salvo"
              ? "O preço bom que o Otimizar achou passa a ser o alvo: kits, escada, Ads e o resto do app passam a usar esse preço. O riscado do anúncio não muda."
              : tipo === "voltar"
                ? `O preço de agora (${pt(op.atual)}) volta pra ${pt(e.novo)}, que vira o preço bom. O app não sugere subir de novo por ${REGRAS_OTIMIZAR.bloqueioDias} dias.`
                : `${pt(op.atual)} → ${pt(e.novo)}${lucroNovo != null ? ` · lucro por venda ${BRL(b.lucroEm(op.atual))} → ${BRL(lucroNovo)}` : ""}. A medição começa amanhã e decide com ${REGRAS_OTIMIZAR.leituraDias} dias e ${REGRAS_OTIMIZAR.minVendas} vendas pagas.`}
          </p>
          {tipo !== "salvo" && e?.novo > 0 && <PreviaPasso b={b} de={op.atual} para={e.novo} />}
          {tipo !== "salvo" && <p className="modal-msg">Na plataforma: troque só a promo (o preço cheio fica fixo). A Anunciar mostra o ↻ com a promo nova{grupo ? " em cada opção do anúncio" : ""}.</p>}
          {tipo === "confirmar" && <p className="modal-msg">Você já subiu {Math.round((e.acumulado || 0) * 100)}% desde que ligou. Confirmando, o app só pede de novo a cada +{Math.round(REGRAS_OTIMIZAR.confirmarCada * 100)}%.</p>}
          <div className="modal-actions">
            <button className="btn" onClick={onCancelar}>Cancelar</button>
            <button className="btn primary" disabled={salvando} onClick={onOk}>{salvando ? "Salvando…" : tipo === "salvo" ? "Atualizar o preço salvo" : tipo === "voltar" ? "Voltar" : "Subir"}</button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

/** Linhas do "O que digitar" do anúncio num preço (produto/kit em R$, grupo em %). */
function linhasNoPreco(b, preco, esc) {
  const op = b.otimizar;
  const { itens, produtos, kits, precos, concorrentes, cfgDoProduto, publicacoesCanal, anunciadoNoCanal } = esc;
  if (!(num(preco) > 0)) return [];
  if (b.tipo === "grupo") {
    return precosDoDegrau({ ops: b.ops || [], pct: preco, canal: b.canal, itens, produtos, kits, publicacoes: publicacoesCanal }).map((l) => ({
      itemId: `${l.idx}|${l.itemId}`,
      nome: l.rotulo || l.item?.nome,
      real: l.real,
      original: l.an?.original,
      promo: l.an?.promo,
      clientePaga: l.an?.clientePaga,
      riscadoFixo: !!l.fixo,
      acimaDoRiscado: !!l.an?.acimaDoRiscado,
      lucro: l.lucro,
    }));
  }
  if (b.tipo === "kit") {
    const kitItem = itens.find((i) => i.id === `k:${b.id}`);
    if (!kitItem) return [];
    return anuncioDaRampaKit({ kitItem, canal: b.canal, preco, alvo: op.alvo, cfg: cfgDoProduto(null), itens, produtos, kits, publicacoes: publicacoesCanal }).linhas;
  }
  const res = anuncioDaRampa({ produtoId: b.id, canal: b.canal, preco, alvo: op.alvo, cfg: cfgDoProduto(b.id), itens, produtos, kits, precos, precosRampa: precos, concorrentes, cfgDoProduto, publicacoes: publicacoesCanal });
  // Só o anúncio do avulso: ele e as variações anunciadas neste canal (kit de produtos diferentes é outro anúncio).
  return res.linhas.filter((l) => l.id === "avulso" || (l.itemId?.startsWith("v:") && anunciadoNoCanal(itens.find((i) => i.id === l.itemId), b.canal)));
}

/** "De quanto pra quanto" em cada item do anúncio num passo do Otimizar. */
export function PreviaPasso({ b, de, para }) {
  const esc = useEscada();
  const linhas = previaDoPasso(linhasNoPreco(b, de, esc), linhasNoPreco(b, para, esc));
  if (!linhas.length) return null;
  const sobe = num(para) > num(de);
  const soma = (k) => linhas.reduce((t, l) => t + num(l[k]), 0);
  return (
    <div className="otim-previa">
      <div className="otim-sub">Em cada item do anúncio ({b.canal?.nome})</div>
      <div className="table-wrap">
        <table className="otim-tab">
          <thead>
            <tr><th>Item</th><th>Preço</th><th>Na plataforma</th><th>Cliente paga</th><th>Lucro por venda</th></tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.itemId}>
                <td>{l.nome}</td>
                <td>{BRL(l.de)} → <b>{BRL(l.para)}</b>{l.pct != null && <small>{l.pct >= 0 ? "+" : ""}{(Math.round(l.pct * 1000) / 10).toFixed(1).replace(".", ",")}%</small>}</td>
                <td>
                  {l.promoDe === l.promoPara ? `promo ${l.promoPara ?? 0}%` : <>promo {l.promoDe ?? 0}% → <b>{l.promoPara ?? 0}%</b></>} <PromoAviso canal={b.canal} promo={l.promoPara} />
                  <small>preço cheio {BRL(l.original)}{l.fixo ? " (fixo)" : ""}</small>
                  {l.acimaDoRiscado && <small className="otim-ruim">passa do preço cheio — precisaria subir o riscado</small>}
                </td>
                <td>{BRL(l.pagaDe)} → {BRL(l.pagaPara)}</td>
                <td>{BRL(l.lucroDe)} → <b>{BRL(l.lucroPara)}</b>{l.lucroDe != null && l.lucroPara != null && <small>{l.lucroPara - l.lucroDe >= 0 ? "+" : ""}{BRL(l.lucroPara - l.lucroDe)}</small>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="otim-faint otim-nota">
        {sobe ? "Na plataforma só a promo muda; o preço cheio fica igual." : "Na plataforma só a promo aumenta; o preço cheio fica igual."}
        {linhas.length > 1 && soma("lucroDe") > 0 ? ` Vendendo 1 de cada: lucro ${BRL(soma("lucroDe"))} → ${BRL(soma("lucroPara"))}.` : ""}
      </div>
    </div>
  );
}

/** Janela de ligar com as ações (usada pelo "+ Otimizar preço" e pelo Painel do anúncio). */
export function LigarOtimizar({ b, onToast, onFechar }) {
  const ac = useAcoesOtimizar(b, onToast);
  return <LigarOtimizarDialog b={b} salvando={ac.salvando} onCancelar={onFechar} onLigar={async (subir) => (await ac.ligar(subir)) && onFechar()} />;
}

/** Ligar: lê o histórico e já dá a decisão de hoje. Só oferece "Ligar e subir" quando enquadra. */
export function LigarOtimizarDialog({ b, salvando, onCancelar, onLigar }) {
  const op = b.otimizar;
  const ini = op.inicial();
  const grupo = op.grupo;
  const pt = (v) => precoTxt(v, grupo);
  const abaixo = num(op.atual) < num(op.alvo) - 0.004;
  const lucroAgora = !grupo && b.lucroEm ? b.lucroEm(op.atual) : null;
  const lucroNovo = !grupo && b.lucroEm && ini.novo ? b.lucroEm(ini.novo) : null;
  const podePerder = lucroAgora > 0 && lucroNovo > lucroAgora ? 1 - lucroAgora / lucroNovo : null;
  const pode = ini.pode && !abaixo;
  return (
    <Portal>
      <div className="modal-overlay" onClick={onCancelar}>
        <div className="modal-box modal-box-larga modal-box-md" onClick={(x) => x.stopPropagation()} role="dialog" aria-modal="true">
          <h3>Ligar Otimizar preço — {b.item?.nome} · {b.canal?.nome}</h3>
          {abaixo ? (
            <div className="otim-agora st-borda-info">
              <div className="otim-tit">Começa quando chegar no alvo</div>
              <div className="otim-txt">Agora {pt(op.atual)}, alvo {pt(op.alvo)}. A rampa continua até o alvo; daí em diante o Otimizar decide pelo lucro do dia.</div>
            </div>
          ) : pode ? (
            <div className="otim-agora st-borda-oportunidade">
              <div className="otim-tit">↑ Dá pra subir +{Math.round(ini.passo * 100)}% agora: {pt(ini.novo)}</div>
              <div className="otim-txt">
                {ini.v14} vendas pagas em 14 dias, ritmo estável.
                {lucroAgora != null && lucroNovo != null ? ` Cada venda deixa ${BRL(lucroAgora)} → ${BRL(lucroNovo)}${podePerder != null ? `: dá pra vender até ${Math.floor(podePerder * 100)}% menos e ganhar o mesmo` : ""}.` : ""}
              </div>
            </div>
          ) : (
            <div className="otim-agora st-borda-info">
              <div className="otim-tit">{ini.bloqueio ? "Ainda não é hora de subir" : "Ainda não dá pra subir"}</div>
              <div className="otim-txt">{ini.bloqueio ? ini.bloqueio.texto : ini.motivos.filter((m) => m.bloqueia).map((m) => m.texto).join(" · ")} Ligue mesmo assim: o app avisa no Início quando enquadrar.</div>
            </div>
          )}
          {pode && <PreviaPasso b={b} de={op.atual} para={ini.novo} />}
          <div className="otim-sub">O que o app olhou (pedidos importados)</div>
          <ul className="otim-lista">
            {ini.motivos.map((m, k) => (
              <li key={k}><span className={m.info ? "otim-faint" : m.ok ? "otim-ok" : "otim-ruim"}>{m.info ? "i" : m.ok ? "✓" : "✗"}</span> {m.texto}</li>
            ))}
            {ini.hist && <li><span className="otim-faint">i</span> Últimos {ini.hist.dias} dias: {n1(ini.hist.vendasDia)} vendas/dia · sobrou {BRL(ini.hist.sobrouDia)}/dia depois do Ads</li>}
          </ul>
          <p className="modal-msg otim-faint">Subir muda o preço de agora pela rampa: na plataforma só a promo muda (o preço cheio fica fixo). A medição começa no dia seguinte.</p>
          <div className="modal-actions">
            <button className="btn" onClick={onCancelar}>Cancelar</button>
            {pode && <button className="btn" disabled={salvando} onClick={() => onLigar(null)}>Só ligar, sem subir agora</button>}
            <button className="btn primary" disabled={salvando} onClick={() => onLigar(pode ? { novo: ini.novo, passo: ini.passo } : null)}>
              {salvando ? "Salvando…" : pode ? `Ligar e subir +${Math.round(ini.passo * 100)}%` : "Ligar (acompanhar)"}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

/** Desligar: avisa em que degrau está e qual foi o melhor. */
export function DesligarOtimizarDialog({ b, salvando, onCancelar, onDesligar }) {
  const op = b.otimizar;
  const grupo = op.grupo;
  const pt = (v) => precoTxt(v, grupo);
  const ot = op.ot;
  const melhor = num(ot.precoBom) > 0 ? num(ot.precoBom) : null;
  const atual = num(op.atual);
  const alvo = num(op.alvo);
  const mudou = Math.abs(atual - alvo) > 0.004;
  return (
    <Portal>
      <div className="modal-overlay" onClick={onCancelar}>
        <div className="modal-box modal-box-larga" onClick={(x) => x.stopPropagation()} role="dialog" aria-modal="true">
          <h3>Desligar Otimizar preço?</h3>
          <p className="modal-msg">
            Agora: <b>{pt(atual)}</b>
            {op.estado?.degrau ? ` (degrau ${op.estado.degrau})` : ""}. {melhor && Math.abs(melhor - atual) > 0.004 ? <>O preço bom achado foi <b>{pt(melhor)}</b>. </> : null}
            {(ot.passos || []).length ? `${ot.passos.length} mudança${ot.passos.length === 1 ? "" : "s"} registrada${ot.passos.length === 1 ? "" : "s"}.` : "Nenhuma mudança feita ainda."}
          </p>
          <p className="modal-msg otim-faint">O histórico fica guardado. Se ligar de novo, o app continua de onde parou.</p>
          <div className="modal-actions">
            <button className="btn" onClick={onCancelar}>Cancelar</button>
            <button className="btn" disabled={salvando} onClick={() => onDesligar("ficar")}>Desligar e ficar em {pt(atual)}</button>
            {melhor && Math.abs(melhor - atual) > 0.004 && <button className="btn" disabled={salvando} onClick={() => onDesligar("melhor", melhor)}>Voltar pro melhor ({pt(melhor)})</button>}
            {mudou && <button className="btn primary" disabled={salvando} onClick={() => onDesligar("salvo", alvo)}>Voltar pro preço salvo ({pt(alvo)})</button>}
          </div>
        </div>
      </div>
    </Portal>
  );
}

/** Escolher um anúncio pra ligar (botão "+ Otimizar preço" da lista). */
export function EscolherOtimizarDialog({ linhas, onCancelar, onEscolher }) {
  const [busca, setBusca] = useState("");
  const t = busca.trim().toLowerCase();
  const lista = (linhas || []).filter((b) => b.otimizar && !b.otimizar.ot?.ligado && !b.otimizar.semRampaNoCanal && (!t || `${b.item?.nome} ${b.item?.sku || ""} ${b.canal?.nome}`.toLowerCase().includes(t)));
  return (
    <Portal>
      <div className="modal-overlay" onClick={onCancelar}>
        <div className="modal-box modal-box-larga modal-box-md" onClick={(x) => x.stopPropagation()} role="dialog" aria-modal="true">
          <h3>Otimizar preço de qual anúncio?</h3>
          <div className="field"><input type="search" placeholder="Buscar por nome ou SKU" value={busca} onChange={(x) => setBusca(x.target.value)} autoFocus /></div>
          <div className="table-wrap" style={{ maxHeight: 380, overflowY: "auto" }}>
            <table>
              <thead><tr><th>Anúncio</th><th>Canal</th><th>Vendas 14 dias</th><th></th></tr></thead>
              <tbody>
                {lista.slice(0, 60).map((b) => {
                  const v = b.otimizar.inicial().v14;
                  return (
                    <tr key={b.chave}>
                      <td>{b.item?.nome}</td>
                      <td>{b.canal?.nome}</td>
                      <td>{v}</td>
                      <td><button className="btn" onClick={() => onEscolher(b)}>Escolher</button></td>
                    </tr>
                  );
                })}
                {!lista.length && <tr><td colSpan={4} className="otim-faint">Nenhum anúncio disponível.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="modal-actions"><button className="btn" onClick={onCancelar}>Fechar</button></div>
        </div>
      </div>
    </Portal>
  );
}
