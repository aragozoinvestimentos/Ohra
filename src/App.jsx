import { useEffect, useRef, useState } from "react";
import logo from "./assets/logo.png";
import CustoProducao from "./components/CustoProducao.jsx";
import RegistroImpressoes from "./components/RegistroImpressoes.jsx";
import PrecificacaoCanal from "./components/PrecificacaoCanal.jsx";
import Comparativo from "./components/Comparativo.jsx";
import Cadastros from "./components/Cadastros.jsx";
import Canais from "./components/Canais.jsx";
import TaxasMarketplace from "./components/TaxasMarketplace.jsx";
import Orcamento from "./components/Orcamento.jsx";
import Promocoes from "./components/Promocoes.jsx";
import Otimizacao from "./components/Otimizacao.jsx";
import Metas from "./components/Metas.jsx";
import Ranking from "./components/Ranking.jsx";
import TelaDescanso from "./components/TelaDescanso.jsx";
import Historico from "./components/Historico.jsx";
import Tutorial from "./components/Tutorial.jsx";
import Lojas from "./components/Lojas.jsx";
import LojaSwitcher from "./components/LojaSwitcher.jsx";
import LojaGate from "./components/LojaGate.jsx";
import Icone from "./components/Icone.jsx";
import { useLoja } from "./lib/LojaContext.jsx";

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
      { key: "registroImpressoes", label: "Registro de Impressões", sub: "Taxa de falha real e lote máximo seguro" },
      { key: "canal", label: "Precificação por Canal", sub: "Preço, taxas e lucro em cada marketplace" },
      { key: "comparativo", label: "Comparativo", sub: "O mesmo item lado a lado em todos os canais" },
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
    ],
  },
  {
    titulo: "Gestão",
    tabs: [
      { key: "metas", label: "Metas", sub: "Faturamento e lucro do mês" },
      { key: "ranking", label: "Ranking por Retorno", sub: "Quais itens dão mais lucro por hora" },
      { key: "otimizacao", label: "Otimização", sub: "Capacidade de produção da loja" },
    ],
  },
  {
    titulo: "Configuração",
    tabs: [
      { key: "lojas", label: "Lojas", sub: "Lojas, ícones e PIN" },
      { key: "canais", label: "Canais", sub: "Canais de venda e custos de cada um" },
      { key: "taxas", label: "Taxas Marketplace", sub: "Tabela oficial de comissões e taxas" },
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
    if (saved && TABS.some((t) => t.key === saved)) return saved;
  } catch {
    // sem problema, usa o padrão
  }
  return "producao";
}

export default function App() {
  const { lojas, disponivel: lojasDisponivel, carregando: carregandoLoja, lojaId, precisaPin } = useLoja();
  const [tab, setTab] = useState(loadTab);
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
    showToast("Custo levado para a Precificação por Canal");
  }

  function salvarComoProduto({ custo, materialNome, detalhe, id, nome, pecasPorImpressao }) {
    setProdutoRecebido((prev) => ({
      custo,
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
    showToast("Produto levado para a Precificação por Canal");
  }

  function irPara(key) {
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
        </header>

        <div className="content">
        <section className={`view ${tab === "lojas" ? "active" : ""}`}>
          <Lojas onToast={showToast} />
        </section>

        <section className={`view ${tab === "canais" ? "active" : ""}`}>
          <Canais onToast={showToast} />
        </section>

        <section className={`view ${tab === "taxas" ? "active" : ""}`}>
          <TaxasMarketplace />
        </section>

        <section className={`view ${tab === "cadastros" ? "active" : ""}`}>
          <Cadastros produtoRecebido={produtoRecebido} abrirItem={abrirItem} onToast={showToast} onProdutoCriado={irParaPrecificarProduto} />
        </section>

        <section className={`view ${tab === "producao" ? "active" : ""}`}>
          <CustoProducao onUsarCusto={usarCusto} onSalvarProduto={salvarComoProduto} onIrParaMateriais={irParaMateriais} />
        </section>

        <section className={`view ${tab === "registroImpressoes" ? "active" : ""}`}>
          <RegistroImpressoes onToast={showToast} />
        </section>

        <section className={`view ${tab === "canal" ? "active" : ""}`}>
          <PrecificacaoCanal custoRecebido={custoRecebido} produtoParaSelecionar={produtoParaPrecificar} onToast={showToast} />
        </section>

        <section className={`view ${tab === "comparativo" ? "active" : ""}`}>
          <Comparativo />
        </section>

        <section className={`view ${tab === "orcamento" ? "active" : ""}`}>
          <Orcamento onToast={showToast} />
        </section>

        <section className={`view ${tab === "promocoes" ? "active" : ""}`}>
          <Promocoes onToast={showToast} />
        </section>

        <section className={`view ${tab === "metas" ? "active" : ""}`}>
          <Metas onToast={showToast} />
        </section>

        <section className={`view ${tab === "ranking" ? "active" : ""}`}>
          <Ranking />
        </section>

        <section className={`view ${tab === "otimizacao" ? "active" : ""}`}>
          <Otimizacao onToast={showToast} />
        </section>

        <section className={`view ${tab === "historico" ? "active" : ""}`}>
          <Historico onEditarCompleto={editarItemCompleto} onToast={showToast} />
        </section>

        <section className={`view ${tab === "tutorial" ? "active" : ""}`}>
          <Tutorial />
        </section>

        <footer className="note">
          Taxas vigentes a partir de mar/2026 — confira periodicamente na Shopee e no Mercado Livre. Dados salvos na nuvem, acessíveis de qualquer aparelho.
        </footer>
        </div>
      </div>

      <div className={`toast ${toast.show ? "show" : ""}`}>{toast.msg}</div>
    </div>
  );
}
