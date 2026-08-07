/*
 * La porte qui empêche une clé d'entrer au dépôt.
 *
 * ── POURQUOI CE TEST ET PAS SEULEMENT UN .gitignore ──────────────────────────
 *
 * Le geste naturel, en recevant une clé de compte de service, est de la déposer à côté
 * du code : c'est là qu'on la cherche pour lancer le serveur. Un `git add -A` suffit
 * alors à la publier — et une clé de compte de service ouvre le projet GCP ENTIER, pas
 * un modèle.
 *
 * `.gitignore` est une intention : il se contourne d'un `git add -f`, il ne couvre que
 * les noms auxquels on a pensé, et il ne dit rien de ce qui est DÉJÀ suivi. Ce test
 * regarde le contenu de ce qui est réellement dans l'index, et casse la CI. C'est la
 * même différence qu'entre écrire une règle et la faire appliquer par la porte — le
 * principe de tout ce dépôt, appliqué à lui-même.
 *
 * ── CE QU'IL CHERCHE, ET CE QU'IL LAISSE PASSER ──────────────────────────────
 *
 * Uniquement ce qui ne peut PAS être légitime : une clé privée PEM, un JSON de compte de
 * service, un jeton d'API porteur. Pas les motifs larges de L007 (une URL en dur, un
 * `token:` quelconque) — le registre contient volontairement de faux secrets, dans les
 * fixtures du linter et dans l'entrée `token-en-clair` de la banque, et un test qui
 * crierait sur eux serait désactivé dans la semaine.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Ce qui ne peut jamais être un faux exemple. */
const INTERDITS = [
  { re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, quoi: 'une clé privée' },
  { re: /"type"\s*:\s*"service_account"/, quoi: 'un JSON de compte de service GCP' },
  { re: /"private_key_id"\s*:\s*"[a-f0-9]{20,}"/, quoi: 'une empreinte de clé privée' },
  { re: /\bya29\.[A-Za-z0-9_-]{20,}/, quoi: 'un jeton d\'accès Google' }
];

/*
 * Les fichiers SUIVIS par git, pas ceux du disque. C'est la distinction qui compte : une
 * clé posée à côté du code est sans danger tant qu'elle n'est pas indexée, et c'est
 * exactement ce que .gitignore doit obtenir. Ce test vérifie le résultat, pas l'intention.
 */
function suivis() {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
      .split('\0').filter(Boolean);
  } catch {
    return null;                        // hors dépôt git : le test se saute, il ne ment pas
  }
}

const fichiers = suivis();

describe('aucun identifiant ne peut entrer au dépôt', { skip: fichiers ? false : 'hors dépôt git' }, () => {
  test('aucun fichier suivi ne contient de clé privée ni de compte de service', () => {
    const trouves = [];

    for (const f of fichiers) {
      // Ce fichier-ci porte les motifs, forcément : il les décrit.
      if (f === 'test/secrets.test.js') continue;
      let contenu;
      try {
        if (statSync(join(ROOT, f)).size > 2_000_000) continue;
        contenu = readFileSync(join(ROOT, f), 'utf8');
      } catch { continue; }

      for (const { re, quoi } of INTERDITS) {
        if (re.test(contenu)) trouves.push(`${f} — ${quoi}`);
      }
    }

    assert.deepEqual(trouves, [],
      `Identifiant(s) dans le dépôt :\n  ${trouves.join('\n  ')}\n\n`
      + 'Retire le fichier de l\'index, RÉVOQUE la clé — elle est compromise dès qu\'elle '
      + 'a été indexée — et refais-en une.');
  });

  test('les noms de clé usuels sont ignorés par git', () => {
    // On demande à git lui-même : réimplémenter ses règles de correspondance ici les
    // ferait diverger au premier motif un peu subtil.
    const noms = ['cle.json', 'key.json', 'gcp-key.json', 'vertex.json', 'sa-credentials.json',
                  'salsi-service-account.json', '.env', '.env.local', 'prod.pem', 'id_rsa.key'];
    const sortie = execFileSync('git', ['check-ignore', '--no-index', ...noms],
                                { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    assert.deepEqual(sortie.sort(), noms.sort(),
      'ces noms doivent être ignorés : c\'est là qu\'une clé atterrit en pratique');
  });

  test('le modèle .env.exemple reste suivi, et reste vide', () => {
    // Piège vécu : `.env.*` avale `.env.exemple`, et plus personne ne sait quoi remplir.
    // L'exception est fragile — un test la tient.
    assert.ok(fichiers.includes('.env.exemple'),
      '.env.exemple doit rester suivi : sans lui, personne ne sait quelles variables poser');
    const contenu = readFileSync(join(ROOT, '.env.exemple'), 'utf8');
    for (const { re, quoi } of INTERDITS) assert.ok(!re.test(contenu), `le modèle contient ${quoi}`);
    // Aucune valeur : que des noms. `NOM=` seul, ou commenté.
    for (const ligne of contenu.split('\n')) {
      if (!ligne.trim() || ligne.trim().startsWith('#')) continue;
      assert.match(ligne, /^[A-Z_]+=$/, `« ${ligne} » porte une valeur : le modèle n'en contient aucune`);
    }
  });

  test('un vrai .env, lui, ne peut pas être suivi', () => {
    const sortie = execFileSync('git', ['check-ignore', '--no-index', '.env', '.env.local'],
                                { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    assert.deepEqual(sortie.sort(), ['.env', '.env.local']);
  });

  test('les faux secrets du registre restent, eux, parfaitement légitimes', () => {
    // La banque contient un diff avec un jeton, et les fixtures du linter en contiennent
    // d'autres. Un test qui crierait sur eux serait désactivé dans la semaine — et le
    // jour où une vraie clé entrerait, plus personne ne le regarderait.
    for (const f of ['entrees/diff/token-en-clair.txt', 'fixtures/invalid/L007-secret-en-dur.yaml']) {
      assert.ok(fichiers.includes(f), `${f} doit rester suivi`);
      const contenu = readFileSync(join(ROOT, f), 'utf8');
      assert.match(contenu, /ghp_/, 'il porte bien un faux jeton');
      for (const { re } of INTERDITS) assert.ok(!re.test(contenu), `${f} déclenche un interdit`);
    }
  });
});
