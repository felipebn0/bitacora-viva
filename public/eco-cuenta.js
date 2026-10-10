/* ECO Cuenta — reorganizacion progresiva de controles existentes.
   No recrea formularios, no modifica datos y conserva los nodos/IDs originales. */
(function () {
  'use strict';
  function init() {
    var panel = document.getElementById('userMenuPanel');
    if (!panel || panel.dataset.ecoOrganizado === '1') return;
    var original = {
      perfil: document.querySelector('[aria-controls="umSecPerfil"].um-section-toggle'),
      avanzadas: document.querySelector('[aria-controls="umSecAvanzadas"].um-section-toggle')
    };
    var perfil = document.getElementById('umSecPerfil');
    var avanzadas = document.getElementById('umSecAvanzadas');
    if (!original.perfil || !original.avanzadas || !perfil || !avanzadas) return;

    // El bloque peligroso y el cambio de clave se separan del formulario de perfil.
    var seguridad = perfil.querySelector('.um-nested-group');
    var username = document.getElementById('umUsername');
    var nav = document.createElement('div');
    nav.className = 'eco-cuenta-secciones';
    nav.setAttribute('aria-label', 'Opciones de cuenta');
    if (username) username.insertAdjacentElement('afterend', nav);
    else panel.prepend(nav);

    function section(title, sub, icon) {
      var sectionEl = document.createElement('section');
      sectionEl.className = 'eco-cuenta-grupo';
      var trigger = document.createElement('button');
      trigger.className = 'eco-cuenta-cabecera';
      trigger.type = 'button';
      trigger.setAttribute('aria-expanded', 'false');
      var heading = document.createElement('span');
      heading.className = 'eco-cuenta-heading';
      var emoji = document.createElement('span');
      emoji.className = 'eco-cuenta-icono';
      emoji.setAttribute('aria-hidden', 'true');
      emoji.textContent = icon;
      var texts = document.createElement('span');
      var name = document.createElement('strong'); name.textContent = title;
      var description = document.createElement('small'); description.textContent = sub;
      texts.append(name, description);
      heading.append(emoji, texts);
      var chevron = document.createElement('span');
      chevron.className = 'eco-cuenta-chevron'; chevron.textContent = '⌄'; chevron.setAttribute('aria-hidden', 'true');
      trigger.append(heading, chevron);
      var body = document.createElement('div'); body.className = 'eco-cuenta-contenido'; body.hidden = true;
      trigger.addEventListener('click', function () {
        var open = trigger.getAttribute('aria-expanded') === 'true';
        nav.querySelectorAll('.eco-cuenta-cabecera[aria-expanded="true"]').forEach(function (b) {
          if (b !== trigger) b.click();
        });
        trigger.setAttribute('aria-expanded', String(!open));
        body.hidden = open;
      });
      sectionEl.append(trigger, body); nav.append(sectionEl);
      return body;
    }
    function moveItem(container, bodyId) {
      var body = document.getElementById(bodyId);
      if (!body) return;
      var btn = panel.querySelector('.um-section-toggle[aria-controls="' + bodyId + '"]');
      if (btn) container.appendChild(btn);
      container.appendChild(body);
      // Se mantiene contraído: el manejador existente del botón interno sigue activo.
    }
    var datos = section('Mi perfil', 'Tus datos personales', '◉');
    perfil.hidden = false;
    // Evitar que el cambio de clave o borrar cuenta aparezca dentro del perfil.
    if (seguridad) seguridad.remove();
    datos.appendChild(perfil);

    var preferencias = section('Preferencias', 'Voz, lectura y avisos', '◌');
    moveItem(preferencias, 'umSecVoz');
    moveItem(preferencias, 'umSecFuente');
    moveItem(preferencias, 'umSecRecordatorios');

    var datosECO = section('Mis recuerdos y datos', 'Descarga y privacidad', '▣');
    moveItem(datosECO, 'umSecCopia');

    var acceso = section('Acceso y seguridad', 'Contraseña, instalación y eliminación', '◇');
    moveItem(acceso, 'umSecInstalacion');
    if (seguridad) acceso.appendChild(seguridad);

    var perfilesPlan = section('Perfiles y plan', 'Tus bitácoras y suscripción', '◫');
    var linkPerfiles = document.getElementById('umPerfilesLink');
    if (linkPerfiles) perfilesPlan.appendChild(linkPerfiles);
    moveItem(perfilesPlan, 'umSecPlan');

    var admin = document.getElementById('umAdminLink');
    if (admin) {
      var adminArea = document.createElement('div');
      adminArea.className = 'eco-cuenta-admin';
      admin.parentNode.insertBefore(adminArea, admin);
      adminArea.appendChild(admin);
      nav.insertAdjacentElement('afterend', adminArea);
    }
    // Los originales quedan solo como compatibilidad con scripts existentes.
    original.perfil.hidden = true;
    original.avanzadas.hidden = true;
    avanzadas.hidden = true;
    original.perfil.classList.add('eco-cuenta-legacy');
    original.avanzadas.classList.add('eco-cuenta-legacy');
    panel.dataset.ecoOrganizado = '1';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
