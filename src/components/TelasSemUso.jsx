import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { usePreferencia } from "../hooks/usePreferencia.js";
import { telasDoApp, telasSemUso, DIAS_SEM_USO } from "../lib/telasSemUso.js";
import { hojeSP } from "../lib/datas.js";

// Configuração → Regras → "Telas que você não abriu" (01/11/2026). Só lista e
// guarda o seu voto (preferencias_loja `app:telas-sem-uso`); nada some sozinho —
// o que você marcar "concordo" vai pro "Levar pro Claude" decidir junto.
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

export default function TelasSemUso() {
  const { lojaId } = useLoja();
  const [usos, setUsos] = useState([]);
  const [votos, setVotos] = usePreferencia("app:telas-sem-uso", {});
  const hoje = hojeSP();
  useEffect(() => {
    if (!supabase || !lojaId) return;
    let ativo = true;
    supabase
      .from("consultor_registros")
      .select("chave")
      .eq("loja_id", lojaId)
      .eq("tipo", "uso")
      .then((r) => ativo && setUsos(r.data || []));
    return () => {
      ativo = false;
    };
  }, [lojaId]);
  const r = useMemo(() => telasSemUso({ telas: telasDoApp(), usos, hoje }), [usos, hoje]);
  const votar = (tab, voto) => setVotos({ ...(votos || {}), [tab]: votos?.[tab]?.voto === voto ? undefined : { voto, em: hoje } });

  return (
    <div>
      <p className="hint">
        {r.inicio ? `O app anota as telas abertas desde ${dm(r.inicio)}.` : "O app ainda não tem registro de uso das telas."}{" "}
        {r.completo ? `Estas não foram abertas nos últimos ${DIAS_SEM_USO} dias.` : `Faltam ${r.faltam} dias pra completar ${DIAS_SEM_USO} dias de registro — por enquanto, as que nunca foram abertas.`} Concordo = pode tirar ou esconder (levamos pro Claude decidir junto); não concordo = fica.
      </p>
      {r.lista.length === 0 ? (
        <p className="hint">✓ Você abriu todas as telas.</p>
      ) : (
        <table className="tabela-mini">
          <tbody>
            {r.lista.map((t) => {
              const v = votos?.[t.tab]?.voto;
              return (
                <tr key={t.tab}>
                  <td>
                    <b>{t.label}</b>
                    <div className="hint">{t.ultima ? `aberta pela última vez em ${dm(t.ultima)} (${t.diasSem} dias)` : "nunca aberta desde o início do registro"}</div>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className={`btn btn-mini${v === "concordo" ? " primary" : ""}`} onClick={() => votar(t.tab, "concordo")}>
                      Concordo
                    </button>{" "}
                    <button className={`btn btn-mini${v === "nao" ? " primary" : ""}`} onClick={() => votar(t.tab, "nao")}>
                      Não concordo
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
