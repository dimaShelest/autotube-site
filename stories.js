/* Voz sin Firma — story form + deletion page. No cookies, no storage, no analytics.
   Talks only to the stories API (data-api) and, on the form page, loads Cloudflare Turnstile on first interaction.
   All user-visible output is set with textContent only (no HTML parsing). PLAYBOOK §37. */
(function () {
  'use strict';
  var LANG = document.documentElement.lang === 'en' ? 'en' : 'es';
  var T = {
    es: {
      count: function (n, max) { return n + ' / ' + max + ' caracteres'; },
      tooShort: function (min) { return 'La historia es demasiado corta: mínimo ' + min + ' caracteres.'; },
      tooLong: function (max) { return 'La historia es demasiado larga: máximo ' + max + ' caracteres.'; },
      adult: 'Debes confirmar que tienes 18 años o más.',
      consent: 'Debes dar tu consentimiento para que podamos usar la historia.',
      pseudonym: 'El seudónimo solo puede tener letras, números, espacios y . _ \' - (máximo 40).',
      email: 'Revisa el correo electrónico (o déjalo vacío).',
      waitCaptcha: 'Espera un momento a que termine la verificación antispam y vuelve a pulsar.',
      captchaLoadError: 'No se pudo cargar la verificación antispam. Revisa tu conexión o desactiva el bloqueador para esta página.',
      captchaFailed: 'La verificación antispam ha fallado. Inténtalo de nuevo.',
      sending: 'Enviando…',
      rate: 'Has enviado varias historias seguidas. Inténtalo de nuevo dentro de una hora.',
      busy: 'Hoy hemos recibido muchas historias. Inténtalo de nuevo mañana.',
      notConfigured: 'El envío no está disponible en este momento. Inténtalo más tarde.',
      network: 'No se pudo conectar con el servidor. Tu texto sigue aquí: inténtalo de nuevo.',
      generic: 'Algo ha fallado. Tu texto sigue aquí: inténtalo de nuevo.',
      copied: 'Copiado.',
      copyFailed: 'No se pudo copiar: selecciónalo y cópialo a mano.',
      badCode: 'El código debe tener 20 letras y números.',
      deleting: 'Borrando…',
      deleted: 'Hecho: tu historia se ha borrado. También desaparecerá de nuestra copia de trabajo en la próxima sincronización.',
      notFound: 'No hay ninguna historia con ese código (puede que ya se haya borrado). Revisa que esté bien escrito.'
    },
    en: {
      count: function (n, max) { return n + ' / ' + max + ' characters'; },
      tooShort: function (min) { return 'Your story is too short: at least ' + min + ' characters.'; },
      tooLong: function (max) { return 'Your story is too long: at most ' + max + ' characters.'; },
      adult: 'Please confirm that you are 18 or older.',
      consent: 'Please give your consent so that we can use the story.',
      pseudonym: 'The pseudonym may only contain letters, digits, spaces and . _ \' - (40 at most).',
      email: 'Please check the e-mail address (or leave it empty).',
      waitCaptcha: 'Please wait for the spam check to finish and press again.',
      captchaLoadError: 'The spam check could not load. Check your connection or disable the blocker for this page.',
      captchaFailed: 'The spam check failed. Please try again.',
      sending: 'Sending…',
      rate: 'You have sent several stories in a row. Please try again in an hour.',
      busy: 'We have received many stories today. Please try again tomorrow.',
      notConfigured: 'Submissions are not available right now. Please try later.',
      network: 'Could not reach the server. Your text is still here: please try again.',
      generic: 'Something went wrong. Your text is still here: please try again.',
      copied: 'Copied.',
      copyFailed: 'Could not copy: please select and copy it by hand.',
      badCode: 'The code has 20 letters and digits.',
      deleting: 'Deleting…',
      deleted: 'Done: your story has been deleted. It will also disappear from our working copy at the next sync.',
      notFound: 'There is no story with that code (it may have been deleted already). Please check it.'
    }
  }[LANG];

  function clean(s) {
    return s.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  }
  function chars(s) { return Array.from(clean(s)).length; }   // code points, same as the Worker and Python
  var PSEUDO = /^[\p{L}\p{M}\p{N} ._'\-]{1,40}$/u;
  var EMAIL = /^[^\s@<>"'(),;:\\[\]]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

  function post(api, path, body) {
    return fetch(api.replace(/\/+$/, '') + path, {
      method: 'POST', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j || {} }; });
    });
  }
  function say(el, text, kind) { el.textContent = text || ''; el.className = 'status' + (kind ? ' ' + kind : ''); }

  // ---------------------------------------------------------------- submission form
  var form = document.getElementById('story-form');
  if (form) {
    var api = form.getAttribute('data-api');
    var sitekey = form.getAttribute('data-sitekey');
    var MIN = parseInt(form.getAttribute('data-min'), 10);
    var MAX = parseInt(form.getAttribute('data-max'), 10);
    var story = document.getElementById('story');
    var counter = document.getElementById('story-count');
    var status = document.getElementById('form-status');
    var submit = document.getElementById('submit');
    var token = null, widget = null, loading = false, sending = false;

    var updateCount = function () {
      var n = chars(story.value);
      counter.textContent = T.count(n, MAX);
      counter.className = 'counter' + (n > MAX ? ' bad' : n >= MIN ? ' good' : '');
    };
    var loadTurnstile = function () {
      if (loading) return;
      loading = true;
      window.vsfTurnstileReady = function () {
        widget = window.turnstile.render('#turnstile', {
          sitekey: sitekey, action: 'submit_story', language: LANG, theme: 'auto',
          callback: function (t) { token = t; },
          'expired-callback': function () { token = null; },
          'error-callback': function () { token = null; say(status, T.captchaFailed, 'bad'); }
        });
      };
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=vsfTurnstileReady';
      s.async = true;
      s.onerror = function () { loading = false; say(status, T.captchaLoadError, 'bad'); };
      document.head.appendChild(s);
    };
    var resetTurnstile = function () {
      token = null;
      if (window.turnstile && widget !== null) window.turnstile.reset(widget);
    };

    story.addEventListener('input', updateCount);
    form.addEventListener('focusin', loadTurnstile);
    form.addEventListener('input', loadTurnstile);
    updateCount();

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (sending) return;
      var n = chars(story.value);
      var pseudonym = document.getElementById('pseudonym').value.trim().replace(/\s+/g, ' ');
      var email = document.getElementById('email').value.trim();
      var err = n < MIN ? T.tooShort(MIN) : n > MAX ? T.tooLong(MAX)
        : pseudonym && !PSEUDO.test(pseudonym) ? T.pseudonym
        : email && (email.length > 254 || !EMAIL.test(email)) ? T.email
        : !document.getElementById('adult').checked ? T.adult
        : !document.getElementById('consent').checked ? T.consent
        : !token ? T.waitCaptcha : '';
      if (err) { loadTurnstile(); say(status, err, 'bad'); return; }
      sending = true; submit.disabled = true; say(status, T.sending);
      post(api, '/api/story', {
        story: story.value, pseudonym: pseudonym || null, email: email || null, lang: LANG,
        adult: true, consent: true, turnstile: token, website: document.getElementById('website').value
      }).then(function (r) {
        if (r.status === 201 && r.body.ok && r.body.code) {
          document.getElementById('code').textContent = r.body.code;
          form.hidden = true;
          form.reset();
          var done = document.getElementById('done');
          done.hidden = false;
          done.focus();
          return;
        }
        var e = r.body.error;
        say(status, e === 'rate_limited' ? T.rate : e === 'busy' ? T.busy : e === 'turnstile_failed' ? T.captchaFailed
          : e === 'too_short' ? T.tooShort(MIN) : e === 'too_long' ? T.tooLong(MAX) : e === 'bad_pseudonym' ? T.pseudonym
          : e === 'bad_email' ? T.email : e === 'not_configured' ? T.notConfigured : T.generic, 'bad');
        resetTurnstile();
      }, function () { say(status, T.network, 'bad'); resetTurnstile(); })
        .then(function () { sending = false; submit.disabled = false; });
    });

    document.getElementById('copy').addEventListener('click', function () {
      var code = document.getElementById('code').textContent;
      var out = document.getElementById('copy-status');
      if (navigator.clipboard) {
        navigator.clipboard.writeText(code).then(function () { out.textContent = T.copied; }, function () { out.textContent = T.copyFailed; });
      } else { out.textContent = T.copyFailed; }
    });
  }

  // ---------------------------------------------------------------- deletion page
  var del = document.getElementById('delete-form');
  if (del) {
    var dstatus = document.getElementById('delete-status');
    var dbtn = document.getElementById('delete-submit');
    del.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var code = document.getElementById('code-input').value.toUpperCase().replace(/[\s\-_.]/g, '');
      if (!/^[0-9A-Z]{20}$/.test(code)) { say(dstatus, T.badCode, 'bad'); return; }
      dbtn.disabled = true; say(dstatus, T.deleting);
      post(del.getAttribute('data-api'), '/api/delete', { code: code }).then(function (r) {
        if (r.status === 200 && r.body.ok) {
          say(dstatus, r.body.deleted ? T.deleted : T.notFound, r.body.deleted ? 'good' : 'bad');
          if (r.body.deleted) del.reset();
        } else {
          var e = r.body.error;
          say(dstatus, e === 'rate_limited' ? T.rate : e === 'bad_code' ? T.badCode : e === 'not_configured' ? T.notConfigured : T.generic, 'bad');
        }
      }, function () { say(dstatus, T.network, 'bad'); })
        .then(function () { dbtn.disabled = false; });
    });
  }
})();
