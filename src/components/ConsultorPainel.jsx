import { useEffect, useMemo, useRef, useState } from "react";
import { EXEMPLOS_PERGUNTA, ROTULOS_ABA, conferirSenhaApp, montarPacote, responderPergunta, resumoUso } from "../lib/consultor.js";
import { atualizarRegistros, excluirRegistro, gravarRegistro, lerNivelApp } from "../lib/consultorAcoes.js";
import {
  NOVIDADES_CONSULTOR,
  assuntoDe,
  dadosComDecisao,
  linhasAprendizado,
  notaDoPerfil,
  perfilDecisoes,
  perguntasAprendidas,
  respostaAprendida,
  resumoAprendizado,
  ultimoResultado,
} from "../lib/consultorAprende.js";
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
  { k: "aprendi", r: "📚 Aprendi" },
  { k: "app", r: "🔒 App" },
];

export default function ConsultorPainel({ nome, lojaId, nomeLoja, ctx, registros, disponivel, consultorias, propostas, backup, nomes, abrir, onToast, telaAtual }) {
  const [aba, setAba] = useState("perguntar");
  const hoje = hojeSP();
  const perguntasAbertas = registros.filter((r) => r.tipo === "pergunta" && r.status === "aberta");
  const aprovadas = registros.filter((r) => r.tipo === "consultoria" && r.status === "quero");
  const nPropostas = consultorias.length + propostas.length + (backup?.estado.vencido ? 1 : 0);
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
      {aba === "propostas" && <Propostas backup={backup} lojaId={lojaId} disponivel={disponivel} registros={registros} hoje={hoje} consultorias={consultorias} propostas={propostas} aprovadas={aprovadas} nomes={nomes} abrir={abrir} onToast={onToast} />}
      {aba === "levar" && <Levar nomeLoja={nomeLoja} hoje={hoje} registros={registros} perguntas={perguntasAbertas} aprovadas={aprovadas} kpis={ctx.kpis} onToast={onToast} />}
      {aba === "aprendi" && <Aprendi lojaId={lojaId} disponivel={disponivel} registros={registros} onToast={onToast} />}
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
  const guardadas = registros.filter((r) => r.tipo === "pergunta" && !r.dados?.ensinada).slice(0, 8);
  const atalhos = [...new Set([...perguntasAprendidas(registros), ...EXEMPLOS_PERGUNTA])].slice(0, 9);
  async function guardar(pergunta, numeros) {
    if (!disponivel) return onToast?.("Rode o SQL v65 pra guardar a pergunta");
    const chave = chaveNova();
    const { error } = await gravarRegistro(lojaId, "pergunta", chave, { texto: pergunta, tela: telaAtual, numeros: numeros || null }, "aberta");
    if (error) onToast?.(`Não consegui guardar: ${error.message}`);
  }
  async function enviar(t = texto) {
    const p = t.trim();
    if (!p) return;
    let r = responderPergunta(p, ctx);
    // não sabe pelos números → procura no que já aprendeu (respostas do Claude e as que você ensinou)
    if (!r.entendeu) {
      const a = respostaAprendida(p, registros);
      if (a) {
        r = { entendeu: true, aprendida: a, texto: `${a.ensinada ? "Você me ensinou" : "Aprendi com o Claude"} em ${dm(a.data)}${a.score < 1 ? ` (pergunta parecida: “${a.texto}”)` : ""}:\n${a.resposta}`, numeros: null };
        if (disponivel) gravarRegistro(a.registro.loja_id, "pergunta", a.registro.chave, { ...a.registro.dados, usos: (Number(a.registro.dados?.usos) || 0) + 1 }, a.registro.status);
      }
    }
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
                  {c.r.aprendida ? "não era isso — levar pro Claude" : "levar pro Claude também"}
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
        {atalhos.map((e) => (
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

function Propostas({ backup, lojaId, disponivel, registros, hoje, consultorias: todasC, propostas: todasP, aprovadas, nomes, abrir, onToast }) {
  const perfil = useMemo(() => perfilDecisoes(registros), [registros]);
  const registroDe = (chave) => registros.find((r) => r.tipo === "consultoria" && r.chave === chave);
  // o que o consultor aprendeu sobre o assunto (aprovações, adiamentos e se resolveu)
  const Aprendeu = ({ chave }) => {
    const a = assuntoDe(chave);
    const t = [notaDoPerfil(perfil[a]), ultimoResultado(registros, a)].filter(Boolean);
    return t.length ? <div className="consultor-aprendeu">📚 {t.join(" · ")}</div> : null;
  };
  const [verTudo, setVerTudo] = useState(false);
  const consultorias = verTudo ? todasC : todasC.slice(0, 3);
  const propostas = verTudo ? todasP : todasP.slice(0, 4);
  const escondidas = todasC.length + todasP.length - consultorias.length - propostas.length;
  async function decidir(item, status) {
    if (!disponivel) return onToast?.("Rode o SQL v65 pra guardar a decisão");
    const antes = registroDe(item.chave)?.dados;
    const dados = dadosComDecisao({ ...(antes || {}), titulo: item.titulo, viu: item.viu || item.proposta, porque: item.porque || null, responderia: item.responderia || null, proposta: item.proposta || null, de: item.de || null, para: item.para || null }, status, hoje);
    const { error } = await gravarRegistro(lojaId, "consultoria", item.chave, dados, status);
    if (error) return onToast?.(`Não consegui guardar: ${error.message}`);
    onToast?.(status === "quero" ? "Vai no pacote “Levar pro Claude”" : status === "aprovada" ? "Aprovado" : "Ok");
  }
  const n = (id) => nomes[id] || id;
  const cartaoBackup = backup?.estado.vencido ? (
    <div className="consultor-cartao">
      <Estado tipo="atencao">arquivo pronto pra gerar</Estado>
      <b>📄 Backup de 15 dias</b>
      <div className="sede-aviso-txt">
        Último backup: {backup.estado.texto}. Todos os dados de todas as lojas num arquivo — guarde numa pasta segura (ou no Drive).
      </div>
      <button type="button" className="btn primary btn-sm" onClick={backup.gerar} disabled={backup.gerando}>
        {backup.gerando ? "Gerando…" : "Gerar e baixar"}
      </button>
    </div>
  ) : null;
  if (!todasC.length && !todasP.length && !aprovadas.length) return cartaoBackup || <div className="sede-ok">Nenhuma proposta agora. A equipe está em dia ✓</div>;
  return (
    <div className="consultor-propostas">
      {cartaoBackup}
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
          <Aprendeu chave={c.chave} />
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
          <Aprendeu chave={p.chave} />
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
  const aprendizado = useMemo(() => linhasAprendizado(registros), [registros]);
  const texto = useMemo(() => montarPacote({ nomeLoja, hoje, perguntas, consultorias: aprovadas, erros, uso, kpis, aprendizado }), [nomeLoja, hoje, perguntas, aprovadas, erros, uso, kpis, aprendizado]);
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

function Aprendi({ lojaId, disponivel, registros, onToast }) {
  const r = useMemo(() => resumoAprendizado(registros), [registros]);
  const respostas = registros.filter((x) => x.tipo === "pergunta" && x.dados?.resposta);
  const [p, setP] = useState("");
  const [resp, setResp] = useState("");
  async function ensinar(e) {
    e.preventDefault();
    if (!disponivel) return onToast?.("Rode o SQL v65 pra eu aprender");
    const { error } = await gravarRegistro(lojaId, "pergunta", chaveNova(), { texto: p.trim(), resposta: resp.trim(), ensinada: true, usos: 0 }, "respondida");
    if (error) return onToast?.(`Não consegui guardar: ${error.message}`);
    setP("");
    setResp("");
    onToast?.("Aprendi! Da próxima vez respondo sozinho");
  }
  return (
    <div className="consultor-aprendi">
      <div className="sede-ok">
        Eu aprendo com o que vocês fazem: guardo as respostas do Claude, o que você costuma aprovar ou deixar pra depois, e confiro se o que foi aprovado resolveu.
      </div>
      <div className="consultor-sub">Respostas que eu já sei ({r.respostas})</div>
      {respostas.length ? (
        <ul className="consultor-lista">
          {respostas.slice(0, 10).map((x) => (
            <li key={x.id}>
              <span className="sede-quem">
                {x.dados.ensinada ? "você me ensinou" : "do Claude"} · {dm(x.atualizado_em || x.criado_em)} · usada {Number(x.dados.usos) || 0}×
              </span>
              <b>{x.dados.texto}</b>
              <div className="consultor-resposta">{x.dados.resposta}</div>
              <button type="button" className="link-btn" onClick={() => excluirRegistro(x.id)}>
                esquecer
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="hint">Ainda nenhuma. Quando você guardar uma resposta do Claude (aba Perguntar) ou me ensinar aqui embaixo, eu passo a responder sozinho perguntas parecidas.</div>
      )}
      <form className="consultor-ensinar" onSubmit={ensinar}>
        <div className="consultor-sub">Ensinar uma resposta</div>
        <input value={p} onChange={(e) => setP(e.target.value)} placeholder="Pergunta — ex.: qual o prazo de envio da Shopee?" maxLength={300} />
        <textarea rows={3} value={resp} onChange={(e) => setResp(e.target.value)} placeholder="Resposta que eu devo dar" />
        <button type="submit" className="btn primary btn-sm" disabled={!p.trim() || !resp.trim()}>
          Ensinar
        </button>
      </form>
      <div className="consultor-sub">O que aprendi com as suas decisões</div>
      {r.assuntos.length ? (
        <ul className="consultor-lista">
          {r.assuntos.map((a) => (
            <li key={a.assunto}>
              <b>{a.rotulo}</b>
              <span className="sede-aviso-txt">
                aprovou {a.sim} · deixou pra depois {a.depois}
                {a.nunca ? ` · não quer mais ${a.nunca}` : ""}
                {a.resolveu + a.continuou ? ` · resolveu ${a.resolveu} de ${a.resolveu + a.continuou}` : ""}
                {a.espera > 14 ? ` · volto só depois de ${a.espera} dias` : ""}
              </span>
              {a.nota && <span className="consultor-aprendeu">📚 {a.nota}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <div className="hint">Ainda pouco. Cada “Quero”, “Aprovar”, “Agora não” e “não sugerir mais” me ensina o que vale trazer.</div>
      )}
      <div className="consultor-sub">O que aprendi com as mudanças do app</div>
      <ul className="consultor-lista">
        {[...NOVIDADES_CONSULTOR].reverse().map((n, i) => (
          <li key={i}>
            <span className="sede-quem">{dm(n.data)}</span>
            {n.texto}
          </li>
        ))}
      </ul>
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
