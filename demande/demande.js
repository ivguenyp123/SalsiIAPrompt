/*
 * Demander un agent — un écran, un champ, et la file de validation au bout.
 *
 * ── POURQUOI CET ÉCRAN N'EST PAS UN BOUTON DU STUDIO ─────────────────────────
 *
 * Il l'a d'abord été, et c'était une erreur de public. Le Studio est l'établi de
 * l'AUTEUR : il montre les variables, les outils, les cibles assertables, les cas d'or.
 * Quelqu'un qui « voudrait un agent pour vérifier ses branches mortes » n'est pas auteur
 * d'artefacts — il a un besoin. Lui demander d'ouvrir un établi pour l'exprimer, c'est
 * lui demander d'apprendre le métier de quelqu'un d'autre avant d'avoir le droit de
 * demander quelque chose.
 *
 * Ici : une phrase, un bouton. Le vocabulaire du registre — `criteria`, `golden_cases`,
 * `model_tier` — n'apparaît nulle part. Il est pourtant tout entier dans le fichier
 * déposé : c'est le travail du modèle, pas celui du demandeur.
 *
 * ── CE QUE L'ÉCRAN MONTRE, ET POURQUOI ───────────────────────────────────────
 *
 * Le déroulé en direct, tours de correction compris. On pourrait n'afficher que le
 * résultat ; ce serait plus propre et moins vrai. Voir le linter refuser « outil inconnu »
 * puis le modèle corriger est ce qui fait comprendre, sans une ligne d'explication, que
 * la machine n'a pas eu le dernier mot.
 *
 * Et le PROMPT en clair. C'est la substance de ce qu'on demande : quelqu'un qui ne le lit
 * pas ne peut pas dire si l'agent fait ce qu'il voulait, et il sera le premier à s'en
 * plaindre après.
 */
import { requireSession, clear } from '../app/session.js';
import { createForge, toBase64 } from '../app/forge.js';
import { mountShell } from '../app/shell.js';
import { knownScopes, guessScope } from '../app/scopes.js';
import { entete } from '../lib/provenance.js';
import { aplatir, confronter, familles, filtrer, compter } from '../lib/inventaire.js';
import yaml from '../lib/yaml.js';

const session = requireSession('../app/login.html');
if (!session) await new Promise(() => {});

const forge = createForge(session);
const repoRegistre = () => localStorage.getItem('salsi_ia_registry_repo') || '';

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), attrs);
  for (const k of kids) if (k !== null && k !== undefined) n.append(k);
  return n;
};

mountShell({ active: 'demande', session, base: '../', onLogout: () => { clear(); location.href = '../app/login.html'; } });

const FRAIS = { cache: 'no-cache' };

/* ── Le catalogue de ce qu'on PEUT demander ───────────────────────────────────
 *
 * Quatre exemples en dur montraient le FORMAT d'une demande, pas son ÉTENDUE. Quelqu'un
 * qui ne voit que « vérifier mes branches mortes » ne devinera jamais qu'il peut demander
 * un plan de décommission de feature flag ou la chronologie d'un incident.
 *
 * `inventaire/hub-devops.yaml` porte 82 capacités tirées de la surface RÉELLE du hub —
 * ses 20 modules, leurs actions, leurs sorties. Chaque ligne est la PHRASE à envoyer :
 * un clic la pose dans le champ, et c'est parti. Un inventaire dont les lignes ne sont
 * pas actionnables en un clic redevient un document, et un document ne crée aucun agent.
 *
 * L'état — « au registre » contre « à créer » — n'est écrit nulle part : il se calcule en
 * confrontant l'inventaire aux artefacts PUBLIÉS. Un catalogue qui mentirait sur ce qui
 * existe déjà ferait créer deux fois le même agent.
 */
let CATALOGUE = [];
let familleActive = '';

async function chargerCatalogue() {
  const [brut, publies] = await Promise.all([
    fetch('../inventaire/hub-devops.yaml', FRAIS).then((r) => r.text()).then((t) => yaml.parse(t)),
    // Les artefacts du dossier `artifacts/` : le VALIDÉ. Ce qui attend en revue n'existe
    // pas encore pour celui qui demande — le lui présenter comme fait serait faux.
    forge.listFiles(repoRegistre(), 'artifacts')
      .then((fs) => fs.filter((f) => f.type === 'file' && /\.ya?ml$/.test(f.name))
                       .map((f) => f.name.replace(/\.ya?ml$/, '')))
      .catch(() => [])
  ]);

  CATALOGUE = confronter(aplatir(brut), publies);
  rendreFamilles();
  rendreCatalogue();
}

function rendreFamilles() {
  const zone = $('catFamilles');
  zone.textContent = '';

  const bouton = (cle, texte) => {
    const b = el('button', { type: 'button', textContent: texte,
                             className: familleActive === cle ? 'on' : '' });
    b.onclick = () => { familleActive = cle; rendreFamilles(); rendreCatalogue(); };
    return b;
  };

  zone.append(bouton('', 'Tout'));
  for (const f of familles(CATALOGUE)) {
    zone.append(bouton(f.cle, `${f.icone} ${f.titre} · ${f.total}`));
  }
}

function rendreCatalogue() {
  const liste = $('catListe');
  liste.textContent = '';

  const vus = filtrer(CATALOGUE, { q: $('catQ').value, famille: familleActive });
  const c = compter(CATALOGUE);
  $('catCompte').textContent = `${c.total} capacités possibles · ${c.faits} déjà au registre`
    + (vus.length !== c.total ? ` · ${vus.length} affichée(s)` : '');

  if (vus.length === 0) {
    liste.append(el('div', { className: 'cat-vide', textContent:
      'Rien ne correspond. Le catalogue n\'est qu\'une amorce — écris ton besoin dans le '
      + 'champ, il n\'a pas besoin d\'y figurer.' }));
    return;
  }

  for (const p of vus) {
    const b = el('button', { type: 'button', className: 'cat-ligne' },
      el('span', {},
        el('b', { textContent: p.titre }),
        el('small', { textContent: p.besoin }),
        el('span', { className: 'mod', textContent: `${p.icone} ${p.module}` })),
      el('span', { className: 'sp' }),
      /*
       * « Au registre » NE SUFFIT PAS QUAND L'AGENT PORTE UN AUTRE NOM.
       *
       * Une capacité peut être couverte par un agent qui ne s'appelle pas comme la
       * question — `nettoyer-un-depot` est répondu par « Le régime du dépôt ». Dire
       * seulement « ça existe » envoie alors quelqu'un chercher au Catalogue un nom qui
       * n'y est pas, et il finira par redemander l'agent. L'infobulle nomme donc CELUI
       * qu'il faut ouvrir.
       */
      el('span', { className: `cat-etat ${p.etat}`,
                   textContent: p.etat === 'au-registre' ? 'au registre' : 'à créer',
                   title: p.etat !== 'au-registre'
                     ? 'Personne ne l\'a encore demandé.'
                     : (p.par && p.par !== p.id
                       ? `Déjà couvert au Catalogue par « ${p.par} ».`
                       : 'Cet agent existe déjà : tu peux l\'ouvrir au Catalogue.') }));
    b.onclick = () => {
      $('besoin').value = p.besoin;
      $('besoin').focus();
      $('besoin').scrollIntoView({ block: 'nearest' });
    };
    liste.append(b);
  }
}

/* ── Le périmètre ─────────────────────────────────────────────────────────────
 *
 * Il n'est pas décoratif : c'est lui qui décide quels outils l'agent aura le droit
 * d'invoquer (L006). On le DÉDUIT du dépôt de travail choisi à l'accueil, et on le montre
 * quand même — deviner en silence ferait signer un périmètre qu'on n'a pas choisi.
 */
let scopes = [];

async function chargerPerimetres() {
  const tools = await fetch('../registries/tools.yaml', FRAIS)
    .then((r) => r.text()).then((t) => yaml.parse(t).tools);
  scopes = knownScopes(tools);

  const devine = guessScope(localStorage.getItem('salsi_ia_project_path') || '', scopes);
  const select = $('perimetre');
  select.textContent = '';
  for (const s of scopes) select.append(el('option', { value: s, textContent: s }));
  select.value = devine || scopes[0] || '';
}

/* ── Le déroulé ───────────────────────────────────────────────────────────── */

const etapes = $('etapes');

function etape(icone, titre, detail, classe = '') {
  const n = el('div', { className: `etape ${classe}` },
    el('span', { className: 'ic', textContent: icone }),
    el('span', {}, el('b', { textContent: titre }),
                   detail ? el('small', { className: /\n/.test(detail) ? 'codes' : '',
                                          textContent: detail }) : null));
  etapes.append(n);
  return n;
}

/* ── Le résultat ──────────────────────────────────────────────────────────── */

function fiche(artefact, corps) {
  const f = el('div', { className: 'fiche' });
  f.append(el('h2', { textContent: artefact.title || artefact.id }));
  f.append(el('p', { className: 'purpose', textContent: artefact.intent?.purpose || '' }));

  if (artefact.intent?.not_for) {
    f.append(el('h4', { textContent: 'Quand ne PAS l\'utiliser' }));
    f.append(el('p', { className: 'purpose', style: 'margin:0', textContent: artefact.intent.not_for }));
  }

  // Le prompt, en clair. C'est ce qu'on demande vraiment.
  f.append(el('h4', { textContent: 'Les instructions qu\'il suivra' }));
  f.append(el('pre', { textContent: artefact.spec || '' }));

  f.append(el('h4', { textContent: 'Ce qu\'on vérifiera sur sa réponse, à chaque fois' }));
  const puces = el('div', { className: 'compte' });
  for (const c of artefact.criteria || []) {
    puces.append(el('span', { className: 'chip', textContent: `${c.target} ${c.op} ${JSON.stringify(c.value)}` }));
  }
  f.append(puces.children.length ? puces
    : el('p', { className: 'purpose', style: 'margin:0', textContent: 'Rien ne sera vérifié sur sa réponse.' }));

  const gc = (artefact.golden_cases || []).length;
  const vars = (artefact.variables || []).length;
  f.append(el('div', { className: 'compte' },
    el('span', { className: 'chip', textContent: `${vars} entrée${vars > 1 ? 's' : ''} nécessaire${vars > 1 ? 's' : ''}` }),
    el('span', { className: 'chip', textContent: `${gc} cas de test écrit${gc > 1 ? 's' : ''}` })));

  /*
   * Le YAML, replié. Le demandeur n'a pas à le lire ; le relecteur, si, et il arrive
   * parfois que ce soit la même personne. Le cacher entièrement obligerait à aller
   * chercher le fichier au dépôt pour une vérification de dix secondes.
   */
  const det = el('details');
  det.append(el('summary', { textContent: 'Voir le fichier tel qu\'il sera déposé' }));
  det.append(el('pre', { textContent: corps.yaml || '' }));
  f.append(det);

  f.append(el('div', { className: 'avert' },
    el('b', { textContent: 'Les contrôles ont jugé sa FORME, pas ce qu\'il produit.' }),
    el('small', { textContent:
      'Les 25 règles vérifient qu\'il est complet, que ses outils existent et que son '
      + 'contrat est vérifiable. Aucun de ses cas de test n\'a été joué : ce qu\'il fait '
      + 'vraiment se mesurera au banc d\'essai, après validation.' })));

  return f;
}

/* ── Départ ───────────────────────────────────────────────────────────────── */

$('catQ').oninput = () => rendreCatalogue();

chargerPerimetres().catch((error) => {
  etape('⚠', 'Registre des outils illisible', error.message, 'ko');
});

chargerCatalogue().catch((error) => {
  // Le catalogue est un CONFORT : il montre l'étendue de ce qui est possible. S'il ne
  // charge pas, on peut toujours écrire son besoin — c'est le champ qui compte.
  $('catCompte').textContent = 'Catalogue indisponible — écris ton besoin, ça marche pareil.';
  $('catListe').append(el('div', { className: 'cat-vide', textContent: error.message }));
});

$('envoyer').onclick = async () => {
  const phrase = $('besoin').value.trim();
  const resultat = $('resultat');
  etapes.textContent = '';
  resultat.textContent = '';

  if (phrase.length < 10) {
    etape('⚠', 'Dis-en un peu plus',
          'Quelques mots sur ce que tu veux obtenir. « un agent » ne dit pas ce qu\'il doit faire.', 'ko');
    $('besoin').focus();
    return;
  }

  const repo = repoRegistre();
  if (!repo) {
    etape('⚠', 'Aucun dépôt de registre choisi',
          'Retourne à l\'accueil pour en sélectionner un : c\'est là que les agents sont déposés.', 'ko');
    return;
  }

  const bouton = $('envoyer');
  bouton.disabled = true;
  const libelle = bouton.textContent;
  bouton.textContent = 'En cours…';

  try {
    const enCours = etape('✨', 'Traduction de ta phrase en agent',
                          'Un modèle écrit, le registre juge, et corrige jusqu\'à trois fois.');

    const reponse = await fetch('../api/rediger', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phrase, auteur: session.username, scope: $('perimetre').value })
    });
    const corps = await reponse.json();
    enCours.remove();

    if (!reponse.ok) {
      etape('✕', 'La traduction n\'a pas abouti', corps.erreur || `Le serveur a répondu ${reponse.status}.`, 'ko');
      return;
    }

    // Le déroulé, tour par tour. Voir le refus puis la correction vaut mieux qu'un
    // paragraphe expliquant que le linter gouverne.
    for (const t of corps.tours) {
      if (t.illisible) { etape('⚠', `Tour ${t.tour} — réponse illisible`, t.illisible); continue; }
      if (t.erreurs === 0) {
        etape('✔', `Tour ${t.tour} — les 25 règles le laissent passer`,
              t.avertissements ? `${t.avertissements} remarque(s) non bloquante(s).` : '', 'ok');
      } else {
        etape('↩', `Tour ${t.tour} — ${t.erreurs} refus, renvoyés au modèle`,
              t.constats.filter((c) => c.severity === 'error')
                        .map((c) => `${c.code} · ${c.message}`).join('\n'));
      }
    }

    if (!corps.artefact) {
      etape('✕', 'Rien d\'exploitable', 'Réessaie en reformulant ton besoin.', 'ko');
      return;
    }

    $('resultat').append(fiche(corps.artefact, corps));

    if (corps.abandon) {
      $('resultat').append(el('div', { className: 'verdict ko' },
        el('span', { textContent:
          `✕ Le registre refuse encore ce brouillon (${corps.report?.errors || 0} erreur(s)). `
          + 'Il n\'a pas été déposé.' }),
        el('small', { textContent:
          'Reformule en disant plus précisément ce que l\'agent doit LIRE et ce qu\'il doit '
          + 'PRODUIRE — c\'est presque toujours ce qui manque. Un auteur peut aussi le '
          + 'reprendre au Studio : la charpente est là.' })));
      return;
    }

    /* ── Le dépôt ─────────────────────────────────────────────────────────────
     *
     * `artifacts/pending/` EST la validation humaine. Rien de ce qui s'y trouve n'est
     * exécutable ni visible au Catalogue ; l'écran d'Admin accepte ou refuse pièce par
     * pièce, avec le fichier entier et le verdict du lint sous les yeux.
     *
     * La PROVENANCE part avec le fichier, en commentaires de tête : le relecteur doit
     * savoir qu'un modèle a écrit ça et à partir de quelle phrase. On ne relit pas de la
     * même façon ce qu'une machine a produit.
     */
    const chemin = `artifacts/pending/${corps.artefact.id}.yaml`;
    const tete = entete({ origine: 'demande', phrase, auteur: session.username,
                          date: new Date().toISOString().slice(0, 10),
                          tours: corps.tours.length, modele: corps.modele,
                          fournisseur: corps.fournisseur });

    await forge.putFile(repo, chemin, {
      content: toBase64(tete + corps.yaml),
      message: `registre : demander ${corps.artefact.title}\n\n`
             + `Demandé par ${session.username} : « ${phrase} ».\n`
             + `Rédigé par un modèle (${corps.modele}), ${corps.tours.length} tour(s) de `
             + 'correction par le linter.\nEn attente de validation humaine.',
      branch: 'main'
    });

    $('resultat').append(el('div', { className: 'verdict ok' },
      el('span', {}, '✔ Déposé pour validation — ', el('code', { textContent: chemin }), '.'),
      el('small', { textContent:
        'Un humain doit l\'accepter avant qu\'il apparaisse au Catalogue. Tant qu\'il est '
        + 'en attente, personne ne peut l\'exécuter.' }),
      el('div', { className: 'refait' },
        el('a', { className: 'primary', href: '../admin/index.html',
                  textContent: 'Voir la file de validation' }),
        el('a', { href: './index.html', textContent: 'En demander un autre' }))));

  } catch (error) {
    etape('✕', 'Le dépôt a échoué', error.message, 'ko');
  } finally {
    bouton.disabled = false;
    bouton.textContent = libelle;
  }
};
