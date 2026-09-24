import { useEffect, useMemo, useRef, useState } from "react";
import { ML_CATEGORY_PCT, calcCanalCustom, resolverFaixaML, resolverFaixaShein, resolverFaixaShopee, resolverFaixaTikTok, resultadoNoPreco } from "../lib/calc.js";
import { BRL, PCT, arredondarPreco } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import SeletorItens, { totalItens } from "./SeletorItens.jsx";
import Termometro from "./Termometro.jsx";
import Ajuda from "./Ajuda.jsx";
import { TIPOS } from "../lib/promocaoTipos.js";
import { normalizarTexto, nomesParecidos } from "../lib/texto.js";

const ML_CATEGORIAS = Object.keys(ML_CATEGORY_PCT);

const TIERS_PADRAO = [
  { qtd: 2, desconto: 8 },
  { qtd: 3, desconto: 15 },
  { qtd: 5, desconto: 22 },
];

// Linha de comparação padrão em toda promoção: quanto essa configuração
// deixa a mais (ou a menos) do que vender a(s) mesma(s) peça(s) avulsa(s),
// no preço/margem normal. Um desconto isolado (Desconto direto, Frete
// grátis) SEMPRE dá negativo aqui — isso é esperado, é o preço de
// atrair a venda. Já Combo/Venda combinada podem dar positivo, porque a
// taxa fixa do canal é cobrada uma vez só em vez de uma vez por peça.
function DeltaAvulso({ delta, sufixo = "" }) {
  if (delta == null || !isFinite(delta)) return null;
  const melhor = delta >= 0;
  return (
    <div className="hint" style={{ marginTop: 10, marginBottom: 0, color: melhor ? "var(--good)" : "var(--bad)", fontWeight: 600 }}>
      {melhor ? "▲" : "▼"} {BRL(Math.abs(delta))} {melhor ? "a mais" : "a menos"} do que vender avulso{sufixo}
    </div>
  );
}

// Ponto de equilíbrio: uma promoção quase sempre reduz o lucro POR PEÇA em
// troca de vender mais peças — mas nenhum painel respondia "vender mais
// quanto, exatamente, pra não sair perdendo?". Não dá pra responder em
// unidades absolutas (o app não sabe quantas vendas você faria no preço
// normal), mas dá pra responder em múltiplo/porcentagem: se o lucro por
// peça cai pela metade, por exemplo, precisa vender o dobro só pra empatar
// o lucro TOTAL de vender menos peças no preço cheio.
function Breakeven({ lucroNormal, lucroPromo }) {
  if (lucroNormal == null || !isFinite(lucroNormal) || lucroNormal <= 0) return null;
  if (lucroPromo == null || !isFinite(lucroPromo)) return null;
  if (lucroPromo <= 0) {
    return (
      <div className="hint" style={{ marginTop: 4, marginBottom: 0, color: "var(--bad)" }}>
        Ponto de equilíbrio: essa promoção não dá lucro por peça — nenhum volume de venda extra compensa sozinho (só vale se trouxer ganho indireto: giro de estoque, ranking no canal, atrair um cliente novo etc.).
      </div>
    );
  }
  const mult = lucroNormal / lucroPromo;
  const pctExtra = (mult - 1) * 100;
  return (
    <div className="hint" style={{ marginTop: 4, marginBottom: 0 }}>
      Ponto de equilíbrio: precisa vender {mult.toFixed(2)}× mais peças nessa promoção ({pctExtra >= 0 ? "+" : ""}
      {pctExtra.toFixed(0)}%) pra igualar o lucro total de vender no preço normal.
    </div>
  );
}

export default function PromocaoSimulador({ onToast }) {
  const { lojaId } = useLoja();
  const [produtos, setProdutos] = useState([]);
  const [kits, setKits] = useState([]);
  const [kitProdutosTodos, setKitProdutosTodos] = useState([]);
  const [kitEmbalagensTodos, setKitEmbalagensTodos] = useState([]);
  const [embalagensCatalogo, setEmbalagensCatalogo] = useState([]);
  const [canais, setCanais] = useState([]);
  const [precos, setPrecos] = useState([]); // precos_canal já salvos — base do "preço original de venda" abaixo
  const [nomesPromocoesSalvas, setNomesPromocoesSalvas] = useState([]); // pro autocomplete/sugestão ao salvar
  const [carregando, setCarregando] = useState(true);

  const [baseSelecionada, setBaseSelecionada] = useState(""); // "" | `p:<id>` | `k:<id>`
  const [canalId, setCanalId] = useState("");
  const [custoManual, setCustoManual] = useState("");
  const [frete, setFrete] = useState(0);
  const [embalagem, setEmbalagem] = useState(0);
  const [mlCategoria, setMlCategoria] = useState(ML_CATEGORIAS[0]);
  const [mlTipoAnuncio, setMlTipoAnuncio] = useState("classico");
  const [lucratividade, setLucratividade] = useState(30);

  const [tipo, setTipo] = useState("desconto");
  const [desconto, setDesconto] = useState(10);
  // Desconto direto tem dois jeitos de calcular: "percentual" (o de sempre —
  // desconto% reduz o preço normal) ou "precoFinal" — ao contrário: você diz
  // o preço final que quer cobrar e o desconto que quer anunciar, e o app
  // calcula o preço "de" que precisa marcar pra esse desconto bater certinho
  // nesse valor final, sem precisar fazer a conta na mão.
  const [modoDesconto, setModoDesconto] = useState("percentual");
  const [precoFinalDesejado, setPrecoFinalDesejado] = useState("");
  const [tiers, setTiers] = useState(TIERS_PADRAO);
  const [levar, setLevar] = useState(3);
  const [pagar, setPagar] = useState(2);
  const [freteAbsorvido, setFreteAbsorvido] = useState(12);

  // Venda combinada
  const [itensCombinada, setItensCombinada] = useState([]);
  const [descontoCombinada, setDescontoCombinada] = useState(10);
  const [freteCombinada, setFreteCombinada] = useState(0);
  const [embalagemCombinada, setEmbalagemCombinada] = useState(0);

  // Liquidação com piso de margem
  const [margemMinima, setMargemMinima] = useState(10);

  useEffect(() => {
    if (!supabase) {
      setCarregando(false);
      return;
    }
    let ativo = true;
    async function carregar() {
      try {
        let qp = supabase.from("produtos_cadastro").select("*").order("nome");
        let qc = supabase.from("canais").select("*").eq("ativo", true).order("tipo");
        let qk = supabase.from("kits").select("*").order("nome");
        let qe = supabase.from("embalagens").select("*").order("nome");
        let qpc = supabase.from("precos_canal").select("*");
        let qps = supabase.from("promocoes_salvas").select("nome");
        if (lojaId) {
          qp = qp.eq("loja_id", lojaId);
          qc = qc.eq("loja_id", lojaId);
          qk = qk.eq("loja_id", lojaId);
          qe = qe.eq("loja_id", lojaId);
          qpc = qpc.eq("loja_id", lojaId);
          qps = qps.eq("loja_id", lojaId);
        }
        const [rp, rc, rk, re, rpc, rps] = await Promise.all([qp, qc, qk, qe, qpc, qps]);
        if (!ativo) return;
        // Troca de loja invalida seleções antigas — se o produto/canal/kit
        // escolhido não existir mais na lista desta loja, volta pro padrão
        // (manual/primeiro canal) em vez de manter um id de outra loja preso.
        if (!rp.error) setProdutos(rp.data || []);
        if (!rc.error) {
          const listaC = rc.data || [];
          setCanais(listaC);
          setCanalId((prev) => (listaC.some((c) => c.id === prev) ? prev : listaC[0]?.id || ""));
        }
        if (!rk.error) setKits(rk.data || []);
        if (!re.error) setEmbalagensCatalogo(re.data || []);
        if (!rpc.error) setPrecos(rpc.data || []);
        // Nomes já usados em promoções salvas — só pra sugerir/autocompletar
        // na hora de salvar (dedupe por texto normalizado, guarda a 1ª grafia).
        if (!rps.error) {
          const vistos = new Map();
          for (const row of rps.data || []) {
            const nome = (row.nome || "").trim();
            if (!nome) continue;
            const chave = normalizarTexto(nome);
            if (!vistos.has(chave)) vistos.set(chave, nome);
          }
          setNomesPromocoesSalvas([...vistos.values()].sort((a, b) => a.localeCompare(b, "pt-BR")));
        }

        const kitIds = (rk.data || []).map((k) => k.id);
        const [kpResp, keResp] = await Promise.all([
          kitIds.length ? supabase.from("kit_produtos").select("*").in("kit_id", kitIds) : Promise.resolve({ data: [] }),
          kitIds.length ? supabase.from("kit_embalagens").select("*").in("kit_id", kitIds) : Promise.resolve({ data: [] }),
        ]);
        if (!ativo) return;
        setKitProdutosTodos(kpResp.data || []);
        setKitEmbalagensTodos(keResp.data || []);

        setBaseSelecionada((prev) => {
          if (!prev) return prev;
          const [t, id] = prev.split(":");
          const listaP = rp.data || [];
          const listaK = rk.data || [];
          if (t === "p" && !listaP.some((p) => p.id === id)) return "";
          if (t === "k" && !listaK.some((k) => k.id === id)) return "";
          return prev;
        });
      } catch {
        // falha de rede — mantém o que já estava carregado
      } finally {
        if (ativo) setCarregando(false);
      }
    }
    carregar();
    // Sem isso, cadastrar/editar/excluir um produto, kit OU canal em
    // Cadastros só refletia aqui depois de recarregar a página inteira.
    const ch = supabase
      .channel("promocoes-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "produtos_cadastro" }, carregar)
      .on("postgres_changes", { event: "*", schema: "public", table: "canais" }, carregar)
      .on("postgres_changes", { event: "*", schema: "public", table: "kits" }, carregar)
      .on("postgres_changes", { event: "*", schema: "public", table: "kit_produtos" }, carregar)
      .on("postgres_changes", { event: "*", schema: "public", table: "kit_embalagens" }, carregar)
      .on("postgres_changes", { event: "*", schema: "public", table: "embalagens" }, carregar)
      .on("postgres_changes", { event: "*", schema: "public", table: "precos_canal" }, carregar)
      .on("postgres_changes", { event: "*", schema: "public", table: "promocoes_salvas" }, carregar)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(ch);
    };
  }, [lojaId]);

  const canal = canais.find((c) => c.id === canalId) || null;

  const [tipoBaseSel, idBaseSel] = baseSelecionada ? baseSelecionada.split(":") : [null, null];
  const produtoBase = tipoBaseSel === "p" ? produtos.find((p) => p.id === idBaseSel) || null : null;
  const kitBase = tipoBaseSel === "k" ? kits.find((k) => k.id === idBaseSel) || null : null;

  const catalogoProdutosBase = useMemo(
    () => produtos.map((p) => ({ id: p.id, nome: p.nome, preco: Number(p.custo_producao) || 0, unidade: "un" })),
    [produtos]
  );
  const catalogoEmbalagensBase = useMemo(
    () => embalagensCatalogo.map((m) => ({ id: m.id, nome: m.nome, preco: m.preco, unidade: m.unidade })),
    [embalagensCatalogo]
  );

  function custoKitTotal(k) {
    const prodItens = kitProdutosTodos.filter((r) => r.kit_id === k.id).map((r) => ({ itemId: r.produto_id, quantidade: r.quantidade }));
    const embItens = kitEmbalagensTodos.filter((r) => r.kit_id === k.id).map((r) => ({ itemId: r.embalagem_id, quantidade: r.quantidade }));
    return totalItens(catalogoProdutosBase, prodItens) + totalItens(catalogoEmbalagensBase, embItens);
  }

  // Ao trocar de produto/kit, preenche frete/embalagem automaticamente — do
  // cadastro do produto, ou zerado pro kit (a embalagem do kit já entra no
  // custo dele, tem sua própria receita separada em Cadastros → Kits).
  useEffect(() => {
    if (!baseSelecionada) return;
    if (tipoBaseSel === "p" && produtoBase) {
      setFrete(arredondarPreco(produtoBase.frete_padrao || 0));
      setEmbalagem(arredondarPreco(produtoBase.embalagem_padrao || 0));
    } else if (tipoBaseSel === "k") {
      setFrete(0);
      setEmbalagem(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseSelecionada]);

  const n = (v) => {
    const x = Number(v);
    return isFinite(x) ? x : 0;
  };
  const custoProduto = produtoBase
    ? arredondarPreco(Number(produtoBase.custo_producao) || 0)
    : kitBase
    ? arredondarPreco(custoKitTotal(kitBase))
    : parseFloat(custoManual) || 0;

  // Resolve preço normal (sem promoção) pelo canal escolhido, e guarda as
  // taxas efetivas (comissão/taxa fixa) pra reaproveitar nos cálculos de
  // combo/combinada, que precisam montar um "pedido" com custo/preço diferentes.
  const base = useMemo(
    () => ({
      custoProduto,
      frete: n(frete),
      embalagem: n(embalagem),
      lucratividadePct: n(lucratividade) / 100,
      imposto: canal?.imposto_pct || 0,
      custosFixosPct: canal?.custos_fixos_pct || 0,
    }),
    [custoProduto, frete, embalagem, lucratividade, canal]
  );

  // Resolve comissão/taxa fixa efetivas pra um canal+base quaisquer — usada
  // tanto pro item principal quanto, em Venda combinada, pra cada item da
  // lista e pro pacote combinado.
  function resolverComTier(canalObj, baseObj) {
    if (!canalObj) return null;
    if (canalObj.tipo === "shopee") {
      const r = resolverFaixaShopee(baseObj);
      return { resultado: r.resultado, comissaoPct: r.tier.pct, taxaFixa: r.tier.fixo };
    }
    if (canalObj.tipo === "ml") {
      const r = resolverFaixaML(mlCategoria, baseObj, mlTipoAnuncio);
      const pcts = ML_CATEGORY_PCT[mlCategoria] ?? { classico: 0.13, premium: 0.18 };
      const comissaoPct = mlTipoAnuncio === "premium" ? pcts.premium : pcts.classico;
      return { resultado: r.resultado, comissaoPct, taxaFixa: r.tier.fixo };
    }
    if (canalObj.tipo === "tiktok") {
      const r = resolverFaixaTikTok(baseObj);
      return { resultado: r.resultado, comissaoPct: r.tier.pct, taxaFixa: r.tier.fixo };
    }
    if (canalObj.tipo === "shein") {
      const r = resolverFaixaShein(baseObj);
      return { resultado: r.resultado, comissaoPct: r.tier.pct, taxaFixa: r.tier.fixo };
    }
    return { resultado: calcCanalCustom(canalObj, baseObj), comissaoPct: canalObj.comissao_pct || 0, taxaFixa: canalObj.taxa_fixa || 0 };
  }

  const { normal: normalCalculado, feeInfo } = useMemo(() => {
    if (!canal) return { normal: null, feeInfo: null };
    const r = resolverComTier(canal, base);
    return { normal: r.resultado, feeInfo: { comissaoPct: r.comissaoPct, taxaFixa: r.taxaFixa } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canal, base, mlCategoria, mlTipoAnuncio]);

  // Preço já salvo (Precificação por Canal) pra esse item + canal — quando
  // existe, é a referência mais real do "preço original" do que a conta
  // teórica de custo + lucratividade desejada.
  const precoSalvo = useMemo(() => {
    if (!baseSelecionada || !canalId) return null;
    const [t, id] = baseSelecionada.split(":");
    const itemTipo = t === "k" ? "kit" : "produto";
    return precos.find((p) => p.item_tipo === itemTipo && p.item_id === id && p.canal_id === canalId) || null;
  }, [precos, baseSelecionada, canalId]);

  // "Preço original de venda" — editável. Vem preenchido com o preço salvo
  // (ou, na falta dele, com o calculado pela margem desejada) e ACOMPANHA AO
  // VIVO qualquer mudança nesse valor (preço salvo em Produtos precificados, ou
  // custo do produto/frete/embalagem que muda o teórico) enquanto você não
  // tiver digitado nada diferente na mão — sem isso, o campo ficava
  // "congelado" no valor de quando o produto foi selecionado, e a promoção
  // inteira (lucro, margem, ponto de equilíbrio) continuava calculando em
  // cima de um preço/custo desatualizado mesmo depois de editar o produto ou
  // salvar um preço novo em outra aba/aparelho. `ultimoAutoRef` guarda o
  // último valor preenchido automaticamente — se o campo ainda for igual a
  // ele, é seguro atualizar; se for diferente, é porque você editou na mão,
  // e nesse caso a troca de item/canal (chaveRef) ainda reseta do jeito
  // antigo, pra não carregar o ajuste manual de um produto pro outro.
  const [precoOriginalOverride, setPrecoOriginalOverride] = useState("");
  const chaveItemCanalRef = useRef("");
  const ultimoAutoRef = useRef(null);

  useEffect(() => {
    const chave = `${baseSelecionada}|${canalId}`;
    const valor = precoSalvo?.preco ?? normalCalculado?.preco ?? null;
    const valorStr = valor != null ? String(arredondarPreco(valor)) : "";
    const trocouItemOuCanal = chave !== chaveItemCanalRef.current;
    chaveItemCanalRef.current = chave;
    if (trocouItemOuCanal) {
      ultimoAutoRef.current = valorStr;
      setPrecoOriginalOverride(valorStr);
      return;
    }
    setPrecoOriginalOverride((atual) => {
      if (atual !== ultimoAutoRef.current) return atual; // editado na mão — não sobrescreve
      ultimoAutoRef.current = valorStr;
      return valorStr;
    });
  }, [baseSelecionada, canalId, precoSalvo, normalCalculado]);

  const precoOriginalNum = parseFloat(precoOriginalOverride);
  // Reavalia lucro/margem com a faixa de comissão certa pro preço original
  // DIGITADO, não com a faixa resolvida pro preço teórico (custo + margem
  // desejada) — sem isso, subir esse preço além da faixa original podia
  // continuar usando comissão/taxa fixa de uma faixa mais barata (ou mais
  // cara) do que a que realmente vale ali, e mostrar lucro errado (inclusive
  // negativo mesmo com o preço subindo). O `lucroEm` também é substituído por
  // uma versão que resolve a faixa certa pra QUALQUER preço avaliado depois
  // (desconto, progressivo, liquidação…), não só pro preço original em si —
  // o mesmo problema existe pra desconto grande ou preço bem diferente do
  // teórico. `faixaOk` continua refletindo o preço TEÓRICO (aviso de
  // custo/margem inconsistente), sem relação com esse ajuste manual.
  const normal = useMemo(() => {
    if (!normalCalculado) return null;
    const precoBase = isFinite(precoOriginalNum) && precoOriginalNum > 0 ? precoOriginalNum : normalCalculado.preco;
    const r = resultadoNoPreco(canal, base, precoBase, mlCategoria, mlTipoAnuncio);
    if (!r) return normalCalculado;
    const lucroEm = (p) => resultadoNoPreco(canal, base, p, mlCategoria, mlTipoAnuncio)?.lucro ?? null;
    return {
      ...normalCalculado,
      preco: r.preco,
      lucro: r.lucro,
      margem: r.margem,
      totalPct: r.totalPct,
      taxaFixa: r.taxaFixa,
      custoTotal: r.custoTotal,
      lucroEm,
    };
  }, [normalCalculado, precoOriginalNum, canal, base, mlCategoria, mlTipoAnuncio]);

  // Resultado do desconto direto — extraído num memo próprio (em vez de só
  // calcular dentro do JSX) porque o comparativo entre promoções, abaixo,
  // também precisa desse número, sem duplicar a conta.
  const descontoResultado = useMemo(() => {
    if (!normal) return null;
    if (modoDesconto === "precoFinal") {
      const preco = n(precoFinalDesejado);
      if (preco <= 0) return null;
      const lucro = normal.lucroEm(preco);
      return { preco, lucro, margem: preco > 0 ? lucro / preco : null };
    }
    const preco = normal.preco * (1 - (n(desconto) || 0) / 100);
    const lucro = normal.lucroEm(preco);
    return { preco, lucro, margem: preco > 0 ? lucro / preco : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normal, desconto, modoDesconto, precoFinalDesejado]);

  // Modo "preço final": pura regra de três a partir do que você digitou (não
  // depende do preço normal calculado) — preço "de" = preço final ÷ (1 −
  // desconto), que é exatamente o preço que, descontado nessa porcentagem,
  // bate no valor final desejado.
  const precoOriginalSugerido = useMemo(() => {
    if (modoDesconto !== "precoFinal") return null;
    const precoFinal = n(precoFinalDesejado);
    const pct = n(desconto) / 100;
    if (precoFinal <= 0 || pct >= 1) return null;
    return precoFinal / (1 - pct);
  }, [modoDesconto, precoFinalDesejado, desconto]);

  function atualizarTier(idx, campo, valor) {
    setTiers((prev) => prev.map((t, i) => (i === idx ? { ...t, [campo]: valor } : t)));
  }

  const linhasProgressivo = useMemo(() => {
    if (!normal) return [];
    return tiers.map((t) => {
      const precoUnit = normal.preco * (1 - (n(t.desconto) || 0) / 100);
      const lucroUnit = normal.lucroEm(precoUnit);
      return { ...t, precoUnit, lucroUnit, margemUnit: precoUnit > 0 ? lucroUnit / precoUnit : null, deltaVsAvulso: lucroUnit - normal.lucro };
    });
  }, [normal, tiers]);

  const combo = useMemo(() => {
    if (!normal || !feeInfo) return null;
    const L = Math.max(1, n(levar) || 1);
    const P = Math.min(L, Math.max(0, n(pagar) || 0));
    const custoKit = custoProduto * L + n(embalagem) * L;
    const precoKit = normal.preco * P;
    // Preço do kit é ~L vezes o preço de uma unidade — quase sempre cai numa
    // faixa de comissão diferente da de uma venda avulsa (feeInfo), então
    // reavalia a faixa certa pro preço do KIT, não reaproveita a de uma peça.
    const baseKit = { imposto: base.imposto, custosFixosPct: base.custosFixosPct, custoProduto: custoKit, frete: n(frete), embalagem: 0 };
    const lucroKit = resultadoNoPreco(canal, baseKit, precoKit, mlCategoria, mlTipoAnuncio)?.lucro ?? null;
    return {
      L,
      P,
      precoKit,
      lucroKit,
      margemKit: precoKit > 0 ? lucroKit / precoKit : null,
      precoUnidadeEfetivo: precoKit / L,
      lucroUnidadeEfetivo: lucroKit / L,
      economiaTaxaFixa: feeInfo.taxaFixa * (L - 1),
      deltaVsAvulso: lucroKit - normal.lucro * L,
    };
  }, [normal, feeInfo, levar, pagar, custoProduto, embalagem, frete, base, canal, mlCategoria, mlTipoAnuncio]);

  const freteGratis = useMemo(() => {
    if (!normal) return null;
    const lucro = normal.lucro - (n(freteAbsorvido) || 0);
    return { lucro, margem: normal.preco > 0 ? lucro / normal.preco : null, delta: lucro - normal.lucro };
  }, [normal, freteAbsorvido]);

  const liquidacao = useMemo(() => {
    if (!normal || !feeInfo) return null;
    const alvo = (parseFloat(margemMinima) || 0) / 100;
    const denom = 1 - normal.totalPct - alvo;
    if (denom <= 0) return { possivel: false };
    const precoMinimo = (feeInfo.taxaFixa + normal.custoTotal) / denom;
    const lucroNoPiso = normal.lucroEm(precoMinimo);
    const descontoMaximo = normal.preco > 0 ? 1 - precoMinimo / normal.preco : null;
    return { possivel: true, precoMinimo, lucroNoPiso, descontoMaximo, delta: lucroNoPiso - normal.lucro };
  }, [normal, feeInfo, margemMinima]);

  // Comparativo entre todos os tipos de promoção configurados agora, lado a
  // lado — sem precisar trocar de aba pra ver qual rende mais lucro. Só
  // entra na lista o tipo que já tem uma configuração válida (ex: liquidação
  // só depois que o piso de margem informado for viável). "Progressivo" fica
  // de fora porque já tem sua própria tabela de faixas (não é um resultado
  // único) e "Venda combinada" fica de fora porque parte de uma seleção de
  // itens diferente (não é o mesmo produto/canal único dos outros tipos).
  const resumoComparativo = useMemo(() => {
    if (!normal) return null;
    const linhas = [{ key: "normal", label: "Preço normal", preco: normal.preco, lucro: normal.lucro, margem: normal.margem }];
    if (descontoResultado) {
      linhas.push({ key: "desconto", label: `Desconto direto (${n(desconto)}%)`, preco: descontoResultado.preco, lucro: descontoResultado.lucro, margem: descontoResultado.margem });
    }
    if (combo) {
      linhas.push({ key: "combo", label: `Combo (leve ${combo.L}, pague ${combo.P})`, preco: combo.precoUnidadeEfetivo, lucro: combo.lucroUnidadeEfetivo, margem: combo.margemKit });
    }
    if (liquidacao?.possivel) {
      linhas.push({
        key: "liquidacao",
        label: `Liquidação (margem mín. ${n(margemMinima)}%)`,
        preco: liquidacao.precoMinimo,
        lucro: liquidacao.lucroNoPiso,
        margem: liquidacao.precoMinimo > 0 ? liquidacao.lucroNoPiso / liquidacao.precoMinimo : null,
      });
    }
    if (freteGratis) {
      linhas.push({ key: "frete", label: "Frete grátis subsidiado", preco: normal.preco, lucro: freteGratis.lucro, margem: freteGratis.margem });
    }
    return linhas.map((l) => ({
      ...l,
      deltaVsNormal: l.key === "normal" ? null : l.lucro - normal.lucro,
      mult: l.key !== "normal" && normal.lucro > 0 && l.lucro > 0 ? normal.lucro / l.lucro : null,
    }));
  }, [normal, descontoResultado, desconto, combo, liquidacao, margemMinima, freteGratis]);

  // Catálogo pro seletor de "Venda combinada" — produtos e kits juntos,
  // marcados na hora de exibir; o "preço" aqui é o custo de cada um (mesma
  // convenção usada em Kits.jsx), só pra calcular o subtotal em custo.
  const catalogoCombinacao = useMemo(() => {
    const p = produtos.map((x) => ({ id: `p:${x.id}`, nome: x.nome, sku: x.sku || "", preco: Number(x.custo_producao) || 0, unidade: "un" }));
    const k = kits.map((x) => ({ id: `k:${x.id}`, nome: `[Kit] ${x.nome}`, sku: x.sku || "", preco: custoKitTotal(x), unidade: "un" }));
    return [...p, ...k];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtos, kits, kitProdutosTodos, kitEmbalagensTodos, embalagensCatalogo]);

  function custoBaseDoItem(idPrefixado) {
    const [t, id] = idPrefixado.split(":");
    if (t === "p") {
      const p = produtos.find((x) => x.id === id);
      return p ? arredondarPreco(Number(p.custo_producao) || 0) : 0;
    }
    const k = kits.find((x) => x.id === id);
    return k ? arredondarPreco(custoKitTotal(k)) : 0;
  }

  // "Se vendido avulso" de um item da combinação: resolve o preço/lucro dele
  // sozinho, com o frete/embalagem PRÓPRIO (produto) ou já embutido (kit) —
  // é a referência de "vender em pedidos separados" pra comparar com o pacote.
  function avulsoItem(idPrefixado) {
    const [t, id] = idPrefixado.split(":");
    if (!canal) return null;
    let custoP, freteP, embP;
    if (t === "p") {
      const p = produtos.find((x) => x.id === id);
      if (!p) return null;
      custoP = arredondarPreco(Number(p.custo_producao) || 0);
      freteP = arredondarPreco(Number(p.frete_padrao) || 0);
      embP = arredondarPreco(Number(p.embalagem_padrao) || 0);
    } else {
      const k = kits.find((x) => x.id === id);
      if (!k) return null;
      custoP = arredondarPreco(custoKitTotal(k));
      freteP = 0;
      embP = 0;
    }
    const baseItem = {
      custoProduto: custoP,
      frete: freteP,
      embalagem: embP,
      lucratividadePct: n(lucratividade) / 100,
      imposto: canal.imposto_pct || 0,
      custosFixosPct: canal.custos_fixos_pct || 0,
    };
    const r = resolverComTier(canal, baseItem);
    if (!r?.resultado?.preco) return null;
    return { preco: r.resultado.preco, lucro: r.resultado.lucro };
  }

  const combinada = useMemo(() => {
    if (!canal) return null;
    const itensValidos = itensCombinada.filter((it) => it.itemId && (Number(it.quantidade) || 0) > 0);
    if (itensValidos.length === 0) return null;

    let precoSomaAvulso = 0;
    let lucroSomaAvulso = 0;
    let custoItensTotal = 0;
    let totalPecas = 0;
    for (const it of itensValidos) {
      const qtd = Number(it.quantidade) || 0;
      const av = avulsoItem(it.itemId);
      if (av) {
        precoSomaAvulso += av.preco * qtd;
        lucroSomaAvulso += av.lucro * qtd;
      }
      custoItensTotal += custoBaseDoItem(it.itemId) * qtd;
      totalPecas += qtd;
    }
    if (totalPecas === 0) return null;

    const baseCombinadaTier = {
      custoProduto: custoItensTotal,
      frete: n(freteCombinada),
      embalagem: n(embalagemCombinada),
      lucratividadePct: n(lucratividade) / 100,
      imposto: canal.imposto_pct || 0,
      custosFixosPct: canal.custos_fixos_pct || 0,
    };
    const precoCombinado = precoSomaAvulso * (1 - (n(descontoCombinada) || 0) / 100);
    // Reavalia a faixa certa pro preço COMBINADO (soma de vários itens, com
    // desconto) em vez de reaproveitar a faixa resolvida pro custo+margem
    // teórico da combinação — mesmo risco de faixa errada dos outros casos.
    const resultadoCombinada = resultadoNoPreco(canal, baseCombinadaTier, precoCombinado, mlCategoria, mlTipoAnuncio);
    if (!resultadoCombinada) return null;
    const lucroCombinado = resultadoCombinada.lucro;

    return {
      totalPecas,
      pedidos: itensValidos.length,
      precoSomaAvulso,
      lucroSomaAvulso,
      precoCombinado,
      lucroCombinado,
      margemCombinado: precoCombinado > 0 ? lucroCombinado / precoCombinado : null,
      lucroUnidadeEfetivo: lucroCombinado / totalPecas,
      deltaVsAvulso: lucroCombinado - lucroSomaAvulso,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canal, itensCombinada, freteCombinada, embalagemCombinada, descontoCombinada, lucratividade, produtos, kits, kitProdutosTodos, kitEmbalagensTodos, mlCategoria, mlTipoAnuncio]);

  // Nome do item/canal + resultado final da promoção CONFIGURADA agora,
  // pronto pra virar uma linha em "Promoções salvas" — cada tipo de
  // promoção calcula preço/lucro/margem de um jeito diferente (ou nem tem
  // um preço único, caso do Progressivo), então monta aqui um resumo comum
  // (preco/lucro/margem podem vir null quando não fizer sentido pro tipo)
  // mais um texto legível com a configuração usada, sem precisar guardar
  // cada campo separado — reaproveita os mesmos memos já calculados acima
  // pra cada tipo de promoção, não recalcula nada.
  const itemNomeAtual =
    tipoBaseSel === "p" ? produtoBase?.nome || null : tipoBaseSel === "k" ? kitBase?.nome || null : baseSelecionada ? null : "Custo manual";
  const canalNomeAtual = canal?.nome || null;

  const resumoParaSalvar = useMemo(() => {
    if (tipo === "combinada") {
      if (!combinada) return null;
      return {
        itemNome: `${combinada.pedidos} itens combinados (${combinada.totalPecas} peças)`,
        canalNome: canalNomeAtual,
        preco: combinada.precoCombinado,
        lucro: combinada.lucroCombinado,
        margem: combinada.margemCombinado,
        precoReferencia: combinada.precoSomaAvulso,
        descontoPct: null,
        resumo: `Venda combinada: desconto de ${n(descontoCombinada)}% sobre a soma dos preços avulsos.`,
      };
    }
    if (!normal) return null;
    if (tipo === "desconto") {
      if (!descontoResultado) return null;
      const precoReferencia = modoDesconto === "precoFinal" ? precoOriginalSugerido : normal.preco;
      const resumo =
        modoDesconto === "precoFinal"
          ? `Desconto direto de ${n(desconto)}% — preço final fixado em ${BRL(descontoResultado.preco)}${
              precoOriginalSugerido != null ? ` (marque "de" ${BRL(precoOriginalSugerido)})` : ""
            }.`
          : `Desconto direto de ${n(desconto)}% sobre o preço normal (${BRL(normal.preco)}).`;
      return {
        itemNome: itemNomeAtual,
        canalNome: canalNomeAtual,
        preco: descontoResultado.preco,
        lucro: descontoResultado.lucro,
        margem: descontoResultado.margem,
        precoReferencia,
        descontoPct: n(desconto),
        resumo,
      };
    }
    if (tipo === "progressivo") {
      return {
        itemNome: itemNomeAtual,
        canalNome: canalNomeAtual,
        preco: null,
        lucro: null,
        margem: null,
        precoReferencia: null,
        descontoPct: null,
        resumo: linhasProgressivo.map((t) => `${t.qtd}un -${n(t.desconto)}%: ${BRL(t.precoUnit)} (lucro ${BRL(t.lucroUnit)})`).join(" · "),
      };
    }
    if (tipo === "combo") {
      if (!combo) return null;
      return {
        itemNome: itemNomeAtual,
        canalNome: canalNomeAtual,
        preco: combo.precoKit,
        lucro: combo.lucroKit,
        margem: combo.margemKit,
        precoReferencia: normal.preco,
        descontoPct: null,
        resumo: `Leve ${combo.L}, pague ${combo.P} — preço efetivo por unidade ${BRL(combo.precoUnidadeEfetivo)}.`,
      };
    }
    if (tipo === "frete") {
      if (!freteGratis) return null;
      return {
        itemNome: itemNomeAtual,
        canalNome: canalNomeAtual,
        preco: normal.preco,
        lucro: freteGratis.lucro,
        margem: freteGratis.margem,
        precoReferencia: null,
        descontoPct: null,
        resumo: `Frete grátis — você absorve ${BRL(n(freteAbsorvido))}.`,
      };
    }
    if (tipo === "liquidacao") {
      if (!liquidacao || !liquidacao.possivel) return null;
      return {
        itemNome: itemNomeAtual,
        canalNome: canalNomeAtual,
        preco: liquidacao.precoMinimo,
        lucro: liquidacao.lucroNoPiso,
        margem: liquidacao.precoMinimo > 0 ? liquidacao.lucroNoPiso / liquidacao.precoMinimo : null,
        precoReferencia: normal.preco,
        descontoPct: null,
        resumo: `Margem mínima de ${n(margemMinima)}% — desconto máximo ${liquidacao.descontoMaximo != null ? PCT(liquidacao.descontoMaximo) : "—"}.`,
      };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, normal, combinada, combo, freteGratis, liquidacao, linhasProgressivo, desconto, descontoResultado, modoDesconto, precoOriginalSugerido, descontoCombinada, freteAbsorvido, margemMinima, itemNomeAtual, canalNomeAtual]);

  const [nomePromo, setNomePromo] = useState("");
  const [salvandoPromo, setSalvandoPromo] = useState(false);
  const [sugestaoNomeAberta, setSugestaoNomeAberta] = useState(false);
  const nomePromoRef = useRef(null);

  useEffect(() => {
    if (!sugestaoNomeAberta) return;
    function aoClicarFora(e) {
      if (nomePromoRef.current && !nomePromoRef.current.contains(e.target)) setSugestaoNomeAberta(false);
    }
    document.addEventListener("mousedown", aoClicarFora);
    return () => document.removeEventListener("mousedown", aoClicarFora);
  }, [sugestaoNomeAberta]);

  // Sugestões de nomes já usados que combinam com o que está sendo digitado
  // — autocomplete pra reaproveitar o nome de uma promoção já cadastrada em
  // vez de criar sem querer uma nova com um nome quase igual.
  const sugestoesNomePromo = useMemo(() => {
    const alvo = normalizarTexto(nomePromo);
    if (!alvo) return [];
    return nomesPromocoesSalvas.filter((n) => normalizarTexto(n).includes(alvo)).slice(0, 8);
  }, [nomePromo, nomesPromocoesSalvas]);

  // "Nome parecido, mas não igual" — só dispara quando o texto digitado não
  // bate exatamente com nenhum nome já existente, pra avisar antes de criar
  // sem querer uma promoção duplicada por causa de um erro de digitação.
  const nomePromoParecido = useMemo(() => {
    const alvo = nomePromo.trim();
    if (!alvo) return null;
    const alvoNorm = normalizarTexto(alvo);
    if (nomesPromocoesSalvas.some((n) => normalizarTexto(n) === alvoNorm)) return null;
    return nomesPromocoesSalvas.find((n) => nomesParecidos(n, alvo)) || null;
  }, [nomePromo, nomesPromocoesSalvas]);

  async function salvarPromocao() {
    const nome = nomePromo.trim();
    if (!nome) {
      onToast?.("Dê um nome à promoção antes de salvar");
      return;
    }
    if (!resumoParaSalvar) {
      onToast?.("Configure a promoção antes de salvar");
      return;
    }
    if (!supabase) {
      onToast?.("Promoções salvas indisponível (Supabase não configurado)");
      return;
    }
    setSalvandoPromo(true);
    const { error } = await supabase.from("promocoes_salvas").insert({
      nome,
      tipo,
      item_nome: resumoParaSalvar.itemNome,
      canal_nome: resumoParaSalvar.canalNome,
      preco: resumoParaSalvar.preco != null ? arredondarPreco(resumoParaSalvar.preco) : null,
      lucro: resumoParaSalvar.lucro != null ? arredondarPreco(resumoParaSalvar.lucro) : null,
      margem: resumoParaSalvar.margem,
      preco_referencia: resumoParaSalvar.precoReferencia != null ? arredondarPreco(resumoParaSalvar.precoReferencia) : null,
      desconto_pct: resumoParaSalvar.descontoPct,
      resumo: resumoParaSalvar.resumo,
      ...(lojaId ? { loja_id: lojaId } : {}),
    });
    setSalvandoPromo(false);
    if (error) {
      onToast?.("Não foi possível salvar agora — tente de novo");
      return;
    }
    onToast?.("Promoção salva em Promoções salvas");
    setNomePromo("");
  }

  if (!supabase) {
    return (
      <div className="panel">
        <h3>Promoções</h3>
        <div className="empty">Indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="subabas">
        {TIPOS.map((t) => (
          <button
            key={t.key}
            className={`btn${tipo === t.key ? " primary" : ""}`}
            onClick={() => setTipo(t.key)}
            style={{ flex: "none" }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid2">
        <div>
          <div className="panel">
            <h3 className="section-title">
              {tipo === "combinada" ? "Canal" : "Produto e canal"}
              <Ajuda texto="Simula o impacto de uma promoção no lucro, a partir do preço normal calculado pro canal escolhido (mesmas taxas de Configuração → Canais)." />
            </h3>
            {carregando ? (
              <div className="empty">Carregando…</div>
            ) : (
              <>
                {tipo !== "combinada" && (
                  <>
                    <div className="field">
                      <label>Produto ou kit cadastrado</label>
                      <select value={baseSelecionada} onChange={(e) => setBaseSelecionada(e.target.value)}>
                        <option value="">— usar custo manual —</option>
                        {produtos.length > 0 && (
                          <optgroup label="Produtos">
                            {produtos.map((p) => (
                              <option key={`p:${p.id}`} value={`p:${p.id}`}>{p.nome}</option>
                            ))}
                          </optgroup>
                        )}
                        {kits.length > 0 && (
                          <optgroup label="Kits">
                            {kits.map((k) => (
                              <option key={`k:${k.id}`} value={`k:${k.id}`}>{k.nome}</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </div>
                    {!baseSelecionada && (
                      <div className="field">
                        <label>Custo de produção (R$)</label>
                        <input type="number" step="0.01" value={custoManual} onChange={(e) => setCustoManual(e.target.value)} />
                      </div>
                    )}
                  </>
                )}
                <div className="field">
                  <label>Canal</label>
                  <select value={canalId} onChange={(e) => setCanalId(e.target.value)}>
                    {canais.length === 0 && <option value="">Nenhum canal cadastrado</option>}
                    {canais.map((c) => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                </div>
                {canal?.tipo === "ml" && (
                  <div className="row2">
                    <div className="field">
                      <label>Categoria (Mercado Livre)</label>
                      <select value={mlCategoria} onChange={(e) => setMlCategoria(e.target.value)}>
                        {ML_CATEGORIAS.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label>Tipo de anúncio</label>
                      <select value={mlTipoAnuncio} onChange={(e) => setMlTipoAnuncio(e.target.value)}>
                        <option value="classico">Clássico</option>
                        <option value="premium">Premium</option>
                      </select>
                    </div>
                  </div>
                )}
                {tipo !== "combinada" && (
                  <>
                    <div className="row3">
                      <div className="field">
                        <label title="Frete extra por sua conta">Frete extra (R$)</label>
                        <input type="number" step="0.01" value={frete} onChange={(e) => setFrete(e.target.value)} />
                      </div>
                      <div className="field">
                        <label>Embalagem (R$)</label>
                        <input type="number" step="0.01" value={embalagem} onChange={(e) => setEmbalagem(e.target.value)} />
                      </div>
                      <div className="field">
                        <label>Margem desejada (%)</label>
                        <input type="number" step="1" value={lucratividade} onChange={(e) => setLucratividade(e.target.value)} />
                      </div>
                    </div>
                    {(produtoBase || kitBase) && (
                      <div className="hint" style={{ marginTop: -8 }}>
                        {produtoBase
                          ? "Preenchido automaticamente com a embalagem já cadastrada nesse produto — não precisa somar de novo."
                          : "Kit selecionado: a embalagem já está no custo dele (receita própria em Cadastros → Kits) — deixe zerado, a menos que essa promoção precise de embalagem extra."}
                      </div>
                    )}
                  </>
                )}
                {tipo === "combinada" && (
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Margem desejada (%)</label>
                    <input type="number" step="1" value={lucratividade} onChange={(e) => setLucratividade(e.target.value)} />
                  </div>
                )}
              </>
            )}
          </div>

          {normal && tipo !== "combinada" && (
            <div className="panel">
              <h3 className="section-title">
                Preço normal (sem promoção)
                <Ajuda texto="Preço original de venda: vem do que você já salvou em Produtos precificados pra esse item+canal (ou, se ainda não salvou nada, de um cálculo por margem desejada) — mas pode ajustar aqui na mão pra testar um valor diferente antes de aplicar o desconto. O desconto da promoção é sempre calculado em cima desse número." />
              </h3>
              <div className="field" style={{ marginBottom: 8 }}>
                <label>Preço original de venda (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  value={precoOriginalOverride}
                  onChange={(e) => setPrecoOriginalOverride(e.target.value)}
                />
              </div>
              <div className="hint" style={{ marginTop: -4 }}>
                {precoSalvo && Math.abs(precoOriginalNum - precoSalvo.preco) < 0.005
                  ? "Preenchido com o preço já salvo em Produtos precificados pra esse item nesse canal."
                  : precoSalvo
                  ? `Ajustado na mão — o preço salvo em Produtos precificados pra esse item é ${BRL(precoSalvo.preco)}.`
                  : "Nenhum preço salvo ainda pra esse item+canal — preenchido pelo cálculo de margem desejada abaixo. Ajuste aqui se seu preço real for outro."}
              </div>
              <div className="kv"><span className="k">Lucro</span><span className="v">{BRL(normal.lucro)}</span></div>
              <div className="kv"><span className="k">Margem</span><span className="v">{PCT(normal.margem)}</span></div>
              {canal?.tipo !== "custom" && normal.faixaOk === false && (
                <div className="hint" style={{ marginTop: 10, marginBottom: 0, color: "var(--bad)" }}>
                  O preço calculado não confere com a faixa de comissão desse canal — o custo informado está baixo demais pra fechar a conta de forma consistente. Ajuste o custo/frete antes de confiar nesses números.
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          {tipo === "combinada" ? (
            <div className="panel">
              <h3 className="section-title">
                Venda combinada
                <Ajuda texto="Combine produtos e/ou kits diferentes num pedido só. A taxa fixa do canal é cobrada uma vez (não por item), então dá pra oferecer desconto sobre a soma dos preços avulsos e ainda assim sair ganhando — o comparativo abaixo mostra se esse desconto está valendo a pena ou comendo demais do lucro." />
              </h3>
              {!canal ? (
                <div className="empty">Escolha um canal cadastrado pra simular.</div>
              ) : (
                <>
                  <SeletorItens
                    catalogo={catalogoCombinacao}
                    itens={itensCombinada}
                    onChange={setItensCombinada}
                    rotuloVazio="Cadastre produtos ou kits primeiro pra combinar (Cadastros → Produtos / Kits)."
                  />
                  <div className="row2" style={{ marginTop: 12 }}>
                    <div className="field">
                      <label>Frete da combinação (R$)</label>
                      <input type="number" step="0.01" value={freteCombinada} onChange={(e) => setFreteCombinada(e.target.value)} />
                    </div>
                    <div className="field">
                      <label>Embalagem da combinação (R$)</label>
                      <input type="number" step="0.01" value={embalagemCombinada} onChange={(e) => setEmbalagemCombinada(e.target.value)} />
                    </div>
                  </div>
                  <div className="field">
                    <label>Desconto sobre a soma dos preços avulsos (%)</label>
                    <input type="number" step="1" value={descontoCombinada} onChange={(e) => setDescontoCombinada(e.target.value)} />
                  </div>
                  {combinada && (
                    <>
                      <div className="kv"><span className="k">Vendendo separado ({combinada.totalPecas} peças em {combinada.pedidos} pedidos)</span><span className="v">{BRL(combinada.precoSomaAvulso)}</span></div>
                      <div className="kv"><span className="k">Preço combinado (com desconto)</span><span className="v">{BRL(combinada.precoCombinado)}</span></div>
                      <div className="kv total"><span className="k">Lucro combinado</span><span className="v">{BRL(combinada.lucroCombinado)}</span></div>
                      <div className="kv"><span className="k">Lucro efetivo por peça</span><span className="v">{BRL(combinada.lucroUnidadeEfetivo)}</span></div>
                      <div className="kv">
                        <span className="k">Margem combinada</span>
                        <span className="v">{combinada.margemCombinado != null ? PCT(combinada.margemCombinado) : "—"}</span>
                      </div>
                      <Termometro valor={combinada.margemCombinado || 0} meta={n(lucratividade) / 100} />
                      <DeltaAvulso delta={combinada.deltaVsAvulso} sufixo=" (total do pedido, vs. vender tudo separado)" />
                      <Breakeven lucroNormal={combinada.lucroSomaAvulso / combinada.totalPecas} lucroPromo={combinada.lucroUnidadeEfetivo} />
                    </>
                  )}
                </>
              )}
            </div>
          ) : !normal ? (
            <div className="panel"><div className="empty">Escolha um canal cadastrado pra simular.</div></div>
          ) : tipo === "desconto" ? (
            <div className="panel">
              <h3 className="section-title">
                Desconto direto
                <Ajuda texto="'Por desconto %' é o de sempre: você diz o desconto e o app aplica sobre o preço normal. 'Por preço final' é ao contrário: você diz o preço que quer cobrar e o desconto que quer anunciar, e o app calcula o preço 'de' que precisa marcar pra esse desconto bater certinho — sem fazer conta na mão." />
              </h3>
              <div className="subabas" style={{ marginBottom: 12 }}>
                <button
                  type="button"
                  className={`btn${modoDesconto === "percentual" ? " primary" : ""}`}
                  onClick={() => setModoDesconto("percentual")}
                >
                  Por desconto %
                </button>
                <button
                  type="button"
                  className={`btn${modoDesconto === "precoFinal" ? " primary" : ""}`}
                  onClick={() => setModoDesconto("precoFinal")}
                >
                  Por preço final
                </button>
              </div>

              {modoDesconto === "percentual" ? (
                <div className="field">
                  <label>Desconto sobre o preço normal (%)</label>
                  <input type="number" step="1" value={desconto} onChange={(e) => setDesconto(e.target.value)} />
                </div>
              ) : (
                <>
                  <div className="row2">
                    <div className="field">
                      <label>Preço final que você quer cobrar (R$)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={precoFinalDesejado}
                        onChange={(e) => setPrecoFinalDesejado(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label>Desconto que quer anunciar (%)</label>
                      <input type="number" step="1" value={desconto} onChange={(e) => setDesconto(e.target.value)} />
                    </div>
                  </div>
                  {n(desconto) >= 100 ? (
                    <div className="hint" style={{ marginTop: -4, color: "var(--bad)" }}>
                      Desconto de 100% ou mais não dá pra calcular um preço "de" (seria infinito).
                    </div>
                  ) : precoOriginalSugerido != null ? (
                    <>
                      <div className="destaque-preco">
                        <span className="k">Marque o preço "de" como</span>
                        <span className="v">{BRL(precoOriginalSugerido)}</span>
                      </div>
                      <div className="hint" style={{ marginTop: -4 }}>
                        Assim o anúncio fica "de {BRL(precoOriginalSugerido)} por {BRL(n(precoFinalDesejado))}" — {n(desconto)}% de desconto batendo certinho no preço final que você quer.
                      </div>
                      <button
                        type="button"
                        className="btn"
                        style={{ marginTop: 8 }}
                        onClick={() => setPrecoOriginalOverride(String(arredondarPreco(precoOriginalSugerido)))}
                      >
                        Usar esse valor como preço normal
                      </button>
                    </>
                  ) : (
                    <div className="hint" style={{ marginTop: -4 }}>
                      Preencha o preço final desejado pra calcular o preço "de".
                    </div>
                  )}
                </>
              )}

              {descontoResultado && (
                <>
                  <div className="kv"><span className="k">Preço com desconto</span><span className="v">{BRL(descontoResultado.preco)}</span></div>
                  <div className="kv total"><span className="k">Lucro com desconto</span><span className="v">{BRL(descontoResultado.lucro)}</span></div>
                  <div className="kv"><span className="k">Margem com desconto</span><span className="v">{descontoResultado.margem != null ? PCT(descontoResultado.margem) : "—"}</span></div>
                  <Termometro valor={descontoResultado.margem || 0} meta={n(lucratividade) / 100} />
                  <DeltaAvulso delta={descontoResultado.lucro - normal.lucro} />
                  <Breakeven lucroNormal={normal.lucro} lucroPromo={descontoResultado.lucro} />
                </>
              )}
            </div>
          ) : tipo === "progressivo" ? (
            <div className="panel">
              <h3 className="section-title">
                Progressivo por quantidade
                <Ajuda texto="Cada faixa aplica um desconto % maior conforme a quantidade comprada — a taxa fixa do canal continua sendo cobrada por unidade (é assim que Shopee/ML tratam item por item, mesmo em um pedido só). “Equilíbrio” é quantas vezes mais peças você precisa vender NESSA faixa (em vez de vender avulso, no preço normal) pra igualar o lucro total — quanto maior o desconto da faixa, mais volume ela exige pra compensar. É pra venda dentro do marketplace (o desconto aparece nas faixas de quantidade do próprio anúncio). Pra um pedido combinado direto com o cliente, fora do marketplace, use “Encomenda em volume” em Orçamento." />
              </h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>A partir de</th>
                      <th className="num">Desconto</th>
                      <th className="num">Preço/un.</th>
                      <th className="num">Lucro/un.</th>
                      <th className="num">Margem</th>
                      <th className="num">Vs. avulso</th>
                      <th className="num">Equilíbrio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhasProgressivo.map((t, i) => (
                      <tr key={i}>
                        <td>
                          <input
                            type="number"
                            step="1"
                            style={{ width: 55 }}
                            value={t.qtd}
                            onChange={(e) => atualizarTier(i, "qtd", e.target.value)}
                          />{" "}
                          un.
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            step="1"
                            style={{ width: 55, textAlign: "right" }}
                            value={t.desconto}
                            onChange={(e) => atualizarTier(i, "desconto", e.target.value)}
                          />%
                        </td>
                        <td className="num">{BRL(t.precoUnit)}</td>
                        <td className="num">{BRL(t.lucroUnit)}</td>
                        <td className="num">{t.margemUnit != null ? PCT(t.margemUnit) : "—"}</td>
                        <td className="num" style={{ color: t.deltaVsAvulso >= 0 ? "var(--good)" : "var(--bad)" }}>
                          {t.deltaVsAvulso >= 0 ? "+" : ""}{BRL(t.deltaVsAvulso)}
                        </td>
                        <td className="num">
                          {normal.lucro > 0 && t.lucroUnit > 0 ? `${(normal.lucro / t.lucroUnit).toFixed(2)}×` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : tipo === "combo" ? (
            <div className="panel">
              <h3 className="section-title">
                Combo — leve mais, pague menos
                <Ajuda texto="Vendido como um único pedido/kit: a taxa fixa do canal é cobrada uma vez só (não por unidade), então quanto maior o kit, mais essa economia ajuda a bancar o desconto. É um desconto por levar um combo fechado (leve X, pague Y) numa venda no marketplace — diferente do “Progressivo”, que dá desconto crescente por faixa de quantidade." />
              </h3>
              <div className="row2">
                <div className="field">
                  <label>Leva (unidades)</label>
                  <input type="number" step="1" min="1" value={levar} onChange={(e) => setLevar(e.target.value)} />
                </div>
                <div className="field">
                  <label>Paga (unidades)</label>
                  <input type="number" step="1" min="0" value={pagar} onChange={(e) => setPagar(e.target.value)} />
                </div>
              </div>
              {combo && (
                <>
                  <div className="kv"><span className="k">Preço do kit ({combo.L} un.)</span><span className="v">{BRL(combo.precoKit)}</span></div>
                  <div className="kv"><span className="k">Preço efetivo por unidade</span><span className="v">{BRL(combo.precoUnidadeEfetivo)}</span></div>
                  {normal.preco > 0 && (
                    <div className="kv">
                      <span className="k">Desconto equivalente vs. preço normal</span>
                      <span className="v">{PCT(Math.max(0, 1 - combo.precoUnidadeEfetivo / normal.preco))}</span>
                    </div>
                  )}
                  <div className="kv total"><span className="k">Lucro do kit</span><span className="v">{BRL(combo.lucroKit)}</span></div>
                  <div className="kv"><span className="k">Lucro efetivo por unidade</span><span className="v">{BRL(combo.lucroUnidadeEfetivo)}</span></div>
                  <div className="kv">
                    <span className="k">Margem do kit</span>
                    <span className="v">{combo.margemKit != null ? PCT(combo.margemKit) : "—"}</span>
                  </div>
                  <Termometro valor={combo.margemKit || 0} meta={n(lucratividade) / 100} />
                  <div className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
                    Economia de taxa fixa por vender junto: {BRL(combo.economiaTaxaFixa)} (comparado a vender as {combo.L} unidades em pedidos separados).
                  </div>
                  <DeltaAvulso delta={combo.deltaVsAvulso} sufixo={` (total do pedido, vs. vender ${combo.L} unidades avulsas)`} />
                  <Breakeven lucroNormal={normal.lucro} lucroPromo={combo.lucroUnidadeEfetivo} />
                </>
              )}
            </div>
          ) : tipo === "liquidacao" ? (
            <div className="panel">
              <h3 className="section-title">
                Liquidação com piso de margem
                <Ajuda texto="Em vez de chutar um desconto e ver o que sobra, você define a margem mínima que aceita — o app calcula o maior desconto possível sem furar esse piso. Útil pra saída de estoque sem vender no prejuízo." />
              </h3>
              <div className="field">
                <label>Margem mínima aceitável (%)</label>
                <input type="number" step="1" value={margemMinima} onChange={(e) => setMargemMinima(e.target.value)} />
              </div>
              {liquidacao && !liquidacao.possivel ? (
                <div className="empty">Essa margem mínima é maior que o teto possível pra esse canal/custo — reduza o piso.</div>
              ) : liquidacao ? (
                <>
                  <div className="kv"><span className="k">Preço mínimo permitido</span><span className="v">{BRL(liquidacao.precoMinimo)}</span></div>
                  <div className="kv">
                    <span className="k">Desconto máximo sobre o preço normal</span>
                    <span className="v">{liquidacao.descontoMaximo != null ? PCT(liquidacao.descontoMaximo) : "—"}</span>
                  </div>
                  <div className="kv total"><span className="k">Lucro nesse piso</span><span className="v">{BRL(liquidacao.lucroNoPiso)}</span></div>
                  <DeltaAvulso delta={liquidacao.delta} />
                  <Breakeven lucroNormal={normal.lucro} lucroPromo={liquidacao.lucroNoPiso} />
                </>
              ) : null}
            </div>
          ) : (
            <div className="panel">
              <h3 className="section-title">
                Frete grátis subsidiado
                <Ajuda texto="Frete grátis costuma aumentar conversão e ranking no marketplace — vale comparar esse lucro com o ganho esperado em volume de vendas." />
              </h3>
              <div className="field">
                <label>Frete que você vai absorver (R$)</label>
                <input type="number" step="0.01" value={freteAbsorvido} onChange={(e) => setFreteAbsorvido(e.target.value)} />
              </div>
              {freteGratis && (
                <>
                  <div className="kv"><span className="k">Preço (não muda)</span><span className="v">{BRL(normal.preco)}</span></div>
                  <div className="kv total"><span className="k">Lucro absorvendo o frete</span><span className="v">{BRL(freteGratis.lucro)}</span></div>
                  <div className="kv">
                    <span className="k">Margem absorvendo o frete</span>
                    <span className="v">{freteGratis.margem != null ? PCT(freteGratis.margem) : "—"}</span>
                  </div>
                  <Termometro valor={freteGratis.margem || 0} meta={n(lucratividade) / 100} />
                  <DeltaAvulso delta={freteGratis.delta} />
                  <Breakeven lucroNormal={normal.lucro} lucroPromo={freteGratis.lucro} />
                </>
              )}
            </div>
          )}

          {resumoParaSalvar && (
            <div className="panel">
              <h3 className="section-title">
                Salvar essa promoção
                <Ajuda texto="Promoções com o mesmo nome ficam agrupadas em Promoções salvas — por isso, se essa é mais um produto de uma promoção que você já vem cadastrando (ex: 'Black Friday 15%'), reaproveite o mesmo nome em vez de criar um novo. Guarda esse resultado em “Promoções salvas” pra consultar depois — não muda nada no cadastro do produto/canal. Promoções com o mesmo nome ficam agrupadas lá." />
              </h3>
              <div className="save-row">
                <div className="field" ref={nomePromoRef} style={{ position: "relative" }}>
                  <label>Nome da promoção</label>
                  <input
                    type="text"
                    placeholder="ex: Black Friday 15%"
                    value={nomePromo}
                    onChange={(e) => {
                      setNomePromo(e.target.value);
                      setSugestaoNomeAberta(true);
                    }}
                    onFocus={() => setSugestaoNomeAberta(true)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") salvarPromocao();
                    }}
                  />
                  {sugestaoNomeAberta && sugestoesNomePromo.length > 0 && (
                    <div className="seletor-item-sugestoes">
                      {sugestoesNomePromo.map((n) => (
                        <button
                          type="button"
                          key={n}
                          onClick={() => {
                            setNomePromo(n);
                            setSugestaoNomeAberta(false);
                          }}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button className="btn primary" onClick={salvarPromocao} disabled={salvandoPromo}>
                  {salvandoPromo ? "Salvando…" : "Salvar"}
                </button>
              </div>
              {nomePromoParecido && (
                <div className="hint" style={{ marginTop: -4, marginBottom: 8 }}>
                  Já existe uma promoção parecida: "{nomePromoParecido}".{" "}
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "2px 8px", fontSize: 12, fontWeight: 400 }}
                    onClick={() => setNomePromo(nomePromoParecido)}
                  >
                    Usar esse nome
                  </button>{" "}
                  ou continue pra salvar "{nomePromo.trim()}" como uma promoção nova mesmo.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {resumoComparativo && resumoComparativo.length > 1 && (
        <div className="panel">
          <h3 className="section-title">
            Comparativo entre promoções
            <Ajuda texto="Lado a lado, o resultado de cada tipo de promoção configurada acima pra esse mesmo produto e canal — pra decidir qual vale mais a pena sem ficar trocando de aba. Só entra na lista o tipo que já tem uma configuração válida (ex: liquidação só aparece quando o piso de margem informado é viável). “Progressivo por quantidade” não entra aqui porque tem uma faixa por quantidade (veja a própria aba) e “Venda combinada” parte de uma seleção de itens diferente do produto único comparado acima." />
          </h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th className="num">Preço</th>
                  <th className="num">Lucro</th>
                  <th className="num">Margem</th>
                  <th className="num">Vs. normal</th>
                  <th className="num">Equilíbrio</th>
                </tr>
              </thead>
              <tbody>
                {resumoComparativo.map((l) => (
                  <tr key={l.key} style={l.key === "normal" ? { fontWeight: 600 } : undefined}>
                    <td>{l.label}</td>
                    <td className="num">{BRL(l.preco)}</td>
                    <td className="num">{BRL(l.lucro)}</td>
                    <td className="num">{l.margem != null ? PCT(l.margem) : "—"}</td>
                    <td className="num" style={l.deltaVsNormal != null ? { color: l.deltaVsNormal >= 0 ? "var(--good)" : "var(--bad)" } : undefined}>
                      {l.deltaVsNormal != null ? `${l.deltaVsNormal >= 0 ? "+" : ""}${BRL(l.deltaVsNormal)}` : "—"}
                    </td>
                    <td className="num">{l.mult != null ? `${l.mult.toFixed(2)}×` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
