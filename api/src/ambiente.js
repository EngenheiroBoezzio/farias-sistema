/* Carrega o .env a partir da RAIZ DO PROJETO, não da pasta atual.
 *
 * O `require('dotenv').config()` puro procura o .env em process.cwd(). Isso
 * funciona enquanto alguém roda `node src/servidor.js` de dentro da pasta —
 * e falha calado no único momento que importa: quando o Windows sobe o
 * serviço, que começa em C:\Windows\System32. Aí não há .env, não há
 * JWT_SECRET, e o serviço morre com uma mensagem que parece bug do sistema.
 *
 * Ancorando em __dirname o arquivo é sempre o mesmo, venha de onde vier a
 * chamada: serviço, agendador, atalho do menu iniciar ou terminal.
 *
 * Todo arquivo que precisa de configuração começa com:
 *   require('./ambiente');        (de dentro de src/)
 *   require('../src/ambiente');   (de dentro de scripts/)
 */
'use strict';
const path = require('path');

const RAIZ = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(RAIZ, '.env') });

module.exports = { RAIZ };
