import { PASSOS } from "./lib/passosPreco.js";
import { trocarSubAba, useSubAba } from "./lib/subAbas.js";
import { pegarPedido, pegarPedidoSemConsumir } from "./lib/navegar.js";
import { assinarMarcas, lerMarcas, somarMarcas } from "./lib/marcas.js";
import { CrescimentoProvider } from "./hooks/useCrescimento.js";
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { assinarUrgentes, lerUrgentes } from "./lib/urgentes.js";
import MarcaApp from "./components/MarcaApp.jsx";
import TelaDescanso from "./components/TelaDescanso.jsx";
import LojaSwitcher from "./components/LojaSwitcher.jsx";
import LojaGate from "./components/LojaGate.jsx";
import Icone from "./components/Icone.jsx";
import Ajuda from "./components/Ajuda.jsx";
import { LegendaEstados } from "./components/Estado.jsx";
import { useLoja } from "./lib/LojaContext.jsx";

// Se um deploy novo saiu com o app aberto, o pedaço antigo da aba não existe
// mais no servidor — recarrega a página uma vez pra pegar a versão nova.
function lazyAba(importar) {
  return lazy(() =>
    importar()
      .then((m) => {
        try {
          sessionStorage.removeItem("ohra:recarregou-aba");
        } catch {
          // sem sessionStorage — tudo bem
        }
        return m;
      })
      .catch((err) => {
        try {
          if (!sessionStorage.getItem("ohra:recarregou-aba")) {
            sessionStorage.setItem("ohra:recarregou-aba", "1");
            window.location.reload();
            return new Promise(() => {});
          }
        } catch {
          // sem sessionStorage — segue pro erro
        }
        throw err;
      })
  );
}

// Cada aba vira um pedaço separado do JS, baixado só quando a aba é aberta
// pela primeira vez (o app abre mais rápido, principalmente no celular).
const CustoProducao = lazyAba(() => import("./components/CustoProducao.jsx"));
const RegistroImpressoes = lazyAba(() => import("./components/RegistroImpressoes.jsx"));
const PrecificacaoPagina = lazyAba(() => import("./components/PrecificacaoPagina.jsx"));
const Cadastros = lazyAba(() => import("./components/Cadastros.jsx"));
const Orcamento = lazyAba(() => import("./components/Orcamento.jsx"));
const Promocoes = lazyAba(() => import("./components/Promocoes.jsx"));
const Otimizacao = lazyAba(() => import("./components/Otimizacao.jsx"));
const Metas = lazyAba(() => import("./components/Metas.jsx"));
const Ranking = lazyAba(() => import("./components/Ranking.jsx"));
const Historico = lazyAba(() => import("./components/Historico.jsx"));
const Tutorial = lazyAba(() => import("./components/Tutorial.jsx"));
const Configuracao = lazyAba(() => import("./components/Configuracao.jsx"));
const Crescimento = lazyAba(() => import("./components/Crescimento.jsx"));
const FluxoCaixa = lazyAba(() => import("./components/FluxoCaixa.jsx"));
const Analise = lazyAba(() => import("./components/Analise.jsx"));
const Live = lazyAba(() => import("./components/Live.jsx"));
const MinhaFarm = lazyAba(() => import("./components/MinhaFarm.jsx"));
const Inicio = lazyAba(() => import("./components/Inicio.jsx"));
const AtualizarDados = lazyAba(() => import("./components/AtualizarDados.jsx"));
const Anuncios = lazyAba(() => import("./components/Anuncios.jsx"));
const PainelAnuncio = lazyAba(() => import("./components/PainelAnuncio.jsx"));
const PaginaProduto = lazyAba(() => import("./components/PaginaProduto.jsx"));
const ResumoMes = lazyAba(() => import("./components/ResumoMes.jsx"));
const CompararPeriodos = lazyAba(() => import("./components/CompararPeriodos.jsx"));
const Insumos = lazyAba(() => import("./components/Insumos.jsx"));

const THEME_KEY = "ohra:theme";

function loadTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // sem problema, usa o padrão
  }
  return "light";
}

// Menu do REMAP (21/10/2026, aprovado pelo Gustavo pela prévia remap-v1): dois
// "centros" por produto — Página do produto (o produto em si, todos os canais)
// e Painel do anúncio (o produto NUM canal). As telas de antes continuam com as
// MESMAS chaves de aba (irPara, irParaAba, aba lembrada e links do Início
// seguem valendo); só mudaram de item no menu. Entradas com `oculta` não
// aparecem no cabeçalho (são abertas por clique: produto, anúncio) e `tambem`
// marca a sub-aba como ativa quando a tela aberta é uma dessas.
const SEP = { sep: true };
const MENU = [
  {
    grupo: null,
    itens: [
      { key: "m-inicio", label: "Início", icone: "inicio", sub: "O que pede atenção hoje e como a loja está", abas: [{ tab: "inicio", label: "Início" }] },
      { key: "m-atualizar", label: "Atualizar dados", icone: "analise", sub: "Pedidos, desempenho, Ads, GMV Max, avaliações e venda física — tudo que vem dos marketplaces", abas: [{ tab: "importar", label: "Atualizar dados" }] },
    ],
  },
  {
    grupo: "Loja",
    itens: [
      {
        key: "m-produtos",
        label: "Produtos",
        icone: "cadastros",
        sub: "Catálogo, cadastro e custo de cada peça — clique num produto pra ver tudo dele",
        abas: [
          { tab: "cadastros", s: "catalogo", label: "Catálogo", tambem: "produto" },
          { tab: "produto", label: "Página do produto", oculta: true },
          { tab: "cadastros", s: "produtos", label: "Cadastro de produtos" },
          { tab: "cadastros", s: "kits", label: "Kits" },
          SEP,
          { tab: "producao", label: "Simular custo" },
        ],
      },
      {
        key: "m-anuncios",
        label: "Anúncios",
        icone: "historico",
        sub: "Cada produto em cada canal — preço, vendas, rampa, Ads e o que digitar",
        abas: [
          { tab: "anuncios", label: "Todos os anúncios", tambem: "anuncio" },
          { tab: "anuncio", label: "Painel do anúncio", oculta: true },
          { tab: "historico", label: "Preços salvos" },
          { tab: "canal", s: "comparar", label: "Comparar canais" },
          SEP,
          ...PASSOS.map((p) => ({ tab: "canal", s: p.key, label: p.label, ordem: p.ordem })),
        ],
      },
      {
        key: "m-vender",
        label: "Vender mais",
        icone: "crescimento",
        sub: "Rampa de preço, Ads, afiliados, promoções e atacado",
        abas: [
          { tab: "crescimento", s: "rampa", label: "Rampa de preço" },
          { tab: "crescimento", s: "ads", label: "Ads" },
          { tab: "crescimento", s: "afiliados", label: "Afiliados" },
          SEP,
          { tab: "promocoes", label: "Promoções e cupons" },
          { tab: "orcamento", label: "Orçamento e atacado" },
        ],
      },
      {
        key: "m-live",
        label: "Live",
        icone: "live",
        sub: "Planejar, fazer e comparar lives — à parte do resto da loja",
        abas: [
          { tab: "live", s: "planejar", label: "Planejar", ordem: "1" },
          { tab: "live", s: "aovivo", label: "Ao vivo", ordem: "2" },
          { tab: "live", s: "resultados", label: "Resultados", ordem: "3" },
        ],
      },
    ],
  },
  {
    grupo: "Operação",
    itens: [
      {
        key: "m-dinheiro",
        label: "Dinheiro",
        icone: "caixa",
        sub: "Resumo do mês, caixa, contas, vendas, payoff, metas e retorno por item",
        abas: [
          { tab: "resumoMes", label: "Resumo do mês" },
          SEP,
          { tab: "caixa", s: "caixa", label: "Caixa", ordem: "1" },
          { tab: "caixa", s: "contas", label: "Contas fixas e parcelas", ordem: "2" },
          { tab: "caixa", s: "vendas", label: "Vendas do mês", ordem: "3" },
          { tab: "caixa", s: "payoff", label: "Payoff", ordem: "4" },
          SEP,
          { tab: "metas", label: "Metas" },
          { tab: "ranking", label: "Ranking por retorno" },
        ],
      },
      {
        key: "m-analise",
        label: "Análise",
        icone: "analise",
        sub: "Pedidos reais: curva ABC, XYZ, evolução e comparar períodos",
        abas: [
          { tab: "analise", s: "abc", label: "Curva ABC" },
          { tab: "analise", s: "xyz", label: "Curva XYZ" },
          { tab: "analise", s: "evolucao", label: "Evolução e métricas" },
          { tab: "compararPeriodos", label: "Comparar períodos" },
        ],
      },
      {
        key: "m-producao",
        label: "Produção",
        icone: "registroImpressoes",
        sub: "Impressões, planejamento, as impressoras e os insumos",
        abas: [
          { tab: "registroImpressoes", label: "Registro de impressões" },
          { tab: "otimizacao", label: "Otimização" },
          { tab: "farm", label: "Minha farm" },
          SEP,
          { tab: "insumos", s: "materiais", label: "Materiais" },
          { tab: "insumos", s: "embalagens", label: "Embalagens" },
        ],
      },
    ],
  },
  {
    grupo: "",
    itens: [
      {
        key: "m-config",
        label: "Configuração",
        icone: "config",
        sub: "Lojas, canais, taxas e as regras do app",
        abas: [
          { tab: "config", s: "lojas", label: "Lojas" },
          { tab: "config", s: "canais", label: "Canais" },
          { tab: "config", s: "taxas", label: "Taxas dos marketplaces" },
          { tab: "config", s: "regras", label: "Regras" },
        ],
      },
    ],
  },
];
const ITENS_MENU = MENU.flatMap((g) => g.itens.map((i) => ({ ...i, grupo: g.grupo })));
const menuDaAba = (tab) => ITENS_MENU.find((i) => i.abas.some((a) => a.tab === tab)) || null;

const TUTORIAL = { key: "tutorial", label: "Tutorial", sub: "Checklist de primeiros passos" };

// Todas as abas (chaves) que existem — as do menu + o Tutorial.
const TABS = [...new Set(ITENS_MENU.flatMap((i) => i.abas.filter((a) => a.tab).map((a) => a.tab)))].map((key) => ({ key })).concat(TUTORIAL);

const TAB_KEY = "ohra:ultima-aba";
// Chaves das sub-abas lembradas das telas (as mesmas que as telas já usavam).
const SUB_CHAVE = { cadastros: "ohra:cadastros-sub", crescimento: "ohra:crescimento-sub", caixa: "ohra:caixa:sub", analise: "ohra:analise-sub", live: "ohra:live-sub", insumos: "ohra:insumos-sub" };

// O app abre no Início (sessão nova do navegador). Recarregar a página na
// mesma sessão continua na aba em que estava — só aceita uma chave que ainda
// exista (uma aba pode ter sido renomeada/removida entre versões do app).
function loadTab() {
  try {
    const saved = sessionStorage.getItem(TAB_KEY);
    // "lojas"/"canais"/"taxas" viraram sub-abas de "config" (set/2026)
    if (saved === "lojas" || saved === "canais" || saved === "taxas") return "config";
    // "Comparativo" virou a sub-aba "Comparar canais" da Precificação por Canal (set/2026)
    if (saved === "comparativo") return "canal";
    // "Importar vendas" saiu do menu (out/2026): virou Fluxo de Caixa → Vendas do mês
    if (saved === "importarVendas") return "caixa";
    // Remap (21/10/2026): Importar dados virou aba própria.
    if (saved === "analise" && localStorage.getItem("ohra:analise-sub") === "importar") return "importar";
    if (saved && TABS.some((t) => t.key === saved)) return saved;
  } catch {
    // sem problema, usa o padrão
  }
  return "inicio";
}

export default function App() {
  const { disponivel: lojasDisponivel, carregando: carregandoLoja, lojaId, precisaPin } = useLoja();
  const [tab, setTab] = useState(loadTab);
  // Abas já abertas nesta sessão: só montam na primeira visita e depois
  // continuam montadas (escondidas) — o que você digitou não se perde.
  // O Início monta sempre (escondido): é ele que calcula as bolinhas do menu
  // (marcas e urgentes) — sem isso, abrir o app direto noutra aba não as mostrava.
  const [visitadas, setVisitadas] = useState(() => new Set([tab, "inicio"]));
  if (!visitadas.has(tab)) setVisitadas(new Set(visitadas).add(tab));
  const [configSub, setConfigSub] = useState("lojas");
  const [cadastrosSub] = useSubAba(SUB_CHAVE.cadastros, "catalogo", ["catalogo", "produtos", "kits"]);
  const [crescimentoSub] = useSubAba(SUB_CHAVE.crescimento, "rampa");
  const [caixaSub] = useSubAba(SUB_CHAVE.caixa, "caixa");
  const [analiseSub] = useSubAba(SUB_CHAVE.analise, "abc", ["abc", "xyz", "evolucao"]);
  const [insumosSub] = useSubAba(SUB_CHAVE.insumos, "materiais", ["materiais", "embalagens"]);
  const [liveSub] = useSubAba(SUB_CHAVE.live, "planejar");
  // Última tela aberta dentro de cada item do menu (estado derivado da aba atual).
  const [ultimaDoMenu, setUltimaDoMenu] = useState({});
  const menuDaTab = menuDaAba(tab);
  if (menuDaTab && ultimaDoMenu[menuDaTab.key] !== tab) setUltimaDoMenu({ ...ultimaDoMenu, [menuDaTab.key]: tab });
  const [canalSub, setCanalSub] = useState(() => {
    try {
      if (sessionStorage.getItem(TAB_KEY) === "comparativo" || localStorage.getItem(TAB_KEY) === "comparativo") return "comparar";
      const s = localStorage.getItem("ohra:canal-sub");
      if (["avulso", "quantidade", "ficha", "lancamento", "comparar", "publicar"].includes(s)) return s;
    } catch {
      // sem problema
    }
    return "avulso";
  });
  const [custoRecebido, setCustoRecebido] = useState(null);
  const [produtoRecebido, setProdutoRecebido] = useState(null);
  const [abrirItem, setAbrirItem] = useState(null); // { tipo: "produto"|"kit", id, seq } — vindo de "editar completo" em Preços por Canal
  const [produtoParaPrecificar, setProdutoParaPrecificar] = useState(null); // { id, seq } — vindo de "Ir para Precificação por Canal" logo depois de cadastrar um produto novo em Produtos
  const [toast, setToast] = useState({ msg: "", show: false });
  const [tema, setTema] = useState(loadTheme);
  const [menuAberto, setMenuAberto] = useState(false);
  const toastTimer = useRef(null);
  // Altura real do cabeçalho (muda com a linha de sub-abas) → --topbar-h,
  // usada pelo que gruda embaixo dele (ResumoFixo, cabeçalho das tabelas).
  const topbarRef = useRef(null);
  useEffect(() => {
    const el = topbarRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty("--topbar-h", `${Math.round(el.getBoundingClientRect().height)}px`));
    ro.observe(el);
    return () => ro.disconnect();
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", tema);
    try {
      localStorage.setItem(THEME_KEY, tema);
    } catch {
      // sem problema, só não lembra da próxima vez
    }
  }, [tema]);

  function alternarTema() {
    setTema((t) => (t === "dark" ? "light" : "dark"));
  }

  useEffect(() => {
    try {
      localStorage.setItem("ohra:canal-sub", canalSub);
    } catch {
      // sem problema
    }
  }, [canalSub]);

  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
      sessionStorage.setItem(TAB_KEY, tab);
    } catch {
      // sem problema, só não lembra da próxima vez
    }
  }, [tab]);

  function showToast(msg) {
    setToast({ msg, show: true });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 2200);
  }

  function usarCusto(total) {
    setCustoRecebido((prev) => ({ value: total, seq: (prev?.seq || 0) + 1 }));
    setTab("canal");
    setCanalSub("avulso");
    showToast("Custo levado para a Precificação por Canal");
  }

  function salvarComoProduto({ custo, materialNome, detalhe, id, nome, pecasPorImpressao, peso }) {
    setProdutoRecebido((prev) => ({
      custo,
      peso: peso || null,
      materialNome,
      detalhe,
      id: id || null,
      nome: nome || "",
      pecasPorImpressao: pecasPorImpressao ?? 1,
      seq: (prev?.seq || 0) + 1,
      lojaId, // o pedido vale só na loja em que foi feito
    }));
    setTab("cadastros");
    showToast(id ? "Detalhamento levado para atualizar o produto" : "Custo levado para o cadastro de Produtos");
  }

  function editarItemCompleto(tipo, id) {
    setAbrirItem((prev) => ({ tipo, id, seq: (prev?.seq || 0) + 1, lojaId }));
    setTab("cadastros");
  }

  // Depois de cadastrar um produto NOVO em Cadastros → Produtos, o botão "Ir
  // para Precificação por Canal" pula direto pra lá com esse produto já
  // selecionado em "Produto ou kit cadastrado" — mesma ideia de usarCusto,
  // só que seleciona um item do catálogo em vez de levar um valor solto.
  function irParaPrecificarProduto(id) {
    setProdutoParaPrecificar((prev) => ({ id, seq: (prev?.seq || 0) + 1 }));
    setTab("canal");
    setCanalSub("avulso");
    showToast("Produto levado para a Precificação por Canal");
  }

  function irPara(key) {
    if (key === "lojas" || key === "canais" || key === "taxas" || key === "regras") {
      setConfigSub(key);
      key = "config";
    }
    if (key === "comparativo") {
      setCanalSub("comparar");
      key = "canal";
    }
    if (key === "importarVendas") key = "caixa";
    // Remap (21/10/2026): Importar dados virou o item "Atualizar dados".
    if (key === "analise" && pegarPedidoSemConsumir("analise")?.sub === "importar") {
      pegarPedido("analise");
      key = "importar";
    }
    if (key === "publicar" || key === "lancamento" || key === "ficha" || key === "quantidade" || key === "avulso") {
      setCanalSub(key);
      key = "canal";
    }
    setTab(key);
    setMenuAberto(false);
  }

  // Pedidos de navegação vindos de dentro das telas (lib/navegar.js).
  useEffect(() => {
    const ouvir = (e) => irPara(e.detail.aba);
    window.addEventListener("ohra:ir-para", ouvir);
    return () => window.removeEventListener("ohra:ir-para", ouvir);
  });

  function irParaMateriais() {
    trocarSubAba(SUB_CHAVE.insumos, "materiais");
    setTab("insumos");
  }

  const menuAtual = menuDaAba(tab);
  const grupoAtual = tab === "tutorial" ? "Ajuda" : menuAtual?.grupo || "Margem Real";
  const tituloAtual = tab === "tutorial" ? TUTORIAL.label : menuAtual?.label;
  const subtituloAtual = tab === "tutorial" ? TUTORIAL.sub : menuAtual?.sub;
  const subDaAba = { canal: canalSub, config: configSub, cadastros: cadastrosSub, crescimento: crescimentoSub, caixa: caixaSub, analise: analiseSub, live: liveSub, insumos: insumosSub };
  const abaAtiva = (a) => (a.tab === tab && (!a.s || a.s === subDaAba[a.tab])) || (a.tambem && a.tambem === tab);
  // Vai pra uma sub-aba do cabeçalho: troca a aba e a sub-aba dela.
  function irParaEntrada(a) {
    if (a.tab === "canal") setCanalSub(a.s);
    else if (a.tab === "config") setConfigSub(a.s);
    else if (a.s) trocarSubAba(SUB_CHAVE[a.tab], a.s);
    setTab(a.tab);
    setMenuAberto(false);
  }
  // Item do menu: volta pra última tela usada dentro dele (senão a 1ª).
  function irParaMenu(item) {
    const ultima = ultimaDoMenu[item.key];
    const entrada = (ultima && item.abas.find((a) => !a.sep && a.tab === ultima)) || item.abas.find((a) => !a.sep && !a.oculta);
    if (entrada.tab === ultima) {
      setTab(entrada.tab);
      setMenuAberto(false);
    } else irParaEntrada(entrada);
  }

  // Nenhuma aba pode montar (e nenhum dado pode ser buscado) enquanto a
  // loja atual não estiver definida e, se tiver PIN, desbloqueada nesta
  // sessão — vale tanto na primeira visita quanto numa aba/janela anônima,
  // onde não há nada salvo em localStorage/sessionStorage ainda.
  const bloqueado = lojasDisponivel && (carregandoLoja || !lojaId || precisaPin(lojaId));
  if (bloqueado) {
    return <LojaGate onToast={showToast} />;
  }

  return (
    <CrescimentoProvider>
    <div className={`shell ${menuAberto ? "menu-aberto" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <MarcaApp tamanho={30} />
          <div>
            <div className="word">MARGEM REAL</div>
            <div className="tagline">o lucro de verdade</div>
          </div>
        </div>

        <LojaSwitcher onGerenciar={() => irPara("lojas")} />

        <nav className="side-nav">
          {MENU.map((g, gi) => (
            <div className="side-nav-grupo" key={gi}>
              {g.grupo ? <div className="side-nav-label">{g.grupo}</div> : g.grupo === "" ? <div className="side-nav-espaco" /> : null}
              {g.itens.map((item) => (
                <button key={item.key} data-menu={item.key} className={menuAtual?.key === item.key ? "active" : ""} onClick={() => irParaMenu(item)} title={item.label}>
                  <Icone nome={item.icone} />
                  <span>{item.label}</span>
                  {item.key === "m-inicio" ? <BolinhaUrgentes /> : <Marcas filtro={(k) => item.abas.some((a) => a.tab && a.tab === k.split(":")[0])} />}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <button data-tab="tutorial" className={`sidebar-foot-link${tab === "tutorial" ? " active" : ""}`} onClick={() => irPara("tutorial")}>
            <Icone nome="tutorial" size={14} /> Tutorial
          </button>
          <button className="sidebar-foot-btn" onClick={alternarTema} title="Trocar tema">
            <Icone nome={tema === "dark" ? "sol" : "lua"} size={13} />
            {tema === "dark" ? "Claro" : "Escuro"}
          </button>
        </div>
      </aside>

      {menuAberto && <div className="sidebar-overlay" onClick={() => setMenuAberto(false)} />}

      <div className="main">
        <TelaDescanso />

        <header className="topbar" ref={topbarRef}>
          <button className="menu-toggle" onClick={() => setMenuAberto((v) => !v)} aria-label="Abrir menu">
            <Icone nome="menu" size={18} />
          </button>
          <div className="topbar-titulo">
            <div className="topbar-crumb">{grupoAtual}</div>
            <h1>{tituloAtual}</h1>
          </div>
          {subtituloAtual && <div className="topbar-sub">{subtituloAtual}</div>}
          <span className="topbar-legenda">
            <Ajuda texto={<LegendaEstados />} />
          </span>
          <div className="topbar-acoes">
            {TABS.map((t) => (
              <div key={t.key} id={`acoes-${t.key}`} className="topbar-acoes-slot" hidden={t.key !== tab} />
            ))}
          </div>
          {menuAtual && menuAtual.abas.filter((a) => !a.oculta).length > 1 && (
            <nav className="topbar-abas" aria-label={`Telas de ${menuAtual.label}`}>
              {menuAtual.abas.filter((a) => !a.oculta).map((a, i) =>
                a.sep ? (
                  <span key={`sep${i}`} className="topbar-abas-sep" />
                ) : (
                  <button key={`${a.tab}:${a.s || ""}`} type="button" data-tab={a.tab} data-sub={a.s} className={abaAtiva(a) ? "ativo" : ""} aria-current={abaAtiva(a) ? "page" : undefined} onClick={() => irParaEntrada(a)}>
                    {a.ordem && <span className="topbar-abas-ordem">{a.tab === "canal" ? a.ordem : `${a.ordem} ·`}</span>}
                    {a.label}
                    <Marcas filtro={(k) => k === (a.s ? `${a.tab}:${a.s}` : a.tab)} />
                  </button>
                ),
              )}
            </nav>
          )}
        </header>

        <div className="content">
        <section className={`view ${tab === "inicio" ? "active" : ""}`}>
          {visitadas.has("inicio") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <Inicio key={lojaId || "sem-loja"} onIrPara={irPara} onToast={showToast} />
            </Suspense>
          )}
        </section>

        <section className={`view ${tab === "config" ? "active" : ""}`}>
          {visitadas.has("config") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <Configuracao sub={configSub} onSub={setConfigSub} onToast={showToast} />
            </Suspense>
          )}
        </section>

        <section className={`view ${tab === "cadastros" ? "active" : ""}`}>
          {visitadas.has("cadastros") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <Cadastros produtoRecebido={produtoRecebido} abrirItem={abrirItem} onToast={showToast} onProdutoCriado={irParaPrecificarProduto} />
            </Suspense>
          )}
        </section>

        <section className={`view ${tab === "producao" ? "active" : ""}`}>
          {visitadas.has("producao") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <CustoProducao onUsarCusto={usarCusto} onSalvarProduto={salvarComoProduto} onIrParaMateriais={irParaMateriais} />
            </Suspense>
          )}
        </section>

        <section className={`view ${tab === "registroImpressoes" ? "active" : ""}`}>
          {visitadas.has("registroImpressoes") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <RegistroImpressoes onToast={showToast} />
            </Suspense>
          )}
        </section>

        <section className={`view ${tab === "canal" ? "active" : ""}`}>
          {visitadas.has("canal") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <PrecificacaoPagina
                sub={canalSub}
                onSub={setCanalSub}
                ativo={tab === "canal"}
                custoRecebido={custoRecebido}
                produtoParaSelecionar={produtoParaPrecificar}
                onToast={showToast}
              />
            </Suspense>
          )}
        </section>

        <section className={`view ${tab === "orcamento" ? "active" : ""}`}>
          {visitadas.has("orcamento") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <Orcamento onToast={showToast} />
            </Suspense>
          )}
        </section>

        <section className={`view ${tab === "promocoes" ? "active" : ""}`}>
          {visitadas.has("promocoes") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <Promocoes onToast={showToast} />
            </Suspense>
          )}
        </section>

        <section className={`view ${tab === "crescimento" ? "active" : ""}`}>
          {visitadas.has("crescimento") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <Crescimento key={lojaId || "sem-loja"} onToast={showToast} />
            </Suspense>
          )}
        </section>

        <section className={`view ${tab === "caixa" ? "active" : ""}`}>
          {visitadas.has("caixa") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <FluxoCaixa key={lojaId || "sem-loja"} onToast={showToast} />
            </Suspense>
          )}
        </section>

        <section className={`view ${tab === "analise" ? "active" : ""}`}>
          {visitadas.has("analise") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <Analise key={lojaId || "sem-loja"} onToast={showToast} />
            </Suspense>
          )}
        </section>

        <section className={`view ${tab === "live" ? "active" : ""}`}>
          {visitadas.has("live") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <Live key={lojaId || "sem-loja"} onToast={showToast} />
            </Suspense>
          )}
        </section>

        <section className={`view ${tab === "farm" ? "active" : ""}`}>
          {visitadas.has("farm") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <MinhaFarm key={lojaId || "sem-loja"} onToast={showToast} />
            </Suspense>
          )}
        </section>

        <section className={`view ${tab === "metas" ? "active" : ""}`}>
          {visitadas.has("metas") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <Metas onToast={showToast} />
            </Suspense>
          )}
        </section>

        <section className={`view ${tab === "ranking" ? "active" : ""}`}>
          {visitadas.has("ranking") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <Ranking />
            </Suspense>
          )}
        </section>

        <section className={`view ${tab === "otimizacao" ? "active" : ""}`}>
          {visitadas.has("otimizacao") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <Otimizacao onToast={showToast} />
            </Suspense>
          )}
        </section>

        <section className={`view ${tab === "historico" ? "active" : ""}`}>
          {visitadas.has("historico") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <Historico onEditarCompleto={editarItemCompleto} onToast={showToast} />
            </Suspense>
          )}
        </section>

        <section className={`view ${tab === "importar" ? "active" : ""}`}>
          {visitadas.has("importar") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <AtualizarDados key={lojaId || "sem-loja"} onToast={showToast} />
            </Suspense>
          )}
        </section>

        <section className={`view ${tab === "anuncios" ? "active" : ""}`}>
          {visitadas.has("anuncios") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <Anuncios key={lojaId || "sem-loja"} />
            </Suspense>
          )}
        </section>

        <section className={`view ${tab === "anuncio" ? "active" : ""}`}>
          {visitadas.has("anuncio") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <PainelAnuncio key={lojaId || "sem-loja"} onToast={showToast} ativo={tab === "anuncio"} />
            </Suspense>
          )}
        </section>

        <section className={`view ${tab === "produto" ? "active" : ""}`}>
          {visitadas.has("produto") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <PaginaProduto key={lojaId || "sem-loja"} onToast={showToast} onEditar={editarItemCompleto} />
            </Suspense>
          )}
        </section>

        <section className={`view ${tab === "resumoMes" ? "active" : ""}`}>
          {visitadas.has("resumoMes") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <ResumoMes key={lojaId || "sem-loja"} />
            </Suspense>
          )}
        </section>

        <section className={`view ${tab === "compararPeriodos" ? "active" : ""}`}>
          {visitadas.has("compararPeriodos") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <CompararPeriodos key={lojaId || "sem-loja"} />
            </Suspense>
          )}
        </section>

        <section className={`view ${tab === "insumos" ? "active" : ""}`}>
          {visitadas.has("insumos") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <Insumos onToast={showToast} />
            </Suspense>
          )}
        </section>

        <section className={`view ${tab === "tutorial" ? "active" : ""}`}>
          {visitadas.has("tutorial") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <Tutorial />
            </Suspense>
          )}
        </section>

        <footer className="note">
          Taxas oficiais dos marketplaces conferidas em set/2026. Dados salvos na nuvem, acessíveis de qualquer aparelho.
        </footer>
        </div>
      </div>

      <NavCelular menuAtual={menuAtual} irParaMenu={irParaMenu} menuAberto={menuAberto} abrirMenu={() => setMenuAberto(true)} />

      <div className={`toast ${toast.show ? "show" : ""}`}>{toast.msg}</div>
    </div>
    </CrescimentoProvider>
  );
}

// Barra de navegação no celular (≤ 760px, só CSS decide quando aparece):
// 4 itens do menu + "Mais" (abre o menu lateral). No PC fica escondida.
const NAV_CELULAR = [
  { key: "m-inicio", rot: "Início" },
  { key: "m-anuncios", rot: "Anúncios" },
  { key: "m-vender", rot: "Vender" },
  { key: "m-dinheiro", rot: "Dinheiro" },
];
function NavCelular({ menuAtual, irParaMenu, menuAberto, abrirMenu }) {
  const naBarra = NAV_CELULAR.some((n) => n.key === menuAtual?.key);
  return (
    <nav className="nav-celular" aria-label="Navegação rápida">
      {NAV_CELULAR.map((n) => {
        const item = ITENS_MENU.find((i) => i.key === n.key);
        const ativo = menuAtual?.key === n.key;
        return (
          <button key={n.key} type="button" className={ativo && !menuAberto ? "ativo" : ""} onClick={() => irParaMenu(item)} aria-current={ativo ? "page" : undefined}>
            <Icone nome={item.icone} size={19} />
            <span className="rot">{n.rot}</span>
            {n.key === "m-inicio" && <BolinhaUrgentes />}
          </button>
        );
      })}
      <button type="button" className={menuAberto || !naBarra ? "ativo" : ""} onClick={abrirMenu} aria-label="Mais — abre o menu">
        <Icone nome="menu" size={19} />
        <span className="rot">Mais</span>
      </button>
    </nav>
  );
}

// Urgentes (grupo Resolver do Início): bolinha vermelha no menu, de qualquer tela.
function BolinhaUrgentes() {
  const n = useSyncExternalStore(assinarUrgentes, lerUrgentes, lerUrgentes);
  if (!n) return null;
  return (
    <span className="bolinha-menu bolinha-urgente" title={`${n} ${n === 1 ? "item urgente" : "itens urgentes"} no Início`}>
      {n}
    </span>
  );
}

// Marcas de notificação (src/lib/marcas.js, calculadas pelo Início):
// vermelha = resolver, âmbar = atenção (só quando não há vermelha), verde forte = oportunidade.
function Marcas({ filtro }) {
  const m = useSyncExternalStore(assinarMarcas, lerMarcas, lerMarcas);
  const t = somarMarcas(m, filtro);
  if (!t.r && !t.a && !t.o) return null;
  return (
    <span className="marcas">
      {t.r > 0 && <span className="marca marca-r" title={`${t.r} pra resolver`}>{t.r}</span>}
      {!t.r && t.a > 0 && <span className="marca marca-a" title={`${t.a} pedindo atenção`}>{t.a}</span>}
      {t.o > 0 && <span className="marca marca-o" title={`${t.o} oportunidade${t.o > 1 ? "s" : ""} (mais lucro)`}>↑{t.o}</span>}
    </span>
  );
}

