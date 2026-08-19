/**
 * Sessão do painel legado — agora sobre o GoTrue.
 *
 * O CONTRATO DO CONTEXTO NÃO MUDOU, de propósito: `user`, `accessToken`,
 * `initialized`, `createUser`, `loginUser`, `logoutUser` e `authFetch`
 * continuam com os mesmos nomes e os mesmos papéis, e nenhum dos consumidores
 * (Header, Sidebar, Cart, LoginForm, productContext, as telas do painel)
 * precisou de edição por causa disto. O que mudou é o que existe do outro lado.
 *
 * O QUE SAIU
 *  - `POST /auth/refresh-token`, `/sign-in`, `/sign-out`, `/sign-up`: apagados
 *    na Task 5. Quem responde agora é o `lib/conta/sessao.ts`, que a vitrine já
 *    usava — este arquivo NÃO reimplementa nada, ele chama.
 *  - `localStorage["has_refresh"]`: era a pista de "vale a pena tentar o
 *    refresh" do esquema de cookie do Express. Morre junto com o esquema; o
 *    supabase-js guarda a sessão em cookie e sabe sozinho se há o que renovar.
 *    `sair()` ainda APAGA a chave, para quem já a tinha gravada.
 *  - `getCsrfToken`, que este provedor exportava pelo contexto. Ver `api.js`.
 *    O único consumidor era `productContextProvider.jsx`, que já o chamava sob
 *    `typeof getCsrfToken === "function"` — sem ele, o `X-CSRF-Token` continua
 *    `null` e o cabeçalho simplesmente não é montado. Isso IMPORTA: o cabeçalho
 *    saiu do `allowedHeaders` do CORS, e enviá-lo hoje quebraria o preflight.
 *  - O `AbortController` compartilhado: ele existia para cancelar os `fetch`
 *    de login/cadastro. As chamadas do supabase-js não recebem signal, e o
 *    controlador viraria estado morto. O `error.name === "AbortError"` que
 *    sobrou nas telas é inofensivo — nunca casa.
 *
 * O PAPEL DE ADMINISTRADOR VEM DE `canastra.admins`, e não de claim nenhum:
 * quem lê é `lerPapel()` em `sessao.ts`, e ele cai para "cliente" quando a
 * consulta FALHA. Numa instância compartilhada do Supabase, um projeto vizinho
 * pode cunhar o claim que quiser; a tabela, não — escrever nela é privilégio de
 * `service_role`. `routes/AdminRoutes.jsx` compara com `"admin"` e é só isso
 * que ele precisa saber.
 *
 * SOBRE `shop:cartMerged`: o evento sumiu daqui porque a fusão de sacola sumiu
 * do login — `/auth/sign-in` levava o carrinho local no corpo e devolvia o
 * carrinho fundido, e essa rota não existe mais. O ouvinte em
 * `productContextProvider.jsx` fica inerte; a fusão de verdade é a
 * `canastra.fundir_sacola` da vitrine. `shop:logout` CONTINUA sendo disparado,
 * porque é ele que esvazia o carrinho em memória do painel.
 */
import PropTypes from "prop-types";
import authContext from "./createAuthContext";
import { useEffect, useState } from "react";
import { authFetch } from "../../api";
import { entrar, recuperarSessao, sair } from "../../../lib/conta/sessao";
import { cadastrar } from "../../../lib/conta/cadastro";

const AuthProvider = ({ children }) => {
  const [accessToken, setAccessToken] = useState(null);
  const [user, setUser] = useState(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    let montado = true;

    // `recuperarSessao()` não rejeita: ele devolve `null` para "sem sessão" e
    // também para "deu erro", que é o estado seguro (visitante). O `finally`
    // está aqui mesmo assim porque `initialized` NÃO PODE ficar falso — o
    // painel inteiro fica preso na tela de carregamento se ficar.
    recuperarSessao()
      .then((sessao) => {
        if (!montado || !sessao) return;
        setUser(sessao.usuario);
        setAccessToken(sessao.accessToken);
      })
      .finally(() => {
        if (montado) setInitialized(true);
      });

    return () => {
      montado = false;
    };
  }, []);

  /**
   * `cadastrar()` devolve `{ situacao, email }`, não uma `Response`. Quem chama
   * é `components/SignUpForm/SignUpForm.jsx`, ajustado junto.
   */
  const createUser = async (userData) =>
    cadastrar({
      nome: userData.name,
      email: userData.email,
      senha: userData.password,
      telefone: userData.phone ?? null,
      cpf: userData.cpf ?? null,
    });

  /**
   * Erros sobem como `ErroDeLogin`, cuja `.message` já é frase de loja em
   * português — as telas fazem `toast.error(error.message)` e continuam certas
   * sem mudar uma linha.
   */
  const loginUser = async (credentials) => {
    const sessao = await entrar(credentials.email, credentials.password);
    setUser(sessao.usuario);
    setAccessToken(sessao.accessToken);
    return sessao;
  };

  const logoutUser = async () => {
    // `sair()` não lança: ele já engole a falha do servidor de propósito, para
    // que ninguém fique preso dentro da conta por causa de uma rede ruim.
    await sair();
    setUser(null);
    setAccessToken(null);
    // O evento vai ANTES do localStorage: quem ouve (`productContextProvider`)
    // é que esvazia o carrinho em memória, e num navegador em modo privado sem
    // cota o `removeItem` pode lançar. Nessa ordem, uma falha de storage não
    // deixa a sacola da sessão anterior visível na tela.
    window.dispatchEvent(new Event("shop:logout"));
    localStorage.removeItem("cart");
  };

  return (
    <authContext.Provider
      value={{
        user,
        /**
         * Continua exposto porque fazia parte do contrato, mas NINGUÉM no
         * painel o lê — conferido por grep. E ele é um retrato do momento da
         * montagem: quando o supabase-js renova a sessão, este valor fica para
         * trás. Quem precisa de token usa `authFetch`, que pergunta ao
         * supabase-js a cada chamada.
         */
        accessToken,
        initialized,
        createUser,
        loginUser,
        logoutUser,
        // Função de módulo, identidade estável entre renders. Ela lê o token do
        // supabase-js a cada chamada, e não do `accessToken` acima — é por isso
        // que não precisa de `useCallback` nem entra em lista de dependência.
        authFetch,
      }}
    >
      {children}
    </authContext.Provider>
  );
};

AuthProvider.propTypes = {
  children: PropTypes.any,
};

export default AuthProvider;
