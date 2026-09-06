import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";

const LOJA_KEY = "ohra:loja-atual";

// disponivel=false enquanto a tabela "lojas" não existir (schema_v3.sql não
// rodado ainda) — nesse caso o app funciona igual antes, sem filtrar por loja.
const LojaContext = createContext({
  lojas: [],
  lojaId: null,
  disponivel: false,
  carregando: true,
  selecionar: () => {},
  criar: async () => null,
});

function lerSalvo() {
  try {
    return localStorage.getItem(LOJA_KEY);
  } catch {
    return null;
  }
}

export function LojaProvider({ children }) {
  const [lojas, setLojas] = useState([]);
  const [lojaId, setLojaId] = useState(null);
  const [disponivel, setDisponivel] = useState(false);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    if (!supabase) {
      setCarregando(false);
      return;
    }
    try {
      const { data, error } = await supabase.from("lojas").select("*").order("criado_em", { ascending: true });
      if (error) throw error;
      setDisponivel(true);
      setLojas(data || []);
      setLojaId((atual) => {
        if (atual && data.some((l) => l.id === atual)) return atual;
        const salvo = lerSalvo();
        if (salvo && data.some((l) => l.id === salvo)) return salvo;
        return data[0]?.id || null;
      });
    } catch {
      // tabela "lojas" ainda não existe — multi-loja fica invisível
      setDisponivel(false);
      setLojas([]);
      setLojaId(null);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
    if (!supabase) return;
    const canal = supabase
      .channel("lojas-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "lojas" }, carregar)
      .subscribe();
    return () => supabase.removeChannel(canal);
  }, [carregar]);

  function selecionar(id) {
    setLojaId(id);
    try {
      localStorage.setItem(LOJA_KEY, id);
    } catch {
      // sem problema, só não lembra da próxima vez
    }
  }

  async function criar(nome) {
    if (!supabase) return null;
    const { data, error } = await supabase.from("lojas").insert({ nome }).select().single();
    if (error) return null;
    // Atualiza a lista local na hora — sem isso o <select> fica sem nenhuma
    // opção correspondente até o round-trip do realtime voltar.
    setLojas((prev) => (prev.some((l) => l.id === data.id) ? prev : [...prev, data]));
    selecionar(data.id);
    // Toda loja nova já nasce com Shopee e Mercado Livre cadastrados —
    // mesmo padrão da loja default (item ajustável depois em Canais).
    try {
      await supabase.from("canais").insert([
        { nome: "Shopee", tipo: "shopee", loja_id: data.id },
        { nome: "Mercado Livre", tipo: "ml", loja_id: data.id },
      ]);
    } catch {
      // falha de rede ao semear os canais padrão — a loja já foi criada;
      // dá pra cadastrar os canais manualmente em Cadastros → Canais.
    }
    return data;
  }

  return (
    <LojaContext.Provider value={{ lojas, lojaId, disponivel, carregando, selecionar, criar }}>
      {children}
    </LojaContext.Provider>
  );
}

export function useLoja() {
  return useContext(LojaContext);
}
