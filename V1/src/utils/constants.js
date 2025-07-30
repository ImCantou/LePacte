module.exports = {
    PACTE_RULES: `
**PACTE D'HONNEUR DE L'ABÎME HURLANT**

*En apposant ma signature sur ce pacte sacré, je m'engage devant mes pairs et les anciennes puissances de l'Abîme à :*

**Article I - De l'Engagement Solennel**
Poursuivre sans relâche l'objectif de [X] victoires consécutives en ARAM aux côtés de mes compagnons d'armes, dans l'honneur et la détermination, jusqu'à ce que gloire nous soit rendue ou que l'échec nous sépare.

**Article II - Des Conditions Impératives**
- Toute bataille doit se dérouler sur le pont de l'Abîme Hurlant (ARAM uniquement)
- L'intégralité des signataires doit combattre côte à côte dans chaque affrontement
- Le pacte prend fin 24 heures après l'apposition de la dernière signature
- Une unique défaite ramène le décompte au néant
- Nul remake ne saurait être compté dans la quête

**Article III - De l'Honneur et du Déshonneur**
- La réussite de cette quête octroiera [POINTS] points de gloire éternelle
- L'échec de cette entreprise coûtera [MALUS] points d'honneur
- L'abandon en cours de route sera considéré comme une défaite
- La meilleure série atteinte sera gravée dans les annales

**Article IV - Des Droits et Devoirs**
- Un combattant peut se retirer du pacte mais subira le déshonneur
- Un nouveau champion peut rejoindre la quête si aucune victoire n'est encore acquise
- Chaque signataire s'engage à donner le meilleur de lui-même
- Les excuses et justifications sont proscrites en cas d'échec

**Article V - Du Serment Inviolable**
*"Par les vents glacés de Freljord et les brumes de l'Abîme, je jure de respecter cet engagement jusqu'à son terme. Que la victoire nous sourie ou que la défaite nous accable, j'affronterai mon destin aux côtés de mes compagnons."*

**Pour sceller ce pacte de votre honneur, inscrivez : "Je signe"**
`,

    POINTS_TABLE: {
        3: 5,
        4: 15,
        5: 40,
        6: 100,
        7: 250,
        8: 400,
        9: 550,
        10: 700
    },

    BONUS_PER_WIN: 2,
    MALUS_MULTIPLIER: 10,
    EXTRA_WIN_POINTS: 150,

    TAUNTS: {
        generic: [
            "Toujours là ?",
            "La pression monte...",
            "Une de plus ou c'est fini ?",
            "Les dieux de l'ARAM vous observent",
            "L'Abîme Hurlant retient son souffle...",
            "Le pont tremble sous vos pas...",
            "Les Poros vous regardent avec espoir",
            "La légende est en marche..."
        ],
        victory: [
            "Les étoiles s'alignent !",
            "L'Abîme chante votre gloire !",
            "Un pas de plus vers la légende...",
            "Les anciens approuvent !"
        ],
        defeat: [
            "L'Abîme pleure...",
            "Les Poros baissent la tête",
            "Le destin en a décidé autrement",
            "La route est encore longue..."
        ],
        lastOne: "**C'EST LA DERNIÈRE ! L'ABÎME RETIENT SON SOUFFLE !**",
        almostThere: "💔 Si proche... L'Abîme a tremblé !",
        timeRunningOut: "⏰ Le temps presse ! Plus que [HOURS]h pour accomplir votre destinée !"
    },

    QUEUE_ID: {
        ARAM: 450
    },

    REGION_MAPPING: {
        'euw1': 'europe',
        'eune': 'europe',
        'na1': 'americas',
        'br1': 'americas',
        'jp1': 'asia',
        'kr': 'asia',
        'la1': 'americas',
        'la2': 'americas',
        'oc1': 'sea',
        'ru': 'europe',
        'tr1': 'europe'
    }
};