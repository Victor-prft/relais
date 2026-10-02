import { h, mount, loading } from '../../ui/dom.js';
import { icons } from '../../ui/icons.js';
import { api } from '../../api.js';
import { modal, toast, toastError } from '../../ui/feedback.js';
import { field, textInput, selectInput, referenceInput, numberOrNull } from '../../ui/fields.js';
import { formatRelative } from '../../format.js';
import { invalidate } from '../../state.js';

const ROLE_OPTIONS = [
  { value: 'user', label: 'Utilisateur' },
  { value: 'agent', label: 'Agent' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Administrateur' }
];
const roleLabel = (r) => ROLE_OPTIONS.find((o) => o.value === r)?.label || r;

async function editUser(user, reload) {
  const c = {
    full_name: textInput({ value: user?.full_name }),
    email: textInput({ value: user?.email, type: 'email' }),
    role: selectInput(ROLE_OPTIONS, { value: user?.role || 'user' }),
    department: textInput({ value: user?.department }),
    phone: textInput({ value: user?.phone }),
    manager_id: referenceInput({ endpoint: '/api/users', params: { staff: '1' }, value: user?.manager_id ? { id: user.manager_id, label: user.manager_name } : null }),
    password: textInput({ type: 'password', placeholder: user ? 'Laisser vide pour ne pas changer' : '8 caractères minimum' }),
    is_active: h('input', { type: 'checkbox', checked: user ? user.is_active : true })
  };
  await modal({
    title: user ? `Modifier ${user.full_name}` : 'Nouvel utilisateur',
    build: (body) =>
      body.append(
        h('div', { class: 'grid-2' },
          field('Nom complet', c.full_name, { required: true }),
          field('Email', c.email, { required: true }),
          field('Rôle', c.role),
          field('Service', c.department),
          field('Téléphone', c.phone),
          field('Manager', c.manager_id, { hint: 'Approuve ses demandes de service' }),
          field('Mot de passe', c.password, { required: !user }),
          user ? h('label', { class: 'checkbox' }, c.is_active, 'Compte actif') : null
        )
      ),
    actions: [
      { label: 'Annuler', onClick: (close) => close() },
      {
        label: 'Enregistrer',
        class: 'primary',
        onClick: async (close) => {
          const payload = {
            full_name: c.full_name.value.trim(),
            email: c.email.value.trim(),
            role: c.role.value,
            department: c.department.value.trim() || null,
            phone: c.phone.value.trim() || null,
            manager_id: c.manager_id.getValue()
          };
          if (c.password.value) payload.password = c.password.value;
          if (user) payload.is_active = c.is_active.checked;
          try {
            if (user) await api.patch(`/api/admin/users/${user.id}`, payload);
            else await api.post('/api/admin/users', payload);
            toast('Utilisateur enregistré');
            close();
            reload();
          } catch (err) {
            toastError(err);
          }
        }
      }
    ]
  });
}

export async function adminUsersView(el) {
  const body = h('div', {}, loading());
  const reload = async () => {
    const { items } = await api.get('/api/admin/users');
    mount(body,
      h('div', { class: 'table-wrap' },
        h('table', { class: 'table responsive' },
          h('thead', {}, h('tr', {}, ['Nom', 'Email', 'Rôle', 'Service', 'Manager', 'Dernière connexion', 'État'].map((t) => h('th', {}, t)))),
          h('tbody', {}, items.map((u) =>
            h('tr', { class: 'clickable', onclick: () => editUser(u, reload) },
              h('td', { 'data-label': 'Nom' }, h('strong', {}, u.full_name)),
              h('td', { 'data-label': 'Email' }, u.email),
              h('td', { 'data-label': 'Rôle' }, h('span', { class: 'badge' }, roleLabel(u.role))),
              h('td', { 'data-label': 'Service' }, u.department || '—'),
              h('td', { 'data-label': 'Manager' }, u.manager_name || '—'),
              h('td', { 'data-label': 'Connexion' }, formatRelative(u.last_login_at)),
              h('td', { 'data-label': 'État' }, u.is_active ? h('span', { class: 'badge ok dot' }, 'Actif') : h('span', { class: 'badge' }, 'Inactif'))
            )
          ))
        )
      )
    );
  };
  mount(el,
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Utilisateurs'), h('div', { class: 'sub' }, 'Comptes, rôles et rattachement hiérarchique')),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => editUser(null, reload) }, icons.plus(), 'Nouvel utilisateur'))
    ),
    h('div', { class: 'card' }, body)
  );
  await reload().catch(toastError);
}

async function editGroup(group, reload) {
  const users = (await api.get('/api/admin/users')).items.filter((u) => u.is_active && u.role !== 'user');
  const members = new Set((group?.members || []).map((m) => m.id));
  const c = {
    name: textInput({ value: group?.name }),
    description: textInput({ value: group?.description }),
    manager_id: selectInput(users.filter((u) => u.role === 'manager' || u.role === 'admin').map((u) => ({ value: u.id, label: u.full_name })), { value: group?.manager_id, empty: '—' })
  };
  const boxes = users.map((u) => {
    const box = h('input', { type: 'checkbox', checked: members.has(u.id), value: u.id });
    return { box, row: h('label', { class: 'checkbox' }, box, u.full_name, h('span', { class: 'small faint' }, roleLabel(u.role))) };
  });
  await modal({
    title: group ? `Groupe ${group.name}` : 'Nouveau groupe',
    build: (body) =>
      body.append(
        h('div', { class: 'stack' },
          field('Nom', c.name, { required: true }),
          field('Description', c.description),
          field('Manager du groupe', c.manager_id),
          h('div', { class: 'field' }, h('span', { class: 'label' }, 'Membres'), h('div', { class: 'grid-2' }, boxes.map((b) => b.row)))
        )
      ),
    actions: [
      { label: 'Annuler', onClick: (close) => close() },
      {
        label: 'Enregistrer',
        class: 'primary',
        onClick: async (close) => {
          const payload = {
            name: c.name.value.trim(),
            description: c.description.value.trim() || null,
            manager_id: numberOrNull(c.manager_id.value),
            member_ids: boxes.filter((b) => b.box.checked).map((b) => Number(b.box.value))
          };
          try {
            if (group) await api.patch(`/api/admin/groups/${group.id}`, payload);
            else await api.post('/api/admin/groups', payload);
            invalidate('groups');
            toast('Groupe enregistré');
            close();
            reload();
          } catch (err) {
            toastError(err);
          }
        }
      }
    ]
  });
}

export async function adminGroupsView(el) {
  const body = h('div', { class: 'tiles' }, loading());
  const reload = async () => {
    const { items } = await api.get('/api/groups');
    mount(body,
      items.map((g) =>
        h('button', { class: 'card tile', type: 'button', style: { textAlign: 'left', font: 'inherit', cursor: 'pointer' }, onclick: () => editGroup(g, reload) },
          h('div', { class: 'icon' }, icons.users()),
          h('strong', {}, g.name),
          h('span', { class: 'small muted' }, g.description || ''),
          h('span', { class: 'small' }, `Manager : ${g.manager_name || '—'}`),
          h('div', { class: 'row' }, g.members.map((m) => h('span', { class: 'badge' }, m.full_name)))
        )
      )
    );
  };
  mount(el,
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Groupes de support'), h('div', { class: 'sub' }, 'Groupes d’assignation des tickets')),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => editGroup(null, reload) }, icons.plus(), 'Nouveau groupe'))
    ),
    body
  );
  await reload().catch(toastError);
}
