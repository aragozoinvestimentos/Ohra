import { useEffect } from "react";
import { useSubAba } from "../lib/subAbas.js";
import Produtos from "./Produtos.jsx";
import Kits from "./Kits.jsx";
import CatalogoLista from "./CatalogoLista.jsx";

// Sub-abas (Catálogo, Produtos, Kits — Materiais e Embalagens foram pra Produção → Insumos) ficam no cabeçalho do App (lib/subAbas.js).

export default function Cadastros({ produtoRecebido, abrirItem, onToast, onProdutoCriado }) {
  const [sub, setSub] = useSubAba("ohra:cadastros-sub", "catalogo", ["catalogo", "produtos", "kits"]);

  // Veio de "Salvar como Produto" (Custo de Produção) — troca pra
  // sub-aba Produtos automaticamente, mesmo se Cadastros já estava aberto
  // numa outra sub-aba (sem isso, o efeito que carrega o produto em
  // Produtos.jsx só dispara se ele já estiver montado).
  useEffect(() => {
    (() => {
      if (produtoRecebido?.seq) setSub("produtos");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtoRecebido?.seq]);

  // Veio de "Editar completo" em Produtos precificados — troca pra Produtos ou
  // Kits conforme o tipo do item.
  useEffect(() => {
    (() => {
      if (abrirItem?.seq) {
        setSub(abrirItem.tipo === "kit" ? "kits" : "produtos");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirItem?.seq]);

  const abrir = abrirItem;
  const abrirProdutoId = abrir?.id && abrir.tipo !== "kit" ? { id: abrir.id, seq: abrir.seq } : null;
  const abrirKitId = abrir?.id && abrir.tipo === "kit" ? { id: abrir.id, seq: abrir.seq } : null;

  return (
    <div>

      {sub === "catalogo" && <CatalogoLista onToast={onToast} />}
      {sub === "produtos" && (
        <Produtos produtoRecebido={produtoRecebido} abrirProdutoId={abrirProdutoId} onToast={onToast} onProdutoCriado={onProdutoCriado} />
      )}
      {sub === "kits" && <Kits abrirKitId={abrirKitId} onToast={onToast} />}
    </div>
  );
}
