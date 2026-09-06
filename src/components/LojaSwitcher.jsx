import { useState } from "react";
import { useLoja } from "../lib/LojaContext.jsx";

// Fica escondido até "lojas" existir no banco (schema_v3.sql) — até lá o
// app continua igual, sem seletor e sem filtrar nada por loja.
export default function LojaSwitcher() {
  const { lojas, lojaId, disponivel, carregando, selecionar, criar } = useLoja();
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);

  if (!disponivel || carregando) return null;

  async function confirmarCriar() {
    const n = nome.trim();
    if (!n) {
      setCriando(false);
      return;
    }
    setSalvando(true);
    await criar(n);
    setSalvando(false);
    setNome("");
    setCriando(false);
  }

  return (
    <div className="loja-switcher">
      {!criando ? (
        <>
          <select value={lojaId || ""} onChange={(e) => selecionar(e.target.value)} title="Loja atual">
            {lojas.map((l) => (
              <option key={l.id} value={l.id}>{l.nome}</option>
            ))}
          </select>
          <button type="button" className="loja-add" title="Nova loja" onClick={() => setCriando(true)}>+</button>
        </>
      ) : (
        <div className="loja-nova">
          <input
            type="text"
            autoFocus
            placeholder="Nome da loja"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmarCriar();
              if (e.key === "Escape") setCriando(false);
            }}
            onBlur={confirmarCriar}
          />
          <button type="button" className="btn primary" onClick={confirmarCriar} disabled={salvando}>OK</button>
        </div>
      )}
    </div>
  );
}
