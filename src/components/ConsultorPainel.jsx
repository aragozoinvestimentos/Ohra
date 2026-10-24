import { useEffect, useMemo, useRef, useState } from "react";
import { EXEMPLOS_PERGUNTA, ROTULOS_ABA, conferirSenhaApp, montarPacote, responderPergunta, resumoUso } from "../lib/consultor.js";
import { atualizarRegistros, excluirRegistro, gravarRegistro, lerNivelApp } from "../lib/consultorAcoes.js";
import { hojeSP } from "../lib/datas.js";
import Estado from "./Estado.jsx";

// Painel do consultor da Sede (24/10/2026): Perguntar · Propostas · Levar pro
// Claude · Nível do app (senha). Só grava em consultor_registros (v65).
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
let seqChave = 0;
const chaveNova = () => `${Date.now()}-${++seqChave}`;
const dm = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : "");
const ABAS = [
  { k: "perguntar", r: "Perguntar" },
  { k: "propostas", r: "Propostas" },
  { k: "levar", r: "Levar pro Claude" },
  { k: "app", r: "🔒 App" },
];

export default function ConsultorPainel({ nome, lojaId, nomeLoja, ctx, registros, disponivel, consultorias, propostas, nomes, abrir, onToast, telaAtual }) {
  const [aba, setAba] = useState("perguntar");
  const hoje = hojeSP();
  const perguntasAbertas = registros.filter((r) => r.tipo === "pergunta" && r.status === "aberta");
  const aprovadas = registros.filter((r) => r.tipo === "consultoria" && r.status === "quero");
  const nPropostas = consultorias.length + propostas.length;
  const nLevar = perguntasAbertas.length + aprovadas.length;
  return (
    <div className="consultor">
      <h3>
        🤓 {nome} <span className="sede-quem">· consultor da loja</span>
      </h3>
      {!disponivel && <div className="aviso-cel">Pra guardar perguntas e propostas, rode o SQL v65 no Supabase. As perguntas básicas já funcionam.</div>}
      <div className="consultor-abas" role="tablist">
        {ABAS.map((a) => (
          <button key={a.k} type="button" role="tab" aria-selected={aba === a.k} className={aba === a.k ? "ativo" : ""} onClick={() => setAba(a.k)}>
            {a.r}
            {a.k === "propostas" && nPropostas > 0 && <span className="consultor-n">{nPropostas}</span>}
            {a.k === "levar" && nLevar > 0 && <span className="consultor-n">{nLevar}</span>}
          </button>
        ))}
      </div>
      {aba === "perguntar" && <Perguntar ctx={ctx} lojaId={lojaId} disponivel={disponivel} registros={registros} onToast={onToast} telaAtual={telaAtual} />}
      {aba === "propostas" && <Propostas lojaId={lojaId} disponivel={disponivel} consultorias={consultorias} propostas={propostas} aprovadas={aprovadas} nomes={nomes} abrir={abrir} onToast={onToast} />}
      {aba === "levar" && <Levar nomeLoja={nomeLoja} hoje={hoje} registros={registros} perguntas={perguntasAbertas} aprovadas={aprovadas} kpis={ctx.kpis} onToast={onToast} />}
      {aba === "app" && <NivelApp />}
    </div>
  );
}

function Perguntar({ ctx, lojaId, disponivel, registros, onToast, telaAtual }) {
  const [texto, setTexto] = useState("");
  const [conversa, setConversa] = useState([]);
  const [colando, setColando] = useState(null);
  const fimRef = useRef(null);
  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "nearest" });
  }, [conversa]);
  const guardadas = registros.filter((r) => r.tipo === "pergunta").slice(0, 8);
  async function guardar(pergunta, numeros) {
    if (!disponivel) return onToast?.("Rode o SQL v65 pra guardar a pergunta");
    const chave = chaveNova();
    const { error } = await gravarRegistro(lojaId, "pergunta", chave, { texto: pergunta, tela: telaAtual, numeros: numeros || null }, "aberta");
    if (error) onToast?.(`Não consegui guardar: ${error.message}`);
  }
  async function enviar(t = texto) {
    const p = t.trim();
    if (!p) return;
    const r = responderPergunta(p, ctx);
    setConversa((c) => [...c, { p, r }].slice(-6));
    setTexto("");
    if (!r.entendeu) await guardar(p, { kpis: ctx.kpis || null });
  }
  return (
    <div className="consultor-perguntar">
      <div className="consultor-conversa">
        {!conversa.length && <div className="sede-ok">Pergunte coisas simples sobre a loja. O que eu não souber, guardo pra você levar pro Claude.</div>}
        {conversa.map((c, i) => (
          <div key={i}>
            <div className="consultor-msg eu">{c.p}</div>
            <div className={`consultor-msg ele${c.r.entendeu ? "" : " naosei"}`}>
              {c.r.texto}
              {c.r.entendeu && (
                <button type="button" className="link-btn" onClick={() => guardar(c.p, c.r.numeros).then(() => onToast?.("Guardado pra levar pro Claude"))}>
                  levar pro Claude também
                </button>
              )}
            </div>
          </div>
        ))}
        <div ref={fimRef} />
      </div>
      <form
        className="consultor-campo"
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
      >
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Pergunte… ex.: quanto vendi essa semana?" maxLength={300} />
        <button type="submit" className="btn primary btn-sm">
          Perguntar
        </button>
      </form>
      <div className="consultor-exemplos">
        {EXEMPLOS_PERGUNTA.map((e) => (
          <button key={e} type="button" className="consultor-ex" onClick={() => enviar(e)}>
            {e}
          </button>
        ))}
      </div>
      {guardadas.length > 0 && (
        <>
          <div className="consultor-sub">Guardadas pro Claude</div>
          <ul className="consultor-lista">
            {guardadas.map((r) => (
              <li key={r.id}>
                <span className="sede-quem">{dm(r.criado_em)} · {r.status === "respondida" ? "✓ respondida" : r.status === "levada" ? "levada" : "aberta"}</span>
                <b>{r.dados?.texto}</b>
                {r.dados?.resposta && <div className="consultor-resposta">{r.dados.resposta}</div>}
                {colando === r.id ? (
                  <ColarResposta
                    onSalvar={async (txt) => {
                      await gravarRegistro(r.loja_id, "pergunta", r.chave, { ...r.dados, resposta: txt }, "respondida");
                      setColando(null);
                    }}
                    onCancelar={() => setColando(null)}
                  />
                ) : (
                  <span className="consultor-acoes">
                    {!r.dados?.resposta && (
                      <button type="button" className="link-btn" onClick={() => setColando(r.id)}>
                        guardar resposta do Claude
                      </button>
                    )}
                    <button type="button" className="link-btn" onClick={() => excluirRegistro(r.id)}>
                      apagar
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ColarResposta({ onSalvar, onCancelar }) {
  const [t, setT] = useState("");
  return (
    <div className="consultor-colar">
      <textarea rows={4} value={t} onChange={(e) => setT(e.target.value)} placeholder="Cole aqui a resposta do Claude" />
      <span className="consultor-acoes">
        <button type="button" className="btn primary btn-sm" disabled={!t.trim()} onClick={() => onSalvar(t.trim())}>
          Guardar
        </button>
        <button type="button" className="btn btn-sm" onClick={onCancelar}>
          Cancelar
        </button>
      </span>
    </div>
  );
}

function Propostas({ lojaId, disponivel, consultorias: todasC, propostas: todasP, aprovadas, nomes, abrir, onToast }) {
  const [verTudo, setVerTudo] = useState(false);
  const consultorias = verTudo ? todasC : todasC.slice(0, 3);
  const propostas = verTudo ? todasP : todasP.slice(0, 4);
  const escondidas = todasC.length + todasP.length - consultorias.length - propostas.length;
  async function decidir(item, status) {
    if (!disponivel) return onToast?.("Rode o SQL v65 pra guardar a decisão");
    const dados = { titulo: item.titulo, viu: item.viu || item.proposta, porque: item.porque || null, responderia: item.responderia || null, proposta: item.proposta || null, de: item.de || null, para: item.para || null };
    const { error } = await gravarRegistro(lojaId, "consultoria", item.chave, dados, status);
    if (error) return onToast?.(`Não consegui guardar: ${error.message}`);
    onToast?.(status === "quero" ? "Vai no pacote “Levar pro Claude”" : status === "aprovada" ? "Aprovado" : "Ok");
  }
  const n = (id) => nomes[id] || id;
  if (!todasC.length && !todasP.length && !aprovadas.length) return <div className="sede-ok">Nenhuma proposta agora. A equipe está em dia ✓</div>;
  return (
    <div className="consultor-propostas">
      {consultorias.map((c) => (
        <div key={c.chave} className="consultor-cartao">
          <Estado tipo={c.tipo === "expansao" ? "atencao" : "decisao"}>{c.tipo === "expansao" ? "expansão" : "consultoria"}</Estado>
          <b>{c.titulo}</b>
          <dl>
            <dt>O que eu vi</dt>
            <dd>{c.viu}</dd>
            <dt>Por que agora</dt>
            <dd>{c.porque}</dd>
            <dt>A análise responderia</dt>
            <dd>{c.responderia}</dd>
            <dt>Pode ganhar</dt>
            <dd>{c.ganho}</dd>
          </dl>
          <span className="consultor-acoes">
            <button type="button" className="btn primary btn-sm" onClick={() => decidir(c, "quero")}>
              Quero a consultoria
            </button>
            <button type="button" className="btn btn-sm" onClick={() => decidir(c, "agora-nao")}>
              Agora não
            </button>
            <button type="button" className="link-btn" onClick={() => decidir(c, "nunca")}>
              não sugerir mais
            </button>
          </span>
        </div>
      ))}
      {propostas.length > 0 && <div className="consultor-sub">A equipe conversou e propõe</div>}
      {propostas.map((p) => (
        <div key={p.chave} className="consultor-cartao">
          <Estado tipo={p.urgente ? "resolver" : "atencao"}>{`${n(p.de)} → ${n(p.para)}`}</Estado>
          <div className="consultor-dialogo">
            <span>
              <b>{n(p.de)}:</b> “{p.fala}”
            </span>
            <span>
              <b>{n(p.para)}:</b> “{p.resposta}”
            </span>
          </div>
          <div className="sede-aviso-txt">{p.titulo}</div>
          <div>
            <b>Proposta:</b> {p.proposta}
          </div>
          <span className="consultor-acoes">
            <button
              type="button"
              className="btn primary btn-sm"
              onClick={() => {
                decidir(p, "aprovada");
                abrir?.(p);
              }}
            >
              Aprovar e abrir
            </button>
            <button type="button" className="btn btn-sm" onClick={() => decidir(p, "quero")}>
              Levar pro Claude
            </button>
            <button type="button" className="btn btn-sm" onClick={() => decidir(p, "agora-nao")}>
              Agora não
            </button>
          </span>
        </div>
      ))}
      {escondidas > 0 && (
        <button type="button" className="btn btn-sm" onClick={() => setVerTudo(true)}>
          ver todas ({escondidas} a mais)
        </button>
      )}
      {aprovadas.length > 0 && (
        <>
          <div className="consultor-sub">Esperando ir pro Claude ({aprovadas.length})</div>
          <ul className="consultor-lista">
            {aprovadas.map((r) => (
              <li key={r.id}>
                <b>{r.dados?.titulo}</b>
                <button type="button" className="link-btn" onClick={() => atualizarRegistros([r.id], { status: "agora-nao" })}>
                  tirar do pacote
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Levar({ nomeLoja, hoje, registros, perguntas, aprovadas, kpis, onToast }) {
  const erros = registros.filter((r) => r.tipo === "erro" && String(r.chave).slice(0, 10) >= somarDias(hoje, -13));
  const uso = resumoUso(registros, somarDias(hoje, -29));
  const texto = useMemo(() => montarPacote({ nomeLoja, hoje, perguntas, consultorias: aprovadas, erros, uso, kpis }), [nomeLoja, hoje, perguntas, aprovadas, erros, uso, kpis]);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      onToast?.("Copiado! Cole na conversa com o Claude");
    } catch {
      onToast?.("Não consegui copiar — selecione o texto e copie");
    }
  }
  async function marcarLevado() {
    await atualizarRegistros([...perguntas, ...aprovadas].map((r) => r.id), { status: "levada" });
    onToast?.("Marcado como levado");
  }
  return (
    <div className="consultor-levar">
      <div className="sede-quem">
        {perguntas.length} pergunta{perguntas.length === 1 ? "" : "s"} · {aprovadas.length} consultoria{aprovadas.length === 1 ? "" : "s"} · {erros.length} erro{erros.length === 1 ? "" : "s"} do app · uso das telas
      </div>
      <textarea readOnly rows={12} value={texto} onFocus={(e) => e.target.select()} />
      <span className="consultor-acoes">
        <button type="button" className="btn primary btn-sm" onClick={copiar}>
          Copiar tudo
        </button>
        <button type="button" className="btn btn-sm" disabled={!perguntas.length && !aprovadas.length} onClick={marcarLevado}>
          Já levei — marcar como levado
        </button>
      </span>
      <div className="hint">Cole na conversa com o Claude. Depois, guarde a resposta na pergunta (aba Perguntar).</div>
    </div>
  );
}

function NivelApp() {
  const [liberado, setLiberado] = useState(() => {
    try {
      return sessionStorage.getItem("ohra:consultor:app") === "1";
    } catch {
      return false;
    }
  });
  const [senha, setSenha] = useState("");
  const [dados, setDados] = useState(null);
  const [erroSenha, setErroSenha] = useState(false);
  async function entrar(e) {
    e.preventDefault();
    if (!(await conferirSenhaApp(senha))) return setErroSenha(true);
    try {
      sessionStorage.setItem("ohra:consultor:app", "1");
    } catch {
      // só não lembra na sessão
    }
    setLiberado(true);
    setDados(await lerNivelApp());
  }
  if (!liberado)
    return (
      <form className="consultor-campo" onSubmit={entrar}>
        <input type="password" inputMode="numeric" value={senha} onChange={(e) => (setSenha(e.target.value), setErroSenha(false))} placeholder="Senha do nível app" />
        <button type="submit" className="btn primary btn-sm">
          Entrar
        </button>
        {erroSenha && <span className="consultor-erro">Senha errada</span>}
      </form>
    );
  if (!dados)
    return (
      <button type="button" className="btn btn-sm" onClick={async () => setDados(await lerNivelApp())}>
        Carregar erros e uso de todas as lojas
      </button>
    );
  const nomeLoja = (id) => dados.lojas.find((l) => l.id === id)?.nome || "loja";
  const uso = resumoUso(dados.uso);
  return (
    <div className="consultor-app">
      <div className="sede-quem">Só erros e uso das telas — nenhum número de venda das lojas.</div>
      <div className="consultor-sub">Erros do app ({dados.erros.length})</div>
      <ul className="consultor-lista">
        {dados.erros
          .sort((a, b) => String(b.atualizado_em).localeCompare(String(a.atualizado_em)))
          .slice(0, 20)
          .map((e) => (
            <li key={`${e.loja_id}|${e.chave}`}>
              <span className="sede-quem">
                {nomeLoja(e.loja_id)} · {dm(e.chave)} · {e.dados?.vezes || 1}× · {ROTULOS_ABA[e.dados?.tela] || e.dados?.tela}
              </span>
              <code>{e.dados?.msg}</code>
            </li>
          ))}
        {!dados.erros.length && <li className="sede-ok">Nenhum erro anotado ✓</li>}
      </ul>
      <div className="consultor-sub">Telas mais usadas (todas as lojas)</div>
      <div className="sede-aviso-txt">{uso.slice(0, 15).map((u) => `${u.rotulo} ${u.n}×`).join(" · ") || "sem dados ainda"}</div>
    </div>
  );
}
