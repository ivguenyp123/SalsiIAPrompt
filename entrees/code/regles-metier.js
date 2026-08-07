// [hub] Extrait de hub.js — suggestions/rules.js (portée globale, script classique)
        // ───── Moteur de règles ────────────────────────────────────────────
        const SUGGESTION_RULES = [
            // ════════ MESURER ════════
            {
                id: 'dora_degraded',
                evaluate(syn, history) {
                    if (!syn.dora || !syn.dora.globalLevel) return null;
                    const prev = findEntryNearDaysAgo(history, 7);
                    if (!prev || !prev.syn.dora) return null;
                    const prevRank = LEVEL_RANK[prev.syn.dora.globalLevel];
                    const curRank = LEVEL_RANK[syn.dora.globalLevel];
                    if (prevRank > curRank) {
                        return {
                            tag: 'measure', tagLabel: 'Mesurer', direction: 'measure',
                            text: `Ton DORA est passé de <strong>${prev.syn.dora.globalLevel}</strong> à <strong>${syn.dora.globalLevel}</strong> cette semaine. Voir où ça coince.`,
                            cta: 'Voir mes métriques',
                            severity: 9
                        };
                    }
                    return null;
                }
            },
            {
                id: 'cfr_drift',
                evaluate(syn, history) {
                    if (!syn.dora || syn.dora.cfr == null) return null;
                    const prev = findEntryNearDaysAgo(history, 7);
                    if (!prev || !prev.syn.dora || prev.syn.dora.cfr == null) return null;
                    const delta = syn.dora.cfr - prev.syn.dora.cfr;
                    if (delta > 3) {
                        return {
                            tag: 'measure', tagLabel: 'Mesurer', direction: 'measure',
                            text: `Ton CFR a légèrement bougé (<strong>+${delta.toFixed(1)}%</strong>). Identifier la cause des échecs récents.`,
                            cta: 'Voir les pipelines',
                            severity: 6
                        };
                    }
                    return null;
                }
            },

            // ════════ SÉCURITÉ (via INSPECTER) ════════
            {
                id: 'maturity_security_low',
                evaluate(syn) {
                    if (!syn.maturity || !syn.maturity.axes) return null;
                    const sec = syn.maturity.axes['Sécurité'];
                    if (sec == null || sec >= 60) return null;
                    const score = syn.maturity.score8 != null ? syn.maturity.score8.toFixed(1) : '?';
                    return {
                        tag: 'inspect', tagLabel: 'Sécurité', direction: 'inspect',
                        text: `Ta squad est à <strong>${score}/8</strong> sur l'axe Sécurité. ${sec < 40 ? '5' : '3'} défis disponibles cette semaine pour progresser.`,
                        cta: 'Voir les défis',
                        severity: sec < 40 ? 10 : 7
                    };
                }
            },

            // ════════ BUS FACTOR ════════
            {
                id: 'bus_factor_critical',
                evaluate(syn) {
                    if (!syn.busFactor || syn.busFactor.bf == null) return null;
                    if (syn.busFactor.bf >= 1.5) return null;
                    return {
                        tag: 'collab', tagLabel: 'Bus Factor', direction: 'collab',
                        text: `Un seul contributeur principal couvre l'essentiel du code. <strong>Risque de concentration critique</strong>. Pair programming recommandée.`,
                        cta: 'Identifier les zones à risque',
                        severity: 10
                    };
                }
            },
            {
                id: 'bus_factor_watch',
                evaluate(syn) {
                    if (!syn.busFactor || syn.busFactor.bf == null) return null;
                    if (syn.busFactor.bf < 1.5 || syn.busFactor.bf >= 2.5) return null;
                    return {
                        tag: 'collab', tagLabel: 'Bus Factor', direction: 'collab',
                        text: `Bus factor à <strong>${syn.busFactor.bf.toFixed(1)}</strong>. Quelques modules sont à risque de concentration. À surveiller.`,
                        cta: 'Identifier les zones à risque',
                        severity: 5
                    };
                }
            },

            // ════════ LIVRER ════════
            {
                id: 'no_deploys',
                evaluate(syn) {
                    if (!syn.deploys || syn.deploys.currentPerDay == null) return null;
                    if (syn.deploys.currentPerDay >= 0.1) return null;
                    return {
                        tag: 'deliver', tagLabel: 'Livrer', direction: 'deliver',
                        text: `Peu de déploiements sur les 30 derniers jours (<strong>${(syn.deploys.currentPerDay * 30).toFixed(0)}</strong> au total). Le pipeline est-il bien actif ?`,
                        cta: 'Voir le pipeline',
                        severity: 7
                    };
                }
            },
            {
                id: 'deploys_dropping',
                evaluate(syn) {
                    if (!syn.deploys || syn.deploys.delta == null) return null;
                    if (syn.deploys.delta >= -20) return null;
                    return {
                        tag: 'deliver', tagLabel: 'Livrer', direction: 'deliver',
                        text: `Ta vélocité a chuté de <strong>${Math.abs(syn.deploys.delta).toFixed(0)}%</strong> vs les 30j précédents. Quelque chose freine.`,
                        cta: 'Analyser le pipeline',
                        severity: 8
                    };
                }
            },
            {
                id: 'deploys_accelerating',
                evaluate(syn) {
                    if (!syn.deploys || syn.deploys.delta == null) return null;
                    if (syn.deploys.delta < 30) return null;
                    return {
                        tag: 'deliver', tagLabel: 'Livrer', direction: 'deliver',
                        text: `Ta vélocité a augmenté de <strong>+${syn.deploys.delta.toFixed(0)}%</strong>. Bonne dynamique — pense à tagger les releases.`,
                        cta: 'Voir les releases',
                        severity: 4
                    };
                }
            },

            // ════════ STABILITÉ / INSPECTER ════════
            {
                id: 'fail_rate_high',
                evaluate(syn) {
                    if (!syn.dora || syn.dora.cfr == null) return null;
                    if (syn.dora.cfr < 15) return null;
                    return {
                        tag: 'inspect', tagLabel: 'Stabilité', direction: 'inspect',
                        text: `Taux d'échec pipeline à <strong>${syn.dora.cfr.toFixed(1)}%</strong>. C'est élevé. Identifier les causes récurrentes.`,
                        cta: 'Audit du pipeline',
                        severity: 8
                    };
                }
            },
            {
                id: 'mttr_high',
                evaluate(syn) {
                    if (!syn.dora || syn.dora.mttr == null) return null;
                    if (syn.dora.mttr < 24) return null;
                    const hours = syn.dora.mttr;
                    const fmt = hours > 48 ? `${(hours / 24).toFixed(1)}j` : `${hours.toFixed(0)}h`;
                    return {
                        tag: 'inspect', tagLabel: 'Stabilité', direction: 'inspect',
                        text: `MTTR à <strong>${fmt}</strong>. Quand un pipeline casse, il met du temps à revenir au vert.`,
                        cta: 'Voir les pipelines',
                        severity: 6
                    };
                }
            },

            // ════════ COLLABORER ════════
            {
                id: 'lead_time_high',
                evaluate(syn) {
                    if (!syn.dora || syn.dora.lt == null) return null;
                    if (syn.dora.lt < 168) return null;
                    const days = (syn.dora.lt / 24).toFixed(1);
                    return {
                        tag: 'collab', tagLabel: 'Collaborer', direction: 'collab',
                        text: `Tes MRs traînent en moyenne <strong>${days}j</strong> avant merge. La review est-elle un goulot ?`,
                        cta: 'Analyser les MRs',
                        severity: 7
                    };
                }
            },

            // ════════ INSPECTER & SÉCURISER ════════
            {
                // Note sécu qui RÉGRESSE depuis 7j (tendance — la plus prioritaire)
                id: 'security_score_dropping',
                evaluate(syn, history) {
                    if (!syn.maturity || !syn.maturity.axes) return null;
                    const cur = syn.maturity.axes['Sécurité'];
                    if (cur == null) return null;
                    const prev = findEntryNearDaysAgo(history, 7);
                    if (!prev || !prev.syn.maturity || !prev.syn.maturity.axes) return null;
                    const old = prev.syn.maturity.axes['Sécurité'];
                    if (old == null) return null;
                    const delta = old - cur;
                    if (delta < 8) return null; // baisse significative seulement
                    return {
                        tag: 'inspect', tagLabel: 'Sécurité', direction: 'inspect',
                        text: `Ta conformité sécurité a chuté de <strong>${Math.round(old)}</strong> à <strong>${Math.round(cur)}</strong> cette semaine. Quelque chose s'est dégradé.`,
                        cta: 'Lancer le scan CIS',
                        severity: 10
                    };
                }
            },
            {
                // Branches obsolètes qui s'accumulent
                id: 'stale_branches_piling',
                evaluate(syn) {
                    if (!syn.maturity || syn.maturity.staleBranches == null) return null;
                    const stale = syn.maturity.staleBranches;
                    if (stale < 10) return null;
                    const merged = syn.maturity.mergedBranches || 0;
                    return {
                        tag: 'inspect', tagLabel: 'Inspecter', direction: 'inspect',
                        text: `<strong>${stale}</strong> branches obsolètes s'accumulent${merged > 0 ? ` (dont ${merged} déjà mergées)` : ''}. Un nettoyage s'impose.`,
                        cta: 'Nettoyer les branches',
                        severity: stale >= 20 ? 6 : 4
                    };
                }
            },
            {
                // Branches obsolètes en forte hausse depuis 7j (tendance)
                id: 'stale_branches_growing',
                evaluate(syn, history) {
                    if (!syn.maturity || syn.maturity.staleBranches == null) return null;
                    const cur = syn.maturity.staleBranches;
                    const prev = findEntryNearDaysAgo(history, 7);
                    if (!prev || !prev.syn.maturity || prev.syn.maturity.staleBranches == null) return null;
                    const delta = cur - prev.syn.maturity.staleBranches;
                    if (delta < 5) return null;
                    return {
                        tag: 'inspect', tagLabel: 'Inspecter', direction: 'inspect',
                        text: `<strong>+${delta}</strong> branches obsolètes cette semaine. Le rythme de nettoyage ne suit pas.`,
                        cta: 'Voir les branches',
                        severity: 5
                    };
                }
            },

            // ════════ LIVRER & DÉPLOYER ════════
            {
                // Pas de fichier CI détecté (axe maturité ou absence de déploiements structurés)
                id: 'no_ci_pipeline',
                evaluate(syn) {
                    if (!syn.maturity || !syn.maturity.axes) return null;
                    // L'axe Hygiène inclut la présence du .gitlab-ci.yml ; proxy raisonnable
                    const hyg = syn.maturity.axes['Hygiène'];
                    if (hyg == null || hyg >= 60) return null;
                    return {
                        tag: 'deliver', tagLabel: 'Livrer', direction: 'deliver',
                        text: `Ton pipeline CI/CD semble incomplet. Un pipeline standardisé fiabilise tes déploiements.`,
                        cta: 'Générer le pipeline',
                        severity: 5
                    };
                }
            },

            // ════════ COLLABORER & AMÉLIORER ════════
            {
                // L'axe le plus faible touche la collaboration → pousser une rétro
                id: 'weakest_is_collab',
                evaluate(syn) {
                    if (!syn.maturity || !syn.maturity.weakest) return null;
                    const w = syn.maturity.weakest;
                    // Axes liés aux pratiques d'équipe / collaboration
                    if (!['Pratiques', 'Culture'].includes(w)) return null;
                    return {
                        tag: 'collab', tagLabel: 'Collaborer', direction: 'collab',
                        text: `Ton axe le plus faible est <strong>${w}</strong>. Une rétro basée sur tes données GitLab peut révéler les points de friction.`,
                        cta: 'Lancer une rétro',
                        severity: 4
                    };
                }
            },
            {
                // Culture basse : MRs mergées sans review (merge à l'aveugle)
                id: 'culture_low_review',
                evaluate(syn) {
                    if (!syn.maturity || !syn.maturity.axes) return null;
                    const c = syn.maturity.axes['Culture'];
                    if (c == null || c >= 55) return null;
                    return {
                        tag: 'collab', tagLabel: 'Collaborer', direction: 'collab',
                        text: `Beaucoup de MRs sont mergées sans review visible. Une review assistée renforce la qualité et le partage de connaissance.`,
                        cta: 'Ouvrir MR Reviewer',
                        severity: 6
                    };
                }
            },
            {
                // Résilience faible : les pipelines restent cassés longtemps
                id: 'resilience_low',
                evaluate(syn) {
                    if (!syn.maturity || !syn.maturity.axes) return null;
                    const r = syn.maturity.axes['Résilience'];
                    if (r == null || r >= 55) return null;
                    return {
                        tag: 'inspect', tagLabel: 'Résilience', direction: 'inspect',
                        text: `Tes pipelines mettent du temps à se rétablir après un échec. Analyser les causes récurrentes des échecs.`,
                        cta: 'Voir les pipelines',
                        severity: 7
                    };
                }
            },

            // ════════ FALLBACKS (cas tout va bien) ════════
            {
                id: 'all_elite',
                evaluate(syn) {
                    if (!syn.dora || syn.dora.eliteCount !== 4) return null;
                    return {
                        tag: 'measure', tagLabel: 'Mesurer', direction: 'measure',
                        text: `Tes 4 indicateurs DORA sont en <strong>Elite</strong>. Tu fais partie du top mondial. Comparer avec d'autres squads ?`,
                        cta: 'Voir le benchmark',
                        severity: 2
                    };
                }
            },
            {
                id: 'maturity_strong',
                evaluate(syn) {
                    if (!syn.maturity || syn.maturity.score8 == null) return null;
                    if (syn.maturity.score8 < 6) return null;
                    return {
                        tag: 'measure', tagLabel: 'Mesurer', direction: 'measure',
                        text: `Maturité à <strong>${syn.maturity.score8.toFixed(1)}/8</strong>. Très bon niveau. Voir l'évolution sur 3 mois ?`,
                        cta: 'Voir la progression',
                        severity: 2
                    };
                }
            },
            {
                id: 'good_distribution',
                evaluate(syn) {
                    if (!syn.busFactor || syn.busFactor.bf == null) return null;
                    if (syn.busFactor.bf < 3) return null;
                    return {
                        tag: 'collab', tagLabel: 'Bus Factor', direction: 'collab',
                        text: `Bus factor à <strong>${syn.busFactor.bf.toFixed(1)}</strong>. La connaissance est bien répartie. Continuer comme ça.`,
                        cta: 'Voir la distribution',
                        severity: 2
                    };
                }
            },
            {
                id: 'all_good',
                evaluate(syn) {
                    if (!syn.dora || !syn.dora.globalLevel) return null;
                    if (LEVEL_RANK[syn.dora.globalLevel] < 3) return null;
                    return {
                        tag: 'measure', tagLabel: 'Mesurer', direction: 'measure',
                        text: `Aucune alerte sur ce repo. Bon moment pour préparer la prochaine release ou un atelier rétro.`,
                        cta: 'Voir mes métriques',
                        severity: 1
                    };
                }
            }
        ];
