import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Se as variáveis de ambiente não estiverem configuradas (ex: rodando local
// sem .env ainda), o app continua funcionando — só a aba Histórico fica
// desativada em vez de quebrar o resto da calculadora.
export const supabase = url && anonKey ? createClient(url, anonKey) : null;
