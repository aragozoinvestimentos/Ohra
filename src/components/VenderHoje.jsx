import { useMemo, useState, useSyncExternalStore } from "react";
import { useLoja } from "../lib/LojaContext.jsx";
import { assinarSede, lerSede } from "../lib/sedeDados.js";
import { chaveDoDestino } from "../lib/marcas.js";
import { produtoDoAviso } from "../lib/inicio.js";
import { adiarAviso } from "../lib/avisosAcoes.js";
import { irParaAba } from "../lib/navegar.js";
import { abrirAnuncio, abrirProduto } from "../lib/anuncios.js";
import { hojeSP } from "../lib/datas.js";
import { BRL } from "../lib/format.js";
import Kpis from "./Kpis.jsx";
import Estado from "./Estado.jsx";
import CanalTag from "./CanalTag.jsx";

// Vender mais → Hoje (28/10/2026, aprovado pela prévia): UM cartão por anúncio (item × canal)
// juntando o que a Rampa, o Ads, os Afiliados e o cupom pedem pra ele. SÓ LÊ: são os
// mesmos avisos do Início (sedeDados) com destino em Vender mais; cada botão leva pra
// mesma confirmação/tela de sempre. As sub-abas Rampa, Ads e Afiliados continuam pro detalhe.
const AREA = { rampa: "Rampa", ads: "Ads", afiliados: "Afiliados" };
const areaDe = (p) => (p.ir?.aba === "promocoes" ? "Cupom" : AREA[p.ir?.pedido?.sub || "rampa"] || "Rampa");
const ROT = { resolver: ["resolver", "! Resolver"], rotina: ["atencao", "⚠ Atenção"], oportunidade: ["oportunidade", "↑ Oportunidade"] };
const semPrefixo = (p) => {
  const t = String(p.titulo || "").replace(/^(?:Anúncio:\s)?.+?:\s/, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const textoSemCanal = (p) => {
  const t = String(p.texto || "");
  return p._canal && t.startsWith(`${p._canal} · `) ? t.slice(p._canal.length + 3) : t;
};
const abaDoAviso = (p) => (String(p.id).startsWith("ads|") ? "ads" : p.ir?.aba === "crescimento" ? "rampa" : "resumo");

export default function VenderHoje({ dados, linhas, linhasAds, onToast }) {
  const { lojaId } = useLoja();
  const sede = useSyncExternalStore(assinarSede, lerSede, lerSede);
  const [filtro, setFiltro] = useState("todos");
  const canais = useMemo(() => dados?.canais || [], [dados?.canais]);
  const nomesCanais = useMemo(() => canais.map((c) => c.nome), [canais]);
  const canalDoNome = (n) => canais.find((c) => c.nome === n) || null;
  const avisos = useMemo(() => (sede.pendencias || []).filter((p) => !p.tarefa && /^(crescimento:|promocoes)/.test(chaveDoDestino(p.ir) || "")), [sede.pendencias]);
  const itensNome = useMemo(() => {
    const m = new Map();
    for (const p of dados?.produtos || []) m.set(String(p.nome).toLowerCase(), `p:${p.id}`);
    for (const k of dados?.kits || []) m.set(String(k.nome).toLowerCase(), `k:${k.id}`);
    for (const g of dados?.gruposAnuncio || []) m.set(String(g.nome).toLowerCase(), `g:${g.id}`);
    return m;
  }, [dados?.produtos, dados?.kits, dados?.gruposAnuncio]);
  // Agrupa por anúncio (item × canal): "<Nome>: …" (como o Início) ou título que começa com
  // o nome de um item cadastrado ("Chaveiro — Kit 3 pode entrar na campanha (Shopee)").
  const { cartoes, loja } = useMemo(() => {
    const nomes = [...itensNome.keys()].sort((a, b) => b.length - a.length);
    const porChave = new Map();
    const soltos = [];
    for (const p of avisos) {
      let k = produtoDoAviso(p, nomesCanais);
      if (!k) {
        const t = String(p.titulo || "").toLowerCase();
        const nome = nomes.find((n) => t.startsWith(n) && /^($|[\s:—–(-])/.test(t.slice(n.length)));
        if (nome) {
          const mc = /\(([^)]+)\)/.exec(p.titulo || "");
          const c = mc && nomesCanais.includes(mc[1]) ? mc[1] : nomesCanais.find((n) => String(p.texto || "").startsWith(`${n} · `)) || null;
          k = { nome: (dados?.produtos || []).concat(dados?.kits || [], dados?.gruposAnuncio || []).find((x) => String(x.nome).toLowerCase() === nome)?.nome || nome, canal: c, anuncio: false };
        }
      }
      if (!k) {
        soltos.push(p);
        continue;
      }
      const chave = `${k.nome.toLowerCase()}|${k.canal || ""}`;
      let g = porChave.get(chave);
      if (!g) porChave.set(chave, (g = { id: `hoje|${chave}`, nome: k.nome, anuncio: k.anuncio, canal: k.canal, itens: [] }));
      g.itens.push({ ...p, _canal: k.canal });
    }
    const ORD = { resolver: 0, rotina: 1, oportunidade: 2 };
    const lista = [...porChave.values()].map((g) => {
      g.itens.sort((a, b) => (ORD[a.grupo] ?? 3) - (ORD[b.grupo] ?? 3));
      g.grupo = g.itens[0].grupo;
      return g;
    });
    lista.sort((a, b) => (ORD[a.grupo] ?? 3) - (ORD[b.grupo] ?? 3) || b.itens.length - a.itens.length);
    return { cartoes: lista, loja: soltos };
  }, [avisos, itensNome, nomesCanais, dados?.produtos, dados?.kits, dados?.gruposAnuncio]);
  const visiveis = cartoes.filter((g) => filtro === "todos" || (filtro === "res" ? g.grupo === "resolver" : filtro === "opo" ? g.grupo === "oportunidade" : g.grupo !== "oportunidade"));
  const nRes = cartoes.filter((g) => g.grupo === "resolver").length;
  const nOpo = cartoes.filter((g) => g.grupo === "oportunidade").length;
  const lucro7 = (linhas || []).reduce((s, l) => s + (l.est?.lucroSemanaAds ?? l.est?.lucroSemana ?? 0), 0);
  const temLucro = (linhas || []).some((l) => l.est?.lucroSemana != null);
  const T = linhasAds?.teto;
  const nAds = (linhasAds?.linhas || []).filter((l) => l.av?.ativo).length;

  async function adiar(p) {
    const { error } = await adiarAviso(lojaId, p.id, hojeSP());
    onToast?.(error ? `Não foi possível adiar: ${error.message}` : "Ok — volta em 30 dias (se ainda valer)");
  }
  const ir = (p) => (p.ir?.pedido ? irParaAba(p.ir.aba, p.ir.pedido) : irParaAba(p.ir.aba));

  const acao = (p, noCartao) => (
    <div key={p.id} className="hoje-acao">
      <span className="hoje-area">{areaDe(p)}</span>
      <span className="hoje-txt">
        <b>{noCartao ? semPrefixo(p) : p.titulo}</b> {noCartao ? textoSemCanal(p) : p.texto}
      </span>
      {p.grupo !== "resolver" && (
        <button type="button" className="link-btn" onClick={() => adiar(p)} title="Some daqui, do Início e da bolinha do menu por 30 dias e volta sozinho se ainda valer.">
          lembrar em 30 dias
        </button>
      )}
      <button type="button" className={`btn btn-mini${p.grupo !== "rotina" ? " primary" : ""}`} onClick={() => ir(p)}>
        {p.rotulo || "Abrir"}
      </button>
    </div>
  );

  return (
    <>
      <Kpis
        itens={[
          { label: "Pra fazer hoje", valor: `${cartoes.length - nOpo} ${cartoes.length - nOpo === 1 ? "anúncio" : "anúncios"}`, sub: nRes ? `${nRes} urgente${nRes > 1 ? "s" : ""}` : "nada urgente", tom: nRes ? "bad" : null },
          { label: "Oportunidades", valor: String(nOpo), sub: "subir degrau, aumentar Ads, afiliado…" },
          { label: "Lucro · últimos 7 dias", valor: temLucro ? BRL(lucro7) : "—", sub: "anúncios em rampa, depois do Ads" },
          { label: "Ads · 30 dias", valor: T ? BRL(T.gasto) : "—", sub: T ? `de ${BRL(T.teto)} do teto${nAds ? ` · ${nAds} ligado${nAds > 1 ? "s" : ""}` : ""}` : "sem Ads" },
        ]}
      />
      <div className="panel">
        <h3 className="section-title">
          <span>O que fazer hoje — um cartão por anúncio</span>
          <span className="subabas" style={{ marginBottom: 0 }}>
            {[
              ["todos", "Todos"],
              ["fazer", "Pra fazer"],
              ["res", "Urgentes"],
              ["opo", "Oportunidades"],
            ].map(([k, r]) => (
              <button key={k} type="button" className={`btn${filtro === k ? " primary" : ""}`} onClick={() => setFiltro(k)}>
                {r}
              </button>
            ))}
          </span>
        </h3>
        {!visiveis.length && !loja.length && <div className="empty">Nada pra fazer em Vender mais hoje ✓ — a Rampa, o Ads e os Afiliados seguem acompanhando.</div>}
        {visiveis.map((g) => {
          const [tipo, rot] = ROT[g.grupo] || ["info", ""];
          const itemId = itensNome.get(String(g.nome).toLowerCase()) || null;
          const canal = g.canal ? canalDoNome(g.canal) : null;
          return (
            <div key={g.id} className={`hoje-cartao st-${tipo}`}>
              <div className="hoje-cab">
                <Estado tipo={tipo}>{rot}</Estado>
                <b>{g.anuncio ? `Anúncio: ${g.nome}` : g.nome}</b>
                {canal && <CanalTag canal={canal} />}
                {g.itens.length > 1 && <span className="muted-cel">{g.itens.length} coisas</span>}
                <span className="hoje-abrir">
                  {itemId && canal ? (
                    <button type="button" className="link-btn" onClick={() => abrirAnuncio(itemId, canal.id, abaDoAviso(g.itens[0]))}>
                      Abrir no Painel do anúncio →
                    </button>
                  ) : itemId ? (
                    <button type="button" className="link-btn" onClick={() => abrirProduto(itemId)}>
                      Abrir produto →
                    </button>
                  ) : null}
                </span>
              </div>
              {g.itens.map((p) => acao(p, true))}
            </div>
          );
        })}
        {loja.length > 0 && filtro !== "opo" && (
          <div className="hoje-cartao">
            <div className="hoje-cab">
              <b>Da loja toda</b>
              <span className="muted-cel">teto de Ads, GMV Max da Loja, campanhas…</span>
            </div>
            {loja.map((p) => acao(p, false))}
          </div>
        )}
        <p className="hint" style={{ margin: "8px 0 0" }}>
          Os mesmos avisos do Início e da bolinha do menu. Anúncios sem nada pra fazer hoje seguem nas sub-abas Rampa, Ads e Afiliados.
        </p>
      </div>
    </>
  );
}
