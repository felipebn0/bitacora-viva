/* ECO — panel Cuenta lateral: conserva IDs, formularios y listeners originales. */
(() => {
  'use strict';
  function iniciar() {
    const panel = document.getElementById('userMenuPanel');
    const cuentaBtn = document.getElementById('userMenuBtn');
    if (!panel || !cuentaBtn || panel.dataset.ecoLateral) return;
    const perfil = document.getElementById('umSecPerfil');
    const avanzadas = document.getElementById('umSecAvanzadas');
    if (!perfil || !avanzadas) return;

    // Mantener los nodos reales para no perder funciones ni datos.
    const raiz = document.createElement('div');
    raiz.className = 'eco-lateral-layout';
    const superior = document.createElement('div');
    superior.className = 'eco-lateral-header';
    const titulo = document.createElement('strong');
    titulo.textContent = 'Mi cuenta';
    const cerrar = document.createElement('button');
    cerrar.type = 'button';
    cerrar.className = 'eco-lateral-close';
    cerrar.setAttribute('aria-label', 'Cerrar Cuenta');
    cerrar.textContent = '×';
    cerrar.addEventListener('click', () => cuentaBtn.click());
    superior.append(titulo, cerrar);

    const identidad = document.createElement('div');
    identidad.className = 'eco-lateral-identidad';
    const username = panel.querySelector('#umUsername');
    if (username) identidad.appendChild(username);
    const nav = document.createElement('nav');
    nav.className = 'eco-lateral-nav';
    nav.setAttribute('aria-label','Apartados de Cuenta');
    const vistas = document.createElement('div');
    vistas.className = 'eco-lateral-vistas';

    const grupos = [
      ['perfil', 'Mi perfil','Datos personales'],
      ['preferencias','Preferencias','Voz, letra y avisos'],
      ['datos','Mis recuerdos y datos','Descargas y privacidad'],
      ['seguridad','Acceso y seguridad','Contraseña y protección'],
      ['planes','Perfiles y plan','Bitácoras y suscripción']
    ];
    const panels = {};
    const botones = {};
    grupos.forEach(([id, nombre, sub]) => {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'eco-lateral-item';
      boton.innerHTML = '<span class="eco-lateral-item-name"></span><small></small><span class="eco-lateral-chevron" aria-hidden="true">›</span>';
      boton.querySelector('.eco-lateral-item-name').textContent=nombre;
      boton.querySelector('small').textContent=sub;
      boton.setAttribute('aria-controls','eco-lateral-'+id);
      nav.appendChild(boton);
      const vista = document.createElement('section');
      vista.className = 'eco-lateral-vista';
      vista.id = 'eco-lateral-'+id;
      vista.hidden=true;
      const retro = document.createElement('button');
      retro.type='button';
      retro.className='eco-lateral-back';
      retro.textContent='← Volver a Cuenta';
      retro.addEventListener('click',mostrarMenu);
      const heading=document.createElement('h2');
      heading.textContent=nombre;
      vista.append(retro,heading);
      vistas.appendChild(vista);
      panels[id]=vista;
      botones[id]=boton;
      boton.addEventListener('click',()=>mostrarVista(id));
    });

    function moverSeccion(id,destino) {
      const el=document.getElementById(id);
      if(!el) return;
      const trigger=panel.querySelector('.um-section-toggle[aria-controls="'+id+'"]');
      if(trigger) destino.appendChild(trigger);
      destino.appendChild(el);
    }
    // Primero extraer las secciones que antes estaban anidadas.
    const seguridad = panels.seguridad;
    moverSeccion('umSecClave',seguridad);
    moverSeccion('umSecInstalacion',seguridad);
    moverSeccion('umSecRiesgo',seguridad);
    ['umSecVoz','umSecFuente','umSecRecordatorios'].forEach(id=>moverSeccion(id,panels.preferencias));
    moverSeccion('umSecCopia',panels.datos);
    moverSeccion('umSecPlan',panels.planes);
    const linkPerfil=panel.querySelector('#umPerfilesLink');
    const admin=panel.querySelector('#umAdminLink');
    if(linkPerfil) panels.planes.insertBefore(linkPerfil,panels.planes.children[2]||null);
    if(admin) panels.planes.appendChild(admin);

    perfil.hidden=false;
    perfil.classList.remove('um-nested-group');
    panels.perfil.appendChild(perfil);
    // Los acordeones originales siguen trabajando dentro de las vistas.
    // No se modifican sus IDs ni su código de guardar.
    const logout=panel.querySelector('#umLogoutBtn');
    const pie=document.createElement('div');
    pie.className='eco-lateral-footer';
    if(logout) pie.appendChild(logout);
    raiz.append(superior,identidad,nav,vistas,pie);
    panel.appendChild(raiz);
    const pToggle=panel.querySelector('.um-section-toggle[aria-controls="umSecPerfil"]');
    const aToggle=panel.querySelector('.um-section-toggle[aria-controls="umSecAvanzadas"]');
    if(pToggle)pToggle.hidden=true;
    if(aToggle)aToggle.hidden=true;
    avanzadas.hidden=true;

    function mostrarMenu(){
      nav.hidden=false;
      Object.values(panels).forEach(v=>v.hidden=true);
      Object.values(botones).forEach(b=>b.setAttribute('aria-expanded','false'));
      panel.scrollTop=0;
    }
    function mostrarVista(id){
      nav.hidden=true;
      Object.entries(panels).forEach(([key,v])=>v.hidden=(key!==id));
      Object.entries(botones).forEach(([key,b])=>b.setAttribute('aria-expanded',String(key===id)));
      panel.scrollTop=0;
    }
    // Las secciones originales movidas de "Opciones avanzadas" están ahora
    // dentro de la vista correspondiente, no dentro del contenedor oculto.
    // Limpiar hr/espaciadores que quedaron sin controles.
    panel.dataset.ecoLateral='1';
    panel.setAttribute('role','dialog');
    panel.setAttribute('aria-label','Cuenta');
    mostrarMenu();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',iniciar);
  else iniciar();
})();
