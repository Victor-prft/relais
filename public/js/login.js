import { api } from './api.js';
import { h } from './ui/dom.js';

const form = document.getElementById('login-form');
const errorEl = document.querySelector('#login-error .error');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.textContent = '';
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api.post('/api/auth/login', { email: form.email.value.trim(), password: form.password.value });
    window.location.assign('/');
  } catch (err) {
    errorEl.textContent = err.message;
    button.disabled = false;
  }
});

const ROLE_LABELS = { admin: 'Administrateur', manager: 'Manager', agent: 'Agent', user: 'Utilisateur' };

api.get('/api/auth/demo-accounts').then(({ accounts, password }) => {
  if (!accounts.length) return;
  document.getElementById('demo').classList.remove('hidden');
  document.getElementById('demo-password').textContent = password;
  document.getElementById('demo-list').replaceChildren(
    ...accounts.map((a) =>
      h('button', {
        type: 'button',
        class: 'btn small',
        onclick: () => {
          form.email.value = a.email;
          form.password.value = password;
          form.requestSubmit();
        }
      }, h('span', {}, a.full_name), h('span', { class: 'faint' }, ROLE_LABELS[a.role]))
    )
  );
}).catch(() => {});
