"use client";

import { useEffect } from "react";

import { clienteNavegador } from "@/lib/supabase/cliente";

import {
  decidirNoAnelDeSessao,
  precisaConferirOPapel,
} from "./anel-de-sessao.logica";

/**
 * O SEGUNDO ANEL DE GUARDA DO PAINEL — a ilha que não desenha nada.
 *
 * POR QUE ELE EXISTE. O anel de servidor (`lib/conta/painel-servidor.ts`, pelo
 * layout de `(protegido)`) roda UMA VEZ, na requisição que serviu a página.
 * Depois disso as telas do painel são Server Components, e nenhum deles roda de
 * novo até haver navegação. Um gestor que deixa a aba aberta a noite inteira, ou
 * que sai da conta em outra aba, continuaria vendo a interface inteira — com
 * cada botão respondendo 401 em silêncio. Uma tela que parece funcionar e não
 * grava nada é pior que uma tela que diz "entre de novo".
 *
 * NÃO REMOVA UM PELO OUTRO. O de servidor impede que o pacote do painel chegue a
 * um anônimo; este impede que a tela do painel siga de pé depois que o acesso
 * acabou. São dois problemas diferentes.
 *
 * DE ONDE ELE VEIO. Este anel era `legacy/routes/AdminRoutes.jsx` — e era meia
 * verdade: aquele componente só era montado DENTRO da ilha do painel legado
 * (`/dashboard/legado/*`), então as telas novas nunca chegaram a tê-lo. Apagar
 * `frontend/legacy/` não criaria a regressão: tornaria total uma lacuna que já
 * existia. Este arquivo a fecha, e sobrevive ao dia em que o legado for apagado.
 *
 * ELE NÃO DESENHA NADA, E ISSO É DELIBERADO. O `AdminRoutes` devolvia um
 * `<Loading />` enquanto redirecionava, porque ELE era o dono da árvore: sem
 * isso o painel piscaria branco. Aqui a árvore é do layout, o conteúdo já está
 * renderizado e correto, e trocá-lo por um spinner no instante entre disparar a
 * navegação e o navegador sair da página só faria a tela piscar por nada.
 *
 * `window.location` E NÃO `router.push`. Sair daqui é DESCARTAR esta sessão de
 * painel inteira — o cache do App Router guarda os RSCs já baixados, e uma
 * navegação de cliente pode servir de volta, do cache, a tela que acabou de
 * deixar de ser permitida. `replace` e não `assign` porque a URL do painel de
 * onde se está saindo não merece entrada no histórico: o Voltar levaria a uma
 * tela que vai expulsar a pessoa de novo. O `?de=` cuida do retorno.
 *
 * O REDIRECIONAMENTO VAI NUM EFEITO, e não no corpo do render — a mesma razão
 * que estava escrita no `AdminRoutes`: mexer em `window.location` durante o
 * render é efeito colateral, e em StrictMode o React renderiza duas vezes, o que
 * dispararia a navegação duas.
 */
export function AnelDeSessao({
  /**
   * Por quem o anel de SERVIDOR respondeu ao servir esta tela — o retorno de
   * `exigirAdminNoPainel`. É a entrega de um anel para o outro: com ela, o caso
   * comum (a mesma pessoa, o token renovando de hora em hora) não custa nenhuma
   * ida à rede. Ver `precisaConferirOPapel`.
   */
  userIdDoServidor,
}: {
  userIdDoServidor: string | null;
}) {
  useEffect(() => {
    let montado = true;

    /**
     * A callback NÃO é `async` de propósito: o supabase-js entrega os eventos em
     * fila, e uma callback lenta atrasa os próximos. Ela dispara o trabalho e
     * volta na hora — é o mesmo padrão de `lib/sacola/sacola.tsx`.
     *
     * Ela também dispara MUITAS vezes por sessão (`INITIAL_SESSION` na
     * construção do cliente, `SIGNED_IN` a cada retomada de foco da aba,
     * `TOKEN_REFRESHED` a cada renovação, todos replicados entre abas por
     * `BroadcastChannel`). Aqui isso não pede trava: reavaliar é barato — o
     * caminho comum não vai à rede — e a decisão é a mesma toda vez.
     */
    let desinscrever = () => {};

    try {
      const supabase = clienteNavegador();

      const avaliar = async (userId: string | null) => {
        const temSessao = userId !== null;

        let ehAdmin: boolean | null = null;
        if (precisaConferirOPapel(temSessao, userId, userIdDoServidor)) {
          /*
            A MESMA PERGUNTA DE `lerPapel` (lib/conta/sessao.ts) e do anel de
            servidor: o papel vem da TABELA, nunca do JWT. A instância do
            Supabase é compartilhada com outros projetos e `user_metadata` é
            editável pelo próprio dono da conta — um `{"role":"admin"}` ali seria
            administrador autoatribuído. `canastra.admins` só é escrita por
            `service_role`, e a política devolve zero linhas para quem não é.
          */
          const { data, error } = await supabase
            .from("admins")
            .select("user_id")
            .eq("user_id", userId as string)
            .maybeSingle();

          // `error` vira `null`, e não `false`: "não respondeu" não é "respondeu
          // que não". Quem faz alguma coisa com essa diferença é
          // `decidirNoAnelDeSessao`, e o porquê de ela não expulsar ninguém está
          // escrito lá.
          if (error) {
            console.warn(
              "[painel] Não foi possível conferir canastra.admins no anel de " +
                `sessão; mantendo a tela. ${error.code ?? ""} ${error.message ?? ""}`.trim(),
            );
            ehAdmin = null;
          } else {
            ehAdmin = Boolean(data);
          }
        }

        if (!montado) return;

        const acao = decidirNoAnelDeSessao({
          temSessao,
          userId,
          userIdDoServidor,
          ehAdmin,
          // O caminho do NAVEGADOR, com a query junto: é o que devolve a pessoa
          // à tela E aos filtros que ela tinha aberto. É a informação que o anel
          // de servidor não tem como saber (o Next apaga o `Next-Url` de toda
          // requisição — ver `painel-servidor.ts`), e a razão de o `?de=` de lá
          // ser sempre a raiz do painel.
          rotaAtual: window.location.pathname + window.location.search,
        });

        if (acao.tipo === "sai") window.location.replace(acao.destino);
      };

      const { data: inscricao } = supabase.auth.onAuthStateChange(
        (_evento, sessao) => {
          void avaliar(sessao?.user?.id ?? null);
        },
      );
      desinscrever = () => inscricao.subscription.unsubscribe();
    } catch (erro) {
      /*
        `clienteNavegador()` lança quando falta `NEXT_PUBLIC_SUPABASE_*`
        (`ambiente.ts` diz o nome da variável). Sem este `catch` o painel INTEIRO
        cairia — este componente está no layout, que envolve todas as telas —
        por causa de um anel que é a SEGUNDA camada. O acesso continua guardado
        pelo anel de servidor, que roda antes de qualquer byte sair, e pela RLS.
      */
      console.warn("[painel] Anel de sessão não pôde ser montado.", erro);
    }

    return () => {
      montado = false;
      desinscrever();
    };
  }, [userIdDoServidor]);

  return null;
}
