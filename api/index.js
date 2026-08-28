// Vercel detecta cualquier archivo acá adentro como una función serverless.
// server.js exporta la app de Express entera (sin abrir puerto propio en
// Vercel), así que solo hace falta reexportarla.
module.exports = require('../server.js');
