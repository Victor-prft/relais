'use strict';

/**
 * La base est-elle posee sur un stockage qui survit au redeploiement ?
 *
 * Sur un hebergeur conteneurise, le systeme de fichiers est recree a chaque
 * deploiement : seul ce qui tombe dans un volume monte persiste. Une base
 * ecrite a cote fonctionne parfaitement — jusqu'au deploiement suivant, qui
 * l'efface. Rien ne le signale, et la perte arrive plus tard, souvent une fois
 * que le compte et les reglages ont ete refaits a la main.
 *
 * D'ou ce controle : au demarrage, on cherche le point de montage dont depend
 * le repertoire de la base. Si c'est la racine du conteneur, la base est
 * jetable et on le dit en toutes lettres.
 */

const fs = require('fs');
const path = require('path');

// Systemes de fichiers d'un conteneur : rien de ce qui est ecrit dessus ne
// survit au deploiement suivant.
const EPHEMERAL_TYPES = new Set(['overlay', 'overlayfs', 'aufs', 'tmpfs', 'ramfs']);

/** Points de montage du systeme, du plus court au plus long. Vide hors Linux. */
function readMounts() {
  try {
    return fs
      .readFileSync('/proc/self/mounts', 'utf8')
      .split('\n')
      .map((line) => line.split(' '))
      .filter((parts) => parts.length >= 3)
      .map(([, point, type]) => ({
        // Les espaces d'un chemin sont echappes en octal dans /proc.
        point: point.replace(/\\040/g, ' '),
        type
      }));
  } catch {
    // Pas de /proc : on n'est pas sur Linux, donc pas sur l'hebergeur.
    return [];
  }
}

/**
 * Le point de montage qui porte ce chemin : le plus long prefixe parmi les
 * montages. `/data/relais.db` sur un volume monte en /data renvoie /data ; le
 * meme fichier sans volume renvoie /.
 */
function mountFor(target, mounts) {
  let best = null;

  for (const mount of mounts) {
    const prefix = mount.point === '/' ? '/' : mount.point + '/';
    if (target === mount.point || target.startsWith(prefix)) {
      if (!best || mount.point.length > best.point.length) best = mount;
    }
  }

  return best;
}

/**
 * Verdict sur le stockage d'un fichier de base.
 *
 * `mounts` n'est passe que par les tests : le seul environnement ou ce code
 * sert est un conteneur Linux, qu'un poste de developpement ne peut pas
 * imiter. Lui fournir la table permet de rejouer exactement la situation.
 *
 * @returns {{checked: boolean, persistent: boolean, mount: string|null, type: string|null}}
 */
function inspect(dbPath, mounts = readMounts()) {
  if (!mounts.length) return { checked: false, persistent: true, mount: null, type: null };

  // Chemins POSIX explicitement : les points de montage n'existent que sous
  // Linux, et `path` sur un poste Windows resoudrait /data en C:\data, qui ne
  // correspondrait a aucun montage.
  const dir = path.posix.dirname(String(dbPath).replace(/\\/g, '/'));

  const mount = mountFor(dir, mounts);
  if (!mount) return { checked: false, persistent: true, mount: null, type: null };

  return {
    checked: true,
    // Un volume est monte a part : son point de montage n'est pas la racine, et
    // son systeme de fichiers n'est pas celui, jetable, du conteneur.
    persistent: mount.point !== '/' && !EPHEMERAL_TYPES.has(mount.type),
    mount: mount.point,
    type: mount.type
  };
}

/**
 * Ecrit le verdict au demarrage. Un avertissement, jamais un refus : mieux
 * vaut une application qui tourne en criant qu'une application qui ne demarre
 * pas parce qu'on teste son disque.
 */
function report(dbPath, log = console, mounts = readMounts()) {
  const verdict = inspect(dbPath, mounts);

  log.log(`Base de donnees : ${dbPath}`);

  if (!verdict.checked) return verdict;

  if (verdict.persistent) {
    log.log(`  volume persistant : ${verdict.mount} (${verdict.type})`);
    return verdict;
  }

  log.warn(
    [
      '',
      '  !!  LA BASE N EST PAS SUR UN VOLUME PERSISTANT  !!',
      `  Elle est ecrite sur ${verdict.mount} (${verdict.type}), le systeme de`,
      '  fichiers du conteneur, qui est recree a chaque deploiement.',
      '',
      '  Tout ce qui sera saisi ici — comptes, tickets, CMDB —',
      '  disparaitra au prochain deploiement.',
      '',
      '  A corriger : monter un volume, puis pointer DATABASE_PATH dedans.',
      '  Le point de montage du volume et le debut de DATABASE_PATH doivent',
      '  etre le meme chemin.',
      ''
    ].join('\n')
  );

  return verdict;
}

module.exports = { inspect, report, mountFor, readMounts };
