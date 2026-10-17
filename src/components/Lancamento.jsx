import { canalDireto } from "../lib/canais.js";
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
import { useAnunciosGrupo } from "../hooks/useAnunciosGrupo.js";
import { ehIdGrupo, fichaDoGrupo } from "../lib/anunciosGrupo.js";

const virgula = (v) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// 4º Lançamento — SÓ CONSULTA (o único lugar que grava é o "Iniciar rampa",
// o MESMO diálogo do Crescimento). Pro produto e canal escolhidos (os da
// Ficha, ou os levados pelo "Próximo →"): vai entrar em rampa ou anunciar no
// alvo? Em rampa: degraus, o que digitar (rampaAnuncio.js) e os portões;
// subir degrau e registrar semana continuam no Crescimento.
export default function Lancamento({ onToast, onSub }) {
  const { dados, rampasH, regras, linhas } = useCrescimento();
  const { itens, canais, precos, produtos, kits, publicacoesCanal, mapaRampa, cobraNoCanal, clientePagaHoje } = dados;
  const { grupos } = useAnunciosGrupo();
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
  // Anúncio com vários itens (Ficha etapa 2): o que digitar por opção; a rampa
  // continua sendo do produto de cada opção.
  const grupo = ehIdGrupo(itemId) ? grupos.find((g) => g.id === itemId.slice(2)) || null : null;
  const fichaG = grupo && canal ? fichaDoGrupo({ grupo, canal, itens, precos, produtos, kits, mapaRampa, publicacoes: publicacoesCanal, clientePagaHoje }) : null;
  const opcoesBusca = [...gruposDoSeletor(itens), ...(grupos.length ? [{ label: "Anúncios com vários itens", itens: grupos.map((g) => ({ id: `g:${g.id}`, rotulo: `${g.nome} · ${g.variacao_nome}` })) }] : [])];

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
  const anunciada = item && canal ? cobraNoCanal(item, canal) : true;
  const chave = item && canal ? `${item.id}|${canal.id}` : "";

  // O que digitar: em rampa (ou derivado dela) = mapaRampa; senão o anúncio no alvo.
  const ra = item && canal ? mapaRampa.get(`${item.id}|${canal.id}`) || null : null;
  const desconto = item && canal ? descontoDoItem(item.id, canal, { itens, produtos, kits }).desconto : 0;
  const anAlvo = item && canal && alvo ? anuncioDoItem({ itemId: item.id, canal, real: alvo, desconto, publicacoes: publicacoesCanal }) : null;
  const an = ra || anAlvo;

  const emRampa = !!rampaDoProduto;
  const derivado = (tipo === "variacao" && emRampa) || pecasEmRampa.length > 0;
  const estado = !item || !canal ? "vazio" : !alvo ? "sem-preco" : canalDireto(canal) ? "direto" : emRampa || derivado ? "rampa" : publicado || noAlvo[chave] ? "alvo" : tipo === "produto" ? "pergunta" : "alvo";

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
        {a.acimaDoRiscado && <div className="aviso-cel atencao">Precisaria subir o preço original — pode ser visto como manipulação; considere manter.</div>}
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
            <BuscaItem grupos={opcoesBusca} value={itemId} onChange={setSel} vazio="— escolha (ou use o da Ficha) —" />
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
        {!anunciada && <div className="aviso-cel">Fora de {canal?.nome}: o produto não tem preço salvo neste canal ou a quantidade não é anunciada aqui (2º Por quantidade → Anunciado em).</div>}

        {grupo && canal && fichaG && (
          <div className="lanc-grupo">
            <div className="legenda-tit">
              Anúncio com vários itens · {grupo.nome} · {grupo.variacao_nome}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Opção</th>
                    <th className="num">Preço de cadastro</th>
                    <th className="num">Promo</th>
                    <th className="num">Cliente paga</th>
                    <th>Rampa</th>
                  </tr>
                </thead>
                <tbody>
                  {fichaG.linhas.filter((l, i, arr) => arr.findIndex((x) => x.opcao === l.opcao) === i).map((l) => {
                    const pid = !l.item ? null : l.item.id.startsWith("p:") ? l.item.id.slice(2) : l.item.id.startsWith("v:") ? l.item.produtoId : null;
                    const rp = pid ? linhas.find((x) => x.r.produto_id === pid && x.r.canal_id === canal.id) : null;
                    return (
                      <tr key={l.chave}>
                        <td>
                          {l.rotulo}
                          <div className="muted-cel">{l.item?.nome || "item não encontrado"}</div>
                        </td>
                        {l.an ? (
                          <>
                            <td className="num">
                              {BRL(l.an.original)}
                              <div className="muted-cel">{l.an.riscadoFixo ? "já anunciado (fixo)" : "a cadastrar"}</div>
                            </td>
                            <td className="num">{l.an.promo ? `${l.an.promo}%` : "—"}</td>
                            <td className="num">
                              {l.an.emRampa ? (
                                <>
                                  agora {BRL(l.an.clientePaga)}
                                  <div className="muted-cel">{l.anSalvo && Math.abs(l.anSalvo.clientePaga - l.an.clientePaga) > 0.004 ? `alvo ${BRL(l.anSalvo.clientePaga)}` : "= alvo"}</div>
                                </>
                              ) : (
                                BRL(l.an.clientePaga)
                              )}
                            </td>
                          </>
                        ) : (
                          <td className="num" colSpan={3} style={{ color: "var(--warn)" }}>
                            sem preço salvo em {canal.nome}
                          </td>
                        )}
                        <td>
                          {rp ? (
                            <button type="button" className="link-btn" onClick={() => irParaAba("crescimento", { sub: "rampa", rampaId: rp.r.id })}>
                              em rampa ({rp.produto.nome}) →
                            </button>
                          ) : (
                            <span className="muted-cel">no alvo</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="hint" style={{ margin: "6px 0 0" }}>A rampa é de cada produto (Crescimento); aqui só se vê o que digitar em cada opção. O “feito” é na 5º Anunciar.</p>
          </div>
        )}
        {grupo && !fichaG && <div className="empty">Escolha o canal.</div>}
        {ehIdGrupo(itemId) && !grupo && <div className="empty">Anúncio com vários itens não encontrado (excluído?).</div>}

        {!ehIdGrupo(itemId) && estado === "vazio" && <div className="empty">Escolha o produto e o canal (ou na 3º Ficha).</div>}
        {estado === "sem-preco" && (
          <div className="empty">
            Sem preço salvo em {canal.nome}. Salve no{" "}
            <button type="button" className="link-btn" onClick={() => onSub?.(tipo === "variacao" ? "quantidade" : "avulso")}>
              {tipo === "variacao" ? "2º Por quantidade" : "1º Avulso"}
            </button>{" "}
            primeiro.
          </div>
        )}

        {estado === "direto" && (
          <div className="lanc-pergunta">
            <b>Venda direta: preço fixo {BRL(alvo)}</b>
            <p className="hint" style={{ margin: "4px 0 0" }}>
              Canal próprio não tem rampa, Ads nem preço original/promo pra digitar — é só vender no preço salvo. Quando o preço ficar velho (12 meses) ou o custo subir 10%, o Início avisa pra revisar.
            </p>
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
                        {p.ok ? `✓ ${p.curto}` : p.falta ? `faltam ${p.falta} ${p.curto}` : `✗ ${p.curto}`}
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
          rampas={[...rampasH.rampas, ...(rampasH.rampasKit || [])]}
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
