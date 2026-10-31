import { useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useCatalogo } from "../hooks/useCatalogo.js";
import { recarregarCatalogo } from "../lib/catalogoStore.js";
import { ordenarCanais } from "../lib/canais.js";
import CanalTag from "./CanalTag.jsx";
import Ajuda from "./Ajuda.jsx";

// Etapa "Concorrência" do cadastro de produto (31/10/2026): o preço que o concorrente
// cobra (o que o cliente paga) por canal, pro avulso e cada variação, numa tabela só.
// Grava em precos_concorrente (a mesma do 2º Por quantidade) ao sair do campo — daí vale
// na escada (teto), nas referências do 1º Avulso e no Painel do anúncio.
const num = (v) => Number(String(v ?? "").replace(",", "."));
const brl = (v) => (v == null ? "" : String(Number(v).toFixed(2)).replace(".", ","));

export default function ConcorrenciaCadastro({ produtoId, onToast }) {
  const { lojaId } = useLoja();
  const { canais = [], variacoes = [], concorrentes = [] } = useCatalogo();
  const [edit, setEdit] = useState({});
  const [salvo, setSalvo] = useState({});
  const linhas = [
    { tipo: "produto", id: produtoId, nome: "1 unidade" },
    ...variacoes
      .filter((v) => v.produto_id === produtoId)
      .sort((a, b) => (Number(a.quantidade) || 0) - (Number(b.quantidade) || 0))
      .map((v) => ({ tipo: "variacao", id: v.id, nome: v.nome || `Kit ${v.quantidade}` })),
  ];
  const cs = ordenarCanais(canais.filter((c) => c.tipo !== "custom" || c.modo_preco !== "markup"));
  const atual = (l, c) => concorrentes.find((x) => x.item_tipo === l.tipo && x.item_id === l.id && x.canal_id === c.id)?.preco ?? null;

  async function gravar(l, c) {
    const k = `${l.id}|${c.id}`;
    if (edit[k] === undefined || !supabase) return;
    const v = edit[k].trim();
    const preco = num(v);
    let error = null;
    if (!v || !(preco > 0)) {
      ({ error } = await supabase.from("precos_concorrente").delete().eq("item_tipo", l.tipo).eq("item_id", l.id).eq("canal_id", c.id));
    } else {
      ({ error } = await supabase
        .from("precos_concorrente")
        .upsert({ loja_id: lojaId || null, item_tipo: l.tipo, item_id: l.id, canal_id: c.id, preco, atualizado_em: new Date().toISOString() }, { onConflict: "item_tipo,item_id,canal_id" }));
    }
    if (error) return onToast?.(/relation|does not exist|schema cache/i.test(error.message) ? "Rode o SQL v27 no Supabase pra salvar concorrentes" : `Não foi possível salvar: ${error.message}`);
    recarregarCatalogo();
    setEdit((p) => {
      const n = { ...p };
      delete n[k];
      return n;
    });
    setSalvo((p) => ({ ...p, [k]: true }));
  }

  if (!cs.length) return <div className="hint">Nenhum canal ativo — cadastre em Configuração → Canais.</div>;
  return (
    <>
      <p className="hint">
        O preço que o concorrente cobra (o que o cliente paga) em cada canal. Opcional — em branco = não tem. Grava ao sair do campo.
        <Ajuda texto="É o mesmo concorrente do 2º Por quantidade: vira teto na escada de kits (nunca abaixo do mínimo aceitável), aparece nas referências do 1º Avulso e no Painel do anúncio. Variações aparecem aqui depois de criadas na etapa Variações." />
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              {cs.map((c) => (
                <th key={c.id}>
                  <CanalTag canal={c} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id}>
                <td>
                  <b>{l.nome}</b>
                </td>
                {cs.map((c) => {
                  const k = `${l.id}|${c.id}`;
                  return (
                    <td key={c.id}>
                      <input
                        style={{ width: 90 }}
                        inputMode="decimal"
                        placeholder="R$"
                        value={edit[k] ?? brl(atual(l, c))}
                        onChange={(e) => setEdit((p) => ({ ...p, [k]: e.target.value }))}
                        onBlur={() => gravar(l, c)}
                        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      />
                      {salvo[k] && edit[k] === undefined && <span className="muted-cel"> ✓</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
