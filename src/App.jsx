import { useEffect, useRef, useState } from "react";
import logo from "./assets/logo.png";
import CustoProducao from "./components/CustoProducao.jsx";
import PrecificacaoCanal from "./components/PrecificacaoCanal.jsx";
import Comparativo from "./components/Comparativo.jsx";
import Cadastros from "./components/Cadastros.jsx";
import Orcamento from "./components/Orcamento.jsx";
import Promocoes from "./components/Promocoes.jsx";
import Otimizacao from "./components/Otimizacao.jsx";
import Ranking from "./components/Ranking.jsx";
import TelaDescanso from "./components/TelaDescanso.jsx";
import Historico from "./components/Historico.jsx";
import Tutorial from "./components/Tutorial.jsx";
import Lojas from "./components/Lojas.jsx";
import LojaSwitcher from "./components/LojaSwitcher.jsx";
import LojaGate from "./components/LojaGate.jsx";
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

// A barra lateral é agrupada em etapas do fluxo de uso: primeiro configura
// a loja, depois cadastra os dados-base, depois precifica um produto,
// depois usa isso pra vender, e por fim gerencia/analisa. A ordem dentro
// de cada grupo também segue a etapa (calcula custo → preço por canal →
// compara canais, por exemplo).
const GRUPOS = [
  {
    titulo: "Configuração",
    tabs: [{ key: "lojas", label: "Lojas", icon: "🏬" }],
  },
  {
    titulo: "Cadastros",
    tabs: [
      { key: "cadastros", label: "Cadastros", icon: "🗂️" },
      { key: "historico", label: "Preços por Canal", icon: "💰" },
    ],
  },
  {
    titulo: "Precificar",
    tabs: [
      { key: "producao", label: "Simular Custo de Produção", icon: "🧮" },
      { key: "canal", label: "Precificação por Canal", icon: "🏷️" },
      { key: "comparativo", label: "Comparativo", icon: "📊" },
    ],
  },
  {
    titulo: "Vender",
    tabs: [
      { key: "orcamento", label: "Orçamento", icon: "🧾" },
      { key: "promocoes", label: "Promoções", icon: "🎁" },
    ],
  },
  {
    titulo: "Gestão",
    tabs: [
      { key: "ranking", label: "Ranking por Retorno", icon: "🏆" },
      { key: "otimizacao", label: "Otimização", icon: "📈" },
    ],
  },
  {
    titulo: "Ajuda",
    tabs: [{ key: "tutorial", label: "Tutorial", icon: "📘" }],
  },
];

const TABS = GRUPOS.flatMap((g) => g.tabs);

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
  const { disponivel: lojasDisponivel, carregando: carregandoLoja, lojaId, precisaPin } = useLoja();
  const [tab, setTab] = useState(loadTab);
  const [custoRecebido, setCustoRecebido] = useState(null);
  const [produtoRecebido, setProdutoRecebido] = useState(null);
  const [abrirItem, setAbrirItem] = useState(null); // { tipo: "produto"|"kit", id, seq } — vindo de "editar completo" em Preços por Canal
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

  function irPara(key) {
    setTab(key);
    setMenuAberto(false);
  }

  function irParaMateriais() {
    setTab("cadastros");
  }

  const tabAtual = TABS.find((t) => t.key === tab);

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
      <button className="menu-toggle" onClick={() => setMenuAberto((v) => !v)} aria-label="Abrir menu">
        ☰
      </button>

      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src={logo} alt="Ohra" />
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
                <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => irPara(t.key)}>
                  <span className="side-nav-icon">{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <button className="btn theme-toggle" onClick={alternarTema} title="Trocar tema">
          {tema === "dark" ? "☀️ Tema claro" : "🌙 Tema escuro"}
        </button>
      </aside>

      {menuAberto && <div className="sidebar-overlay" onClick={() => setMenuAberto(false)} />}

      <div className="content">
        <TelaDescanso />

        <header className="top">
          <div className="mobile-title">{tabAtual?.label}</div>
        </header>

        <section className={`view ${tab === "lojas" ? "active" : ""}`}>
          <Lojas onToast={showToast} />
        </section>

        <section className={`view ${tab === "cadastros" ? "active" : ""}`}>
          <Cadastros produtoRecebido={produtoRecebido} abrirItem={abrirItem} onToast={showToast} />
        </section>

        <section className={`view ${tab === "producao" ? "active" : ""}`}>
          <CustoProducao onUsarCusto={usarCusto} onSalvarProduto={salvarComoProduto} onIrParaMateriais={irParaMateriais} />
        </section>

        <section className={`view ${tab === "canal" ? "active" : ""}`}>
          <PrecificacaoCanal custoRecebido={custoRecebido} onToast={showToast} />
        </section>

        <section className={`view ${tab === "comparativo" ? "active" : ""}`}>
          <Comparativo />
        </section>

        <section className={`view ${tab === "orcamento" ? "active" : ""}`}>
          <Orcamento onToast={showToast} />
        </section>

        <section className={`view ${tab === "promocoes" ? "active" : ""}`}>
          <Promocoes />
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
          Taxas vigentes a partir de mar/2026. Confira periodicamente na Shopee e no Mercado Livre se os percentuais mudaram.
          O histórico fica salvo na nuvem — abra este app em qualquer aparelho para consultar ou testar um novo produto.
        </footer>
      </div>

      <div className={`toast ${toast.show ? "show" : ""}`}>{toast.msg}</div>
    </div>
  );
}
