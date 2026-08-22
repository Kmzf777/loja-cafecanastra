"use client";

import { ErroDePagina } from "../../erro-de-pagina";

/**
 * Fronteira de erro da vitrine. É casca: o App Router resolve a fronteira pelo
 * ARQUIVO, e o grupo transacional precisa de um igual — o conteúdo mora em
 * `app/erro-de-pagina.tsx`, que os dois compartilham.
 */
export default ErroDePagina;
