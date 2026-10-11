import { useEffect, useState } from "react";
import { useCrescimento } from "../hooks/useCrescimento.js";
import { anuncioDoItem } from "../lib/rampaAnuncio.js";
import { descontoDoItem } from "../lib/escada.js";
import { gruposDoSeletor, itemTipoDoId } from "../lib/variacoes.js";
import { irParaAba } from "../lib/navegar.js";
import { publicarSelecao, useSelecaoPasso } from "../lib/passosPreco.js";
import { BRL } from "../lib/format.js";
import BuscaItem from "./BuscaItem.jsx";
import CanalTag from "./CanalTag.jsx";
import Ajuda from "./Ajuda.jsx";
import ProximoPasso from "./ProximoPasso.jsx";
import { IniciarRampaDialog } from "./Crescimento.jsx";

const virgula = (v) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// 4º Lançamento — SÓ CONSULTA (o único lugar que grava é o "Iniciar rampa",
// o MESMO diálogo do Crescimento). Pro produto e canal escolhidos (os da
// Ficha, ou os levados pelo "Próximo →"): vai entrar em rampa ou anunciar no
// alvo? Em rampa: degraus, o que digitar (rampaAnuncio.js) e os portões;
// subir degrau e registrar semana continuam no Crescimento.
export default function Lancamento({ onToast, onSub }) {
  const { dados, rampasH, regras, linhas } = useCrescimento();
  const { itens, canais, precos, produtos, kits, publicacoesCanal, mapaRampa, anunciadoNoCanal } = dados;
  const { porPasso, pedido } = useSelecaoPasso();
  const [sel, setSel] = useState(null); // null = segue o da Ficha
  const [canalSel, setCanalSel] = useState(null);
  const [pedidoVisto, setPedidoVisto] = useState(0);
  const [noAlvo, setNoAlvo] = useState({}); // "item|canal" → escolheu "anunciar no alvo" (só na sessão)
  const [iniciar, setIniciar] = useState(false);

  // "Próximo →" vindo de outro passo: usa o produto e o canal levados.
  if (pedido && pedido.para === "lancamento" && pedido.seq !== pedidoVisto) {
    setPedidoVisto(pedido.seq);
    if (pedido.itemId) setSel(pedido.itemId);
    if (pedido.canalId) setCanalSel(pedido.canalId);
  }
  const daFicha = porPasso.ficha || {};
  const itemId = sel ?? daFicha.itemId ?? "";
  const canal = canais.find((c) => c.id === (canalSel ?? daFicha.canalId)) || canais[0] || null;
  const item = itens.find((i) => i.id === itemId) || null;

  useEffect(() => {
    publicarSelecao("lancamento", itemId || null, canal?.id || null);
  }, [itemId, canal?.id]);

  const tipo = item ? itemTipoDoId(item.id) : null;
  const produtoId = !item ? null : tipo === "produto" ? item.id.slice(2) : tipo === "variacao" ? item.produtoId : null;
  const salvo = item && canal ? precos.find((p) => p.item_tipo === tipo && p.item_id === item.id.slice(2) && p.canal_id === canal.id) || null : null;
  const alvo = salvo ? Number(salvo.preco) : null;
  const rampaDoProduto = produtoId && canal ? linhas.find((l) => l.r.produto_id === produtoId && l.r.canal_id === canal.id) || null : null;
  const pecasEmRampa =
    tipo === "kit" && canal ? (item.componentes || []).map((c) => linhas.find((l) => l.r.produto_id === c.produtoId && l.r.canal_id === canal.id)).filter(Boolean) : [];
  const publicado = item && canal ? publicacoesCanal.find((x) => x.item_tipo === tipo && x.item_id === item.id.slice(2) && x.canal_id === canal.id) || null : null;
  const anunciada = item && canal ? anunciadoNoCanal(item, canal) : true;
  const chave = item && canal ? `${item.id}|${canal.id}` : "";

  // O que digitar: em rampa (ou derivado dela) = mapaRampa; senão o anúncio no alvo.
  const ra = item && canal ? mapaRampa.get(`${item.id}|${canal.id}`) || null : null;
  const desconto = item && canal ? descontoDoItem(item.id, canal, { itens, produtos, kits }).desconto : 0;
  const anAlvo = item && canal && alvo ? anuncioDoItem({ itemId: item.id, canal, real: alvo, desconto, publicacoes: publicacoesCanal }) : null;
  const an = ra || anAlvo;

  const emRampa = !!rampaDoProduto;
  const derivado = (tipo === "variacao" && emRampa) || pecasEmRampa.length > 0;
  const estado = !item || !canal ? "vazio" : !alvo ? "sem-preco" : emRampa || derivado ? "rampa" : publicado || noAlvo[chave] ? "alvo" : tipo === "produto" ? "pergunta" : "alvo";

  const quadroAnuncio = ({ titulo, a, nota }) =>
    a ? (
      <div className="lanc-anuncio">
        <div className="legenda-tit">{titulo}</div>
        <div className="detalhe-cel-grade">
          <div className="kv-cel">
            <small>Preço de cadastro</small>
            <b>{BRL(a.original)}</b>
            <span>{a.riscadoFixo ? "já anunciado (fixo)" : "riscado a cadastrar"}</span>
          </div>
          <div className="kv-cel">
            <small>Promo</small>
            <b>{a.promo}%</b>
            <span>{ra ? "a do degrau de agora" : "no alvo"}</span>
          </div>
          <div className="kv-cel">
            <small>Cliente paga</small>
            <b>{BRL(a.clientePaga)}</b>
            <span>{ra ? "preço de agora (Rampa)" : "preço salvo (alvo)"}</span>
          </div>
        </div>
        {a.acimaDoRiscado && <div className="aviso-cel ruim">Precisaria subir o preço original — pode ser visto como manipulação; considere manter.</div>}
        {nota && <div className="hint" style={{ margin: "6px 0 0" }}>{nota}</div>}
      </div>
    ) : null;

  const est = rampaDoProduto?.est;

  return (
    <>
      <div className="aviso-fluxo">
        Use o produto e o canal da <b>Ficha</b> (ou troque aqui). Daqui só se decide <b>se o produto entra em rampa</b> neste canal — subir degrau e registrar a
        semana continuam no <b>Crescimento</b>; o que digitar fica fixo na <b>Anunciar</b>.
      </div>
      <div className="panel">
        <h3 className="section-title">
          <span>
            4º Lançamento
            <Ajuda texto="Vai entrar em rampa? Sim = abre o mesmo “Iniciar rampa” do Crescimento, já com o produto e o canal. Não = anuncia direto no alvo (o preço salvo); dá pra iniciar a rampa depois pelo Crescimento. Variações e kits seguem a rampa do avulso (a curva de desconto sobre o degrau). Nada aqui muda o preço salvo nem o preço original já anunciado." />
          </span>
        </h3>
        <div className="lanc-topo">
          <div className="field">
            <label>Produto, variação ou kit</label>
            <BuscaItem grupos={gruposDoSeletor(itens)} value={itemId} onChange={setSel} vazio="— escolha (ou use o da Ficha) —" />
          </div>
          <div className="field">
            <label>Canal</label>
            <div className="ficha-canais">
              {canais.map((c) => (
                <button key={c.id} type="button" className={`ficha-canal${canal?.id === c.id ? " on" : ""}`} onClick={() => setCanalSel(c.id)}>
                  <CanalTag canal={c} />
                </button>
              ))}
            </div>
          </div>
          {item && canal && (
            <div className="kv-cel">
              <small>Alvo (preço salvo)</small>
              <b>{alvo ? BRL(alvo) : "—"}</b>
              <span>{alvo ? "Produtos precificados" : "sem preço salvo neste canal"}</span>
            </div>
          )}
        </div>
        {!anunciada && <div className="aviso-cel">Quantidade não anunciada em {canal?.nome} (2º Por quantidade → Anunciado em).</div>}

        {estado === "vazio" && <div className="empty">Escolha o produto e o canal (ou na 3º Ficha).</div>}
        {estado === "sem-preco" && (
          <div className="empty">
            Sem preço salvo em {canal.nome}. Salve no{" "}
            <button type="button" className="link-btn" onClick={() => onSub?.(tipo === "variacao" ? "quantidade" : "avulso")}>
              {tipo === "variacao" ? "2º Por quantidade" : "1º Avulso"}
            </button>{" "}
            primeiro.
          </div>
        )}

        {estado === "pergunta" && (
          <div className="lanc-pergunta">
            <b>Vai entrar em rampa neste canal?</b>
            <p className="hint" style={{ margin: "4px 0 10px" }}>
              Rampa = começar perto do 0 a 0 pra ganhar vendas e avaliações e subir em degraus até o alvo ({BRL(alvo)}).
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn primary" onClick={() => setIniciar(true)} disabled={!rampasH.disponivel}>
                Sim, começar em rampa
              </button>
              <button type="button" className="btn" onClick={() => setNoAlvo((m) => ({ ...m, [chave]: true }))}>
                Não, anunciar no alvo
              </button>
            </div>
            {!rampasH.disponivel && <div className="hint">Rode o supabase/schema_v33.sql pra usar a rampa.</div>}
          </div>
        )}

        {estado === "alvo" && quadroAnuncio({ titulo: "Anunciar no alvo", a: anAlvo, nota: "Pode iniciar a rampa depois pelo Crescimento." })}

        {estado === "rampa" && (
          <div className="lanc-corpo">
            <div>
            {est ? (
              <div className="lanc-rampa">
                <div className="legenda-tit">
                  Em rampa · {est.fase.rotulo} · degrau {est.i + 1} de {est.degraus.length}
                </div>
                <div className="lanc-degraus">
                  {est.degraus.map((d, k) => (
                    <span key={k} className={`lanc-degrau${k === est.i ? " at" : ""}${Math.abs(d - est.alvo) < 0.005 ? " alvo" : ""}`}>
                      {virgula(d)}
                      {Math.abs(d - est.alvo) < 0.005 ? " · alvo" : ""}
                    </span>
                  ))}
                </div>
                {est.fase.chave !== "alvo" && (
                  <div className="chips-portoes" style={{ marginTop: 6 }}>
                    {est.portoes.map((p) => (
                      <span key={p.chave} className={`chip-portao ${p.ok ? "ok" : "no"}`} title={`${p.rotulo}: ${p.valor}`}>
                        {p.ok ? p.curto : p.falta ? `faltam ${p.falta} ${p.curto}` : p.curto}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="hint">
                {tipo === "kit"
                  ? `Kit com peça em rampa (${pecasEmRampa.map((l) => l.produto.nome).join(", ")}): segue a curva de desconto sobre o degrau das peças.`
                  : "Variação: segue a rampa do avulso (a curva de desconto sobre o degrau)."}
              </div>
            )}
            {tipo !== "produto" && est && <div className="hint">Variação: segue a rampa do avulso (a curva de desconto sobre o degrau).</div>}
            </div>
            <div>
            {quadroAnuncio({ titulo: "O que digitar agora", a: an, nota: ra ? null : "No alvo: o preço de agora é o salvo." })}
            <button
              type="button"
              className="btn btn-sm"
              style={{ marginTop: 10 }}
              onClick={() => irParaAba("crescimento", { sub: "rampa", rampaId: (rampaDoProduto || pecasEmRampa[0])?.r.id })}
            >
              Ver no Crescimento →
            </button>
            </div>
          </div>
        )}
      </div>

      {iniciar && produtoId && canal && (
        <IniciarRampaDialog
          dados={dados}
          rampas={rampasH.rampas}
          regras={regras}
          editar={null}
          produtoInicial={produtoId}
          canalInicial={canal.id}
          onToast={onToast}
          onClose={(id) => {
            setIniciar(false);
            if (id) rampasH.recarregar?.();
          }}
        />
      )}

      <ProximoPasso atual="lancamento" itemId={itemId} canalId={canal?.id} onSub={onSub} />
    </>
  );
}
