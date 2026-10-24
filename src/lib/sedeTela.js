// Modo tela cheia da Sede (24/10/2026): "manual" = botão na Sede (sai pelo
// botão ou Esc); "descanso" = substitui a tela de descanso depois de 5 min
// sem mexer (sai ao primeiro movimento e volta pra tela de antes).
// Quem troca de aba é o App, que ouve este evento.
export const pedirTelaSede = (tipo) => window.dispatchEvent(new CustomEvent("ohra:sede-tela", { detail: tipo }));

// "← Voltar pra Sede" (24/10/2026): quando a Sede (consultor, sala, pessoa)
// manda pra outra tela, o App mostra um botão fixo pra voltar. Some ao voltar,
// no × ou quando você escolhe outro item do menu por conta própria.
export const marcarVoltaSede = () => window.dispatchEvent(new Event("ohra:volta-sede"));
