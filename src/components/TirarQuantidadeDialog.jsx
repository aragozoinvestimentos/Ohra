import { useState } from "react";
import ConfirmDialog from "./ConfirmDialog.jsx";
import CanalTag from "./CanalTag.jsx";
import { supabase } from "../lib/supabaseClient.js";
import { recarregarCatalogo } from "../lib/catalogoStore.js";
import { useAfiliados } from "../hooks/useAfiliados.js";
import { excluirVariacaoTodos, oQueExisteNoCanal, tirarDoCanal } from "../lib/tirarDoCanal.js";
import { BRL } from "../lib/format.js";

// "×" num chip de quantidade (2º Por quantidade): (a) tirar deste canal — a
// quantidade sai das anunciadas do canal e a variação perde preço/anúncio/
// afiliado SÓ aqui (mesma conta do "Tirar deste canal"); (b) excluir a
// variação de todos os canais (segunda confirmação).
export default function TirarQuantidadeDialog({ linha, item, produto, canal, canais, precos, publicacoes, listaSemN, temV41, onToast, onClose }) {
  const af = useAfiliados();
  const [modo, setModo] = useState("canal");
  const [confirmar2, setConfirmar2] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const vid = item?.id.startsWith("v:") ? item.id.slice(2) : null;
  const ondeTem = vid
    ? canais
        .map((c) => ({
          canal: c,
          preco: precos.find((p) => p.item_tipo === "variacao" && p.item_id === vid && p.canal_id === c.id) || null,
          pub: publicacoes.find((p) => p.item_tipo === "variacao" && p.item_id === vid && p.canal_id === c.id) || null,
        }))
        .filter((x) => x.preco || x.pub)
    : [];

  async function tirarDoCanalAqui() {
    setSalvando(true);
    const erros = [];
    if (temV41 && produto) {
      const novo = { ...(produto.quantidades_anuncio || {}), [canal.id]: listaSemN };
      const { error } = await supabase.from("produtos_cadastro").update({ quantidades_anuncio: novo }).eq("id", produto.id);
      if (error) erros.push(error.message);
    }
    if (item) {
      const linhas = oQueExisteNoCanal({ itensAlvo: [item], canal, precos, publicacoes, afConfig: af.config });
      if (linhas.length) erros.push(...(await tirarDoCanal({ modo: "tudo", linhas, canal })));
    }
    recarregarCatalogo();
    setSalvando(false);
    onToast?.(erros.length ? `Parte não foi feita: ${erros[0]}` : `${linha.n} un. tirada de ${canal.nome} (os outros canais não mudam)`);
    onClose();
  }
  async function excluirDeTodos() {
    setSalvando(true);
    const erros = await excluirVariacaoTodos({ variacaoId: vid, n: linha.n, produto });
    setSalvando(false);
    onToast?.(erros.length ? `Parte não foi apagada: ${erros[0]}` : `${linha.nome || `Kit ${linha.n}`} excluída de todos os canais`);
    onClose();
  }

  if (confirmar2)
    return (
      <ConfirmDialog
        titulo={`Excluir ${linha.nome || `Kit ${linha.n}`} de todos os canais?`}
        mensagem={`A variação some do cadastro e de ${ondeTem.length ? ondeTem.map((x) => x.canal.nome).join(", ") : "todos os canais"} (preços salvos, anúncios marcados e afiliado). Não dá pra desfazer.`}
        confirmarLabel={salvando ? "Excluindo…" : "Excluir de todos"}
        perigo
        onConfirm={excluirDeTodos}
        onCancel={() => setConfirmar2(false)}
      />
    );

  return (
    <ConfirmDialog
      titulo={
        <>
          Tirar {linha.n} un. <CanalTag canal={canal} />
        </>
      }
      confirmarLabel={salvando ? "Salvando…" : modo === "canal" ? "Tirar deste canal" : "Continuar…"}
      perigo={modo === "todos"}
      larga
      onConfirm={() => (modo === "canal" ? tirarDoCanalAqui() : setConfirmar2(true))}
      onCancel={onClose}
    >
      <div className="tirar-canal">
        <div className="tirar-canal-opcoes" style={{ marginTop: 0 }}>
          <label className={`tirar-opcao${modo === "canal" ? " on" : ""}`}>
            <input type="radio" name="tirar-qtd" checked={modo === "canal"} onChange={() => setModo("canal")} />
            <span>
              <b>Tirar deste canal ({canal.nome})</b>
              <small>A quantidade sai das anunciadas em {canal.nome}{vid ? " e a variação perde preço salvo, anúncio marcado e afiliado só aqui" : ""}. Os outros canais não mudam; dá pra religar em "Anunciado em".</small>
            </span>
          </label>
          {vid && (
            <label className={`tirar-opcao${modo === "todos" ? " on" : ""}`}>
              <input type="radio" name="tirar-qtd" checked={modo === "todos"} onChange={() => setModo("todos")} />
              <span>
                <b>Excluir a variação de todos os canais</b>
                <small>
                  {ondeTem.length
                    ? `Tem preço/anúncio em: ${ondeTem.map((x) => `${x.canal.nome}${x.preco ? ` ${BRL(Number(x.preco.preco))}` : ""}${x.pub ? " (anunciado)" : ""}`).join(" · ")}.`
                    : "Sem preço salvo nem anúncio em nenhum canal."}{" "}
                  Pede uma segunda confirmação.
                </small>
              </span>
            </label>
          )}
        </div>
      </div>
    </ConfirmDialog>
  );
}
