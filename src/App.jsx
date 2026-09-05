import { useEffect, useRef, useState } from "react";
import logo from "./assets/logo.png";
import CustoProducao from "./components/CustoProducao.jsx";
import PrecificacaoCanal from "./components/PrecificacaoCanal.jsx";
import Comparativo from "./components/Comparativo.jsx";
import Cadastros from "./components/Cadastros.jsx";
import Organizacao from "./components/Organizacao.jsx";
import Historico from "./components/Historico.jsx";

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

const TABS = [
  { key: "producao", label: "Custo de Produção" },
  { key: "canal", label: "Precificação por Canal" },
  { key: "comparativo", label: "Comparativo" },
  { key: "cadastros", label: "Cadastros" },
  { key: "organizacao", label: "Organização" },
  { key: "historico", label: "Histórico" },
];

export default function App() {
  const [tab, setTab] = useState("producao");
  const [custoRecebido, setCustoRecebido] = useState(null);
  const [produtoRecebido, setProdutoRecebido] = useState(null);
  const [toast, setToast] = useState({ msg: "", show: false });
  const [tema, setTema] = useState(loadTheme);
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

  function salvarComoProduto({ custo, materialNome }) {
    setProdutoRecebido((prev) => ({ custo, materialNome, seq: (prev?.seq || 0) + 1 }));
    setTab("cadastros");
    showToast("Custo levado para o cadastro de Produtos");
  }

  return (
    <div className="shell">
      <header className="top">
        <img src={logo} alt="Ohra" />
        <div>
          <div className="word">OHRA</div>
          <div className="tagline">Precificador — custo de produção e preço por canal</div>
        </div>
        <button className="btn theme-toggle" onClick={alternarTema} title="Trocar tema">
          {tema === "dark" ? "☀️ Tema claro" : "🌙 Tema escuro"}
        </button>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      <section className={`view ${tab === "producao" ? "active" : ""}`}>
        <CustoProducao onUsarCusto={usarCusto} onSalvarProduto={salvarComoProduto} />
      </section>

      <section className={`view ${tab === "canal" ? "active" : ""}`}>
        <PrecificacaoCanal custoRecebido={custoRecebido} onToast={showToast} />
      </section>

      <section className={`view ${tab === "comparativo" ? "active" : ""}`}>
        <Comparativo />
      </section>

      <section className={`view ${tab === "cadastros" ? "active" : ""}`}>
        <Cadastros produtoRecebido={produtoRecebido} onToast={showToast} />
      </section>

      <section className={`view ${tab === "organizacao" ? "active" : ""}`}>
        <Organizacao onToast={showToast} />
      </section>

      <section className={`view ${tab === "historico" ? "active" : ""}`}>
        <Historico onToast={showToast} />
      </section>

      <footer className="note">
        Taxas vigentes a partir de mar/2026. Confira periodicamente na Shopee e no Mercado Livre se os percentuais mudaram.
        O histórico fica salvo na nuvem — abra este app em qualquer aparelho para consultar ou testar um novo produto.
      </footer>

      <div className={`toast ${toast.show ? "show" : ""}`}>{toast.msg}</div>
    </div>
  );
}
