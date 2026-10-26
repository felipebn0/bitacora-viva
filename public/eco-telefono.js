/* Celular para compartir: bandera + código de país (Colombia o Estados Unidos) y solo los 10 dígitos del número. */
(() => {
  'use strict';
  const PAISES = [
    { codigo: '+57', bandera: '🇨🇴', nombre: 'Colombia' },
    { codigo: '+1', bandera: '🇺🇸', nombre: 'Estados Unidos' },
  ];
  const selectores = new WeakMap();

  function montar(input) {
    if (!input || selectores.has(input)) return;
    const caja = document.createElement('div');
    caja.className = 'eco-tel';
    const select = document.createElement('select');
    select.className = 'eco-tel-pais';
    select.setAttribute('aria-label', 'País del celular');
    PAISES.forEach((p) => {
      const o = document.createElement('option');
      o.value = p.codigo;
      o.textContent = `${p.bandera} ${p.codigo}`;
      o.title = p.nombre;
      select.appendChild(o);
    });
    input.parentNode.insertBefore(caja, input);
    caja.append(select, input);
    input.type = 'tel';
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('maxlength', '14');
    input.setAttribute('placeholder', '300 123 4567');
    input.setAttribute('autocomplete', 'off');
    input.addEventListener('input', () => {
      const d = input.value.replace(/\D/g, '').slice(0, 10);
      input.value = d.length > 6 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : d.length > 3 ? `${d.slice(0, 3)} ${d.slice(3)}` : d;
    });
    selectores.set(input, select);
  }

  // '+573001234567' si hay 10 dígitos; '' si falta o sobra algo.
  function valor(input) {
    montar(input);
    const d = String(input.value || '').replace(/\D/g, '');
    const select = selectores.get(input);
    return d.length === 10 && select ? select.value + d : '';
  }

  function limpiar(input) { input.value = ''; }

  // Muestra un celular ya guardado (por ejemplo '+57 300 123 4567') con su bandera.
  function poner(input, guardado) {
    montar(input);
    const select = selectores.get(input);
    let d = String(guardado || '').replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('57')) { select.value = '+57'; d = d.slice(2); }
    else if (d.length === 11 && d.startsWith('1')) { select.value = '+1'; d = d.slice(1); }
    input.value = d;
    input.dispatchEvent(new Event('input'));
  }

  const montarTodos = () => document.querySelectorAll('input[data-eco-tel]').forEach(montar);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montarTodos); else montarTodos();
  window.EcoTelefono = { montar, valor, limpiar, poner };
})();
