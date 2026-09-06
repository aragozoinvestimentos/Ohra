import { useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import PinPrompt from "./PinPrompt.jsx";

const BUCKET = "loja-icones";
const TAMANHO_MAX_MB = 3;

async function enviarIcone(lojaId, file) {
  if (!supabase) return null;
  try {
    const extBruta = (file.name.split(".").pop() || "png").toLowerCase();
    const ext = /^[a-z0-9]{1,5}$/.test(extBruta) ? extBruta : "png";
    const caminho = `${lojaId}/icone-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(caminho, file, { upsert: true, cacheControl: "3600" });
    if (error) return null;
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(caminho);
    return data?.publicUrl || null;
  } catch {
    return null;
  }
}

function IconePreview({ url, nome, tamanho = 56 }) {
  if (url) {
    return <img src={url} alt="" className="loja-icone-img" style={{ width: tamanho, height: tamanho }} />;
  }
  const letra = (nome || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span className="loja-icone-letra" style={{ width: tamanho, height: tamanho, fontSize: tamanho * 0.42 }}>
      {letra}
    </span>
  );
}

// Formulário compartilhado por "nova loja" e "editar loja" — cada loja tem
// seu próprio ícone (imagem de verdade, enviada pro Storage) e um PIN
// opcional de 4 números.
function FormLoja({ valor, onChange, onSalvar, onCancelar, salvando, tituloBotao }) {
  const fileRef = useRef(null);
  const urlAtual = valor.iconePreview ?? (valor.removerIcone ? null : valor.iconeUrlAtual);

  function escolherArquivo(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("Escolha um arquivo de imagem.");
      return;
    }
    if (file.size > TAMANHO_MAX_MB * 1024 * 1024) {
      alert(`Imagem muito grande — o limite é ${TAMANHO_MAX_MB}MB.`);
      return;
    }
    const preview = URL.createObjectURL(file);
    onChange((prev) => ({ ...prev, iconeFile: file, iconePreview: preview, removerIcone: false }));
  }

  return (
    <div className="loja-form">
      <div className="loja-form-icone">
        <IconePreview url={urlAtual} nome={valor.nome} tamanho={56} />
        <div className="loja-form-icone-actions">
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            {urlAtual ? "Trocar ícone" : "Adicionar ícone"}
          </button>
          {urlAtual && (
            <button
              type="button"
              className="btn"
              onClick={() => onChange((prev) => ({ ...prev, iconeFile: null, iconePreview: null, removerIcone: true }))}
            >
              Remover ícone
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={escolherArquivo} />
        </div>
      </div>
      <div className="row2">
        <div className="field">
          <label>Nome da loja</label>
          <input
            type="text"
            value={valor.nome}
            onChange={(e) => onChange((prev) => ({ ...prev, nome: e.target.value }))}
          />
        </div>
        <div className="field">
          <label>PIN de 4 números (opcional)</label>
          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            placeholder="ex: 1234"
            value={valor.pin}
            onChange={(e) => onChange((prev) => ({ ...prev, pin: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
          />
        </div>
      </div>
      <div className="hint" style={{ marginBottom: 10 }}>
        Deixe o PIN em branco pra loja ficar sem trava de acesso. Com PIN, ele é pedido pra entrar nessa loja e pra excluí-la.
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn primary" onClick={onSalvar} disabled={salvando}>
          {salvando ? "Salvando…" : tituloBotao}
        </button>
        <button className="btn" onClick={onCancelar} disabled={salvando}>Cancelar</button>
      </div>
    </div>
  );
}

const NOVO_VAZIO = { nome: "", pin: "", iconeFile: null, iconePreview: null, removerIcone: false };

export default function Lojas({ onToast }) {
  const { lojas, criar, atualizar, remover, conferirPin } = useLoja();
  const [criando, setCriando] = useState(false);
  const [novo, setNovo] = useState(NOVO_VAZIO);
  const [editandoId, setEditandoId] = useState(null);
  const [edicao, setEdicao] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmacao, setConfirmacao] = useState(null); // "nova" | "editar"
  const [excluirAlvo, setExcluirAlvo] = useState(null);

  function iniciarEdicao(loja) {
    setCriando(false);
    setEditandoId(loja.id);
    setEdicao({
      nome: loja.nome,
      pin: loja.pin || "",
      iconeFile: null,
      iconePreview: null,
      iconeUrlAtual: loja.icone_url || null,
      removerIcone: false,
    });
  }

  function cancelarEdicao() {
    setEditandoId(null);
    setEdicao(null);
  }

  function pedirConfirmacaoNova() {
    if (!novo.nome.trim()) {
      onToast("Dê um nome à loja");
      return;
    }
    if (novo.pin && novo.pin.length !== 4) {
      onToast("O PIN precisa ter 4 números");
      return;
    }
    setConfirmacao("nova");
  }

  function pedirConfirmacaoEdicao() {
    if (!edicao.nome.trim()) {
      onToast("Dê um nome à loja");
      return;
    }
    if (edicao.pin && edicao.pin.length !== 4) {
      onToast("O PIN precisa ter 4 números");
      return;
    }
    setConfirmacao("editar");
  }

  async function confirmarNova() {
    setConfirmacao(null);
    setSalvando(true);
    const nome = novo.nome.trim();
    const loja = await criar({ nome, pin: novo.pin || null });
    if (!loja) {
      setSalvando(false);
      onToast("Não foi possível criar a loja — tente de novo");
      return;
    }
    if (novo.iconeFile) {
      const url = await enviarIcone(loja.id, novo.iconeFile);
      if (url) await atualizar(loja.id, { iconeUrl: url });
      else onToast("Loja criada, mas o ícone não pôde ser enviado — tente adicionar em Editar");
    }
    setSalvando(false);
    setNovo(NOVO_VAZIO);
    setCriando(false);
    onToast("Loja criada");
  }

  async function confirmarEdicao() {
    setConfirmacao(null);
    setSalvando(true);
    const nome = edicao.nome.trim();
    let iconeUrl;
    if (edicao.iconeFile) {
      iconeUrl = await enviarIcone(editandoId, edicao.iconeFile);
      if (!iconeUrl) onToast("Não foi possível enviar o novo ícone — o restante foi salvo");
    }
    const ok = await atualizar(editandoId, {
      nome,
      pin: edicao.pin || null,
      removerIcone: edicao.removerIcone,
      ...(iconeUrl ? { iconeUrl } : {}),
    });
    setSalvando(false);
    if (!ok) {
      onToast("Não foi possível salvar — tente de novo");
      return;
    }
    onToast("Loja atualizada");
    cancelarEdicao();
  }

  async function confirmarExclusaoSemPin() {
    const loja = excluirAlvo;
    setExcluirAlvo(null);
    const ok = await remover(loja.id);
    onToast(ok ? "Loja excluída" : "Não foi possível excluir — tente de novo");
    if (editandoId === loja.id) cancelarEdicao();
  }

  async function confirmarExclusaoComPin(pin) {
    const loja = excluirAlvo;
    if (!conferirPin(loja.id, pin)) return false;
    const ok = await remover(loja.id);
    setExcluirAlvo(null);
    onToast(ok ? "Loja excluída" : "Não foi possível excluir — tente de novo");
    if (editandoId === loja.id) cancelarEdicao();
    return true;
  }

  if (!supabase) {
    return (
      <div className="panel">
        <h3>Lojas</h3>
        <div className="empty">Indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="panel">
        <h3 className="section-title">Suas lojas</h3>
        {lojas.length === 0 ? (
          <div className="empty">Nenhuma loja cadastrada ainda.</div>
        ) : (
          <div className="lojas-grid">
            {lojas.map((loja) =>
              editandoId === loja.id ? (
                <div className="loja-card loja-card-editando" key={loja.id}>
                  <FormLoja
                    valor={edicao}
                    onChange={setEdicao}
                    onSalvar={pedirConfirmacaoEdicao}
                    onCancelar={cancelarEdicao}
                    salvando={salvando}
                    tituloBotao="Salvar alterações"
                  />
                </div>
              ) : (
                <div className="loja-card" key={loja.id}>
                  <IconePreview url={loja.icone_url} nome={loja.nome} />
                  <div className="loja-card-nome">{loja.nome}</div>
                  <div className="loja-card-pin">{loja.pin ? "PIN ●●●●" : "Sem PIN"}</div>
                  <div className="loja-card-actions">
                    <button className="btn" onClick={() => iniciarEdicao(loja)}>Editar</button>
                    <button className="btn danger" onClick={() => setExcluirAlvo(loja)}>Excluir</button>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>

      <div className="panel">
        {!criando ? (
          <button
            className="btn primary"
            onClick={() => {
              cancelarEdicao();
              setNovo(NOVO_VAZIO);
              setCriando(true);
            }}
          >
            + Nova loja
          </button>
        ) : (
          <>
            <h3 className="section-title">Nova loja</h3>
            <FormLoja
              valor={novo}
              onChange={setNovo}
              onSalvar={pedirConfirmacaoNova}
              onCancelar={() => setCriando(false)}
              salvando={salvando}
              tituloBotao="Criar loja"
            />
          </>
        )}
      </div>

      {confirmacao === "nova" && (
        <ConfirmDialog
          titulo="Criar loja"
          mensagem={`Confirma criar a loja "${novo.nome.trim()}"?`}
          confirmarLabel="Criar"
          onConfirm={confirmarNova}
          onCancel={() => setConfirmacao(null)}
        />
      )}
      {confirmacao === "editar" && (
        <ConfirmDialog
          titulo="Salvar alterações"
          mensagem={`Confirma alterar a loja "${edicao.nome.trim()}"?`}
          confirmarLabel="Salvar"
          onConfirm={confirmarEdicao}
          onCancel={() => setConfirmacao(null)}
        />
      )}

      {excluirAlvo && excluirAlvo.pin && (
        <PinPrompt
          titulo={`Excluir loja "${excluirAlvo.nome}"`}
          subtitulo="Essa loja é protegida por PIN. Digite o PIN de cadastro pra confirmar — essa ação apaga também todos os materiais, produtos, canais, pedidos e o histórico dela, e não pode ser desfeita."
          confirmarLabel="Excluir"
          perigo
          onSubmit={confirmarExclusaoComPin}
          onCancel={() => setExcluirAlvo(null)}
        />
      )}
      {excluirAlvo && !excluirAlvo.pin && (
        <ConfirmDialog
          titulo={`Excluir loja "${excluirAlvo.nome}"`}
          mensagem="Essa ação apaga também todos os materiais, produtos, canais, pedidos e o histórico dessa loja — não pode ser desfeita."
          confirmarLabel="Excluir"
          perigo
          onConfirm={confirmarExclusaoSemPin}
          onCancel={() => setExcluirAlvo(null)}
        />
      )}
    </div>
  );
}
