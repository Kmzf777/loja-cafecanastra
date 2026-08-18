/**
 * Cliente Supabase do SERVIDOR — Server Components e Route Handlers.
 *
 * Lê a sessão dos cookies que `cliente.ts` gravou no navegador, então o mesmo
 * usuário logado na vitrine é reconhecido pelo Postgres e as policies de RLS
 * valem também na renderização de servidor.
 *
 * NÃO é singleton, e isso é obrigatório: cada requisição pertence a uma pessoa
 * diferente. Um cliente reaproveitado entre requisições serviria os dados de um
 * cliente para outro. Por isso é uma função `criar…` chamada a cada uso.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { ESQUEMA, chaveAnonima, urlSupabase } from "./ambiente";

/**
 * `cookies()` é assíncrono a partir do Next 15 — daí o `await` e o retorno
 * `Promise`. Chamar sem `await` devolve um Proxy que falha só quando alguém
 * tenta ler um cookie.
 */
export async function criarClienteServidor() {
  const url = urlSupabase();
  const chave = chaveAnonima();
  const armazem = await cookies();

  return createServerClient(url, chave, {
    // Mesmo esquema do navegador. Ver ./ambiente.ts.
    db: { schema: ESQUEMA },
    cookies: {
      getAll() {
        return armazem.getAll();
      },
      /**
       * POR QUE O `catch` VAZIO.
       *
       * Um Server Component não pode escrever cookies: a resposta pode já ter
       * começado a ser enviada, então o Next lança ao chamar `.set()`. Só que
       * quem chama `.set()` aqui não é o nosso código — é o supabase-js,
       * sozinho, quando percebe que o access token expirou e o renova. Deixar
       * a exceção subir derrubaria a página inteira por causa de uma renovação
       * de rotina.
       *
       * Então engolimos, e a renovação continua funcionando porque em Route
       * Handlers (e no middleware, se um for adicionado) o `.set()` passa e o
       * cookie novo é gravado de fato.
       *
       * O PREJUÍZO DE ENGOLIR, escrito porque é invisível: se a sessão só for
       * tocada por Server Components, o token renovado nunca chega ao
       * navegador. A pessoa é deslogada quando o refresh token expira, sem erro
       * em lugar nenhum. O sintoma é "às vezes ele cai da conta". O conserto,
       * se acontecer, é um `middleware.ts` chamando `getClaims()` e devolvendo
       * os cookies na resposta — não é remover este `catch`.
       */
      setAll(cookiesParaGravar) {
        try {
          for (const { name, value, options } of cookiesParaGravar) {
            armazem.set(name, value, options);
          }
        } catch {
          // Server Component: ver acima.
        }
      },
    },
  });
}
