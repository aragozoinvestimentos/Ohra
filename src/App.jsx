import { lazy, Suspense, useEffect, useRef, useState } from "react";
import logo from "./assets/logo.png";
import TelaDescanso from "./components/TelaDescanso.jsx";
import LojaSwitcher from "./components/LojaSwitcher.jsx";
import LojaGate from "./components/LojaGate.jsx";
import Icone from "./components/Icone.jsx";
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
const ImportarVendas = lazyAba(() => import("./components/ImportarVendas.jsx"));
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

// A barra lateral é agrupada em etapas do fluxo de uso do dia a dia:
// precificar vem primeiro (é o que mais se usa), depois o catálogo, vender e
// gestão; a configuração da loja (feita uma vez só) fica por último. Cada
// aba tem um ícone de traço (Icone.jsx) e um subtítulo curto mostrado no
// cabeçalho da tela.
const GRUPOS = [
  {
    titulo: "Precificar",
    tabs: [
      { key: "producao", label: "Custo de Produção", sub: "Simule o custo de uma peça a partir do fatiador" },
      { key: "canal", label: "Precificação por Canal", sub: "Avulso, por quantidade, ficha do anúncio e anunciar" },
    ],
  },
  {
    titulo: "Catálogo",
    tabs: [
      { key: "historico", label: "Produtos precificados", sub: "Preços salvos por produto/kit e canal" },
      { key: "cadastros", label: "Cadastros", sub: "Materiais, embalagens, produtos e kits" },
    ],
  },
  {
    titulo: "Vender",
    tabs: [
      { key: "orcamento", label: "Orçamento", sub: "Encomendas avulsas e em volume" },
      { key: "promocoes", label: "Promoções", sub: "Simule descontos antes de publicar" },
      { key: "crescimento", label: "Crescimento", sub: "Rampa de preço no orgânico, Ads e afiliados" },
    ],
  },
  {
    titulo: "Gestão",
    tabs: [
      { key: "caixa", label: "Fluxo de Caixa", sub: "Entradas, saídas e projeção de até 12 meses" },
      { key: "metas", label: "Metas", sub: "Faturamento e lucro do mês" },
      { key: "ranking", label: "Ranking por Retorno", sub: "Quais itens dão mais lucro por hora" },
      { key: "otimizacao", label: "Otimização", sub: "Capacidade de produção da loja" },
      { key: "registroImpressoes", label: "Registro de Impressões", sub: "Taxa de falha real e lote máximo seguro" },
      { key: "importarVendas", label: "Importar vendas", sub: "Relatório de vendas da Olist (em construção)" },
    ],
  },
  {
    titulo: "Configuração",
    tabs: [
      { key: "config", label: "Lojas, canais e taxas", sub: "Configurações da loja e dos marketplaces" },
    ],
  },
];

const TUTORIAL = { key: "tutorial", label: "Tutorial", sub: "Checklist de primeiros passos" };

const TABS = [...GRUPOS.flatMap((g) => g.tabs), TUTORIAL];

const TAB_KEY = "ohra:ultima-aba";

// Lembra a última aba aberta pra não voltar sempre pro início ao atualizar
// a página — só aceita uma chave que ainda exista (uma aba pode ter sido
// renomeada/removida entre versões do app).
function loadTab() {
  try {
    const saved = localStorage.getItem(TAB_KEY);
    // "lojas"/"canais"/"taxas" viraram sub-abas de "config" (set/2026)
    if (saved === "lojas" || saved === "canais" || saved === "taxas") return "config";
    // "Comparativo" virou a sub-aba "Comparar canais" da Precificação por Canal (set/2026)
    if (saved === "comparativo") return "canal";
    if (saved && TABS.some((t) => t.key === saved)) return saved;
  } catch {
    // sem problema, usa o padrão
  }
  return "producao";
}

export default function App() {
  const { lojas, disponivel: lojasDisponivel, carregando: carregandoLoja, lojaId, precisaPin } = useLoja();
  const [tab, setTab] = useState(loadTab);
  // Abas já abertas nesta sessão: só montam na primeira visita e depois
  // continuam montadas (escondidas) — o que você digitou não se perde.
  const [visitadas, setVisitadas] = useState(() => new Set([tab]));
  if (!visitadas.has(tab)) setVisitadas(new Set(visitadas).add(tab));
  const [configSub, setConfigSub] = useState("lojas");
  const [canalSub, setCanalSub] = useState(() => {
    try {
      if (localStorage.getItem(TAB_KEY) === "comparativo") return "comparar";
      const s = localStorage.getItem("ohra:canal-sub");
      if (["avulso", "quantidade", "ficha", "comparar", "publicar"].includes(s)) return s;
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
    }));
    setTab("cadastros");
    showToast(id ? "Detalhamento levado para atualizar o produto" : "Custo levado para o cadastro de Produtos");
  }

  function editarItemCompleto(tipo, id) {
    setAbrirItem((prev) => ({ tipo, id, seq: (prev?.seq || 0) + 1 }));
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
    if (key === "lojas" || key === "canais" || key === "taxas") {
      setConfigSub(key);
      key = "config";
    }
    if (key === "comparativo") {
      setCanalSub("comparar");
      key = "canal";
    }
    setTab(key);
    setMenuAberto(false);
  }

  function irParaMateriais() {
    setTab("cadastros");
  }

  const tabAtual = TABS.find((t) => t.key === tab);
  const grupoAtual = GRUPOS.find((g) => g.tabs.some((t) => t.key === tab))?.titulo || "Ajuda";
  const lojaAtual = lojas.find((l) => l.id === lojaId) || null;

  // Nenhuma aba pode montar (e nenhum dado pode ser buscado) enquanto a
  // loja atual não estiver definida e, se tiver PIN, desbloqueada nesta
  // sessão — vale tanto na primeira visita quanto numa aba/janela anônima,
  // onde não há nada salvo em localStorage/sessionStorage ainda.
  const bloqueado = lojasDisponivel && (carregandoLoja || !lojaId || precisaPin(lojaId));
  if (bloqueado) {
    return <LojaGate onToast={showToast} />;
  }

  return (
    <div className={`shell ${menuAberto ? "menu-aberto" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          {lojaAtual?.icone_url ? (
            <img className="brand-foto" src={lojaAtual.icone_url} alt="" />
          ) : (
            <img className="brand-logo" src={logo} alt="" />
          )}
          <div>
            <div className="word">OHRA</div>
            <div className="tagline">Precificador</div>
          </div>
        </div>

        <LojaSwitcher onGerenciar={() => irPara("lojas")} />

        <nav className="side-nav">
          {GRUPOS.map((g) => (
            <div className="side-nav-grupo" key={g.titulo}>
              <div className="side-nav-label">{g.titulo}</div>
              {g.tabs.map((t) => (
                <button key={t.key} data-tab={t.key} className={tab === t.key ? "active" : ""} onClick={() => irPara(t.key)} title={t.label}>
                  <Icone nome={t.key} />
                  <span>{t.label}</span>
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

        <header className="topbar">
          <button className="menu-toggle" onClick={() => setMenuAberto((v) => !v)} aria-label="Abrir menu">
            <Icone nome="menu" size={18} />
          </button>
          <div className="topbar-titulo">
            <div className="topbar-crumb">{grupoAtual}</div>
            <h1>{tabAtual?.label}</h1>
          </div>
          {tabAtual?.sub && <div className="topbar-sub">{tabAtual.sub}</div>}
          <div className="topbar-acoes">
            {TABS.map((t) => (
              <div key={t.key} id={`acoes-${t.key}`} className="topbar-acoes-slot" hidden={t.key !== tab} />
            ))}
          </div>
        </header>

        <div className="content">
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

        <section className={`view ${tab === "importarVendas" ? "active" : ""}`}>
          {visitadas.has("importarVendas") && (
            <Suspense fallback={<div className="empty">Carregando…</div>}>
              <ImportarVendas />
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

      <div className={`toast ${toast.show ? "show" : ""}`}>{toast.msg}</div>
    </div>
  );
}
