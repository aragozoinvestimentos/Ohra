import { useState } from "react";
import { useCatalogo } from "../hooks/useCatalogo.js";
import { recarregarCatalogo } from "../lib/catalogoStore.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useSalvoFlash } from "../lib/useSalvoFlash.js";
import Ajuda from "./Ajuda.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import CanalTag from "./CanalTag.jsx";
import { descontoPadraoCanal } from "../lib/escada.js";
import { ordenarCanais } from "../lib/canais.js";

const NOVO_VAZIO = { nome: "", comissao_pct: "", taxa_fixa: "", imposto_pct: "", custos_fixos_pct: "" };

const TIPO_LABEL = {
  shopee: "Shopee (faixas oficiais)",
  ml: "Mercado Livre (faixas oficiais)",
  tiktok: "TikTok Shop (faixas oficiais)",
  shein: "Shein (faixa oficial)",
  custom: "Canal próprio",
};

// Campos percentuais do canal "custom" (comissão/taxa fixa das faixas
// oficiais não entram aqui — só o que o Gustavo digita à mão). Mesma soma que
// entra no `denom` de `calcCanal` (src/lib/calc.js): se comissão + imposto +
// custos fixos + Ads somar 100% ou mais, não sobra preço nenhum que feche a
// conta e a tela vira "—" mais na frente sem explicação — por isso a validação
// já barra aqui, antes de salvar.
const CAMPOS_PCT = ["comissao_pct", "imposto_pct", "custos_fixos_pct", "ads_pct"];
const SOMA_PCT_MAXIMA = 100;

function somaPctExcede(valoresPct) {
  const soma = CAMPOS_PCT.reduce((acc, campo) => acc + (Number(valoresPct[campo]) || 0), 0);
  return soma >= SOMA_PCT_MAXIMA;
}

// Componente fora do Canais() de propósito: se ficasse dentro, seria recriado
// a cada tecla digitada e o input perderia o foco a cada caractere.
function CampoEditavel({ canal, campo, isPct, sufixo, edicoes, setEdicoes, onSalvar }) {
  const [salvo, disparar] = useSalvoFlash();
  const k = `${canal.id}:${campo}`;
  const valorAtual = canal[campo];
  const valorExibido = edicoes[k] ?? (isPct ? (Number(valorAtual || 0) * 100).toFixed(1) : Number(valorAtual || 0).toFixed(2));
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
      {sufixo === "R$" && "R$ "}
      <input
        type="number"
        step="0.01"
        min={isPct ? 0 : undefined}
        max={isPct ? 100 : undefined}
        style={{ width: 64, textAlign: "right" }}
        value={valorExibido}
        onChange={(e) => setEdicoes((prev) => ({ ...prev, [k]: e.target.value }))}
        onBlur={async () => {
          if (edicoes[k] !== undefined) {
            const ok = await onSalvar(canal.id, campo, isPct);
            if (ok) disparar();
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.target.blur();
        }}
      />
      {sufixo === "%" && "%"}
      {salvo && <span className="salvo-check">✓</span>}
    </span>
  );
}

// Desconto exibido no anúncio (schema v30) — o app calcula o preço original
// (riscado) = preço real ÷ (1 − desconto) pra digitar na plataforma
// (Precificação por Canal → Anunciar). Vazio = sem desconto exibido. Sem a
// coluna nova, mostra o acréscimo antigo da Olist convertido.
function CampoDesconto({ canal, onToast, onAtualizado }) {
  const [salvo, disparar] = useSalvoFlash();
  const atual = canal.desconto_anuncio_pct != null ? canal.desconto_anuncio_pct : canal.acrescimo_olist_pct != null ? descontoPadraoCanal(canal) : null;
  const [valor, setValor] = useState(null);
  const exibido = valor ?? (atual == null || atual === "" ? "" : String(Math.round(Number(atual) * 1000) / 10));
  async function salvar() {
    if (valor === null) return;
    const txt = valor.trim().replace(",", ".");
    const novo = txt === "" ? null : Number(txt) / 100;
    if (novo != null && (!isFinite(novo) || novo < 0 || novo > 0.9)) {
      onToast("Desconto precisa ficar entre 0% e 90%");
      return;
    }
    const { error } = await supabase.from("canais").update({ desconto_anuncio_pct: novo }).eq("id", canal.id);
    recarregarCatalogo();
    if (error) {
      onToast(/desconto_anuncio_pct|column/i.test(error.message) ? "Rode o SQL v30 no Supabase pra salvar o desconto" : "Não foi possível atualizar — tente de novo");
      return;
    }
    onAtualizado?.(novo);
    setValor(null);
    disparar();
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
      <input
        type="number"
        step="1"
        min="0"
        max="90"
        placeholder="—"
        title="Desconto que aparece no anúncio (preço riscado). Vazio = sem desconto."
        style={{ width: 70, textAlign: "right" }}
        value={exibido}
        onChange={(e) => setValor(e.target.value)}
        onBlur={salvar}
        onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
      />
      %
      {salvo && <span className="salvo-check">✓</span>}
    </span>
  );
}

export default function Canais({ onToast }) {
  const { lojaId } = useLoja();
  const { canaisTodos: canais, carregando } = useCatalogo();
  const [novo, setNovo] = useState(NOVO_VAZIO);
  const [salvandoNovo, setSalvandoNovo] = useState(false);
  const [edicoes, setEdicoes] = useState({});
  const [excluirAlvo, setExcluirAlvo] = useState(null);


  function chave(id, campo) {
    return `${id}:${campo}`;
  }

  async function salvarCampo(id, campo, isPct) {
    const raw = edicoes[chave(id, campo)];
    const valor = parseFloat(String(raw).replace(",", "."));
    const valorFinal = isFinite(valor) ? (isPct ? valor / 100 : valor) : 0;
    if (isPct) {
      const valorPct = isFinite(valor) ? valor : 0;
      if (valorPct < 0 || valorPct > 100) {
        onToast("Percentual precisa ficar entre 0% e 100%");
        return false;
      }
      if (CAMPOS_PCT.includes(campo)) {
        const canal = canais.find((c) => c.id === id) || {};
        const valoresPct = CAMPOS_PCT.reduce((acc, c) => {
          acc[c] = c === campo ? valorPct : Number(canal[c] || 0) * 100;
          return acc;
        }, {});
        if (somaPctExcede(valoresPct)) {
          onToast("Comissão + imposto + custos fixos + Ads não podem somar 100% ou mais — não sobra espaço pra margem");
          return false;
        }
      }
    }
    const { error } = await supabase.from("canais").update({ [campo]: valorFinal }).eq("id", id);
    recarregarCatalogo();
    if (error) {
      onToast("Não foi possível atualizar — tente de novo");
      return false;
    }
    setEdicoes((prev) => {
      const next = { ...prev };
      delete next[chave(id, campo)];
      return next;
    });
    return true;
  }

  async function adicionar() {
    const nome = novo.nome.trim();
    if (!nome) {
      onToast("Dê um nome ao canal");
      return;
    }
    const comissaoPct = parseFloat(novo.comissao_pct) || 0;
    const impostoPct = parseFloat(novo.imposto_pct) || 0;
    const custosFixosPct = parseFloat(novo.custos_fixos_pct) || 0;
    if ([comissaoPct, impostoPct, custosFixosPct].some((v) => v < 0 || v > 100)) {
      onToast("Percentual precisa ficar entre 0% e 100%");
      return;
    }
    // ads_pct só existe pra edição depois de criado (nasce em 0 aqui).
    if (somaPctExcede({ comissao_pct: comissaoPct, imposto_pct: impostoPct, custos_fixos_pct: custosFixosPct, ads_pct: 0 })) {
      onToast("Comissão + imposto + custos fixos + Ads não podem somar 100% ou mais — não sobra espaço pra margem");
      return;
    }
    setSalvandoNovo(true);
    const { error } = await supabase.from("canais").insert({
      nome,
      tipo: "custom",
      comissao_pct: comissaoPct / 100,
      taxa_fixa: parseFloat(novo.taxa_fixa) || 0,
      imposto_pct: impostoPct / 100,
      custos_fixos_pct: custosFixosPct / 100,
      ...(lojaId ? { loja_id: lojaId } : {}),
    });
    recarregarCatalogo();
    setSalvandoNovo(false);
    if (error) {
      onToast("Não foi possível adicionar — tente de novo");
      return;
    }
    setNovo(NOVO_VAZIO);
    onToast("Canal adicionado");
  }

  async function excluir(id) {
    const { error } = await supabase.from("canais").delete().eq("id", id);
    recarregarCatalogo();
    if (error) onToast("Não foi possível excluir — tente de novo");
  }

  const temTiktok = canais.some((c) => c.tipo === "tiktok");
  const temShein = canais.some((c) => c.tipo === "shein");

  async function adicionarTiktok() {
    const { error } = await supabase.from("canais").insert({
      nome: "TikTok Shop",
      tipo: "tiktok",
      ...(lojaId ? { loja_id: lojaId } : {}),
    });
    recarregarCatalogo();
    if (error) {
      onToast("Não foi possível adicionar — tente de novo");
      return;
    }
    onToast("TikTok Shop adicionado");
  }

  async function adicionarShein() {
    const { error } = await supabase.from("canais").insert({
      nome: "Shein",
      tipo: "shein",
      ...(lojaId ? { loja_id: lojaId } : {}),
    });
    recarregarCatalogo();
    if (error) {
      onToast("Não foi possível adicionar — tente de novo");
      return;
    }
    onToast("Shein adicionado");
  }

  if (!supabase) {
    return (
      <div className="panel">
        <h3>Canais</h3>
        <div className="empty">Indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="panel">
        <h3>
          Canais cadastrados
          <Ajuda texto="Comissão e taxa fixa da Shopee/ML seguem as faixas oficiais (calculadas automaticamente). Imposto e custos fixos são por canal — o Comparativo usa o valor daqui pra cada um. % de Ads é quanto você costuma investir em anúncio patrocinado, usado só pra mostrar o lucro com Ads em Comparar canais. Desconto no anúncio = o % de promoção que aparece no anúncio desse canal (preço riscado); o app calcula o preço original pra digitar na plataforma em Precificação por Canal → Anunciar. Dá pra dar um desconto próprio a um produto ou kit direto na aba Anunciar." />
        </h3>
        {carregando ? (
          <div className="empty">Carregando…</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Canal</th>
                  <th>Tipo</th>
                  <th className="num">Comissão</th>
                  <th className="num">Taxa fixa</th>
                  <th className="num">Imposto (seu)</th>
                  <th className="num">Custos fixos</th>
                  <th className="num">% Ads</th>
                  <th className="num">Desconto no anúncio</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {ordenarCanais(canais).map((c) => (
                  <tr key={c.id}>
                    <td>
                      <CanalTag canal={c} />
                    </td>
                    <td>{TIPO_LABEL[c.tipo] || c.tipo}</td>
                    <td className="num">
                      {c.tipo === "custom" ? (
                        <CampoEditavel canal={c} campo="comissao_pct" isPct sufixo="%" edicoes={edicoes} setEdicoes={setEdicoes} onSalvar={salvarCampo} />
                      ) : (
                        "por faixa"
                      )}
                    </td>
                    <td className="num">
                      {c.tipo === "custom" ? (
                        <CampoEditavel canal={c} campo="taxa_fixa" sufixo="R$" edicoes={edicoes} setEdicoes={setEdicoes} onSalvar={salvarCampo} />
                      ) : (
                        "por faixa"
                      )}
                    </td>
                    <td className="num">
                      <CampoEditavel canal={c} campo="imposto_pct" isPct sufixo="%" edicoes={edicoes} setEdicoes={setEdicoes} onSalvar={salvarCampo} />
                    </td>
                    <td className="num">
                      <CampoEditavel canal={c} campo="custos_fixos_pct" isPct sufixo="%" edicoes={edicoes} setEdicoes={setEdicoes} onSalvar={salvarCampo} />
                    </td>
                    <td className="num">
                      <CampoEditavel canal={c} campo="ads_pct" isPct sufixo="%" edicoes={edicoes} setEdicoes={setEdicoes} onSalvar={salvarCampo} />
                    </td>
                    <td className="num">
                      <CampoDesconto canal={c} onToast={onToast} onAtualizado={(v) => setCanais((prev) => prev.map((x) => (x.id === c.id ? { ...x, desconto_anuncio_pct: v } : x)))} />
                    </td>
                    <td>
                      {(c.tipo === "custom" || c.tipo === "tiktok" || c.tipo === "shein") && (
                        <button className="del" title="Excluir" onClick={() => setExcluirAlvo(c)}>×</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          {!temTiktok && (
            <button className="btn" onClick={adicionarTiktok}>
              + Adicionar TikTok Shop (faixas oficiais)
            </button>
          )}
          {!temShein && (
            <button className="btn" onClick={adicionarShein}>
              + Adicionar Shein (faixa oficial)
            </button>
          )}
        </div>
      </div>


      <div className="panel">
        <h3 className="section-title">Adicionar canal próprio</h3>
        <div className="row2">
          <div className="field">
            <label>Nome</label>
            <input type="text" placeholder="ex: Site Próprio" value={novo.nome} onChange={(e) => setNovo((p) => ({ ...p, nome: e.target.value }))} />
          </div>
          <div className="field">
            <label>Comissão (%)</label>
            <input type="number" step="0.1" min="0" max="100" value={novo.comissao_pct} onChange={(e) => setNovo((p) => ({ ...p, comissao_pct: e.target.value }))} />
          </div>
        </div>
        <div className="row3">
          <div className="field">
            <label>Taxa fixa (R$)</label>
            <input type="number" step="0.01" value={novo.taxa_fixa} onChange={(e) => setNovo((p) => ({ ...p, taxa_fixa: e.target.value }))} />
          </div>
          <div className="field">
            <label>Imposto (seu CNPJ/MEI) (%)</label>
            <input type="number" step="0.1" min="0" max="100" value={novo.imposto_pct} onChange={(e) => setNovo((p) => ({ ...p, imposto_pct: e.target.value }))} />
          </div>
          <div className="field">
            <label>
              Custos fixos (%)
              <Ajuda texto="Outros custos fixos que você tem por venda (não é imposto nem comissão do canal), como % sobre o preço de venda — ex: taxa de gateway de pagamento, embalagem extra etc." />
            </label>
            <input type="number" step="0.1" min="0" max="100" value={novo.custos_fixos_pct} onChange={(e) => setNovo((p) => ({ ...p, custos_fixos_pct: e.target.value }))} />
          </div>
        </div>
        <button className="btn primary" onClick={adicionar} disabled={salvandoNovo}>
          {salvandoNovo ? "Adicionando…" : "+ Adicionar canal"}
        </button>
      </div>

      {excluirAlvo && (
        <ConfirmDialog
          titulo="Excluir canal"
          mensagem={`Confirma excluir "${excluirAlvo.nome}"? Não é possível desfazer.`}
          confirmarLabel="Excluir"
          perigo
          onConfirm={() => {
            excluir(excluirAlvo.id);
            setExcluirAlvo(null);
          }}
          onCancel={() => setExcluirAlvo(null)}
        />
      )}
    </div>
  );
}
