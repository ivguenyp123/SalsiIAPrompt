/*
 * Salsifi — thème clair / sombre partagé
 * ------------------------------------------------------------------
 * Un seul choix, mémorisé, appliqué sur toutes les pages.
 *
 * - Le thème est stocké dans localStorage sous 'salsifi-theme'
 *   ('dark' par défaut) et posé sur <html data-theme="…">.
 * - À charger dans le <head> AVANT les feuilles de style, en script
 *   bloquant, pour éviter tout flash au chargement :
 *       <script src="js/theme.js"></script>
 *       <link rel="stylesheet" href="css/theme.css">
 * - Le sélecteur (soleil / lune) vit sur le hub. Le choix se propage
 *   automatiquement : chaque page lit la même clé, et l'événement
 *   'storage' met à jour les onglets déjà ouverts en direct.
 *
 * API : window.SalsifiTheme.get() / .set('light'|'dark') / .toggle()
 *       Émet l'événement 'salsifi:themechange' (detail = { theme }).
 */
(function () {
    var KEY = 'salsifi-theme';
    var root = document.documentElement;

    function read() {
        try {
            var t = localStorage.getItem(KEY);
            return t === 'light' || t === 'dark' ? t : 'dark';
        } catch (e) { return 'dark'; }
    }

    function apply(theme) {
        root.setAttribute('data-theme', theme);
    }

    // Application immédiate (le script est bloquant dans le <head>).
    apply(read());

    var api = {
        get: read,
        set: function (theme) {
            theme = theme === 'light' ? 'light' : 'dark';
            try { localStorage.setItem(KEY, theme); } catch (e) {}
            apply(theme);
            try {
                window.dispatchEvent(new CustomEvent('salsifi:themechange', { detail: { theme: theme } }));
            } catch (e) {}
            return theme;
        },
        toggle: function () {
            return api.set(read() === 'light' ? 'dark' : 'light');
        },
        // Lit une variable CSS calculée. Utile pour le canvas (Chart.js) qui
        // ne résout pas var(--…) : on récupère la valeur du thème courant.
        cssVar: function (name, fallback) {
            var v = getComputedStyle(root).getPropertyValue(name).trim();
            return v || fallback || '';
        }
    };

    window.SalsifiTheme = api;
    // Alias court pour les configs de graphiques.
    window.cssVar = function (name, fallback) { return api.cssVar(name, fallback); };

    // Synchronisation entre onglets / pages déjà ouverts.
    window.addEventListener('storage', function (e) {
        if (e.key === KEY && e.newValue) {
            apply(e.newValue === 'light' ? 'light' : 'dark');
            try {
                window.dispatchEvent(new CustomEvent('salsifi:themechange', { detail: { theme: e.newValue } }));
            } catch (err) {}
        }
    });
})();
