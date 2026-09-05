import { useRef, useState } from "react";
import logo from "./assets/logo.png";
import CustoProducao from "./components/CustoProducao.jsx";
import PrecificacaoCanal from "./components/PrecificacaoCanal.jsx";
import Historico from "./components/Historico.jsx";

const TABS = [
  { key: "producao", label: "Custo de Produção" },
  { key: "canal", label: "Precificação por Canal" },
  { key: "historico", label: "Histórico" },
];

export default function App() {
  const [tab, setTab] = useState("producao");
  const [custoRecebido, setCustoRecebido] = useState(null);
  const [toast, setToast] = useState({ msg: "", show: false });
  const toastTimer = useRef(null);

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

  return (
    <div className="shell">
      <header className="top">
        <img src={logo} alt="Ohra" />
        <div>
          <div className="word">OHRA</div>
          <div className="tagline">Precificador — custo de produção e preço por canal</div>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      <section className={`view ${tab === "producao" ? "active" : ""}`}>
        <CustoProducao onUsarCusto={usarCusto} />
      </section>

      <section className={`view ${tab === "canal" ? "active" : ""}`}>
        <PrecificacaoCanal custoRecebido={custoRecebido} onToast={showToast} />
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
